import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: corsHeaders });
const hex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
function equalHex(a: string, b: string) {
  if (!/^[a-f0-9]+$/i.test(a) || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function hmacSha512(secret: string, body: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body))));
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!secret || !supabaseUrl || !serviceKey) return json({ error: "Payment webhook is not configured" }, 500);
  const rawBody = await req.text();
  const signature = req.headers.get("x-paystack-signature") ?? "";
  const expected = await hmacSha512(secret, rawBody);
  if (!equalHex(signature, expected)) return json({ error: "Invalid signature" }, 401);

  let event: any;
  try { event = JSON.parse(rawBody); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (event?.event !== "charge.success" || !event?.data?.reference) return json({ received: true, ignored: true });
  const reference = String(event.data.reference);
  const eventId = `charge.success:${reference}:${String(event.data.id ?? "")}`;
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: prior } = await db.from("payment_webhook_events").select("id,processed_at")
    .eq("provider", "paystack").eq("event_id", eventId).maybeSingle();
  if (prior?.processed_at) return json({ received: true, duplicate: true });
  if (prior) {
    await db.from("payment_webhook_events").update({ payload: event, processing_error: null }).eq("id", prior.id);
  } else {
    const { error: insertError } = await db.from("payment_webhook_events").insert({
      provider: "paystack", event_id: eventId, event_type: event.event, reference, payload: event
    });
    if (insertError) {
      const { data: raced } = await db.from("payment_webhook_events").select("id,processed_at")
        .eq("provider", "paystack").eq("event_id", eventId).maybeSingle();
      if (raced?.processed_at) return json({ received: true, duplicate: true });
      if (!raced) return json({ error: "Could not record webhook event" }, 500);
    }
  }

  try {
    const { data: payment, error: lookupError } = await db.from("payment_transactions")
      .select("amount_ngn,status").eq("provider", "paystack").eq("reference", reference).maybeSingle();
    if (lookupError || !payment) throw new Error("Unknown payment reference");
    if (payment.status === "success") {
      await db.from("payment_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null })
        .eq("provider", "paystack").eq("event_id", eventId);
      return json({ received: true, alreadyProcessed: true });
    }

    const verifyResponse = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
      headers: { Authorization: `Bearer ${secret}` }
    });
    const verifyResult = await verifyResponse.json();
    const tx = verifyResult?.data;
    if (!verifyResponse.ok || verifyResult?.status !== true || tx?.status !== "success" ||
        tx?.reference !== reference || tx?.currency !== "NGN" ||
        !Number.isSafeInteger(Number(tx?.amount)) || Number(tx.amount) !== Number(payment.amount_ngn) * 100) {
      throw new Error("Paystack verification did not match the expected payment");
    }
    const { error: recordError } = await db.rpc("record_verified_payment", {
      p_provider: "paystack", p_reference: reference, p_provider_transaction_id: String(tx.id),
      p_amount_ngn: Number(tx.amount) / 100, p_currency: tx.currency, p_payload: tx
    });
    if (recordError) throw new Error("Verified payment could not be recorded");
    await db.from("payment_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq("provider", "paystack").eq("event_id", eventId);
    return json({ received: true, processed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    await db.from("payment_webhook_events").update({ processing_error: message })
      .eq("provider", "paystack").eq("event_id", eventId);
    return json({ error: "Webhook processing failed" }, 500);
  }
});