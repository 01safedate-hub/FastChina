"use client";

import { CheckCircle2, Clock3, CircleAlert, PackageSearch } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useCart } from "@/components/shop/cart-provider";

export function PaymentConfirmation() {
  const params = useSearchParams();
  const status = params.get("status");
  const code = params.get("code");
  const kind = params.get("kind") === "subscription" ? "subscription" : "order";
  const { remove } = useCart();

  useEffect(() => {
    if (status !== "success" || kind !== "order" || !code) return;
    try {
      const raw = sessionStorage.getItem(`fc-pending-cart-${code}`);
      const keys = raw ? JSON.parse(raw) : [];
      if (Array.isArray(keys)) for (const key of keys) if (typeof key === "string") remove(key);
      sessionStorage.removeItem(`fc-pending-cart-${code}`);
    } catch {}
  }, [status, kind, code, remove]);

  const success = status === "success";
  const pending = status === "pending";
  const Icon = success ? CheckCircle2 : pending ? Clock3 : CircleAlert;
  const heading = success
    ? kind === "subscription" ? "Payment confirmed" : "Payment confirmed"
    : pending ? "Payment is being confirmed" : "Payment not confirmed";
  const detail = success
    ? kind === "subscription"
      ? "Your subscription payment has been verified and your seller plan has been updated."
      : "Your payment has been verified. Your order is now in our system."
    : pending
      ? "We have not received final confirmation from the payment provider yet. Please do not pay again while this is being checked."
      : "We could not match this return to a verified payment. If you completed a payment, contact support with your payment receipt.";

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 px-4 py-12 text-center">
      <div className={`flex size-16 items-center justify-center rounded-full ${success ? "bg-success-soft text-success" : "bg-surface text-ink"}`}>
        <Icon aria-hidden size={34} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold">{heading}</h1>
        <p className="text-sm leading-relaxed text-muted">{detail}</p>
      </div>
      {code && kind === "order" && <div className="w-full rounded-lg border border-line bg-white p-4">
        <span className="block text-xs text-muted">Order code</span>
        <strong className="font-mono text-xl">{code}</strong>
      </div>}
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        {success && kind === "order" && code
          ? <Link href={`/track?code=${encodeURIComponent(code)}`} className="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-ink px-4 font-bold text-white"><PackageSearch size={17} /> Track order</Link>
          : <Link href="/account" className="flex min-h-12 flex-1 items-center justify-center rounded-md bg-ink px-4 font-bold text-white">My account</Link>}
        <Link href="/" className="flex min-h-12 flex-1 items-center justify-center rounded-md border border-line bg-white px-4 font-bold">Continue shopping</Link>
      </div>
    </div>
  );
}
