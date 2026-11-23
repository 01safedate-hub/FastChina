import { ArrowLeft, Package, CreditCard, CalendarDays } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { getMe } from "@/lib/data/me";
import { naira } from "@/lib/format";
import { trackingStep, type OrderStatus } from "@/lib/orders/lifecycle";
import { SettingsShell } from "../../settings/ui";
import { CancellationRequest } from "./cancellation-request";

export const metadata: Metadata = { title: "Order details", robots: { index: false } };

export default function OrderDetailsPage({ params }: PageProps<"/account/orders/[code]">) {
  return (
    <SettingsShell title="Order details" back="/account/orders">
      <Suspense fallback={<div className="flex min-h-64 items-center justify-center text-sm text-muted">Loading order details…</div>}>
        <Body params={params} />
      </Suspense>
    </SettingsShell>
  );
}

async function Body({ params }: { params: PageProps<"/account/orders/[code]">["params"] }) {
  await connection();
  const { code } = await params;
  const me = await getMe();
  if (!me) redirect(`/sign-in?mode=signin&next=${encodeURIComponent(`/account/orders/${code}`)}`);
  const order = me.orders.find((item) => item.code.toUpperCase() === code.toUpperCase());
  if (!order) notFound();

  const progress = trackingStep(order.status as OrderStatus);
  const fullyPaid = order.total_ngn > 0 && order.paid_ngn >= order.total_ngn;
  const terminal = ["cancelled", "refunded"].includes(order.status);
  const cancellationEligible = fullyPaid && ["paid", "purchasing"].includes(order.status);

  return (
    <div className="flex flex-col gap-3">
      <section className="rounded-xl border border-line bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div><p className="text-xs text-muted">Order reference</p><h1 className="font-mono text-xl font-extrabold">#{order.code}</h1></div>
          <span className="rounded-full bg-surface px-3 py-1.5 text-xs font-bold">{progress.label}</span>
        </div>
        <p className="mt-3 flex items-center gap-2 text-xs text-muted"><CalendarDays size={14} /> Placed {new Date(order.created_at).toLocaleString("en-NG", { dateStyle: "medium", timeStyle: "short", timeZone: "Africa/Lagos" })}</p>
        {!terminal && <div className="mt-5 grid grid-cols-5 gap-1" aria-label={`Order progress: step ${progress.step} of ${progress.of}`}>
          {["Payment", "Ordering", "China warehouse", "On the way", "At your station"].map((label, index) => (
            <div key={label} className="flex flex-col gap-1.5">
              <span className={`h-1.5 rounded-full ${index < progress.step ? "bg-success" : "bg-surface"}`} />
              <span className={`text-[10px] leading-tight ${index < progress.step ? "font-bold text-ink" : "text-muted"}`}>{label}</span>
            </div>
          ))}
        </div>}
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold"><Package size={17} /> Items in this order</h2>
        <ul className="divide-y divide-line">
          {order.items.map((item) => (
            <li key={item.id} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              {item.imageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element -- product image URL is read from the trusted catalogue record
                <img src={item.imageUrl} alt={item.title} loading="lazy" className="size-20 shrink-0 rounded-lg border border-line bg-surface object-contain" />
              ) : (
                <div aria-hidden className="flex size-20 shrink-0 items-center justify-center rounded-lg bg-surface text-muted"><Package size={25} /></div>
              )}
              <div className="min-w-0"><p className="text-sm font-semibold">{item.title}</p>{item.variant_label && <p className="mt-0.5 text-xs text-muted">{item.variant_label}</p>}<p className="mt-1 text-xs text-muted">Quantity: {item.qty}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-white p-4">
        <h2 className="mb-3 flex items-center gap-2 text-sm font-extrabold"><CreditCard size={17} /> Payment summary</h2>
        <div className="flex justify-between py-1.5 text-sm"><span className="text-muted">Payment method</span><span className="font-semibold">{order.pay_mode === "small" ? "Pay small small" : order.pay_mode === "group" ? "Group pay" : "Pay in full"}</span></div>
        <div className="flex justify-between py-1.5 text-sm"><span className="text-muted">Order total</span><strong>{naira(order.total_ngn)}</strong></div>
        <div className="flex justify-between py-1.5 text-sm"><span className="text-muted">Amount paid</span><strong className="text-success">{naira(order.paid_ngn)}</strong></div>
        <div className="flex justify-between border-t border-line pt-3 mt-2 text-sm"><span className="font-semibold">{fullyPaid ? "Payment status" : "Remaining balance"}</span><strong>{fullyPaid ? "Fully paid" : naira(Math.max(0, order.total_ngn - order.paid_ngn))}</strong></div>
        {!fullyPaid && !terminal && <Link href="/account/orders?tab=unpaid" className="mt-3 flex min-h-11 items-center justify-center rounded-md bg-ink px-4 text-sm font-bold text-white">Continue payment</Link>}
      </section>
      {cancellationEligible && <CancellationRequest code={order.code} request={order.cancellationRequest} />}
      <Link href="/account/orders" className="inline-flex min-h-10 items-center gap-2 self-start px-1 text-sm font-semibold text-muted"><ArrowLeft size={15} /> Back to my orders</Link>
    </div>
  );
}
