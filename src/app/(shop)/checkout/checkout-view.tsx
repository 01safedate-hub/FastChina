"use client";

import { ChevronDown, ChevronLeft, ChevronUp, Copy, Lock, MapPin, Plane } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { useCart } from "@/components/shop/cart-provider";
import { useLivePromo } from "@/components/shop/live-price";
import { ProductTile } from "@/components/shop/product-card";
import { useClaimed } from "@/components/shop/promos";
import { InfoButton } from "@/components/ui/info-button";
import { Progress } from "@/components/ui/progress";
import { useNow } from "@/hooks/use-now";
import { type Station, statesOf } from "@/lib/catalog/stations";
import { getStationId, setStationId } from "@/lib/station-store";
import { myProfile, setMyStation } from "../auth-actions";
import { useSiteData } from "@/components/shop/site-data";
import { cn, naira } from "@/lib/format";
import { productTotals, unitFromPrices } from "@/lib/pricing/prices";
import { inFlash } from "@/lib/pricing/flash";
import { canPaySmall, SMALL_SMALL } from "@/lib/payments/instalments";
import { type CheckoutQuote, placeOrder, quoteCheckout } from "../actions";
import { addDaysLabel } from "@/lib/time";
import { useOnline } from "@/hooks/use-online";
import { attempt } from "@/lib/net";
import { startOrderPayment } from "../payment-actions";

type Mode = "full" | "small" | "group";

const PAYMENT_LOGOS = {
  paystack: "data:image/png;base64,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",
  flutterwave: "data:image/png;base64,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",
} as const;

export function CheckoutView() {
  const params = useSearchParams();
  const initial = params.get("pay");
  const [mode, setMode] = useState<Mode>(initial === "small" || initial === "group" ? initial : "full");
  const { items } = useCart();
  const [phone, setPhone] = useState("");
  const [placing, startPlacing] = useTransition();
  const [placeMsg, setPlaceMsg] = useState<string | null>(null);
  const promo = useLivePromo();
  const now = useNow(60_000);
  const [claimed] = useClaimed();
  const [state, setState] = useState<string>("Lagos");
  const { stations: LISTED } = useSiteData();
  // A station the customer added themselves (being checked) joins the list for them only.
  const [own, setOwn] = useState<Station | null>(null);
  const STATIONS = own && !LISTED.some((s) => s.id === own.id) ? [...LISTED, own] : LISTED;
  const STATES = statesOf(STATIONS);
  const [station, setStationState] = useState<string>(STATIONS[0]?.id ?? "");
  const setStation = (id: string) => {
    setStationState(id);
    setStationId(id);
    void setMyStation(id).catch(() => null);
  };
  // Start from the customer's primary station (profile first, then this device) and their phone.
  useEffect(() => {
    let live = true;
    const apply = (id: string | null, list: readonly Station[]) => {
      const s = id ? list.find((x) => x.id === id) : null;
      if (s) { setState(s.state); setStationState(s.id); }
    };
    apply(getStationId(), LISTED);
    myProfile().then((me) => {
      if (!live || !me) return;
      // Prefill receipt email from the verified Supabase session; guests can still enter one.
      if (me.email) setEmail((current) => current || me.email!);
      if (me.phone) setPhone((p) => p || me.phone!.replace(/^\+234/, "0"));
      if (me.station) {
        const s: Station = { ...me.station, hours: "", verified: me.station.verified };
        setOwn(LISTED.some((x) => x.id === s.id) ? null : s);
        setState(s.state);
        setStationState(s.id);
      }
    }).catch(() => null);
    return () => { live = false; };
  }, [LISTED]);
  const [method, setMethod] = useState<"paystack" | "flutterwave">("paystack");
  const [email, setEmail] = useState("");
  // Pay small small: the first payment the customer chose (₦).
  const [plan, setPlan] = useState(0);
  const [usePoints, setUsePoints] = useState(false);
  const [mine, setMine] = useState(50_000);
  const [others, setOthers] = useState<number[]>([]);
  const [order, setOrder] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);

  const selected = items.filter((i) => i.selected);
  const totals = productTotals(selected);
  const unitOf = (i: (typeof selected)[number]) => unitFromPrices(i.snap.prices, i.qty, promo, totals.get(i.slug), now !== null && inFlash(i.slug, now));

  // The total, coupon and points are worked out on the server with the guardrails; the browser never sees costs.
  const [serverQuote, setServerQuote] = useState<CheckoutQuote | null>(null);
  const [quoteFailed, setQuoteFailed] = useState(false);
  const online = useOnline();
  const requestKey = JSON.stringify([selected.map((i) => [i.slug, i.variantId, i.qty]), claimed, usePoints]);
  useEffect(() => {
    let live = true;
    quoteCheckout(selected.map((i) => ({ slug: i.slug, variantId: i.variantId, qty: i.qty })), { claimedCouponIds: claimed, usePoints })
      .then((q) => {
        if (!live) return;
        setServerQuote(q);
        setQuoteFailed(false);
      })
      .catch(() => {
        if (!live) return;
        setServerQuote(null);
        setQuoteFailed(true);
      });
    return () => {
      live = false;
    };
    // requestKey captures every input that changes the quote.
    // Re-quote when connection comes back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, online]);

  const estimateList = selected.reduce((s, i) => s + i.snap.prices.list * i.qty, 0);
  const estimate = selected.reduce((s, i) => s + unitOf(i) * i.qty, 0);
  const quote = serverQuote ?? { subtotalList: estimateList, subtotal: estimate, priceSavings: estimateList - estimate, coupon: 0, couponLabel: null, couponNote: undefined, points: 0, pointsBalance: 0, total: estimate, lines: [], missing: 0, promo };
  const best = quote.couponLabel ? { label: quote.couponLabel } : null;
  const due = quote.total;
  // Pay small small: no schedule. Start with any amount; pay the rest whenever you like.
  const smallOk = canPaySmall(due);
  const r100 = (n: number) => Math.max(SMALL_SMALL.minPayment, Math.round(n / 100) * 100);
  const startChoices = [...new Set([r100(2_000), r100(5_000), r100(due * 0.25), r100(due * 0.5)])].filter((v) => v < due).sort((a, b) => a - b);
  const weekly = smallOk ? Math.min(due, plan > 100 ? plan : (startChoices[1] ?? startChoices[0] ?? due)) : 0;
  const lineTotal = (i: (typeof selected)[number]) => {
    const l = quote.lines.find((x) => x.slug === i.slug && x.variantId === i.variantId);
    return (l ? l.unit : unitOf(i)) * i.qty;
  };

  // Group pay: contributions arrive live (simulated here until Supabase Realtime is connected).
  useEffect(() => {
    if (mode !== "group") return;
    const feed = [15_000, 5_000, 20_000, 10_000, 3_000, 25_000];
    let k = 0;
    const id = setInterval(() => {
      if (k < feed.length) setOthers((o) => [...o, feed[k++]]);
    }, 2500);
    return () => clearInterval(id);
  }, [mode]);

  const keys = selected.map((i) => i.key);
  const ordered = [...order.filter((k) => keys.includes(k)), ...keys.filter((k) => !order.includes(k))];
  const funded = Math.min(due, mine + others.reduce((a, b) => a + b, 0));
  let pool = funded;
  const allocation = ordered.map((key) => {
    const it = selected.find((i) => i.key === key)!;
    const price = lineTotal(it);
    const got = Math.max(0, Math.min(price, pool));
    pool -= got;
    return { it, price, got, done: got >= price };
  });
  const paidCount = allocation.filter((a) => a.done).length;
  const move = (i: number, d: number) => {
    const o = [...ordered];
    const j = i + d;
    if (j < 0 || j >= o.length) return;
    [o[i], o[j]] = [o[j], o[i]];
    setOrder(o);
  };

  const stations = STATIONS.filter((s) => s.state === state);
  const eta = now ? `${addDaysLabel(now, 10)} – ${addDaysLabel(now, 18)}` : "in 10–18 days";
  const cta = mode === "full" ? `PAY ${naira(due)}` : mode === "small" ? (weekly ? `PAY ${naira(weekly)} NOW` : `PAY ${naira(due)} IN FULL`) : "CREATE GROUP LINK";

  if (selected.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <h1 className="text-lg font-extrabold">Nothing to check out</h1>
        <Link href="/cart" className="bg-ink px-5 py-3 font-extrabold text-white">BACK TO CART</Link>
      </div>
    );
  }

  const radio = (on: boolean) => cn("flex min-h-[46px] w-full items-center gap-2.5 rounded-md border-[1.5px] bg-white p-2.5 text-left text-[13px]", on ? "border-ink" : "border-[#e6e6e6]");
  const dot = (on: boolean) => cn("size-4 shrink-0 rounded-full", on ? "border-[5px] border-ink" : "border-[1.5px] border-[#999]");
  const chip = (on: boolean) => cn("min-h-[38px] border-[1.5px] px-2.5 text-xs font-bold", on ? "border-ink bg-ink text-white" : "border-black/15 bg-white");

  return (
    <div className="flex flex-col gap-2 bg-surface pb-32 lg:grid lg:grid-cols-[1fr_380px] lg:items-start md:gap-6 md:bg-transparent md:pt-6 md:pb-10">
      <div className="flex flex-col gap-2 md:gap-4">
        <div className="flex items-center gap-1.5 bg-white px-2 py-1 md:px-0">
          <Link href="/cart" aria-label="Back to cart" className="flex h-11 w-10 items-center justify-center md:hidden">
            <ChevronLeft aria-hidden size={22} />
          </Link>
          <h1 className="flex-1 text-[17px] font-extrabold md:text-2xl">Checkout</h1>
          <span className="flex items-center gap-1 pr-1.5 text-xs font-bold text-success">
            <Lock aria-hidden size={14} /> Secure
          </span>
        </div>

        {/* Pickup */}
        <section className="flex flex-col gap-2.5 bg-white p-3 md:rounded-md md:border md:border-line md:p-4">
          <span className="flex items-center">
            <h2 className="text-sm font-bold">1. Jumia pickup station</h2>
            <InfoButton topic="shipping" />
          </span>
          <label className="flex flex-col gap-1 text-xs font-bold">
            Email
            <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="min-h-11 border border-black/15 px-2 text-sm font-normal" />
          </label>

          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-xs font-bold">
              State
              <select value={state} onChange={(e) => { setState(e.target.value); setStation(STATIONS.find((s) => s.state === e.target.value)!.id); }} className="min-h-11 border border-black/15 bg-white px-2 text-sm font-normal">
                {STATES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold">
              Phone for SMS
              <input type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0803 000 0000" className="min-h-11 border border-black/15 px-2 text-sm font-normal" />
            </label>
          </div>
          <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Pickup station">
            {stations.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={station === s.id} onClick={() => setStation(s.id)} className={radio(station === s.id)}>
                <span className={dot(station === s.id)} />
                <MapPin aria-hidden size={16} className="shrink-0" />
                <span className="flex flex-1 flex-col">
                  <strong>{s.name}</strong>
                  <span className="text-xs text-muted">{s.verified === false ? "Added by you · we check it before your order ships" : s.hours}</span>
                </span>
                <span className="text-xs font-bold text-success">FREE</span>
              </button>
            ))}
          </div>
        </section>

        {/* Items */}
        <section className="flex flex-col gap-2 bg-white p-3 md:rounded-md md:border md:border-line md:p-4">
          <div className="flex items-center justify-between">
            <strong className="flex items-center gap-1.5 text-sm"><Plane aria-hidden size={16} /> {selected.length} {selected.length === 1 ? "item" : "items"}</strong>
            <span className="text-xs font-bold text-success">Arrives {eta}</span>
          </div>
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
            {selected.map((i) => <ProductTile key={i.key} tint={i.snap.tint} icon={i.snap.icon} name={i.snap.name} image={i.snap.image} sizes="64px" className="h-[76px] w-16 shrink-0" iconSize={30} />)}
          </div>
        </section>

        {/* Pay */}
        <section className="flex flex-col gap-2.5 bg-white p-3 md:rounded-md md:border md:border-line md:p-4">
          <span className="flex items-center">
            <h2 className="text-sm font-bold">2. How do you want to pay?</h2>
            <InfoButton topic="pay" />
          </span>
          <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Payment type">
            {([["full", "Pay in full", "Card · transfer"], ["small", "Small small", "Any time, 0%"], ["group", "Group pay", "Friends chip in"]] as const).map(([id, t, s]) => (
              <button key={id} type="button" role="radio" aria-checked={mode === id} onClick={() => setMode(id)} className={cn("flex min-h-[58px] flex-col items-start gap-0.5 rounded-md border-[1.5px] bg-white px-2 py-2.5 text-left", mode === id ? "border-ink" : "border-[#e6e6e6]")}>
                <strong className="text-xs md:text-sm">{t}</strong>
                <span className="text-[10px] text-muted md:text-xs">{s}</span>
              </button>
            ))}
          </div>

          {(mode === "full" || mode === "small") && (
            <div className="flex flex-col gap-1.5">
              <h3 className="text-xs font-bold">Payment method</h3>
              <div className="flex flex-col gap-1.5" role="radiogroup" aria-label="Payment method">
              {([["paystack", "Paystack"], ["flutterwave", "Flutterwave"]] as const).map(([id, label]) => (
                <button key={id} type="button" role="radio" aria-checked={method === id} onClick={() => setMethod(id)} className={radio(method === id)}>
                  <span className={dot(method === id)} />
                  <img src={PAYMENT_LOGOS[id]} alt="" aria-hidden="true" className="h-7 w-9 shrink-0 object-contain" />
                  <span>{label}</span>
                </button>
              ))}
              </div>
            </div>
          )}

          {mode === "small" && (
            <div className="flex flex-col gap-2">
              {!smallOk ? (
                <span className="text-muted">Pay small small starts from {naira(SMALL_SMALL.minOrder)}. Add a little more to your cart to use it.</span>
              ) : (
                <>
                  <span className="flex items-center justify-between font-bold">
                    Start with
                    <InfoButton topic="smallsmall" />
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {startChoices.map((v) => (
                      <button key={v} type="button" aria-pressed={weekly === v} onClick={() => setPlan(v)} className={chip(weekly === v)}>{naira(v)}</button>
                    ))}
                  </div>
                  <ul className="flex flex-col gap-1 leading-relaxed text-muted">
                    <li>• Pay the remaining {naira(due - weekly)} in any amounts, whenever you like. No deadlines.</li>
                    <li>• 0% interest. Today’s price is locked.</li>
                    <li>• We order from the factory as soon as it’s fully paid.</li>
                  </ul>
                </>
              )}
            </div>
          )}

          {mode === "group" && (
            <div className="rounded-md bg-group-soft p-3 text-sm">
              <strong>Share the cost with friends</strong>
              <p className="mt-1 text-xs leading-relaxed text-muted">Create your order first. FastChina will generate a unique contribution link that you can share. Friends can contribute securely by Paystack or Flutterwave until the order is fully funded.</p>
              <p className="mt-2 text-xs font-semibold text-muted">The link remains active for 7 days. No payment is taken from you when creating the link.</p>
            </div>
          )}

        {/* Savings */}
        <section className="flex flex-col gap-2.5 bg-white p-3 md:rounded-md md:border md:border-line md:p-4">
          <div className="flex items-center justify-between">
            <span>
              <strong className="flex items-center">Coupon <InfoButton topic="coupons" className="-my-2" /></strong>
              <span className="text-xs text-muted">{best ? `${best.label} · best coupon applied` : "No coupon fits this cart yet"}{quote.couponNote ? ` · ${quote.couponNote}` : ""}</span>
            </span>
            <strong className="shrink-0 whitespace-nowrap pl-3 text-sale">{quote.coupon ? `−${naira(quote.coupon)}` : "—"}</strong>
          </div>
          <button type="button" role="switch" aria-checked={usePoints} onClick={() => setUsePoints(!usePoints)} className="flex min-h-10 items-center justify-between text-left">
            <span>
              <strong className="flex items-center">Use {(quote.pointsBalance ?? 0).toLocaleString("en-NG")} points</strong>
              <span className="text-xs text-muted">100 pts = ₦100 · up to 10% of the order</span>
            </span>
            <span className={cn("flex h-[26px] w-11 rounded-full p-[3px]", usePoints ? "justify-end bg-ink" : "justify-start bg-[#d4d4d4]")}>
              <span className="size-5 rounded-full bg-white" />
            </span>
          </button>
        </section>
      </div>

      {/* Summary */}
      <aside className="flex flex-col gap-1.5 bg-white p-3 lg:sticky lg:top-32 md:rounded-md md:border md:border-line md:p-5">
        <h2 className="hidden text-base font-extrabold md:block">Order summary</h2>
        <div className="flex justify-between"><span className="text-muted">Items</span><span>{naira(quote.subtotalList)}</span></div>
        {quote.priceSavings > 0 && <div className="flex justify-between"><span className="text-muted">Midnight / retailer savings</span><span className="text-sale">−{naira(quote.priceSavings)}</span></div>}
        <div className="flex justify-between"><span className="text-muted">Shipping to pickup station</span><span className="font-bold text-success">Free</span></div>
        <div className="flex justify-between"><span className="text-muted">Customs clearing</span><span className="font-bold text-success">Included</span></div>
        {quote.coupon > 0 && <div className="flex justify-between"><span className="text-muted">Coupon</span><span className="text-sale">−{naira(quote.coupon)}</span></div>}
        {quote.points > 0 && <div className="flex justify-between"><span className="text-muted">Points</span><span className="text-sale">−{naira(quote.points)}</span></div>}
        <div className="flex justify-between border-t border-line pt-1.5 text-base"><strong>Total</strong><strong>{naira(due)}</strong></div>
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-col gap-1 border-t border-line bg-white px-3 pt-2 pb-[max(14px,env(safe-area-inset-bottom))] md:static md:border-0 md:p-0 md:pt-2">
          {placeMsg && <p role="alert" className="text-center text-xs font-semibold text-sale">{placeMsg}</p>}
          {!placeMsg && !online && <p role="status" className="text-center text-xs font-semibold text-muted">You’re offline. We’ll confirm your total when you reconnect.</p>}
          {!placeMsg && online && quoteFailed && <p role="status" className="text-center text-xs font-semibold text-muted">Showing an estimate. We couldn’t confirm the final total yet; it updates when your connection settles.</p>}
          <button
            type="button"
            disabled={placing || selected.length === 0 || !online || !serverQuote || ((mode === "full" || mode === "small") && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))}
            onClick={() =>
              startPlacing(async () => {
                setPlaceMsg(null);
                const call = await attempt(() => placeOrder({
                  items: selected.map((i) => ({ slug: i.slug, variantId: i.variantId, qty: i.qty })),
                  stationId: station, phone, mode, claimedCouponIds: claimed, usePoints,
                }));
                if (!call.ok) return setPlaceMsg(call.message);
                const r = call.value;
                if (!r.ok) return setPlaceMsg(r.message);
                if (mode === "group") {
                  if (!r.linkCode) return setPlaceMsg("The order was created, but its Group Pay link could not be generated. Contact support with order " + r.code + ".");
                  window.location.assign("/c/" + encodeURIComponent(r.linkCode));
                  return;
                }
                const payment = await startOrderPayment({
                  code: r.code, phone, email, provider: method,
                  amountNgn: mode === "full" ? due : weekly,
                });
                if (!payment.ok) return setPlaceMsg(payment.message);
                try {
                  sessionStorage.setItem(`fc-track-${r.code}`, phone.replace(/\D/g, "").slice(-4));
                } catch {}
                // Keep the cart intact while the customer is on the provider's payment page.
                // The cart is cleared only after the verified return reaches order tracking.
                try {
                  sessionStorage.setItem(`fc-pending-cart-${r.code}`, JSON.stringify(selected.map((i) => i.key)));
                } catch {}
                window.location.assign(payment.checkoutUrl);
              })
            }
            className="min-h-[50px] bg-sale text-[15px] font-extrabold text-white disabled:opacity-60"
          >
            {placing ? "PLACING ORDER…" : !online ? "OFFLINE" : !serverQuote ? "CHECKING TOTAL…" : cta}
          </button>
          <span className="text-center text-[11px] text-muted">Paid via licensed processors · refund if it never reaches the station</span>
        </div>
      </aside>
    </div>
  );
}
