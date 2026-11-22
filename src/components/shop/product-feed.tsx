"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { InfoButton } from "@/components/ui/info-button";
import type { Product } from "@/lib/catalog/types";
import { cn } from "@/lib/format";
import { ProductCard } from "./product-card";
import { PromoTile, SpotlightCarousel } from "./feed-promos";
import { categoryRanks } from "./spotlight-card";

const TABS = ["For You", "Gadgets", "New In", "Under ₦10k", "Sea items"] as const;
type Tab = (typeof TABS)[number];

interface ProductFeedPage {
  products: Product[];
  nextCursor: string | null;
}

/** Newest first: products staff marked new, then by date added. */
export function newIn(list: Product[], max = 60): Product[] {
  return [...list].sort((a, b) => Number(!!b.isNew) - Number(!!a.isNew) || (b.addedAt ?? 0) - (a.addedAt ?? 0)).slice(0, max);
}

const filter = (tab: Tab, list: Product[]) => {
  switch (tab) {
    case "Gadgets": return list.filter((p) => p.isGadget);
    case "New In": return newIn(list);
    case "Under ₦10k": return list.filter((p) => p.prices.list < 10_000);
    case "Sea items": return list.filter((p) => p.shipMode === "sea");
    default: return list;
  }
};

function PriceCarousel({ title, products }: { title: string; products: Product[] }) {
  if (!products.length) return null;
  return (
    <section aria-label={title} className="flex flex-col gap-2 px-2 md:px-0">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[15px] font-extrabold md:text-lg">{title}</h2>
        <span className="text-[11px] text-muted">Lowest price first</span>
      </div>
      <div className="no-scrollbar flex snap-x snap-mandatory gap-2 overflow-x-auto pb-1">
        {products.map((product) => (
          <div key={product.slug} className="w-[42vw] shrink-0 snap-start sm:w-44 md:w-48">
            <ProductCard product={product} />
          </div>
        ))}
      </div>
    </section>
  );
}

export function ProductFeed({
  products: initialProducts,
  nextCursor: initialCursor,
  underFiveK,
  fiveToTenK,
}: {
  products: Product[];
  nextCursor: string | null;
  underFiveK: Product[];
  fiveToTenK: Product[];
}) {
  const [tab, setTab] = useState<Tab>("For You");
  const [products, setProducts] = useState(initialProducts);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const hasMore = cursor !== null;

  const loadMore = useCallback(async () => {
    if (!cursor || inFlight.current || loading) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/catalog/feed?cursor=${encodeURIComponent(cursor)}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Could not load more products. Please try again.");
      const page = (await response.json()) as ProductFeedPage;
      setProducts((current) => {
        const seen = new Set(current.map((product) => product.slug));
        return [...current, ...page.products.filter((product) => !seen.has(product.slug))];
      });
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more products. Please try again.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [cursor, loading]);

  useEffect(() => {
    const target = end.current;
    if (!target || !hasMore || loading || error) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) void loadMore();
      },
      { rootMargin: "800px 0px" },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [error, hasMore, loadMore, loading]);

  const list = filter(tab, products);
  const best = [...list].sort((a, b) => b.sold - a.sold).slice(0, 6);
  const photos = [...list].sort((a, b) => b.sold - a.sold).flatMap((p) => p.images.slice(0, 1)).slice(0, 24);
  const ranks = categoryRanks(products);

  return (
    <section aria-label="Products" className="flex flex-col gap-4">
      <PriceCarousel title="Under ₦5,000" products={underFiveK} />
      <PriceCarousel title="Under ₦10,000" products={fiveToTenK} />
      <div className="flex flex-col gap-2">
        <div className="no-scrollbar sticky top-[69px] z-10 flex items-center gap-0.5 overflow-x-auto bg-white px-2 md:static md:px-0">
          {TABS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={cn("min-h-10 whitespace-nowrap border-b-2 px-2 text-sm md:px-3 md:text-[15px]", tab === t ? "border-sale font-extrabold" : "border-transparent text-subtle")}
            >
              {t}
            </button>
          ))}
          <InfoButton topic="shipping" className="ml-auto text-muted" />
        </div>
        {list.length === 0 ? (
          <p className="px-3 py-8 text-center text-muted">Nothing here yet. New items arrive daily.</p>
        ) : (
          <div className="grid grid-cols-2 gap-x-1.5 gap-y-3 px-1.5 sm:grid-cols-3 md:grid-cols-4 md:gap-x-3 md:gap-y-5 md:px-0 lg:grid-cols-5 xl:grid-cols-6">
            {list.map((p, i) => {
              const n = i + 1;
              const spotSlot = n % 8 === 0;
              const spot = spotSlot ? best[(n / 8 - 1) % Math.max(best.length, 1)] : undefined;
              return (
                <Fragment key={p.slug}>
                  <ProductCard product={p} />
                  {n % 12 === 5 && <PromoTile slot={Math.floor(n / 12)} images={photos} />}
                  {spotSlot && <SpotlightCarousel product={spot} rank={spot ? ranks.get(spot.slug) : undefined} className="col-span-2 aspect-[16/11] sm:aspect-[2/1]" images={photos} />}
                </Fragment>
              );
            })}
          </div>
        )}
        <div ref={end} aria-hidden className="h-px" />
        {loading && <p role="status" className="py-4 text-center text-sm text-muted">Loading more products…</p>}
        {error && (
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <p role="alert" className="text-sm text-muted">{error}</p>
            <button type="button" onClick={() => void loadMore()} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Try again</button>
          </div>
        )}
        {!hasMore && products.length > 0 && <p className="py-4 text-center text-[13px] text-muted">You’ve seen it all for now. Try search for something specific.</p>}
      </div>
    </section>
  );
}
