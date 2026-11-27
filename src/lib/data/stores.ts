import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { PriceSet, Product } from "@/lib/catalog/types";
import { getProductsBySlugs } from "@/lib/data/catalog";
import { type PlanKey, storePrice, type ThemeKey } from "@/lib/dropship/plans";
import { hasSupabase } from "@/lib/supabase/env";
import { publicDb } from "@/lib/supabase/server";

export interface PublicStore {
  id: string;
  slug: string;
  alias?: string | null;
  name: string;
  tagline: string | null;
  accent: string;
  theme: ThemeKey;
  plan: PlanKey;
  status: "active" | "needs_upgrade" | "suspended";
  customDomain: string | null;
  allowSmallSmall: boolean;
}

export interface Listing {
  slug: string;
  markupType: "pct" | "fixed";
  markupValue: number;
}

const DEMO: { store: PublicStore; listings: Listing[] } = {
  store: { id: "demo", slug: "adas-closet", name: "Ada’s Closet", tagline: "Lagos girls, Lagos prices. Delivered to your Jumia station.", accent: "#C2410C", theme: "studio", plan: "free", status: "active", customDomain: null, allowSmallSmall: true },
  listings: ["satin-cowl-neck-midi-dress", "quilted-crossbody-chain-bag", "body-wave-lace-front-wig-22", "matte-liquid-lipstick-set", "mens-steel-quartz-watch", "chunky-platform-sneakers", "stainless-thorn-chain-necklace", "wireless-earbuds-enc"]
    .map((slug) => ({ slug, markupType: "pct" as const, markupValue: 25 })),
};

type StorefrontRpcResult = {
  store: {
    id: string; slug: string; alias: string | null; name: string; tagline: string | null;
    accent: string; theme: ThemeKey; plan: PlanKey; status: PublicStore["status"];
    custom_domain: string | null; allow_small_small: boolean | null;
  };
  listings: { slug: string; markup_type: "pct" | "fixed"; markup_value: number | string }[];
};

/** Public store lookup uses a narrow, read-only RPC so every storefront shares one safe query path. */
export async function getStore(key: string): Promise<{ store: PublicStore; listings: Listing[] } | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("stores", `store:${key}`);
  if (!hasSupabase) {
    if (key === DEMO.store.slug) return DEMO;
    const t = key.replace(/^demo-/, "") as ThemeKey;
    const look: Partial<Record<ThemeKey, Partial<PublicStore>>> = {
      noir: { name: "Maison Ọba", tagline: "Watches, wigs and evening wear. Quietly expensive.", accent: "#C9A44C" },
      bloom: { name: "Little Bloom", tagline: "Soft things for little ones and the people who love them.", accent: "#D9577A" },
      atelier: { name: "Atelier Ẹwà", tagline: "An edit of pieces worth keeping, chosen every week.", accent: "#7A4E2D" },
      pulse: { name: "VOLT", tagline: "Gadgets, kicks and loud colour. Free delivery nationwide.", accent: "#7C3AED" },
    };
    return look[t] ? { store: { ...DEMO.store, ...look[t], theme: t, plan: "elite", slug: key }, listings: DEMO.listings } : null;
  }

  const k = key.trim().toLowerCase();
  if (!k || k.length > 253) return null;
  try {
    // The RPC is SECURITY DEFINER but returns only explicitly approved public fields.
    // Cast locally until Supabase's generated Database type is refreshed with the RPC.
    const rpc = publicDb() as unknown as {
      rpc: (name: string, args: { p_key: string }) => Promise<{ data: unknown; error: { code?: string; message: string; details?: string; hint?: string } | null }>;
    };
    const { data, error } = await rpc.rpc("get_public_storefront", { p_key: k });
    if (error) {
      console.error("[storefront:getStore:rpc]", { key: k, code: error.code, message: error.message, details: error.details, hint: error.hint });
      return null;
    }
    if (!data || typeof data !== "object") return null;
    const result = data as StorefrontRpcResult;
    if (!result.store || result.store.status === "suspended") return null;
    return {
      store: {
        id: result.store.id,
        slug: result.store.slug,
        alias: result.store.alias,
        name: result.store.name,
        tagline: result.store.tagline,
        accent: result.store.accent,
        theme: result.store.theme,
        plan: result.store.plan,
        status: result.store.status,
        customDomain: result.store.custom_domain,
        allowSmallSmall: result.store.allow_small_small !== false,
      },
      listings: (result.listings ?? []).map((listing) => ({
        slug: listing.slug,
        markupType: listing.markup_type,
        markupValue: Number(listing.markup_value),
      })),
    };
  } catch (error) {
    console.error("[storefront:getStore:rpc-threw]", { key: k, error });
    return null;
  }
}

/** Seller's fixed selling price: FastChina price plus markup, with marketplace promotions disabled. */
export function sellerPrices(p: PriceSet, l: Pick<Listing, "markupType" | "markupValue">): PriceSet {
  const { price } = storePrice(p.list, l.markupType, l.markupValue);
  return { list: price, midnight: price, event: price, flash: price, retailer: price };
}

/** Hydrate only the products selected by this store. A catalogue failure must not take down its shell. */
export async function getStoreProducts(listings: Listing[]): Promise<Product[]> {
  const slugs = [...new Set(listings.map((listing) => listing.slug))].slice(0, 10);
  if (!slugs.length) return [];
  let selected: Product[];
  try {
    selected = await getProductsBySlugs(slugs);
  } catch (error) {
    console.error("[storefront:getStoreProducts:catalog-query]", { slugs, error });
    return [];
  }
  const bySlug = new Map(selected.map((product) => [product.slug, product]));
  return listings.flatMap((listing) => {
    const product = bySlug.get(listing.slug);
    if (!product) return [];
    return [{
      ...product,
      prices: sellerPrices(product.prices, listing),
      flash: undefined,
      badge: undefined,
      variants: product.variants.map((variant) => ({
        ...variant,
        prices: sellerPrices(variant.prices, listing),
      })),
    }];
  });
}
