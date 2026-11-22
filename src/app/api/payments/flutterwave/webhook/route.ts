import { NextResponse } from "next/server";
import { verifyFlutterwaveWebhook } from "@/lib/payments/gateways";
import { fulfilVerifiedPayment } from "@/lib/payments/fulfil";
import { secretDb } from "@/lib/supabase/server";


export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyFlutterwaveWebhook(request.headers.get("verif-hash"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: { event?: unknown; data?: { reference?: unknown; tx_ref?: unknown; id?: unknown } };
  try { event = JSON.parse(raw) as typeof event; } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  const reference = typeof event?.data?.tx_ref === "string" ? event.data.tx_ref : "";
  const transactionId = event?.data?.id == null ? "" : String(event.data.id);
  if (!reference || !/^\d+$/.test(transactionId) || event?.event !== "charge.completed") {
    return NextResponse.json({ received: true });
  }

  const db = secretDb();
  const inserted = await db.from("payment_webhook_events").insert({
    provider: "flutterwave", event_id: transactionId, event_type: String(event.event),
    reference, payload: event,
  }).select("id").maybeSingle();

  if (inserted.error?.code === "23505") {
    const { data: prior } = await db.from("payment_webhook_events")
      .select("id, processed_at").eq("provider", "flutterwave").eq("event_id", transactionId).maybeSingle();
    if (prior?.processed_at) return NextResponse.json({ received: true, duplicate: true });
    try {
      await fulfilVerifiedPayment("flutterwave", reference, transactionId);
      if (prior) await db.from("payment_webhook_events").update({ processed_at: new Date().toISOString(), processing_error: null }).eq("id", prior.id);
      return NextResponse.json({ received: true, retried: true });
    } catch {
      return NextResponse.json({ error: "Payment verification failed" }, { status: 500 });
    }
  }
  if (inserted.error || !inserted.data) return NextResponse.json({ error: "Could not record event" }, { status: 500 });

  try {
    await fulfilVerifiedPayment("flutterwave", reference, transactionId);
    await db.from("payment_webhook_events").update({ processed_at: new Date().toISOString() }).eq("id", inserted.data.id);
    return NextResponse.json({ received: true });
  } catch (error) {
    await db.from("payment_webhook_events").update({ processing_error: error instanceof Error ? error.message.slice(0, 300) : "Processing failed" }).eq("id", inserted.data.id);
    return NextResponse.json({ error: "Payment verification failed" }, { status: 500 });
  }
}
