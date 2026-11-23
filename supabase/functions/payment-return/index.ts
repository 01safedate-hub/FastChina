import { createClient } from "npm:@supabase/supabase-js@2";
const projectUrl = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(projectUrl,key,{auth:{persistSession:false,autoRefreshToken:false}});
const configuredSite = Deno.env.get("SITE_URL") || "https://fastchina.shop";
let siteOrigin = "https://fastchina.shop";
try { siteOrigin = new URL(configuredSite).origin; } catch { console.error("Invalid SITE_URL; using canonical origin"); }
const go = (path: string) => Response.redirect(new URL(path.startsWith("/") ? path : `/${path}`, siteOrigin), 302);
async function confirmation(status: "success" | "pending" | "unverified", code?: string) {
  const params = new URLSearchParams({ status });
  if (code) params.set("code", code);
  return go(`/payment/confirmation?${params.toString()}`);
}
Deno.serve(async req => {
  const q = new URL(req.url).searchParams;
  const provider = q.get("provider");
  const reference = provider === "paystack" ? q.get("reference") : q.get("tx_ref");
  const transactionId = q.get("transaction_id");
  if ((provider !== "paystack" && provider !== "flutterwave") || !reference) return confirmation("unverified");
  let orderCode: string | undefined;
  try {
    const {data:p,error} = await db.from("payment_transactions").select("purpose,amount_ngn,order_id,status").eq("provider",provider).eq("reference",reference).maybeSingle();
    if (error || !p) return confirmation("unverified");
    if (p.purpose === "order" && p.order_id) {
      const {data:o} = await db.from("orders").select("code").eq("id",p.order_id).maybeSingle();
      orderCode = o?.code ?? undefined;
    }
    if (p.status !== "success") {
      let v:Record<string,unknown>;
      if (provider === "paystack") {
        const secret = Deno.env.get("PAYSTACK_SECRET_KEY"); if (!secret) throw new Error("Paystack secret missing");
        const r = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,{headers:{Authorization:`Bearer ${secret}`}});
        const j = await r.json(); if (!r.ok || j.status !== true || j.data?.status !== "success") throw new Error("Payment not verified");
        v = j.data; if (v.reference !== reference || v.currency !== "NGN" || Number(v.amount) !== Number(p.amount_ngn)*100) throw new Error("Payment mismatch");
      } else {
        const secret = Deno.env.get("FLUTTERWAVE_SECRET_KEY"); if (!secret || !transactionId || !/^\\d+$/.test(transactionId)) throw new Error("Invalid Flutterwave return");
        const r = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`,{headers:{Authorization:`Bearer ${secret}`}});
        const j = await r.json(); if (!r.ok || j.status !== "success" || j.data?.status !== "successful") throw new Error("Payment not verified");
        v = j.data; if (v.tx_ref !== reference || v.currency !== "NGN") throw new Error("Payment mismatch");
      }
      const amount = provider === "paystack" ? Number(v.amount)/100 : Number(v.amount);
      if (!Number.isSafeInteger(amount) || amount !== Number(p.amount_ngn)) throw new Error("Amount mismatch");
      const {error:re} = await db.rpc("record_verified_payment",{p_provider:provider,p_reference:reference,p_provider_transaction_id:String(v.id),p_amount_ngn:amount,p_currency:"NGN",p_payload:v});
      if (re) throw re;
    }
    return confirmation("success", orderCode);
  } catch (error) {
    console.error("Payment return verification failed", {provider, reference, reason:error instanceof Error ? error.message : String(error)});
    return confirmation("pending", orderCode);
  }
});
