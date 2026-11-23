"use client";

import { Check, Users } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { startGroupContribution } from "../../payment-actions";
import { Progress } from "@/components/ui/progress";
import { naira } from "@/lib/format";
import { type LinkProgress, linkProgress } from "../../actions";

/** Live progress for a real Group pay link. Refreshes every 10 seconds while the page is open. */
export function LiveLink({ code, initial }: { code: string; initial: LinkProgress }) {
  const [p, setP] = useState(initial);\n  const [now, setNow] = useState(0);
  const [amount, setAmount] = useState(""); const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [provider, setProvider] = useState<"paystack" | "flutterwave">("paystack"); const [message, setMessage] = useState(""); const [busy, start] = useTransition();
  useEffect(() => {
    const clock = setInterval(() => setNow(Date.now()), 1000);\n    const t = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const next = await linkProgress(code).catch(() => null);
      if (next) setP(next);
    }, 10_000);
    return () => { clearInterval(t); clearInterval(clock); };
  }, [code]);
  const left = p.target - p.raised;
  // Links stay open until the order is fully paid.
  const closed = left <= 0 || new Date(p.expires_at).getTime() <= now;
  const validAmount = Number.isSafeInteger(Number(amount)) && Number(amount) >= 500 && Number(amount) <= left;
  const submit = () => start(async () => { setMessage(""); const result = await startGroupContribution({ code, amountNgn: Number(amount), email, contributorName: name, provider }); if (!result.ok) return setMessage(result.message); window.location.assign(result.checkoutUrl); });
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-4 px-3 py-6">
      <h1 className="text-xl font-extrabold">Help pay for this order</h1>
      <section className="flex flex-col gap-2 rounded-lg bg-group-soft p-4">
        <div className="flex items-baseline justify-between">
          <strong className="text-2xl">{naira(p.raised)}</strong>
          <span className="text-sm text-muted">of {naira(p.target)}</span>
        </div>
        <Progress value={(p.raised / p.target) * 100} className="h-2.5 bg-[#E0DEF7]" barClass="bg-group" label="Raised so far" />
        <span className="flex items-center justify-between text-xs">
          <span className="flex items-center gap-1 font-bold text-group"><Users aria-hidden size={13} /> {p.people} {p.people === 1 ? "person has" : "people have"} chipped in · live</span>
          <span className="text-muted">{closed ? "Fully paid" : "Open until fully paid"}</span>
        </span>
      </section>
      <section className="flex flex-col rounded-lg border border-line bg-white">
        {p.items.map((i, k) => (
          <div key={k} className="flex items-center justify-between gap-2 border-t border-line p-3 first:border-0">
            <span className="flex min-w-0 items-center gap-2">
              {i.funded ? <Check aria-label="Paid" size={16} className="shrink-0 text-success" /> : <span className="size-4 shrink-0 rounded-full border border-black/20" />}
              <span className="truncate">{i.title}</span>
            </span>
            <strong className="shrink-0">{naira(i.amount)}</strong>
          </div>
        ))}
      </section>
      {closed ? (
        <div className="rounded-lg bg-surface p-4 text-center text-sm font-bold">{left <= 0 ? "FULLY PAID · THANK YOU" : "THIS GROUP LINK HAS EXPIRED"}</div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex flex-col gap-3 rounded-lg border border-line bg-white p-4">
          <h2 className="font-extrabold">Contribute to this order</h2>
          <label className="flex flex-col gap-1 text-xs font-semibold">Your name
            <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} className="min-h-11 rounded-md border border-line px-3 text-sm font-normal" placeholder="Name shown to the group" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">Email for payment receipt
            <input required type="email" maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="min-h-11 rounded-md border border-line px-3 text-sm font-normal" placeholder="you@example.com" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold">Contribution amount (₦)
            <input required type="number" min={500} max={left} step={1} value={amount} onChange={(e) => setAmount(e.target.value)} className="min-h-11 rounded-md border border-line px-3 text-sm font-normal" placeholder={`Up to ${left}`} />
          </label>
          <div className="flex flex-col gap-1 text-xs font-semibold">Payment provider
            <div className="grid grid-cols-2 gap-2">{(["paystack", "flutterwave"] as const).map((v) => <button key={v} type="button" aria-pressed={provider === v} onClick={() => setProvider(v)} className={`min-h-10 rounded-md border text-sm capitalize ${provider === v ? "border-ink font-bold" : "border-line"}`}>{v}</button>)}</div>
          </div>
          {message && <p role="alert" className="text-xs text-sale">{message}</p>}
          <button type="submit" disabled={busy || !validAmount || !name.trim()} className="min-h-12 rounded-md bg-group text-sm font-extrabold text-white disabled:opacity-50">{busy ? "OPENING SECURE CHECKOUT…" : `CHIP IN · ${naira(Number(amount) || 0)}`}</button>
          <p className="text-center text-xs text-muted">Secure payment through {provider === "paystack" ? "Paystack" : "Flutterwave"}.</p>
        </form>
      )}
      <p className="text-center text-xs text-muted">You never see the buyer’s phone number or address. This link expires {new Date(p.expires_at).toLocaleDateString("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" })}.</p>
    </div>
  );
}
