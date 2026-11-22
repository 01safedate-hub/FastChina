"use server";

import { randomUUID } from "node:crypto";
import { allow, TOO_MANY } from "@/lib/rate-limit";
import { getSessionUser } from "@/lib/supabase/auth";
import { hasSupabase } from "@/lib/supabase/env";
import { secretDb } from "@/lib/supabase/server";
import { startHostedPayment, type PaymentProvider } from "@/lib/payments/gateways";

export async function startOrderPayment(input: {
  code: unknown;
  phone: unknown;
  email: unknown;
  provider: unknown;
  amountNgn: unknown;
}): Promise<{ ok: true; checkoutUrl: string } | { ok: false; message: string }> {
  if (!hasSupabase) return { ok: false, message: "Payments are unavailable while the database is disconnected." };
  const provider = input.provider;
  if (provider !== "paystack" && provider !== "flutterwave") return { ok: false, message: "Choose a payment provider." };
  const code = typeof input.code === "string" ? input.code.trim().toUpperCase() : "";
  const phoneDigits = typeof input.phone === "string" ? input.phone.replace(/\\D/g, "") : "";
  const phone = phoneDigits.startsWith("234") ? `+${phoneDigits}` : phoneDigits.startsWith("0") ? `+234${phoneDigits.slice(1)}` : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const amount = Number(input.amountNgn);
  if (!/^[A-Z0-9]{8}$/.test(code) || !/^\\+234[789][01]\\d{8}$/.test(phone)) return { ok: false, message: "Order details could not be validated." };
  if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email) || email.length > 254) return { ok: false, message: "Enter a valid email address for your payment receipt." };
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, message: "Invalid payment amount." };
  if (!(await allow("payment-start", 5, 600))) return { ok: false, message: TOO_MANY };

  const user = await getSessionUser();
  const db = secretDb();
  const { data: order, error } = await db.from("orders")
    .select("id, customer_id, phone, total_ngn, paid_ngn, status, pay_mode")
    .eq("code", code).maybeSingle();
  if (error || !order) return { ok: false, message: "We couldn't find this order." };
  if (order.customer_id && order.customer_id !== user?.id) return { ok: false, message: "Sign in with the account used for this order." };
  if (!order.customer_id && order.phone !== phone) return { ok: false, message: "The phone number does not match this order." };
  if (!["awaiting_payment", "part_paid"].includes(order.status)) return { ok: false, message: "This order is not awaiting payment." };
  const remaining = Number(order.total_ngn) - Number(order.paid_ngn);
  if (amount > remaining || (order.pay_mode === "full" && amount !== remaining)) {
    return { ok: false, message: "The payment amount does not match the remaining order balance." };
  }
  const reference = `FC-${randomUUID().replace(/-/g, "")}`;
  const { error: insertError } = await db.from("payment_transactions").insert({
    provider, purpose: "order", reference, order_id: order.id, customer_id: order.customer_id,
    amount_ngn: amount, currency: "NGN", status: "pending",
  });
  if (insertError) return { ok: false, message: "We couldn't prepare your payment. Please try again." };

  try {
    const origin = process.env.SITE_URL || process.env.NEXT_PUBLIC_SHOP_URL || "https://fastchina.shop";
    const callbackUrl = new URL("/api/payments/callback", origin);
    callbackUrl.searchParams.set("provider", provider);
    const hosted = await startHostedPayment({
      provider, reference, amountNgn: amount, email,
      callbackUrl: callbackUrl.toString(),
      description: `FastChina order ${code}`,
    });
    const { error: updateError } = await db.from("payment_transactions")
      .update({ checkout_url: hosted.checkoutUrl, provider_transaction_id: hosted.providerTransactionId })
      .eq("reference", reference).eq("provider", provider);
    if (updateError) throw updateError;
    return { ok: true, checkoutUrl: hosted.checkoutUrl };
  } catch {
    await db.from("payment_transactions").update({ status: "failed" }).eq("reference", reference).eq("provider", provider);
    return { ok: false, message: "The payment provider could not start checkout. No payment was taken." };
  }
}
