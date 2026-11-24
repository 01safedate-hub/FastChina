import type { Metadata } from "next";
import { connection } from "next/server";
import { getSeller, getSellerSubscriptionPayments, getSellerSubscriptionRenewalSettings } from "@/lib/data/seller";
import { FREE_SALES_LIMIT, PLANS } from "@/lib/dropship/plans";
import { DemoNote, Gate } from "../_ui/gate";
import { Card, Meter, ngn, Page } from "../_ui/ui";
import { UpgradeButton } from "./upgrade-button";\nimport { RenewalSettings } from "./renewal-settings";

export const metadata: Metadata = { title: "Manage subscription" };

const dateLabel = (value: string | null) => value
  ? new Date(value).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Lagos" })
  : "No renewal date";

export default async function PlanPage() {
  await connection();
  const state = await getSeller();
  if (state.kind !== "live" && state.kind !== "demo") return <Gate state={state} />;
  const s = state.data.store;
  const [payments, renewal] = state.kind === "live" ? await Promise.all([getSellerSubscriptionPayments(), getSellerSubscriptionRenewalSettings()]) : [null, null];
  const current = PLANS[s.plan];

  return (
    <Page title="Manage subscription" subtitle="Your plan, sales allowance and billing activity.">
      <DemoNote demo={state.kind === "demo"} />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-extrabold uppercase tracking-[0.15em] text-[#A1A1AA]">Current plan</p>
            <h2 className="mt-1 text-[28px] font-black">{current.name}</h2>
            <p className="mt-1 text-[14px] text-[#A1A1AA]">{current.price ? `${ngn(current.price)} per month` : "Free forever"}</p>
          </div>
          <span className={`rounded-full px-3 py-1.5 text-xs font-bold ${s.status === "active" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-300"}`}>
            {s.status === "needs_upgrade" ? "Upgrade required" : s.status === "suspended" ? "Suspended" : "Active"}
          </span>
        </div>
        <div className="mt-5 grid gap-3 border-t border-white/10 pt-4 sm:grid-cols-2">
          <div><p className="text-xs text-[#A1A1AA]">Next plan expiry</p><p className="mt-1 font-bold">{dateLabel(s.plan_renews_at)}</p></div>
          <div><p className="text-xs text-[#A1A1AA]">Store status</p><p className="mt-1 font-bold capitalize">{s.status.replaceAll("_", " ")}</p></div>
        </div>
        {s.plan !== "free" && (
          <p className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3 text-xs leading-5 text-amber-100/80">
Your plan is activated only after verified payment and expires according to the date above. Enable automatic renewal below to use your wallet first, with external checkout available if the wallet is insufficient.
          </p>
        )}
      </Card>

      {s.plan !== "free" && renewal && (\n        <Card>\n          <div className="mb-3">\n            <h2 className="text-lg font-black">Automatic renewal</h2>\n            <p className="mt-1 text-sm text-[#A1A1AA]">We check your FastChina wallet first. If it cannot cover the full renewal, you will be asked to complete payment through Paystack or Flutterwave.</p>\n          </div>\n          <RenewalSettings enabled={renewal.auto_renew} status={renewal.renewal_status} walletBalance={renewal.wallet_ngn} />\n          {renewal.renewal_status === "external_required" && (\n            <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-3">\n              <p className="text-sm font-bold text-amber-200">External payment required</p>\n              <p className="mt-1 text-xs leading-5 text-amber-100/80">Your wallet did not have enough funds for the last renewal attempt. Complete a secure external payment below.</p>\n              <div className="mt-3"><UpgradeButton plan={s.plan} label={`Renew ${current.name}`} renewal /></div>\n            </div>\n          )}\n        </Card>\n      )}\n\n      {s.plan === "free" && (
        <Card>
          <div className="mb-2 flex justify-between gap-3 text-[14px]"><strong>Free-plan sales allowance</strong><span className="tabular-nums text-[#A1A1AA]">{ngn(s.lifetime_sales)} / {ngn(FREE_SALES_LIMIT)}</span></div>
          <Meter value={s.lifetime_sales} max={FREE_SALES_LIMIT} label="Lifetime sales towards the Free-plan limit" tone={s.lifetime_sales >= FREE_SALES_LIMIT * 0.9 ? "red" : "gold"} />
          <p className="mt-2 text-[13px] text-[#A1A1AA]">Free stores can sell up to {ngn(FREE_SALES_LIMIT)} in total. After that, new orders pause until you upgrade. Your products and earnings stay safe.</p>
        </Card>
      )}

      <section>
        <div className="mb-3"><h2 className="text-lg font-black">Compare plans</h2><p className="mt-1 text-sm text-[#A1A1AA]">Choose the plan that fits your store.</p></div>
        <div className="grid gap-3 md:grid-cols-3">
          {Object.values(PLANS).map((p) => {
            const currentPlan = p.key === s.plan;
            const featured = p.key === "pro";
            return (
              <section key={p.key} className={`relative flex flex-col gap-4 rounded-2xl p-5 ${featured ? "bg-gradient-to-b from-[#2B2410] to-[#17171A] ring-1 ring-[#F5C542]/60" : "bg-[#17171A]"}`}>
                {featured && <span className="absolute right-4 top-4 rounded-full bg-[#F5C542] px-2.5 py-1 text-[10px] font-black uppercase text-black">Most popular</span>}
                <div>
                  <h3 className="text-[22px] font-black">{p.name}</h3>
                  <p className="mt-1"><strong className="text-[30px] font-black tabular-nums">{p.price ? ngn(p.price) : "₦0"}</strong><span className="text-[13px] text-[#A1A1AA]">{p.price ? " / month" : " forever"}</span></p>
                </div>
                <ul className="flex flex-1 flex-col gap-2 text-[14px]">
                  {p.perks.map((perk) => <li key={perk} className="flex gap-2"><span aria-hidden className="text-[#3DDC84]">✓</span>{perk}</li>)}
                </ul>
                {currentPlan
                  ? <span className="flex min-h-11 items-center justify-center rounded-full border border-white/15 text-[14px] font-bold text-[#A1A1AA]">Current plan</span>
                  : p.key === "free" ? <span className="text-center text-xs text-[#777780]">Contact support to change to Free.</span>
                  : <UpgradeButton plan={p.key} label={`Get ${p.name}`} featured={featured} />}
              </section>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3"><h2 className="text-lg font-black">Billing history</h2><p className="mt-1 text-sm text-[#A1A1AA]">Subscription payments made through Paystack or Flutterwave.</p></div>
        <Card>
          {!payments ? (
            <p className="text-sm text-[#A1A1AA]">Billing history is available when your store database is connected.</p>
          ) : payments.length === 0 ? (
            <p className="text-sm text-[#A1A1AA]">No subscription payments yet.</p>
          ) : (
            <div className="divide-y divide-white/10">
              {payments.map((payment) => (
                <div key={payment.reference} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="font-bold">{ngn(payment.amount_ngn)}</p>
                    <p className="mt-1 text-xs capitalize text-[#A1A1AA]">{payment.provider} · {new Date(payment.created_at).toLocaleDateString("en-NG", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Lagos" })}</p>
                    <p className="mt-1 truncate text-[10px] text-[#777780]">{payment.reference}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${payment.status === "success" ? "bg-emerald-500/10 text-emerald-400" : payment.status === "pending" ? "bg-amber-500/10 text-amber-300" : "bg-white/10 text-[#A1A1AA]"}`}>{payment.status}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </section>

      <p className="text-[12px] text-[#6B6B73]">Fees apply to seller markup only, never to FastChina’s product price: Free 5%, Pro 3%, Elite 1.5%. Paystack and Flutterwave are available at checkout. Payment verification, not the browser return page, activates a paid plan.</p>
    </Page>
  );
}
