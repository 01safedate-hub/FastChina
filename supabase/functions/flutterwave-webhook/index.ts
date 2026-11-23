import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function safeEqual(a: string, b: string) {
  if (!a || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const webhookSecret = Deno.env.get("FLUTTERWAVE_WEBHOOK_SECRET");
  const apiSecret = Deno.env.get("FLUTTERWAVE_SECRET_KEY");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!webhookSecret || !apiSecret || !supabaseUrl || !serviceKey) return json({ error: "Payment webhook is not configured" }, 500);
  const signature = req.headers.get("verif-hash") ?? "";
  if (!safeEqual(signature, webhookSecret)) return json({ error: "Invalid signature" }, 401);

  let event: any;
  try { event = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }
  if (event?.event !== "charge.completed" || !event?.data?.tx_ref || !event?.data?.id) {
    return json({ received: true, ignored: true });
  }
  const reference = String(event.data.tx_ref);
  const transactionId = String(event.data.id);
  const eventId = `charge.completed:${reference}:${transactionId}`;
  const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const { data: prior } = await db.from("payment_webhook_events").select("id,processed_at")
    .eq("provider", "flutterwave").eq("event_id", eventId).maybeSingle();
  if (prior?.processed_at) return json({ received: true, duplicate: true });
  if (prior) {
    await db.from("payment_webhook_events").update({ payload: event, processing_error: null }).eq("id", prior.id);
  } else {
    const { error: insertError } = await db.from("payment_webhook_events").insert({
      provider: "flutterwave", event_id: eventId, event_type: event.event, reference, payload: event
    });
    if (insertError) {
      const { data: raced } = await db.from("payment_webhook_events").select("id,processed_at")
        .eq("provider", "flutterwave").eq("event_id", eventId).maybeSingle();
      if (raced?.processed_at) return json({ received: true, duplicate: true });
      if (!raced) return json({ error: "Could not record webhook event" }, 500);
    }
  }

  try {
    const { data: payment, error: lookupError } = await db.from("payment_transactions")
      .select("amount_ngn,status").eq("provider", "flutterwave").eq("reference", reference).maybeSingle();
    if (lookupError || !payment) throw new Error("Unknown payment reference");
    if (payment.status === "success") {
      await db.from("payment_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null })
        .eq("provider", "flutterwave").eq("event_id", eventId);
      return json({ received: true, alreadyProcessed: true });
    }

    const verifyResponse = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
      headers: { Authorization: `Bearer ${apiSecret}` }
    });
    const verifyResult = await verifyResponse.json();
    const tx = verifyResult?.data;
    if (!verifyResponse.ok || verifyResult?.status !== "success" || tx?.status !== "successful" ||
        tx?.tx_ref !== reference || tx?.currency !== "NGN" ||
        !Number.isSafeInteger(Number(tx?.amount)) || Number(tx.amount) !== Number(payment.amount_ngn)) {
      throw new Error("Flutterwave verification did not match the expected payment");
    }
    const { error: recordError } = await db.rpc("record_verified_payment", {
      p_provider: "flutterwave", p_reference: reference, p_provider_transaction_id: transactionId,
      p_amount_ngn: Number(tx.amount), p_currency: tx.currency, p_payload: tx
    });
    if (recordError) throw new Error("Verified payment could not be recorded");
    await db.from("payment_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null })
      .eq("provider", "flutterwave").eq("event_id", eventId);
    return json({ received: true, processed: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook processing failed";
    await db.from("payment_webhook_events").update({ processing_error: message })
      .eq("provider", "flutterwave").eq("event_id", eventId);
    return json({ error: "Webhook processing failed" }, 500);
  }
});