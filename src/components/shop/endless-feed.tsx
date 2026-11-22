"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { Product } from "@/lib/catalog/types";
import { PromoTile, SpotlightCarousel } from "./feed-promos";
import { ProductCard } from "./product-card";

interface RelatedProductPage {
  products: Product[];
  nextCursor: string | null;
}

/**
 * Related products load from the backend in cursor-based pages. Products are
 * appended once, and IntersectionObserver requests the next page near the bottom.
 */
export function EndlessFeed({
  products: initialProducts,
  nextCursor: initialCursor,
  currentSlug,
  title = "You may also like",
}: {
  products: Product[];
  nextCursor: string | null;
  currentSlug: string;
  title?: string;
}) {
  const [products, setProducts] = useState(initialProducts);
  const [cursor, setCursor] = useState(initialCursor);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const hasMore = cursor !== null;

  const loadMore = useCallback(async () => {
    if (!cursor || inFlight.current || loading) return;
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/catalog/related/${encodeURIComponent(currentSlug)}?cursor=${encodeURIComponent(cursor)}`,
        { method: "GET", headers: { Accept: "application/json" }, cache: "no-store" },
      );
      if (!response.ok) throw new Error("Could not load more related products. Please try again.");
      const page = (await response.json()) as RelatedProductPage;
      setProducts((current) => {
        const seen = new Set(current.map((product) => product.slug));
        return [...current, ...page.products.filter((product) => product.slug !== currentSlug && !seen.has(product.slug))];
      });
      setCursor(page.nextCursor);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load more related products. Please try again.");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [currentSlug, cursor, loading]);

  useEffect(() => {
    const target = sentinel.current;
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

  const unique = [...new Map(products.filter((product) => product.slug !== currentSlug).map((product) => [product.slug, product])).values()];
  if (!unique.length && !hasMore) return null;
  const best = [...unique].sort((a, b) => b.sold - a.sold);
  const photos = best.flatMap((product) => product.images.slice(0, 1)).slice(0, 24);

  return (
    <section aria-label={title} className="flex flex-col gap-2.5 px-1.5 pt-4 pb-24 md:px-0 md:pb-6">
      <h2 className="px-1.5 text-[15px] font-extrabold md:px-0 md:text-lg">{title}</h2>
      <div className="grid grid-cols-2 gap-x-1.5 gap-y-3 sm:grid-cols-3 md:grid-cols-4 md:gap-x-3 lg:grid-cols-5 xl:grid-cols-6">
        {unique.map((product, i) => {
          const n = i + 1;
          return (
            <Fragment key={product.slug}>
              <ProductCard product={product} />
              {n % 12 === 7 && <PromoTile slot={Math.floor(n / 12) + 3} images={photos} />}
              {n % 16 === 0 && <SpotlightCarousel product={best[(n / 16) % best.length]} className="col-span-2 aspect-[16/11] sm:aspect-[2/1]" images={photos} />}
            </Fragment>
          );
        })}
      </div>
      <div ref={sentinel} aria-hidden className="h-px" />
      {loading && <p role="status" className="py-4 text-center text-sm text-muted">Loading more products…</p>}
      {error && (
        <div className="flex flex-col items-center gap-2 py-4 text-center">
          <p role="alert" className="text-sm text-muted">{error}</p>
          <button type="button" onClick={() => void loadMore()} className="rounded-md bg-ink px-4 py-2 text-sm font-semibold text-white">Try again</button>
        </div>
      )}
      {!hasMore && unique.length > 0 && <p className="py-4 text-center text-[13px] text-muted">You’ve seen it all for now.</p>}
    </section>
  );
}
