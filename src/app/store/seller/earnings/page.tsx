import type { Metadata } from "next";
import { connection } from "next/server";
import { getPayouts, getSeller } from "@/lib/data/seller";
import { PLANS } from "@/lib/dropship/plans";
import { DemoNote, Gate } from "../_ui/gate";
import { Card, CardTitle, ngn, Page, Stat } from "../_ui/ui";
import { BankForm } from "./bank-form";

export const metadata: Metadata = { title: "Earnings" };

export default async function EarningsPage() {
  await connection();
  const state = await getSeller();
  if (state.kind !== "live" && state.kind !== "demo") return <Gate state={state} />;
  const d = state.data;
  const p = state.kind === "demo"
    ? { payouts: [{ id: "1", amount_ngn: 98_400, items: 17, status: "paid", created_at: "2026-11-13T09:00:00Z", paid_at: "2026-11-13T15:20:00Z" }, { id: "2", amount_ngn: 70_600, items: 12, status: "paid", created_at: "2026-11-06T09:00:00Z", paid_at: "2026-11-06T14:02:00Z" }], adjustments: [], bank: { bank_name: "GTBank", account_number: "0123456789", account_name: "Ada Okafor" } }
    : await getPayouts();
  const fee = PLANS[d.store.plan].feePct;
  return (
    <Page title="Earnings" subtitle={`You keep your markup minus a ${fee}% plan fee. Eligible earnings are batched on Fridays and submitted through Paystack after your bank account is verified. Transfers requiring provider approval are held for review.`}>
      <DemoNote demo={state.kind === "demo"} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="On the way" value={ngn(d.earnings.pending)} sub="Paid once delivered" />
        <Stat label="Ready" value={ngn(d.earnings.available)} sub="Eligible for the next Friday batch" tone="gold" />
        <Stat label="Paid to you" value={ngn(d.earnings.paid)} sub="All time" tone="green" />
      </div>
      {p?.adjustments.length ? (
        <Card>
          <CardTitle>Refund adjustments</CardTitle>
          <p className="mb-2 text-xs text-[#8A8A93]">These balances are offset against future Friday payouts. No bank transfer is reversed automatically.</p>
          <ul>
            {p.adjustments.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 border-t border-white/5 py-3 first:border-0">
                <span>
                  <strong className="block text-[14px]">Order refund adjustment</strong>
                  <span className="text-[12px] text-[#8A8A93]">{new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })} · {ngn(a.applied_ngn)} applied</span>
                </span>
                <strong className="text-[14px] tabular-nums">{ngn(a.outstanding_ngn)} outstanding</strong>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle>Payouts</CardTitle>
          {!p?.payouts.length && <p className="py-6 text-center text-[#8A8A93]">Your first payout arrives the Friday after your first delivered order (minimum ₦1,000).</p>}
          <ul>
            {p?.payouts.map((x) => (
              <li key={x.id} className="flex items-center justify-between gap-3 border-t border-white/5 py-3 first:border-0">
                <span>
                  <strong className="block text-[14px]">{new Date(x.created_at).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "Africa/Lagos" })}</strong>
                  <span className="text-[12px] text-[#8A8A93]">{x.items} items · {x.status === "paid" ? "Sent to your bank" : x.status === "failed" ? "Transfer failed: payout will be retried in a future batch" : x.status === "awaiting_approval" ? "Awaiting transfer approval" : x.status === "needs_review" ? "Under staff review" : x.status === "processing" ? "Paystack is processing your transfer" : "Queued for Friday payout"}</span>
                </span>
                <strong className="text-[16px] tabular-nums">{ngn(x.amount_ngn)}</strong>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardTitle>Payout account</CardTitle>
          <BankForm initial={p?.bank ?? { bank_name: null, account_number: null, account_name: null }} />
        </Card>
      </div>
    </Page>
  );
}
