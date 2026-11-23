import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { sampleQuoteLine, sampleToProduct } from "@/lib/catalog/from-sample";
import { SAMPLE_PRODUCTS, sampleBySlug } from "@/lib/catalog/sample";
import type { IconKey, PriceSet, Product, QA, Variant } from "@/lib/catalog/types";
import type { CategoryKey, QuoteLine } from "@/lib/pricing/engine";
import { pausedPrices } from "@/lib/pricing/audit";
import { customTypesLabel } from "@/lib/catalog/supplier";
import { inFlash } from "@/lib/pricing/flash";
import { hasSupabase } from "@/lib/supabase/env";
import { publicDb, secretDb } from "@/lib/supabase/server";

/** Only columns customers are allowed to read (see the column grants in the migrations). */
const PRODUCT_COLUMNS =
  "slug, title, description, created_at, main_images, sale_count, rating, reviews, badge, is_new, tint, icon, flash_claimed_pct, specs, options, wholesale, customisable, " +
  "dispatch_days, custom_moq, custom_types, supplier_verified, supplier_ontime, supplier_years, " +
  "categories(slug, is_gadget, ship_mode, wholesale_enabled), " +
  "product_skus(id, props, image_url, stock, price_list, price_midnight, price_event, price_flash, price_retailer, price_wholesale, active, sort, promo_paused)";

interface Row {
  slug: string;
  title: string;
  description: string | null;
  created_at: string | null;
  main_images: string[];
  sale_count: number;
  rating: number | null;
  reviews: number;
  badge: string | null;
  is_new: boolean;
  tint: string | null;
  icon: string | null;
  flash_claimed_pct: number | null;
  specs: [string, string][];
  options: Product["options"];
  wholesale: boolean;
  customisable: boolean | null;
  dispatch_days: number | null;
  custom_moq: number | null;
  custom_types: string | null;
  supplier_verified: boolean | null;
  supplier_ontime: number | string | null;
  supplier_years: number | null;
  categories: { slug: string; is_gadget: boolean; ship_mode: "air" | "sea"; wholesale_enabled: boolean } | null;
  product_skus: {
    id: string; props: Record<string, string>; image_url: string | null; stock: number; active: boolean; sort: number; promo_paused: boolean;
    price_list: number; price_midnight: number; price_event: number; price_flash: number; price_retailer: number; price_wholesale: number | null;
  }[];
}

/** Variants the profit guard paused sell at list price only. */
const guard = (paused: boolean, p: PriceSet): PriceSet => (paused ? pausedPrices(p) : p);

function rowToProduct(r: Row): Product | null {
  const variants: Variant[] = r.product_skus
    .filter((s) => s.active && s.price_list)
    .sort((a, b) => a.sort - b.sort)
    .map((s) => ({
      id: s.id, props: s.props, image: s.image_url, stock: s.stock,
      // The profit guard paused discounts on this variant: it sells at list price only.
      prices: guard(s.promo_paused, { list: s.price_list, midnight: s.price_midnight, event: s.price_event, flash: s.price_flash, retailer: s.price_retailer }),
      wholesale: s.price_wholesale ?? 0,
    }));
  if (!variants.length) return null;
  const min = (k: keyof PriceSet) => Math.min(...variants.map((v) => v.prices[k]));
  return {
    slug: r.slug,
    name: r.title,
    description: r.description ?? "",
    category: (r.categories?.slug ?? "home") as CategoryKey,
    isGadget: r.categories?.is_gadget ?? false,
    shipMode: r.categories?.ship_mode ?? "air",
    images: [...new Set([...(r.main_images ?? []), ...r.product_skus.map((sku) => sku.image_url).filter((url): url is string => Boolean(url))])],
    tint: r.tint ?? "#ECECEC",
    icon: (r.icon ?? "gift") as IconKey,
    rating: Number(r.rating ?? 0),
    reviews: r.reviews,
    sold: r.sale_count,
    badge: r.badge ?? undefined,
    isNew: r.is_new,
    addedAt: r.created_at ? Date.parse(r.created_at) : undefined,
    specs: r.specs ?? [],
    options: r.options ?? [],
    variants,
    prices: { list: min("list"), midnight: min("midnight"), event: min("event"), flash: min("flash"), retailer: min("retailer") },
    wholesaleFrom: Math.min(...variants.map((v) => v.wholesale || Infinity)),
    wholesale: r.wholesale !== false && r.categories?.wholesale_enabled !== false && variants.some((v) => v.wholesale > 0),
    flash: r.flash_claimed_pct === null ? undefined : { claimedPct: r.flash_claimed_pct },
    customisable: r.customisable === true,
    customMoq: r.custom_moq ?? undefined,
    customTypes: r.custom_types ? customTypesLabel(r.custom_types) : undefined,
    dispatchDays: r.dispatch_days ?? undefined,
    supplier: r.supplier_verified === null ? undefined : {
      verified: r.supplier_verified,
      onTime: r.supplier_ontime === null ? undefined : Number(r.supplier_ontime),
      years: r.supplier_years ?? undefined,
    },
  };
}

/** All visible products. Cached for a few minutes; tag "catalog" to refresh after imports. */
export async function getProducts(): Promise<Product[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  if (!hasSupabase) return SAMPLE_PRODUCTS.map(sampleToProduct);
  const { data, error } = await publicDb().from("products").select(PRODUCT_COLUMNS).in("status", ["active", "sold_out"]).order("sale_count", { ascending: false });
  if (error) throw new Error(`Catalogue: ${error.message}`);
  return ((data ?? []) as unknown as Row[]).map(rowToProduct).filter((p): p is Product => p !== null);
}

/** Products for one category only. Avoid loading the entire catalogue during category-page prerendering. */
export async function getProductsByCategory(category: CategoryKey): Promise<Product[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog", `category:${category}`);
  if (!hasSupabase) return SAMPLE_PRODUCTS.map(sampleToProduct).filter((p) => p.category === category);

  const columns = PRODUCT_COLUMNS.replace("categories(", "categories!inner(");
  const { data, error } = await publicDb()
    .from("products")
    .select(columns)
    .in("status", ["active", "sold_out"])
    .eq("categories.slug", category)
    .order("sale_count", { ascending: false })
    .order("slug", { ascending: true });
  if (error) throw new Error(`Category catalogue (${category}): ${error.message}`);
  return ((data ?? []) as unknown as Row[]).map(rowToProduct).filter((p): p is Product => p !== null);
}

/** Minimal catalogue rows used to choose category-tile photos without loading SKU relations. */
export interface CategoryPhotoProduct {
  slug: string;
  name: string;
  category: CategoryKey;
  images: string[];
  sold: number;
  wholesale: boolean;
}

export async function getCategoryPhotoProducts(): Promise<CategoryPhotoProduct[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  if (!hasSupabase) {
    return SAMPLE_PRODUCTS.map(sampleToProduct).map((p) => ({
      slug: p.slug, name: p.name, category: p.category, images: p.images,
      sold: p.sold, wholesale: p.wholesale,
    }));
  }

  const { data, error } = await publicDb()
    .from("products")
    .select("slug, title, main_images, sale_count, wholesale, categories(slug)")
    .in("status", ["active", "sold_out"])
    .order("sale_count", { ascending: false })
    .order("slug", { ascending: true })
    .limit(1500);
  if (error) throw new Error(`Category photo catalogue: ${error.message}`);

  type PhotoRow = {
    slug: string; title: string; main_images: string[] | null; sale_count: number;
    wholesale: boolean | null; categories: { slug: string } | null;
  };