"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BrandWordmark } from "@/components/shop/brand";

export function StoreNav({ shopUrl }: { shopUrl: string }) {
  const [open, setOpen] = useState(false);
  const links = [
    { href: shopUrl, label: "Marketplace" },
    { href: "#dropship", label: "Dropship stores" },
    { href: "#how", label: "How it works" },
    { href: "#wholesale", label: "Wholesale · Sea" },
    { href: `${shopUrl.replace(/\/$/, "")}/guides`, label: "Guides" },
    { href: "#pricing", label: "Pricing" },
  ];

  return (
    <header className="relative z-40 border-b border-[#E6E1D5] bg-[#FBFAF6]">
      <div className="mx-auto flex min-h-[76px] max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link href="/store" className="flex shrink-0 items-center gap-1" aria-label="FastChina.store home">
          <BrandWordmark className="h-7 w-auto text-ink" title="FastChina.store" />
          <span aria-hidden className="mt-2 self-start text-[13px] font-semibold text-[#7A5C17]">.store</span>
        </Link>

        <nav aria-label="Main" className="hidden min-w-0 flex-1 items-center justify-center gap-x-5 text-sm font-medium lg:flex xl:gap-x-6">
          {links.map((link) => <a key={link.label} href={link.href} className="whitespace-nowrap hover:text-[#7A5C17]">{link.label}</a>)}
        </nav>

        <div className="hidden shrink-0 items-center gap-2.5 sm:flex">
          <Link href="/sign-in?next=/store/seller" className="whitespace-nowrap px-3 py-3 text-sm font-medium">Seller sign in</Link>
          <Link href="/sign-in?next=/store/seller" className="whitespace-nowrap rounded-full bg-ink px-5 py-3 text-sm font-semibold text-[#FBFAF6]">Start selling</Link>
        </div>

        <button
          type="button"
          className="flex size-11 shrink-0 items-center justify-center rounded-full border border-[#E6E1D5] text-ink hover:bg-[#F1EDE3] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#7A5C17] lg:hidden"
          aria-label={open ? "Close navigation" : "Open navigation"}
          aria-expanded={open}
          aria-controls="store-mobile-menu"
          onClick={() => setOpen((value) => !value)}
        >
          {open ? <X size={22} aria-hidden /> : <Menu size={22} aria-hidden />}
        </button>
      </div>

      {open && (
        <>
          <button type="button" aria-label="Close navigation overlay" onClick={() => setOpen(false)} className="fixed inset-0 top-0 z-40 bg-black/30 lg:hidden" />
          <nav id="store-mobile-menu" aria-label="Mobile main" className="absolute inset-x-0 top-full z-50 border-b border-[#E6E1D5] bg-[#FBFAF6] px-5 pb-5 pt-3 shadow-xl lg:hidden">
            <div className="mx-auto flex max-w-7xl flex-col">
              {links.map((link) => (
                <a key={link.label} href={link.href} onClick={() => setOpen(false)} className="border-b border-[#E6E1D5] py-3.5 text-[16px] font-medium text-ink last:border-0 hover:text-[#7A5C17]">
                  {link.label}
                </a>
              ))}
              <div className="mt-4 grid grid-cols-2 gap-2">
                <Link href="/sign-in?next=/store/seller" onClick={() => setOpen(false)} className="rounded-full border border-ink px-3 py-3 text-center text-sm font-semibold">Seller sign in</Link>
                <Link href="/sign-in?next=/store/seller" onClick={() => setOpen(false)} className="rounded-full bg-ink px-3 py-3 text-center text-sm font-semibold text-white">Start selling</Link>
              </div>
            </div>
          </nav>
        </>
      )}
    </header>
  );
}
