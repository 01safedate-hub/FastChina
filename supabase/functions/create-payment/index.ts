import { createClient } from "npm:@supabase/supabase-js@2";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const reply = (body: unknown, status=200) => new Response(JSON.stringify(body), { status, headers });
const url = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const normalizePhone = (v: unknown) => { const d = typeof v === "string" ? v.replace(/\D/g, "") : ""; return d.startsWith("234") ? `+${d}` : d.startsWith("0") ? `+234${d.slice(1)}` : ""; };
const validEmail = (v: unknown): v is string => typeof v === "string" && v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);

const attempts = new Map<string, { count: number; start: number }>();

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function flutterwavePayloadHash(amount: number, email: string, reference: string, secret: string): Promise<string> {
  // Flutterwave Checkout checksum: amount + currency + customer_email + tx_ref + SHA256(secret key).
  const hashedSecret = await sha256Hex(secret);
  return sha256Hex(`${amount}NGN${email}${reference}${hashedSecret}`);
}
async function initialize(provider: "paystack"|"flutterwave", reference: string, amount: number, email: string, callback: string, description: string) {
  if (provider === "paystack") {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) throw new Error("Paystack is not configured in Supabase Secrets.");
    const r = await fetch("https://api.paystack.co/transaction/initialize", { method:"POST", headers:{ Authorization:`Bearer ${secret}`, "Content-Type":"application/json" }, body:JSON.stringify({ email, amount:amount*100, currency:"NGN", reference, callback_url:callback, metadata:{description} }) });
    const j = await r.json();
    if (!r.ok || j.status !== true || typeof j.data?.authorization_url !== "string") throw new Error("Paystack could not start checkout.");
    return { checkoutUrl:j.data.authorization_url, transactionId:j.data.id == null ? null : String(j.data.id) };
  }
  const secret = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  if (!secret) throw new Error("Flutterwave is not configured in Supabase Secrets.");
  const payloadHash = await flutterwavePayloadHash(amount, email, reference, secret);
  const r = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      tx_ref: reference,
      amount,
      currency: "NGN",
      redirect_url: callback,
      customer: { email },
      payload_hash: payloadHash,
      customizations: { title: "FastChina", description },
      configuration: { session_duration: 30, max_retry_attempt: 3 },
    }),
  });

  const responseText = await r.text();
  let j: Record<string, any>;
  try {
    j = JSON.parse(responseText);
  } catch {
    console.error("Flutterwave returned non-JSON response", {
      httpStatus: r.status,
      requestId: r.headers.get("flw-request-id") || r.headers.get("x-request-id"),
      contentType: r.headers.get("content-type"),
    });
    throw new Error("Flutterwave returned an unreadable response. Please try again.");
  }

  if (!r.ok || j.status !== "success" || typeof j.data?.link !== "string") {
    console.error("Flutterwave checkout initialization failed", {
      httpStatus: r.status,
      providerStatus: j.status,
      providerMessage: j.message,
      requestId: r.headers.get("flw-request-id") || r.headers.get("x-request-id"),
    });
    throw new Error("Flutterwave could not create a checkout session. Please try again.");
  }

  let checkout: URL;
  try {
    checkout = new URL(j.data.link);
  } catch {
    console.error("Flutterwave returned an invalid checkout URL", { reference });
    throw new Error("Flutterwave returned an invalid checkout link.");
  }

  // Do not rewrite provider URLs: hosted-link tokens may be bound to their original host.
  // The supported hosted checkout origin in Flutterwave's current API documentation is checkout.flutterwave.com.
  if (
    checkout.protocol !== "https:" ||
    checkout.hostname !== "checkout.flutterwave.com" ||
    !/^\/v3\/hosted\/pay\/[^/]+$/.test(checkout.pathname)
  ) {
    console.error("Flutterwave returned an unsupported hosted-checkout URL", {
      reference,
      hostname: checkout.hostname,
      pathname: checkout.pathname,
      providerStatus: j.status,
      requestId: r.headers.get("flw-request-id") || r.headers.get("x-request-id"),
    });
    throw new Error("Flutterwave returned an unsupported test checkout address. The payment provider must correct this checkout link.");
  }

  return { checkoutUrl: checkout.toString(), transactionId: null };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", {headers});
  if (req.method !== "POST") return reply({ok:false,message:"Method not allowed."},405);
  const ip = (req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown").split(",")[0].trim();
  const now = Date.now();
  const bucket = attempts.get(ip);
  if (!bucket || now - bucket.start > 600000) attempts.set(ip, { count: 1, start: now });
  else if (bucket.count >= 12) return reply({ok:false,message:"Too many payment attempts. Please wait and try again."},429);
  else bucket.count += 1;
  try {
    const b = await req.json();
    const provider = b.provider;
    if (provider !== "paystack" && provider !== "flutterwave") return reply({ok:false,message:"Choose a payment provider."},400);
    const bearer = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i,"");
    let user: {id:string; email?:string} | null = null;
    if (bearer && !/^sb_publishable_/.test(bearer) && bearer !== Deno.env.get("SUPABASE_ANON_KEY")) {
      const {data,error} = await db.auth.getUser(bearer);
      if (!error && data.user) user = {id:data.user.id,email:data.user.email};
      else if (/^eyJ/.test(bearer)) return reply({ok:false,message:"Your session expired. Sign in again."},401);
    }
    const action = b.action || "order";
    const reference = `FC-${crypto.randomUUID().replace(/-/g,"")}`;
    let amount:number, email:string, description:string, row:Record<string,unknown>;
    if (action === "order") {
      const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
      const phone = normalizePhone(b.phone);
      if (!/^[A-Z0-9]{8}$/.test(code) || !/^\+234[789][01]\d{8}$/.test(phone)) return reply({ok:false,message:"Order details could not be validated."},400);
      if (!validEmail(b.email)) return reply({ok:false,message:"Enter a valid email address for your payment receipt."},400);
      amount = Number(b.amountNgn);
      if (!Number.isSafeInteger(amount) || amount <= 0) return reply({ok:false,message:"Invalid payment amount."},400);
      const {data:o,error} = await db.from("orders").select("id,customer_id,phone,total_ngn,paid_ngn,status,pay_mode").eq("code",code).maybeSingle();
      if (error || !o) return reply({ok:false,message:"We couldn't find this order."},404);
      if (o.customer_id && o.customer_id !== user?.id) return reply({ok:false,message:"Sign in with the account used for this order."},403);
      if (!o.customer_id && o.phone !== phone) return reply({ok:false,message:"The phone number does not match this order."},403);
      if (!["awaiting_payment","part_paid"].includes(o.status)) return reply({ok:false,message:"This order is not awaiting payment."},409);
      const remaining = Number(o.total_ngn)-Number(o.paid_ngn);
      if (amount > remaining || (o.pay_mode === "full" && amount !== remaining)) return reply({ok:false,message:"The payment amount does not match the remaining order balance."},400);
      email = b.email.trim().toLowerCase(); description = `FastChina order ${code}`;
      row = {provider,purpose:"order",reference,order_id:o.id,customer_id:o.customer_id,amount_ngn:amount,currency:"NGN",status:"pending"};
    } else if (action === "group_contribution") {
      const code = typeof b.code === "string" ? b.code.trim().toUpperCase() : "";
      const name = typeof b.contributorName === "string" ? b.contributorName.trim().slice(0, 60) : "A friend";
      if (!/^[A-Z0-9-]{4,20}$/.test(code)) return reply({ok:false,message:"This Group Pay link is invalid."},400);
      if (!validEmail(b.email)) return reply({ok:false,message:"Enter a valid email address for your receipt."},400);
      amount = Number(b.amountNgn);
      if (!Number.isSafeInteger(amount) || amount < 500) return reply({ok:false,message:"The minimum contribution is ₦500."},400);
      const {data:l,error:le} = await db.from("group_links").select("id,order_id,expires_at,settled_at").eq("code",code).maybeSingle();
      if (le || !l || l.settled_at || new Date(l.expires_at).getTime() <= Date.now()) return reply({ok:false,message:"This Group Pay link has closed."},410);
      const {data:o,error:oe} = await db.from("orders").select("total_ngn,paid_ngn,status").eq("id",l.order_id).maybeSingle();
      if (oe || !o || !["awaiting_payment","part_paid"].includes(o.status)) return reply({ok:false,message:"This order is no longer accepting contributions."},409);
      const remaining = Number(o.total_ngn)-Number(o.paid_ngn);
      if (remaining <= 0 || amount > remaining) return reply({ok:false,message:"The contribution amount exceeds the remaining balance."},400);
      if (amount < 500 && amount !== remaining) return reply({ok:false,message:"The minimum contribution is ₦500."},400);
      email = b.email.trim().toLowerCase(); description = `FastChina Group Pay contribution · ${code}`;
      row = {provider,purpose:"group_contribution",reference,group_link_id:l.id,contributor_name:name || "A friend",customer_id:user?.id ?? null,amount_ngn:amount,currency:"NGN",status:"pending"};
    } else if (action === "seller_subscription") {
      if (!user) return reply({ok:false,message:"Sign in before upgrading your seller plan."},401);
      if (b.plan !== "pro" && b.plan !== "elite") return reply({ok:false,message:"Choose Pro or Elite."},400);
      const {data:u,error:ue} = await db.auth.admin.getUserById(user.id);
      if (ue || !u.user?.email) return reply({ok:false,message:"Your account needs an email address before upgrading."},400);
      const {data:s,error:se} = await db.from("stores").select("id,plan").eq("owner_id",user.id).maybeSingle();
      if (se || !s) return reply({ok:false,message:"Open a store first."},404);
      const renewal = b.renewal === true;
      if (s.plan === b.plan && !renewal) return reply({ok:false,message:"Your store is already on this plan."},409);
      if (renewal) {
        if (s.plan !== b.plan) return reply({ok:false,message:"Renewal must match your current plan."},409);
        const {data:settings,error:settingsError} = await db.from("store_subscription_settings")
          .select("auto_renew,renewal_status").eq("store_id",s.id).maybeSingle();
        if (settingsError || !settings?.auto_renew || !["external_required","external_checkout_pending"].includes(settings.renewal_status)) {
          return reply({ok:false,message:"External renewal is not currently required for this store."},409);
        }
        const {data:pending,error:pendingError} = await db.from("payment_transactions")
          .select("reference,checkout_url").eq("store_id",s.id).eq("purpose","seller_subscription")
          .eq("subscription_plan",b.plan).eq("status","pending")
          .order("created_at",{ascending:false}).limit(1).maybeSingle();
        if (pendingError) return reply({ok:false,message:"Could not check an existing renewal checkout."},500);
        if (pending?.checkout_url) return reply({ok:true,checkoutUrl:pending.checkout_url,reference:pending.reference});
        if (pending) return reply({ok:false,message:"A renewal checkout is already being prepared. Try again shortly."},409);
      }
      amount = b.plan === "pro" ? 15000 : 45000; email = u.user.email; description = `FastChina ${b.plan.toUpperCase()} monthly seller plan`;
      row = {provider,purpose:"seller_subscription",reference,store_id:s.id,customer_id:user.id,amount_ngn:amount,currency:"NGN",subscription_plan:b.plan,subscription_months:1,status:"pending"};
    } else return reply({ok:false,message:"Unsupported payment action."},400);

    const {error:ie} = await db.from("payment_transactions").insert(row);
    if (ie) return reply({ok:false,message:"We couldn't prepare your payment. Please try again."},500);
    const callback = new URL("/functions/v1/payment-return",url); callback.searchParams.set("provider",provider);
    try {
      const hosted = await initialize(provider,reference,amount,email,callback.toString(),description);
      const {error:ue} = await db.from("payment_transactions").update({checkout_url:hosted.checkoutUrl}).eq("provider",provider).eq("reference",reference);
      if (ue) throw ue;
      if (action === "seller_subscription" && b.renewal === true) {
        const {error:settingsUpdateError} = await db.from("store_subscription_settings")
          .update({renewal_status:"external_checkout_pending",updated_at:new Date().toISOString()})
          .eq("store_id",row.store_id).eq("auto_renew",true);
        if (settingsUpdateError) throw settingsUpdateError;
      }
      return reply({ok:true,checkoutUrl:hosted.checkoutUrl,reference});
    } catch(e) {
      await db.from("payment_transactions").update({status:"failed"}).eq("provider",provider).eq("reference",reference);
      return reply({ok:false,message:e instanceof Error ? e.message : "The payment provider could not start checkout."},502);
    }
  } catch { return reply({ok:false,message:"Unable to start payment. Please try again."},400); }
});
