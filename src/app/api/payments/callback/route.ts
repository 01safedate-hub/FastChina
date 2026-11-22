import { NextResponse } from "next/server";
import { fulfilVerifiedPayment } from "@/lib/payments/fulfil";
import { secretDb } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  const reference = provider === "paystack"
    ? url.searchParams.get("reference")
    : url.searchParams.get("tx_ref");
  const transactionId = provider === "flutterwave" ? url.searchParams.get("transaction_id") : undefined;

  if ((provider !== "paystack" && provider !== "flutterwave") || !reference) {
    return NextResponse.redirect(new URL("/track?payment=unverified", url.origin));
  }

  try {
    await fulfilVerifiedPayment(provider, reference, transactionId ?? undefined);
    const { data: payment } = await secretDb()
      .from("payment_transactions")
      .select("purpose, order_id, store_id")
      .eq("provider", provider)
      .eq("reference", reference)
      .maybeSingle();

    if (payment?.purpose === "order" && payment.order_id) {
      const { data: order } = await secretDb().from("orders").select("code").eq("id", payment.order_id).maybeSingle();
      if (order?.code) return NextResponse.redirect(new URL(`/track?code=${encodeURIComponent(order.code)}&payment=verified`, url.origin));
    }
    return NextResponse.redirect(new URL("/store?payment=verified", url.origin));
  } catch {
    return NextResponse.redirect(new URL("/track?payment=pending", url.origin));
  }
}
