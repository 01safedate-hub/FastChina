import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

export type PaymentProvider = "paystack" | "flutterwave";

export interface StartHostedPaymentInput {
  provider: PaymentProvider;
  reference: string;
  amountNgn: number;
  email: string;
  name?: string;
  phone?: string;
  callbackUrl: string;
  description: string;
}

export interface HostedPayment {
  provider: PaymentProvider;
  reference: string;
  checkoutUrl: string;
  providerTransactionId: string | null;
}

function secretFor(provider: PaymentProvider): string {
  const value = provider === "paystack" ? process.env.PAYSTACK_SECRET_KEY : process.env.FLUTTERWAVE_SECRET_KEY;
  if (!value) throw new Error(`${provider} is not configured`);
  return value;
}

function validAmount(amount: number): void {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new Error("Invalid payment amount");
}

export async function startHostedPayment(input: StartHostedPaymentInput): Promise<HostedPayment> {
  validAmount(input.amountNgn);
  if (!input.email || !input.reference || !input.callbackUrl.startsWith("https://")) {
    throw new Error("Missing or invalid payment details");
  }

  const secret = secretFor(input.provider);
  if (input.provider === "paystack") {
    const response = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        email: input.email,
        amount: input.amountNgn * 100,
        currency: "NGN",
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: { description: input.description },
      }),
      cache: "no-store",
    });
    const result = await response.json();
    if (!response.ok || result.status !== true || typeof result.data?.authorization_url !== "string") {
      throw new Error("Paystack could not start this payment");
    }
    return { provider: input.provider, reference: input.reference, checkoutUrl: result.data.authorization_url, providerTransactionId: result.data.id == null ? null : String(result.data.id) };
  }

  const response = await fetch("https://api.flutterwave.com/v3/payments", {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      tx_ref: input.reference,
      amount: input.amountNgn,
      currency: "NGN",
      redirect_url: input.callbackUrl,
      customer: { email: input.email, name: input.name, phonenumber: input.phone },
      customizations: { title: "FastChina", description: input.description },
    }),
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || result.status !== "success" || typeof result.data?.link !== "string") {
    throw new Error("Flutterwave could not start this payment");
  }
  return { provider: input.provider, reference: input.reference, checkoutUrl: result.data.link, providerTransactionId: null };
}

export async function verifyPaystack(reference: string) {
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, {
    headers: { Authorization: `Bearer ${secretFor("paystack")}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || result.status !== true) throw new Error("Unable to verify Paystack transaction");
  return result.data as { status: string; reference: string; amount: number; currency: string; id: number };
}

export async function verifyFlutterwave(transactionId: string) {
  if (!/^\\d+$/.test(transactionId)) throw new Error("Invalid Flutterwave transaction ID");
  const response = await fetch(`https://api.flutterwave.com/v3/transactions/${encodeURIComponent(transactionId)}/verify`, {
    headers: { Authorization: `Bearer ${secretFor("flutterwave")}` },
    cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok || result.status !== "success") throw new Error("Unable to verify Flutterwave transaction");
  return result.data as { status: string; tx_ref: string; amount: number; currency: string; id: number };
}

function safeHexEqual(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]+$/i.test(actual) || actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function verifyPaystackWebhook(rawBody: string, signature: string | null, timestampedSignature: string | null): boolean {
  const secret = secretFor("paystack");
  if (timestampedSignature) {
    const parts = Object.fromEntries(timestampedSignature.split(",").map((part) => {
      const i = part.indexOf("=");
      return i > 0 ? [part.slice(0, i), part.slice(i + 1)] : ["", ""];
    }));
    const timestamp = Number(parts.t);
    if (!Number.isFinite(timestamp) || Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
    const expected = createHmac("sha512", secret).update(`${parts.t}.${rawBody}`).digest("hex");
    const signatures = timestampedSignature.split(",").filter((p) => p.startsWith("v1=")).map((p) => p.slice(3).split(":").at(-1) ?? "");
    return signatures.some((candidate) => safeHexEqual(candidate, expected));
  }
  if (!signature) return false;
  const expected = createHmac("sha512", secret).update(rawBody).digest("hex");
  return safeHexEqual(signature, expected);
}

export function verifyFlutterwaveWebhook(signature: string | null): boolean {
  const secret = process.env.FLUTTERWAVE_WEBHOOK_SECRET;
  if (!secret || !signature) return false;
  const a = Buffer.from(signature);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
