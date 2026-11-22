import "server-only";

import { secretDb } from "@/lib/supabase/server";
import { verifyFlutterwave, verifyPaystack, type PaymentProvider } from "@/lib/payments/gateways";

export async function fulfilVerifiedPayment(provider: PaymentProvider, reference: string, transactionId?: string) {
  const db = secretDb();
  const { data: payment, error: lookupError } = await db
    .from("payment_transactions")
    .select("id, purpose, amount_ngn, currency, status")
    .eq("provider", provider)
    .eq("reference", reference)
    .maybeSingle();

  if (lookupError || !payment) throw new Error("Unknown payment reference");
  if (payment.status === "success") return { alreadyProcessed: true };

  const verified = provider === "paystack"
    ? await verifyPaystack(reference)
    : await verifyFlutterwave(transactionId ?? "");

  const isSuccessful = verified.status === (provider === "paystack" ? "success" : "successful");
  const verifiedReference = provider === "paystack" ? verified.reference : verified.tx_ref;
  if (!isSuccessful || verifiedReference !== reference || verified.currency !== "NGN") {
    throw new Error("Payment is not verified as successful");
  }

  const amountNgn = provider === "paystack" ? verified.amount / 100 : verified.amount;
  if (!Number.isSafeInteger(amountNgn) || amountNgn !== Number(payment.amount_ngn)) {
    throw new Error("Verified payment amount does not match the expected amount");
  }

  const { data, error } = await db.rpc("record_verified_payment", {
    p_provider: provider,
    p_reference: reference,
    p_provider_transaction_id: String(verified.id),
    p_amount_ngn: amountNgn,
    p_currency: verified.currency,
    p_payload: verified,
  });
  if (error) throw new Error("Verified payment could not be recorded");
  return { alreadyProcessed: data === false };
}
