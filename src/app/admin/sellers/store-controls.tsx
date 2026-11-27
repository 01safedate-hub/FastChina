"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AdminStore } from "@/lib/data/admin";
import { naira } from "@/lib/format";
import { call } from "@/lib/net";
import { storeAddress } from "@/lib/dropship/plans";
import { reviewSellerPayout, setDomainVerified, setStoreAlias, setStorePlan, setStoreStatus } from "../actions";

export function StoreControls({ store }: { store: AdminStore }) {
  const router = useRouter();
  const [plan, setPlan] = useState(store.plan);
  const [months, setMonths] = useState(1);
  const [alias, setAlias] = useState(store.alias ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      const r = await call(fn);
      setMsg(r.message);
      if (r.ok) router.refresh();
    });
  const btn = "min-h-9 rounded-md border border-[#D0D4DB] px-3 text-sm font-bold disabled:opacity-40";
  return (
    <div className="flex flex-col gap-3 border-t border-[#EEF0F3] p-3.5 text-sm">
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[#5B6170]">
        <span>Owner: {store.owner ?? "—"}</span>
        <span>Opened {new Date(store.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
        {store.plan_renews_at && <span>Renews {new Date(store.plan_renews_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>}
        <a href={`/s/${store.alias || store.slug}`} target="_blank" rel="noreferrer" className="font-bold text-[#2563EB] underline">Open store</a>
      </div>
      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs font-semibold text-[#5B6170]">Store address (alias)
          <span className="flex items-center rounded-md border border-[#D0D4DB] bg-white pl-2 text-sm">
            <span className="text-[#5B6170]">fastchina.store/</span>
            <input value={alias} onChange={(e) => setAlias(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder={store.slug} maxLength={40} className="min-h-9 w-40 bg-transparent px-1 outline-none" />
          </span>
        </label>
        <button type="button" disabled={busy || alias === (store.alias ?? "")} onClick={() => run(() => setStoreAlias(store.id, alias))} className={btn}>Save address</button>
        <span className="text-xs text-[#5B6170]">Live at {storeAddress({ slug: store.slug, alias: store.alias })}. Leave empty to use the store name.</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`plan-${store.id}`}>Plan</label>
        <select id={`plan-${store.id}`} value={plan} onChange={(e) => setPlan(e.target.value)} className="min-h-9 rounded-md border border-[#D0D4DB] px-2">
          <option value="free">Free</option><option value="pro">Pro · ₦15,000/mo</option><option value="elite">Elite · ₦45,000/mo</option>
        </select>
        {plan !== "free" && (
          <select aria-label="Months" value={months} onChange={(e) => setMonths(Number(e.target.value))} className="min-h-9 rounded-md border border-[#D0D4DB] px-2">
            {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}
          </select>
        )}
        <button type="button" disabled={busy} className={btn} onClick={() => run(() => setStorePlan(store.id, plan, months))}>Set plan</button>
        {store.custom_domain && (
          <button type="button" disabled={busy} className={btn} onClick={() => run(() => setDomainVerified(store.id, !store.domain_verified))}>
            {store.domain_verified ? `Switch off ${store.custom_domain}` : `Mark ${store.custom_domain} live`}
          </button>
        )}
        <button type="button" disabled={busy} className={`${btn} ${store.status === "suspended" ? "" : "border-[#F0B4B4] text-[#B42318]"}`}
          onClick={() => run(() => setStoreStatus(store.id, store.status === "suspended" ? "active" : "suspended"))}>
          {store.status === "suspended" ? "Reopen store" : "Suspend store"}
        </button>
      </div>
      {store.payouts.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center gap-2 rounded-md bg-[#FFF7E6] p-2.5">
          <span className="flex-1"><strong>{naira(p.amount_ngn)}</strong> to {p.bank_snapshot.name} · {p.bank_snapshot.bank} {p.bank_snapshot.account} · {p.items} items</span>
          {p.payout_admin_approved_at ? (
            <span className="text-xs font-bold text-[#166534]">Approved · waiting for Paystack worker</span>
          ) : (
            <>
              <button type="button" disabled={busy} className={btn} onClick={() => run(() => reviewSellerPayout(p.id, true))}>Approve Paystack payout</button>
              <button type="button" disabled={busy} className={`${btn} border-[#F0B4B4] text-[#B42318]`} onClick={() => run(() => reviewSellerPayout(p.id, false, "Rejected by admin"))}>Reject</button>
            </>
          )}
        </div>
      ))}
      {store.adjustments.length > 0 && (
        <div className="rounded-md border border-[#F0B4B4] bg-[#FFF7F7] p-3">
          <strong className="text-sm">Refund adjustments to recover from future earnings</strong>
          <ul className="mt-2 flex flex-col gap-2">
            {store.adjustments.map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 text-xs">
                <span>Created {new Date(a.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {naira(a.applied_ngn)} applied</span>
                <strong>{naira(a.outstanding_ngn)} outstanding of {naira(a.amount_ngn)}</strong>
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg && <p role="status" className="text-[#5B6170]">{msg}</p>}
    </div>
  );
}
