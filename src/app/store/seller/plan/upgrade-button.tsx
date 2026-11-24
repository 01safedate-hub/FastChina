"use client";

import { useState, useTransition } from "react";
import { call } from "@/lib/net";
import { requestUpgrade } from "../actions";
import { btn } from "../_ui/ui";

export function UpgradeButton({ plan, label, featured, renewal = false }: { plan: "pro" | "elite"; label: string; featured?: boolean; renewal?: boolean }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [provider, setProvider] = useState<"paystack" | "flutterwave">("paystack");
  const [busy, start] = useTransition();

  function upgrade() {
    start(async () => {
      const result = await call(() => requestUpgrade(plan, provider, renewal));
      setMsg(result.message);
      if (result.ok && result.checkoutUrl) window.location.assign(result.checkoutUrl);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-xs text-[#A1A1AA]">
        Payment provider
        <select value={provider} onChange={(e) => setProvider(e.target.value as "paystack" | "flutterwave")} className="min-h-10 border border-white/15 bg-transparent px-2 text-sm text-inherit">
          <option value="paystack">Paystack</option>
          <option value="flutterwave">Flutterwave</option>
        </select>
      </label>
      <button type="button" disabled={busy} className={featured ? btn.primary : btn.ghost} onClick={upgrade}>{busy ? "Opening checkout…" : label}</button>
      {msg && <p role="status" className="text-[12px] text-[#A1A1AA]">{msg}</p>}
    </div>
  );
}
