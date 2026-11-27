"use client";

import { useEffect, useState } from "react";
import { Heart } from "lucide-react";
import Link from "next/link";
import { ProductCard } from "@/components/shop/product-card";
import { useWishlist } from "@/components/shop/wishlist-provider";
import type { Product } from "@/lib/catalog/types";

export function WishlistView() {
  const { slugs } = useWishlist();
  const [products, setProducts] = useState<Product[]>([]);
  const [settledKey, setSettledKey] = useState<string | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const slugKey = slugs.join("\u0000");
  const requestKey = `${slugKey}::${retry}`;
  const loading = Boolean(slugKey) && settledKey !== requestKey && failedKey !== requestKey;
  const failed = Boolean(slugKey) && failedKey === requestKey;

  useEffect(() => {
    const requested = slugKey ? slugKey.split("\u0000") : [];
    let active = true;

    if (!requested.length) return;

    async function loadSavedProducts() {
      try {
        const loaded: Product[] = [];
        // The API deliberately limits each query to 10 slugs to keep the
        // joined product/SKU lookup bounded, even for large wishlists.
        for (let index = 0; index < requested.length; index += 10) {
          const response = await fetch("/api/catalog/products-by-slugs", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ slugs: requested.slice(index, index + 10) }),
          });
          if (!response.ok) throw new Error("Saved products could not be loaded");
          const result = (await response.json()) as { products?: Product[] };
          loaded.push(...(result.products ?? []));
        }

        if (active) {
          const bySlug = new Map(loaded.map((product) => [product.slug, product]));
          setProducts(requested.flatMap((slug) => {
            const product = bySlug.get(slug);
            return product ? [product] : [];
          }));
          setFailedKey(null);
          setSettledKey(requestKey);
        }
      } catch {
        if (active) setFailedKey(requestKey);
      }
    }

    void loadSavedProducts();
    return () => {
      active = false;
    };
  }, [slugKey, retry, requestKey]);

  const bySlug = new Map(products.map((product) => [product.slug, product]));
  const saved = slugs.flatMap((slug) => {
    const product = bySlug.get(slug);
    return product ? [product] : [];
  });

  return (
    <div className="flex flex-col gap-3 px-1.5 py-4 md:px-0">
      <h1 className="flex items-center gap-2 px-1.5 text-xl font-extrabold md:px-0"><Heart aria-hidden size={20} /> Saved items <span className="text-sm font-normal text-muted">{saved.length}</span></h1>
      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6" aria-label="Loading saved items">
          {Array.from({ length: 4 }, (_, index) => <div key={index} className="aspect-[3/4] animate-pulse rounded-lg bg-muted/20" />)}
        </div>
      ) : failed ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-muted">Your saved items could not be loaded. Please try again.</p>
          <button type="button" onClick={() => setRetry((value) => value + 1)} className="min-h-11 rounded-md bg-ink px-5 py-3 text-sm font-extrabold text-white">TRY AGAIN</button>
        </div>
      ) : saved.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-center">
          <p className="text-muted">Tap the heart on anything you like. Sign in and your saved items follow you to every device.</p>
          <Link href="/" className="min-h-11 rounded-md bg-ink px-5 py-3 text-sm font-extrabold text-white">START SHOPPING</Link>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-1.5 gap-y-3 sm:grid-cols-3 md:grid-cols-4 md:gap-x-3 lg:grid-cols-6">
          {saved.map((product) => <ProductCard key={product.slug} product={product} />)}
        </div>
      )}
    </div>
  );
}
