"use client";

import { Fragment } from "react";
import type { Product } from "@/lib/catalog/types";
import { PromoTile, SpotlightCarousel } from "./feed-promos";
import { ProductCard } from "./product-card";

const MAX = 240;

/**
 * Related products are already selected and ordered on the server. Render each product
 * once instead of pretending to load more by cycling through the same array.
 */
export function EndlessFeed({ products, title = "You may also like" }: { products: Product[]; title?: string }) {
  const unique = [...new Map(products.map((product) => [product.slug, product])).values()].slice(0, MAX);
  if (!unique.length) return null;
  const best = [...unique].sort((a, b) => b.sold - a.sold);
  const photos = best.flatMap((p) => p.images.slice(0, 1)).slice(0, 24);
  return (
    <section aria-label={title} className="flex flex-col gap-2.5 px-1.5 pt-4 pb-24 md:px-0 md:pb-6">
      <h2 className="px-1.5 text-[15px] font-extrabold md:px-0 md:text-lg">{title}</h2>
      <div className="grid grid-cols-2 gap-x-1.5 gap-y-3 sm:grid-cols-3 md:grid-cols-4 md:gap-x-3 lg:grid-cols-5 xl:grid-cols-6">
        {unique.map((p, i) => {
          const n = i + 1;
          return (
            <Fragment key={p.slug}>
              <ProductCard product={p} />
              {n % 12 === 7 && <PromoTile slot={Math.floor(n / 12) + 3} images={photos} />}
              {n % 16 === 0 && <SpotlightCarousel product={best[(n / 16) % best.length]} className="col-span-2 aspect-[16/11] sm:aspect-[2/1]" images={photos} />}
            </Fragment>
          );
        })}
      </div>
    </section>
  );
}
