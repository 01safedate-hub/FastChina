"use client";

import { useEffect, useState, useTransition } from "react";
import { cn } from "@/lib/format";
import { call } from "@/lib/net";
import { getPayoutBanks, saveBank, verifyPayoutBank } from "../actions";
import { btn } from "../_ui/ui";

type Bank = { name: string; code: string };
export function BankForm({ initial }: { initial: { bank_name: string | null; account_number: string | null; account_name: string | null } }) {
  const [banks, setBanks] = useState<Bank[]>([]);
  const [f, setF] = useState({ bank_name: initial.bank_name ?? "", bank_code: "", account_number: initial.account_number ?? "", account_name: "" });
  const [verified, setVerified] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, start] = useTransition();

  useEffect(() => {
    let active = true;
    getPayoutBanks().then((r) => {
      if (!active) return;
      if (r.ok && r.banks) {
        setBanks(r.banks);
        const existing = r.banks.find((b) => b.name.toLowerCase() === f.bank_name.toLowerCase());
        if (existing) setF((v) => ({ ...v, bank_code: existing.code }));
      } else setMsg({ ok: false, text: r.message ?? "Could not load banks from Paystack." });
    });
    return () => { active = false; };
  // Load the provider bank directory once when the form mounts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verify = () => start(async () => {
    setMsg(null);
    setVerified(false);
    const bank = banks.find((b) => b.code === f.bank_code);
    if (!bank) { setMsg({ ok: false, text: "Choose a bank first." }); return; }
    const r = await call(() => verifyPayoutBank({ account_number: f.account_number, bank_code: f.bank_code }));
    if (!r.ok || !r.account_name) { setMsg({ ok: false, text: r.message }); return; }
    setF((v) => ({ ...v, bank_name: r.bank_name || bank.name, account_name: r.account_name! }));
    setVerified(true);
    setMsg({ ok: true, text: `Paystack verified: ${r.account_name}. Confirm this is your account before saving.` });
  });

  const save = () => start(async () => {
    const r = await call(() => saveBank(f));
    setMsg({ ok: r.ok, text: r.message });
    if (r.ok) setVerified(false);
  });

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-[13px] font-bold">
        Bank
        <select value={f.bank_code} onChange={(e) => { const b = banks.find((x) => x.code === e.target.value); setF({ ...f, bank_code: e.target.value, bank_name: b?.name ?? "", account_name: "" }); setVerified(false); }} className={btn.input}>
          <option value="">Choose your bank</option>
          {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-[13px] font-bold">
        Account number
        <input value={f.account_number} onChange={(e) => { setF({ ...f, account_number: e.target.value.replace(/\D/g, "").slice(0, 10), account_name: "" }); setVerified(false); }} inputMode="numeric" autoComplete="off" placeholder="10 digits" className={cn(btn.input, "font-mono tracking-wider")} />
      </label>
      <button type="button" onClick={verify} disabled={busy || !f.bank_code || f.account_number.length !== 10} className={btn.ghost}>Verify account with Paystack</button>
      <label className="flex flex-col gap-1.5 text-[13px] font-bold">
        Verified account name
        <input value={f.account_name} readOnly placeholder="Verify your account to display the name" className={cn(btn.input, "opacity-80")} />
      </label>
      {msg && <p role="status" className={cn("text-[13px] font-semibold", msg.ok ? "text-[#3DDC84]" : "text-[#FF8A8A]")}>{msg.text}</p>}
      <button type="button" onClick={save} disabled={busy || !verified} className={btn.primary}>Confirm and save account</button>
      <p className="text-[12px] text-[#6B6B73]">Paystack verifies the account name before it can be used for automatic seller payouts. Only save an account you are authorized to use.</p>
    </div>
  );
}
