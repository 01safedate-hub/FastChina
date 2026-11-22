"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ProductCard } from "@/components/shop/product-card";
import { ProductIcon } from "@/components/ui/product-icon";
import { RotatingPhoto } from "@/components/shop/rotating-photo";
import type { Product } from "@/lib/catalog/types";
import { cn } from "@/lib/format";

const DISCOVER = ["Necklace for men", "Watch for men", "Bone straight wig", "Android phone", "Chain", "Office chair", "Party dress", "Lipstick", "Sneakers"];
const SORTS = ["Relevance", "Best selling", "Price ↑", "Price ↓", "Air only"] as const;

type SearchPage = { products: Product[]; nextCursor: string | null };

function sortResults(matches: Product[], sort: (typeof SORTS)[number]) {
  let res = matches;
  if (sort === "Best selling") res = [...res].sort((a, b) => b.sold - a.sold);
  if (sort === "Price ↑") res = [...res].sort((a, b) => a.prices.list - b.prices.list);
  if (sort === "Price ↓") res = [...res].sort((a, b) => b.prices.list - a.prices.list);
  if (sort === "Air only") res = res.filter((p) => p.shipMode === "air");
  return res;
}

export function SearchView({ hotProducts }: { hotProducts: Product[] }) {
  const params = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(params.get("q") ?? "");
  const [recent, setRecent] = useState(["Silver necklace", "Lace wig", "Earbuds", "Phone case"]);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Relevance");
  const [products, setProducts] = useState<Product[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const term = q.trim();

  const loadPage = useCallback(async (searchTerm: string, cursor: string | null, reset = false) => {
    if (loading) return;
    const id = ++requestId.current;
    setLoading(true);
    setError(false);
    try {
      const params = new URLSearchParams({ q: searchTerm });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/catalog/search?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Search request failed");
      const page = (await response.json()) as SearchPage;
      if (id !== requestId.current) return;
      setProducts((current) => {
        const base = reset ? [] : current;
        const seen = new Set(base.map((product) => product.slug));
        return [...base, ...page.products.filter((product) => !seen.has(product.slug))];
      });
      setNextCursor(page.nextCursor);
    } catch {
      if (id === requestId.current) setError(true);
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    const currentTerm = term;
    if (currentTerm.length < 2) {
      requestId.current += 1;
      setProducts([]);
      setNextCursor(null);
      setLoading(false);
      setError(false);
      return;
    }
    const timer = setTimeout(() => {
      setProducts([]);
      setNextCursor(null);
      void loadPage(currentTerm, null, true);
    }, 220);
    return () => clearTimeout(timer);
  }, [term, loadPage]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node || !nextCursor || loading || error) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) void loadPage(term, nextCursor);
    }, { rootMargin: "700px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, [error, loadPage, loading, nextCursor, term]);

  const results = sortResults(products, sort);
  const go = (value: string) => {
    setQ(value);
    router.replace(value ? `/search?q=${encodeURIComponent(value)}` : "/search", { scroll: false });
  };

  return (
    <div className="flex flex-col pb-6">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          go(q);
        }}
        className="sticky top-0 z-20 flex items-center gap-1.5 border-b border-line bg-white px-3 py-2.5 md:static md:border-0 md:px-0 md:pt-6"
      >
        <Link href="/" aria-label="Back" className="flex h-11 w-9 items-center justify-center md:hidden">
          <ChevronLeft aria-hidden size={22} />
        </Link>
        <div className="flex h-11 min-w-0 flex-1 items-center overflow-hidden rounded-md border-2 border-ink">
          <label htmlFor="sq" className="sr-only">Search FastChina</label>
          <input id="sq" type="search" autoFocus value={q} onChange={(event) => setQ(event.target.value)} placeholder="Search phones, wigs, dresses…" className="h-full min-w-0 flex-1 bg-transparent px-2.5 text-[15px] outline-none" />
          {q && <button type="button" aria-label="Clear search" onClick={() => go("")} className="flex h-full w-9 items-center justify-center text-subtle"><X aria-hidden size={18} /></button>}
          <button type="submit" aria-label="Search" className="flex h-full w-12 items-center justify-center bg-ink text-white"><Search aria-hidden size={18} /></button>
        </div>
      </form>

      {!term ? (
        <div className="flex flex-col gap-5 px-3 pt-3.5 md:grid md:grid-cols-[1fr_1.4fr] md:gap-10 md:px-0">
          <div className="flex flex-col gap-5">
            {recent.length > 0 && (
              <section className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold">Recent searches</h2>
                  <button type="button" aria-label="Clear recent searches" onClick={() => setRecent([])} className="flex size-10 items-center justify-center text-muted"><Trash2 aria-hidden size={18} /></button>
                </div>
                <div className="flex flex-wrap gap-2">{recent.map((item) => <button key={item} type="button" onClick={() => go(item)} className="min-h-[38px] bg-surface px-3.5 text-sm text-[#333]">{item}</button>)}</div>
              </section>
            )}
            <section className="flex flex-col gap-2.5">
              <h2 className="text-base font-extrabold">Search discovery</h2>
              <div className="flex flex-wrap gap-2">{DISCOVER.map((item) => <button key={item} type="button" onClick={() => go(item)} className="min-h-[38px] bg-surface px-3.5 text-sm text-[#333]">{item}</button>)}</div>
            </section>
          </div>
          <section className="flex flex-col gap-2.5">
            <h2 className="flex items-center gap-1.5 text-base font-extrabold"><span className="rounded-sm bg-[#F5DE9A] px-1.5 py-0.5 text-[11px] text-gold-ink">HOT</span>FastChina Hot List</h2>
            <div className="grid grid-cols-3 gap-2">
              {hotProducts.map((product, index) => (
                <button key={product.slug} type="button" onClick={() => go(product.name)} className="flex flex-col overflow-hidden rounded-md bg-[#fafafa]">
                  <span className="relative flex h-[104px] w-full items-center justify-center md:h-36" style={{ background: product.tint }}>
                    <RotatingPhoto images={product.images} offset={index} sizes="(min-width: 768px) 200px, 33vw" className="absolute inset-0" fallback={<ProductIcon icon={product.icon} size={44} className="text-ink/55" />} />
                    <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-[#FFF6DA] px-2 py-0.5 text-[11px] font-extrabold text-gold-ink">TOP {index + 1}</span>
                  </span>
                  <span className="p-1.5 text-center text-[11px] leading-tight text-gold-ink">{product.name}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="no-scrollbar flex gap-1.5 overflow-x-auto border-b border-line px-3 py-2.5 md:px-0">
            {SORTS.map((item) => <button key={item} type="button" aria-pressed={sort === item} onClick={() => setSort(item)} className={cn("min-h-9 whitespace-nowrap rounded-full border px-3 text-[13px] font-bold", sort === item ? "border-ink bg-ink text-white" : "border-black/15")}>{item}</button>)}
          </div>
          <p className="px-3 py-2 text-muted md:px-0">{products.length} result{products.length === 1 ? "" : "s"} loaded for “{term}”</p>
          {results.length ? (
            <div className="grid grid-cols-2 gap-x-1.5 gap-y-3 px-1.5 sm:grid-cols-3 md:grid-cols-4 md:gap-x-3 md:px-0 lg:grid-cols-5">
              {results.map((product) => <ProductCard key={product.slug} product={product} />)}
            </div>
          ) : !loading && !error ? (
            <div className="flex flex-col items-center gap-2 px-4 py-6 text-center">
              <strong className="text-[15px]">Not on FastChina yet</strong>
              <span className="leading-relaxed text-muted">Tell our team what you’re looking for and we’ll find it for you.</span>
              <Link href="/account/settings/contact" className="bg-ink px-4 py-3 font-extrabold text-white">REQUEST THIS PRODUCT</Link>
            </div>
          ) : null}
          {loading && <p className="py-5 text-center text-sm text-muted">Loading products…</p>}
          {error && <div className="py-5 text-center"><p className="mb-2 text-sm text-muted">Search could not load. Please try again.</p><button type="button" onClick={() => void loadPage(term, nextCursor, products.length === 0)} className="font-bold underline">Retry</button></div>}
          <div ref={sentinel} className="h-2" />
          {!loading && !error && !nextCursor && products.length > 0 && <p className="py-5 text-center text-xs text-muted">You’ve reached the end of the results.</p>}
        </div>
      )}
    </div>
  );
}
