"use client";

import { useState, useTransition } from "react";
import { call } from "@/lib/net";
import { setSubscriptionAutoRenew } from "../actions";
import { ngn } from "../_ui/ui";

type Status = "manual" | "wallet_ready" | "external_required" | "renewed";

export function RenewalSettings({ enabled, status, walletBalance }: {
  enabled: boolean;
  status: Status;
  walletBalance: number;
}) {
  const [active, setActive] = useState(enabled);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function toggle() {
    start(async () => {
      const result = await call(() => setSubscriptionAutoRenew(!active));
      setMessage(result.message);
      if (result.ok) setActive(!active);
    });
  }

  const statusLabel = status === "external_required"
    ? "External payment required"
    : status === "renewed"
      ? "Last renewal paid from wallet"
      : active
        ? "Wallet-first renewal enabled"
        : "Manual renewal";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-bold">{statusLabel}</p>
          <p className="mt-1 text-xs text-[#A1A1AA]">Available wallet balance: <strong className="text-white">{ngn(walletBalance)}</strong></p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={active}
          disabled={busy}
          onClick={toggle}
          className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F5C542] disabled:opacity-50 ${active ? "bg-[#F5C542]" : "bg-white/20"}`}
        >
          <span className={`inline-block size-5 rounded-full bg-black transition-transform ${active ? "translate-x-6" : "translate-x-1"}`} />
          <span className="sr-only">{active ? "Disable automatic renewal" : "Enable automatic renewal"}</span>
        </button>
      </div>
      <p className="text-xs leading-5 text-[#A1A1AA]">
        {active
          ? "At renewal time, FastChina will debit the monthly plan price from your wallet only when the full amount is available. If funds are insufficient, your subscription page will provide external checkout."
          : "Automatic wallet deductions are off. Your plan will need to be renewed manually before expiry."}
      </p>
      {message && <p role="status" className="text-xs text-[#F5C542]">{message}</p>}
    </div>
  );
}
