"use client";

import { CheckCircle2, Clock3, CircleAlert, LoaderCircle, PackageSearch } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { attempt } from "@/lib/net";
import { getOrderPaymentDestination, trackOrder, type TrackedOrder } from "../../actions";
import { useCart } from "@/components/shop/cart-provider";

type PaymentState = "checking" | "pending" | "partial" | "paid" | "not-found" | "error";

export function PaymentConfirmation() {
  const params = useSearchParams();
  const code = params.get("code")?.trim().toUpperCase() ?? "";
  const kind = params.get("kind") === "subscription" ? "subscription" : "order";
  const { remove } = useCart();
  const [state, setState] = useState<PaymentState>("checking");
  const [order, setOrder] = useState<TrackedOrder | null>(null);
  const [phoneLast4, setPhoneLast4] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const refresh = useCallback(async (last4: string) => {
    const result = await attempt(() => trackOrder(code, last4));
    if (!result.ok || !result.value.ok) {
      setState(result.ok ? "not-found" : "error");
      return false;
    }
    const current = result.value.order;
    setOrder(current);
    if (current.paid >= current.total && current.total > 0) {
      setState("paid");
      return true;
    }
    if (current.paid > 0) {
      setState("partial");
      return false;
    }
    setState("pending");
    return false;
  }, [code]);

  useEffect(() => {
    if (kind !== "order" || !/^[A-Z0-9]{8}$/.test(code)) return;
    let last4: string | null = null;
    try { last4 = sessionStorage.getItem(`fc-track-${code}`); } catch {}
    if (!last4 || !/^\d{4}$/.test(last4)) {
      let cancelled = false;
      setAttempts(1);
      void (async () => {
        const result = await attempt(() => getOrderPaymentDestination(code));
        if (cancelled) return;
        if (!result.ok || !result.value.ok) {
          setState("error");
          return;
        }
        setState(result.value.paid ? "paid" : "pending");
      })();
      return () => { cancelled = true; };
    }
    let cancelled = false;
    let count = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const check = async () => {
      if (cancelled) return;
      count += 1;
      setAttempts(count);
      const paid = await refresh(last4!);
      if (cancelled || paid || count >= 12) return;
      timer = setTimeout(check, 5000);
    };
    void check();
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, [kind, code, refresh]);

  useEffect(() => {
    if (state !== "paid" || kind !== "order" || !code) return;
    try {
      const raw = sessionStorage.getItem(`fc-pending-cart-${code}`);
      const keys = raw ? JSON.parse(raw) : [];
      if (Array.isArray(keys)) for (const key of keys) if (typeof key === "string") remove(key);
      sessionStorage.removeItem(`fc-pending-cart-${code}`);
    } catch {}
  }, [state, kind, code, remove]);

  const paid = state === "paid";
  const partial = state === "partial";
  const pending = state === "checking" || state === "pending";
  const Icon = paid ? CheckCircle2 : pending ? Clock3 : state === "not-found" || state === "error" ? CircleAlert : CheckCircle2;
  const orderTab = paid ? "processing" : state === "error" ? "all" : "unpaid";
  const orderHref = `/account/orders?tab=${orderTab}`;
  const heading = paid
    ? "Payment confirmed"
    : partial
      ? "Part payment received"
      : pending
        ? "Payment is being confirmed"
        : "We couldn’t check this payment";
  const detail = paid
    ? "Supabase confirms that your order is fully paid. Your order is now being processed."
    : partial
      ? `Supabase confirms that ₦${order?.paid.toLocaleString("en-NG")} has been received. Your remaining balance is ₦${Math.max(0, (order?.total ?? 0) - (order?.paid ?? 0)).toLocaleString("en-NG")}.`
      : pending
        ? "We’re checking your order directly against its payment record. This page will update automatically when the payment webhook has been processed. Please do not pay again while this check is running."
        : state === "not-found"
          ? "We could not verify this order using the saved checkout details. Use Track order to enter your order code and the last four digits of your checkout phone number."
          : "We couldn’t retrieve the latest order status. Your payment has not been declared failed. Please check your order again shortly.";

  if (kind === "subscription") {
    return (
      <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 px-4 py-12 text-center">
        <Clock3 aria-hidden size={34} />
        <h1 className="text-2xl font-extrabold">Subscription payment status</h1>
        <p className="text-sm leading-relaxed text-muted">Subscription confirmation is not checked by this order-status page. Please check your seller account before attempting another payment.</p>
        <Link href="/account" className="flex min-h-12 w-full items-center justify-center rounded-md bg-ink px-4 font-bold text-white">My account</Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col items-center gap-5 px-4 py-12 text-center">
      <div className={`flex size-16 items-center justify-center rounded-full ${paid ? "bg-success-soft text-success" : "bg-surface text-ink"}`}>
        <Icon aria-hidden size={34} className={pending ? "animate-spin" : undefined} />
      </div>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-extrabold">{heading}</h1>
        <p className="text-sm leading-relaxed text-muted">{detail}</p>
      </div>
      {code && <div className="w-full rounded-lg border border-line bg-white p-4">
        <span className="block text-xs text-muted">Order code</span>
        <strong className="font-mono text-xl">{code}</strong>
        {order && <span className="mt-1 block text-xs text-muted">₦{order.paid.toLocaleString("en-NG")} paid of ₦{order.total.toLocaleString("en-NG")}</span>}
      </div>}
      {pending && <p className="text-xs text-muted" aria-live="polite">Checking payment status · {attempts}/12</p>}
      <div className="flex w-full flex-col gap-2 sm:flex-row">
        <Link href={orderHref} aria-disabled={state === "checking"} className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md bg-ink px-4 font-bold text-white ${state === "checking" ? "pointer-events-none opacity-70" : ""}`}>
          {state === "checking" ? <><LoaderCircle size={17} className="animate-spin" /> Checking order…</> : paid ? <><PackageSearch size={17} /> View processing order</> : "Check order"}
        </Link>
        <Link href="/" className="flex min-h-12 flex-1 items-center justify-center rounded-md border border-line bg-white px-4 font-bold">Continue shopping</Link>
      </div>
      {!phoneLast4 && state !== "checking" && <p className="text-xs text-muted">Order status was checked securely. You can view its current payment category in your account.</p>}
    </div>
  );
}
