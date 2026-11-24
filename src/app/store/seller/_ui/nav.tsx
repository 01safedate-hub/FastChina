"use client";

import { BarChart3, Home, Menu, Package, Paintbrush, ReceiptText, Sparkles, Wallet, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { BrandWordmark } from "@/components/shop/brand";
import { cn } from "@/lib/format";

const BASE = "/store/seller";
const ITEMS = [
  { href: BASE, label: "Home", icon: Home },
  { href: `${BASE}/products`, label: "Products", icon: Package },
  { href: `${BASE}/orders`, label: "Orders", icon: ReceiptText },
  { href: `${BASE}/earnings`, label: "Earnings", icon: Wallet },
  { href: `${BASE}/design`, label: "Design", icon: Paintbrush },
  { href: `${BASE}/plan`, label: "Plan", icon: Sparkles },
];

export function SellerNav() {
  const path = usePathname().replace(/\/$/, "");
  const [mobileOpen, setMobileOpen] = useState(false);
  // On fastchina.store the dashboard is served at /seller (the proxy adds /store).
  const active = (href: string) => {
    const p = path.startsWith("/store") ? path : `/store${path}`;
    return href === BASE ? p === BASE : p.startsWith(href);
  };

  const links = (mobile = false) => ITEMS.map(({ href, label, icon: Icon }) => (
    <Link
      key={href}
      href={href}
      aria-current={active(href) ? "page" : undefined}
      onClick={() => mobile && setMobileOpen(false)}
      className={cn(
        "flex min-h-11 items-center gap-3.5 rounded-md px-3 text-[14px] font-bold transition-colors",
        active(href) ? "bg-[#1E1E22] text-white" : "text-[#A1A1AA] hover:bg-white/5 hover:text-white",
      )}
    >
      <Icon aria-hidden size={20} strokeWidth={active(href) ? 2.4 : 1.8} />
      {label}
    </Link>
  ));

  return (
    <>
      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col gap-1 bg-black p-3 md:flex">
        <Link href={BASE} className="mb-4 flex items-center gap-2 px-2 pt-2">
          <BrandWordmark className="h-[22px] w-auto text-white" />
          <span className="mt-1.5 text-[11px] font-bold text-[#A1A1AA]">seller</span>
        </Link>
        {links()}
        <div className="mt-auto rounded-lg bg-[#17171A] p-3 text-xs text-[#A1A1AA]">
          <BarChart3 aria-hidden size={16} className="mb-1.5 text-[#F5C542]" />
          Paid every Friday for delivered orders. Questions? help@fastchina.shop
        </div>
      </aside>

      {/* Mobile dashboard header and navigation drawer */}
      <header className="sticky top-0 z-40 flex h-14 items-center justify-between border-b border-white/10 bg-black/95 px-4 backdrop-blur md:hidden">
        <Link href={BASE} className="flex items-center gap-2" aria-label="Seller dashboard home">
          <BrandWordmark className="h-[20px] w-auto text-white" />
          <span className="text-[11px] font-bold text-[#A1A1AA]">seller</span>
        </Link>
        <button
          type="button"
          aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={mobileOpen}
          aria-controls="seller-mobile-navigation"
          onClick={() => setMobileOpen((open) => !open)}
          className="flex size-10 items-center justify-center rounded-lg text-white hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F5C542]"
        >
          {mobileOpen ? <X aria-hidden size={22} /> : <Menu aria-hidden size={22} />}
        </button>
      </header>

      {mobileOpen && (
        <>
          <button
            type="button"
            aria-label="Close navigation overlay"
            onClick={() => setMobileOpen(false)}
            className="fixed inset-0 z-40 bg-black/65 md:hidden"
          />
          <aside
            id="seller-mobile-navigation"
            aria-label="Seller dashboard navigation"
            className="fixed inset-y-14 left-0 z-50 flex w-[min(19rem,88vw)] flex-col gap-1 border-r border-white/10 bg-[#0E0E10] p-3 shadow-2xl md:hidden"
          >
            <p className="px-3 pb-2 pt-3 text-[10px] font-extrabold uppercase tracking-[0.16em] text-[#777780]">Dashboard</p>
            {links(true)}
            <div className="mt-auto rounded-lg bg-[#17171A] p-3 text-xs text-[#A1A1AA]">
              <BarChart3 aria-hidden size={16} className="mb-1.5 text-[#F5C542]" />
              Paid every Friday for delivered orders. Questions? help@fastchina.shop
            </div>
          </aside>
        </>
      )}
    </>
  );
}
