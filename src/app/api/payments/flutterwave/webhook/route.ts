import { NextResponse } from "next/server";
import { verifyFlutterwaveWebhook } from "@/lib/payments/gateways";
import { fulfilVerifiedPayment } from "@/lib/payments/fulfil";
import { secretDb } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const raw = await request.text();
  if (!verifyFlutterwaveWebhook(request.headers.get("verif-hash"))) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  const reference = typeof event?.data?.tx_ref === "string" ? event.data.tx_ref : "";
  const transactionId = event?.data?.id == null ? "" : String(event.data.id);
  if (!reference || !/^\\d+$/.test(transactionId) || event?.event !== "charge.completed") {
    return NextResponse.json({ received: true });
  }

  const db = secretDb();
  const inserted = await db.from("payment_webhook_events").insert({
    provider: "flutterwave", event_id: transactionId, event_type: String(event.event),
    reference, payload: event,
  }).select("id").maybeSingle();

  if (inserted.error?.code === "23505") return NextResponse.json({ received: true, duplicate: true });
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
