"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Copy, ExternalLink, Share2, Users } from "lucide-react";
import { naira } from "@/lib/format";
import { Progress } from "@/components/ui/progress";
import { linkProgress, type LinkProgress } from "../../actions";

type GroupOrder = LinkProgress & {
  code: string;
  orderCode: string;
  status: string;
  createdAt: string;
  settledAt: string | null;
};

export function GroupOrdersList({ orders }: { orders: GroupOrder[] }) {
  const [items, setItems] = useState(orders);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const refreshed = await Promise.all(orders.map(async (item) => {
        const progress = await linkProgress(item.code).catch(() => null);
        return progress ? { code: item.code, ...progress } : null;
      }));
      setItems((current) => current.map((item) => refreshed.find((next) => next?.code === item.code) ? { ...item, ...refreshed.find((next) => next?.code === item.code)! } : item));
    }, 10000);
    return () => window.clearInterval(timer);
  }, [orders]);

  const shareUrl = (code: string) => `${window.location.origin}/c/${encodeURIComponent(code)}`;
  const copy = async (code: string) => {
    const url = shareUrl(code);
    try {
      await navigator.clipboard.writeText(url);
      setCopied(code);
      window.setTimeout(() => setCopied((current) => current === code ? null : current), 2500);
    } catch {
      window.prompt("Copy your Group Pay link:", url);
    }
  };
  const share = async (code: string) => {
    const url = shareUrl(code);
    if (navigator.share) {
      try { await navigator.share({ title: "Contribute to my FastChina order", url }); return; } catch (error) {
        if (error instanceof Error && error.name === "AbortError") return;
      }
    }
    await copy(code);
  };

  return (
    <ul className="flex flex-col gap-3 px-3">
      {items.map((item) => {
        const remaining = Math.max(0, item.target - item.raised);
        const settled = item.settledAt !== null;
        const expired = settled || (new Date(item.expires_at).getTime() <= Date.now() && remaining > 0);
        const complete = remaining === 0 && !settled;
        const url = `/c/${encodeURIComponent(item.code)}`;
        return (
          <li key={item.code} className="rounded-xl border border-line bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-muted">Order reference</p>
                <Link href={`/account/orders/${encodeURIComponent(item.orderCode)}`} className="font-mono text-lg font-extrabold underline">#{item.orderCode}</Link>
                <p className="mt-1 text-xs text-muted">Created {new Date(item.createdAt).toLocaleDateString("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" })}</p>
              </div>
              <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-bold">{expired ? "Expired" : complete ? "Fully funded" : "Collecting"}</span>
            </div>
            <div className="mt-4 flex items-baseline justify-between gap-2">
              <strong className="text-xl">{naira(item.raised)}</strong>
              <span className="text-xs text-muted">of {naira(item.target)} raised</span>
            </div>
            <Progress value={item.target > 0 ? (item.raised / item.target) * 100 : 0} className="mt-2 h-2 bg-[#E0DEF7]" barClass="bg-group" label="Group Pay funding progress" />
            <div className="mt-2 flex justify-between text-xs text-muted">
              <span className="flex items-center gap-1"><Users size={13} /> {item.people} contributors</span>
              <span>{complete ? "No balance remaining" : `${naira(remaining)} left`}</span>
            </div>
            <p className="mt-2 text-xs text-muted">{item.items.filter((line) => line.funded).length} of {item.items.length} items marked funded · {expired ? "Closed" : "Link expires"} {new Date(item.expires_at).toLocaleDateString("en-NG", { dateStyle: "medium", timeZone: "Africa/Lagos" })}</p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button type="button" onClick={() => void copy(item.code)} className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-line text-sm font-bold">
                {copied === item.code ? <Check size={16} /> : <Copy size={16} />}{copied === item.code ? "Copied" : "Copy link"}
              </button>
              <button type="button" onClick={() => void share(item.code)} className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-ink text-sm font-bold text-white">
                <Share2 size={16} /> Share link
              </button>
            </div>
            <Link href={url} className="mt-3 flex min-h-10 items-center justify-center gap-2 text-sm font-semibold text-muted">
              Open contribution page <ExternalLink size={14} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
