"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ProductCard } from "@/components/shop/product-card";
import { ProductIcon } from "@/components/ui/product-icon";
import type { Product } from "@/lib/catalog/types";
import { cn } from "@/lib/format";

const DISCOVER = [
  "Necklace for men", "Watch for men", "Bone straight wig", "Android phone", "Chain",
  "Office chair", "Party dress", "Lipstick", "Sneakers", "Wireless earbuds",
  "Smart watches", "Phone cases", "Men's sneakers", "Women's handbags", "Sunglasses",
  "Home decorations", "Kitchen appliances", "Gaming accessories", "Laptop bags",
  "Bracelets", "Perfumes", "Wigs and extensions", "Travel backpacks", "Bluetooth speakers",
  "Baby clothes", "Fitness equipment", "Car accessories", "Storage organisers",
  "Men's shirts", "Women's tops", "LED lights", "Power banks", "Water bottles",
];
const SORTS = ["Relevance", "Best selling", "Price ↑", "Price ↓", "Air only"] as const;

type SearchPage = { products: Product[]; nextCursor: string | null };

const RECENT_SEARCHES_KEY = "fastchina:recent-searches";
const DISCOVERY_REFRESH_MS = 5 * 60 * 1000;

function shuffleForWindow<T>(items: T[], window: number): T[] {
  const result = [...items];
  let seed = (window ^ 0x9e3779b9) >>> 0;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function HotListImage({ product }: { product: Product }) {
  const [failed, setFailed] = useState(false);
  const image = product.images.find((url) => Boolean(url));
  if (!image || failed) {
    return <ProductIcon icon={product.icon} size={44} />;
  }
  return (
    <img
      src={image}
      alt={product.name}
      loading="eager"
      decoding="async"
      referrerPolicy="no-referrer"
      className="absolute inset-0 h-full w-full object-contain"
      onError={() => setFailed(true)}
    />
  );
}

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
  const [recent, setRecent] = useState<string[]>([]);
  const [discoveryWindow, setDiscoveryWindow] = useState(0);
  const [discoveryPage, setDiscoveryPage] = useState(0);
  const [sort, setSort] = useState<(typeof SORTS)[number]>("Relevance");
  const [products, setProducts] = useState<Product[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const requestId = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const loadingRef = useRef(false);
  const term = q.trim();

  const discoveryItems = shuffleForWindow(DISCOVER, discoveryWindow);
  const DISCOVERY_PAGE_SIZE = 8;
  const discoveryPageCount = Math.ceil(discoveryItems.length / DISCOVERY_PAGE_SIZE);
  const visibleDiscoveryItems = discoveryItems.slice(
    discoveryPage * DISCOVERY_PAGE_SIZE,
    (discoveryPage + 1) * DISCOVERY_PAGE_SIZE,
  );

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(RECENT_SEARCHES_KEY);
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate browser-persisted searches once on mount.
          setRecent(parsed.filter((item): item is string => typeof item === "string").slice(0, 8));
        }
      }
    } catch {
      // Search still works when browser storage is unavailable.
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset the page when the shuffled discovery window changes.
    setDiscoveryPage(0);
  }, [discoveryWindow]);

  useEffect(() => {
    const updateWindow = () => setDiscoveryWindow(Math.floor(Date.now() / DISCOVERY_REFRESH_MS));
    updateWindow();
    const interval = window.setInterval(updateWindow, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  const loadPage = useCallback(async (searchTerm: string, cursor: string | null, reset = false) => {
    if (loadingRef.current) return;
    if (reset) activeRequest.current?.abort();

    const controller = new AbortController();
    const id = ++requestId.current;
    activeRequest.current = controller;
    loadingRef.current = true;
    setLoading(true);
    setError(false);

    try {
      const params = new URLSearchParams({ q: searchTerm });
      if (cursor) params.set("cursor", cursor);
      const response = await fetch(`/api/catalog/search?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
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
      if (!controller.signal.aborted && id === requestId.current) setError(true);
    } finally {
      if (id === requestId.current) {
        activeRequest.current = null;
        loadingRef.current = false;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    const currentTerm = term;
    activeRequest.current?.abort();
    requestId.current += 1;
    loadingRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- cancel the previous query before scheduling the next one.
    setLoading(false);

    if (currentTerm.length < 2) {
      setProducts([]);
      setNextCursor(null);
      setError(false);
      return;
    }

    setProducts([]);
    setNextCursor(null);
    const timer = setTimeout(() => {
      void loadPage(currentTerm, null, true);
    }, 220);

    return () => {
      clearTimeout(timer);
      activeRequest.current?.abort();
      requestId.current += 1;
      loadingRef.current = false;
    };
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
    const cleaned = value.trim().slice(0, 120);
    setQ(cleaned);
    if (cleaned.length >= 2) {
      const next = [cleaned, ...recent.filter((item) => item.toLowerCase() !== cleaned.toLowerCase())].slice(0, 8);
      setRecent(next);
      try {
        window.localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // Keep the in-memory recent list even if storage is unavailable.
      }
    }
    router.replace(cleaned ? `/search?q=${encodeURIComponent(cleaned)}` : "/search", { scroll: false });
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
                  <button type="button" aria-label="Clear recent searches" onClick={() => { setRecent([]); try { window.localStorage.removeItem(RECENT_SEARCHES_KEY); } catch { /* Ignore unavailable storage. */ } }} className="flex size-10 items-center justify-center text-muted"><Trash2 aria-hidden size={18} /></button>
                </div>
                <div className="flex flex-wrap gap-2">{recent.map((item) => <button key={item} type="button" onClick={() => go(item)} className="min-h-[38px] rounded-full border border-black/15 bg-white px-3.5 text-sm text-[#333] transition-colors hover:border-ink hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{item}</button>)}</div>
              </section>
            )}
            <section className="flex flex-col gap-2.5">
              <h2 className="text-base font-extrabold">Search discovery</h2>
              <div className="flex flex-wrap gap-2">{visibleDiscoveryItems.map((item) => <button key={item} type="button" onClick={() => go(item)} className="min-h-[38px] rounded-full border border-black/15 bg-white px-3.5 text-sm text-[#333] transition-colors hover:border-ink hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">{item}</button>)}</div>
              <button type="button" onClick={() => setDiscoveryPage((page) => (page + 1) % discoveryPageCount)} className="self-start rounded-full border border-black/15 bg-white px-3.5 py-2 text-xs font-semibold text-[#333] transition-colors hover:border-ink hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">More suggestions <span aria-hidden>→</span></button>
            </section>
          </div>
          <section className="flex flex-col gap-2.5">
            <h2 className="flex items-center gap-1.5 text-base font-extrabold"><span className="rounded-sm bg-[#F5DE9A] px-1.5 py-0.5 text-[11px] text-gold-ink">HOT</span>FastChina Hot List</h2>
            <div className="grid grid-cols-3 gap-2">
              {hotProducts.map((product, index) => (
                <Link key={product.slug} href={`/product/${product.slug}`} className="flex min-w-0 flex-col overflow-hidden rounded-md bg-[#fafafa]">
                  <span className="relative flex h-[112px] w-full shrink-0 items-center justify-center md:h-36" style={{ background: product.tint }}>
                    <HotListImage product={product} />
                    <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-[#FFF6DA] px-2 py-0.5 text-[11px] font-extrabold text-gold-ink">TOP {index + 1}</span>
                  </span>
                  <span className="hot-list-title h-[2.75rem] overflow-hidden p-1.5 text-center text-[11px] leading-[1.25rem] text-gold-ink">{product.name}</span>
                </Link>
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
