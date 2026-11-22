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
  return ((data ?? []) as unknown as PhotoRow[]).map((row) => ({
    slug: row.slug,
    name: row.title,
    category: (row.categories?.slug ?? "home") as CategoryKey,
    images: row.main_images ?? [],
    sold: row.sale_count ?? 0,
    wholesale: row.wholesale === true,
  }));
}

/** Hydrate only the products needed for the currently selected category cards. */
export async function getProductsBySlugs(slugs: string[]): Promise<Product[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  const uniqueSlugs = [...new Set(slugs)].slice(0, 10);
  if (!uniqueSlugs.length) return [];
  if (!hasSupabase) {
    const bySlug = new Map(SAMPLE_PRODUCTS.map((sample) => {
      const product = sampleToProduct(sample);
      return [product.slug, product] as const;
    }));
    return uniqueSlugs.flatMap((slug) => {
      const product = bySlug.get(slug);
      return product ? [product] : [];
    });
  }

  const { data, error } = await publicDb()
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("status", ["active", "sold_out"])
    .in("slug", uniqueSlugs);
  if (error) throw new Error(`Category products: ${error.message}`);

  const bySlug = new Map(
    ((data ?? []) as unknown as Row[])
      .map(rowToProduct)
      .filter((product): product is Product => product !== null)
      .map((product) => [product.slug, product]),
  );
  return uniqueSlugs.flatMap((slug) => {
    const product = bySlug.get(slug);
    return product ? [product] : [];
  });
}

/** A bounded product set for homepage merchandising modules. */
export async function getHomeProducts(): Promise<Product[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  if (!hasSupabase) return SAMPLE_PRODUCTS.map(sampleToProduct);
  const { data, error } = await publicDb()
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("status", ["active", "sold_out"])
    .order("sale_count", { ascending: false })
    .order("slug", { ascending: true })
    // Homepage modules need a compact merchandising sample, not 120 full product
    // records with every SKU relation. The main feed is loaded separately in pages.
    .limit(24);
  if (error) throw new Error(`Homepage catalogue: ${error.message}`);
  return ((data ?? []) as unknown as Row[]).map(rowToProduct).filter((p): p is Product => p !== null);
}

/** Bounded wholesale catalogue: filter eligible products in the database before loading SKU details. */
export async function getWholesaleProducts(): Promise<Product[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  if (!hasSupabase) {
    return SAMPLE_PRODUCTS.map(sampleToProduct).filter((p) => p.wholesale && p.wholesaleFrom > 0 && Number.isFinite(p.wholesaleFrom));
  }
  const wholesaleColumns = PRODUCT_COLUMNS.replace("product_skus(", "product_skus!inner(");
  const { data, error } = await publicDb()
    .from("products")
    .select(wholesaleColumns)
    .eq("wholesale", true)
    .eq("product_skus.active", true)
    .gt("product_skus.price_wholesale", 0)
    .in("status", ["active", "sold_out"])
    .order("sale_count", { ascending: false })
    .order("slug", { ascending: true })
    .limit(120);
  if (error) throw new Error(`Wholesale catalogue: ${error.message}`);
  return ((data ?? []) as unknown as Row[])
    .map(rowToProduct)
    .filter((p): p is Product => p !== null && p.wholesale && p.wholesaleFrom > 0 && Number.isFinite(p.wholesaleFrom));
}

/** Bounded related-product candidates; the page prioritises the current product's category. */
export async function getRelatedProducts(slug: string): Promise<Product[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog");
  if (!hasSupabase) return SAMPLE_PRODUCTS.map(sampleToProduct).filter((p) => p.slug !== slug);
  const { data, error } = await publicDb()
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("status", ["active", "sold_out"])
    .neq("slug", slug)
    .order("sale_count", { ascending: false })
    .order("slug", { ascending: true })
    // Keep prerender work bounded; the product page only needs a small related strip.
    .limit(12);
  if (error) throw new Error(`Related catalogue: ${error.message}`);
  return ((data ?? []) as unknown as Row[]).map(rowToProduct).filter((p): p is Product => p !== null);
}

export interface ProductFeedPage {
  products: Product[];
  nextCursor: string | null;
}

/**
 * A stable, server-backed catalogue page. The cursor uses sale_count + slug so products
 * with the same sales count have a deterministic order and are not repeated between pages.
 */
export async function getProductFeedPage(cursor?: string | null, pageSize = 12): Promise<ProductFeedPage> {
  const size = Math.min(24, Math.max(1, Math.floor(pageSize)));
  const parsed = cursor ? /^(\d+):([a-z0-9-]+)$/.exec(cursor) : null;
  if (cursor && !parsed) throw new Error("Invalid catalogue cursor");

  if (!hasSupabase) {
    const all = SAMPLE_PRODUCTS.map(sampleToProduct).sort((a, b) => b.sold - a.sold || a.slug.localeCompare(b.slug));
    const remaining = parsed
      ? all.filter((p) => p.sold < Number(parsed[1]) || (p.sold === Number(parsed[1]) && p.slug > parsed[2]))
      : all;
    const page = remaining.slice(0, size + 1);
    const hasMore = page.length > size;
    const products = page.slice(0, size);
    const last = products[products.length - 1];
    return {
      products,
      nextCursor: hasMore && last ? `${last.sold}:${last.slug}` : null,
    };
  }

  let query = publicDb()
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("status", ["active", "sold_out"])
    .order("sale_count", { ascending: false })
    .order("slug", { ascending: true })
    .limit(size + 1);

  if (parsed) {
    const sold = Number(parsed[1]);
    const slug = parsed[2];
    query = query.or(`sale_count.lt.${sold},and(sale_count.eq.${sold},slug.gt.${slug})`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Catalogue feed: ${error.message}`);
  const rows = ((data ?? []) as unknown as Row[]);
  const hasMore = rows.length > size;
  const products = rows.slice(0, size).map(rowToProduct).filter((p): p is Product => p !== null);
  const last = rows[Math.min(size, rows.length) - 1];
  return {
    products,
    nextCursor: hasMore && last ? `${last.sale_count}:${last.slug}` : null,
  };
}

/**
 * Cursor-paginated related catalogue for product pages. The current product is
 * excluded on every page and sale_count + slug keeps pagination deterministic.
 */
export async function getRelatedProductsPage(
  currentSlug: string,
  cursor?: string | null,
  pageSize = 12,
): Promise<ProductFeedPage> {
  const size = Math.min(24, Math.max(1, Math.floor(pageSize)));
  const parsed = cursor ? /^(\d+):([a-z0-9-]+)$/.exec(cursor) : null;
  if (cursor && !parsed) throw new Error("Invalid related catalogue cursor");

  if (!hasSupabase) {
    const all = SAMPLE_PRODUCTS.map(sampleToProduct)
      .filter((product) => product.slug !== currentSlug)
      .sort((a, b) => b.sold - a.sold || a.slug.localeCompare(b.slug));
    const remaining = parsed
      ? all.filter((product) => product.sold < Number(parsed[1]) || (product.sold === Number(parsed[1]) && product.slug > parsed[2]))
      : all;
    const page = remaining.slice(0, size + 1);
    const hasMore = page.length > size;
    const products = page.slice(0, size);
    const last = products[products.length - 1];
    return { products, nextCursor: hasMore && last ? `${last.sold}:${last.slug}` : null };
  }

  let query = publicDb()
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("status", ["active", "sold_out"])
    .neq("slug", currentSlug)
    .order("sale_count", { ascending: false })
    .order("slug", { ascending: true })
    .limit(size + 1);

  if (parsed) {
    const sold = Number(parsed[1]);
    const slug = parsed[2];
    query = query.or(`sale_count.lt.${sold},and(sale_count.eq.${sold},slug.gt.${slug})`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Related catalogue: ${error.message}`);
  const rows = (data ?? []) as unknown as Row[];
  const hasMore = rows.length > size;
  const products = rows.slice(0, size).map(rowToProduct).filter((product): product is Product => product !== null);
  const last = rows[Math.min(size, rows.length) - 1];
  return {
    products,
    nextCursor: hasMore && last ? `${last.sale_count}:${last.slug}` : null,
  };
}

export async function getProduct(slug: string): Promise<Product | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("catalog", `product:${slug}`);
  if (!hasSupabase) {
    const s = sampleBySlug(slug);
    return s ? sampleToProduct(s) : null;
  }
  const { data, error } = await publicDb().from("products").select(PRODUCT_COLUMNS).eq("slug", slug).maybeSingle();
  if (error) throw new Error(`Product: ${error.message}`);
  return data ? rowToProduct(data as unknown as Row) : null;
}

export async function getProductSlugs(): Promise<string[]> {
  if (!hasSupabase) return SAMPLE_PRODUCTS.map((p) => p.slug);

  // Static generation only needs representative routes, not the full catalogue graph.
  const { data, error } = await publicDb()
    .from("products")
    .select("slug")
    .in("status", ["active", "sold_out"])
    .order("sale_count", { ascending: false })
    .order("slug", { ascending: true })
    .limit(24);

  if (error) throw new Error(`Product slugs: ${error.message}`);
  return (data ?? []).map((row) => row.slug);
}

/** Wholesale route params need only slug and wholesale eligibility, not full product details. */
export async function getWholesaleProductSlugs(): Promise<string[]> {
  if (!hasSupabase) {
    return SAMPLE_PRODUCTS.map(sampleToProduct)
      .filter((p) => p.wholesale && p.wholesaleFrom > 0 && Number.isFinite(p.wholesaleFrom))
      .map((p) => p.slug);
  }

  // Static generation needs only a small set of candidate paths. Avoid joining
  // categories and product_skus here: those relations can make build-time queries
  // exceed Supabase's statement timeout on a large catalogue.
  const { data, error } = await publicDb()
    .from("products")
    .select("slug")
    .eq("wholesale", true)
    .in("status", ["active", "sold_out"])
    .order("sale_count", { ascending: false })
    .order("slug", { ascending: true })
    .limit(24);

  if (error) throw new Error(`Wholesale product slugs: ${error.message}`);
  return (data ?? []).map((row) => row.slug);
}

export interface LineRequest {
  slug: string;
  variantId: string;
  qty: number;
}

/** Server-only: selling prices + costs for a cart, used to enforce the promotion guardrails. */
export type ServerLine = QuoteLine & LineRequest & { title?: string; variantLabel?: string; shipMode?: "air" | "sea" };

export async function getQuoteLines(items: LineRequest[]): Promise<ServerLine[]> {
  if (!hasSupabase) {
    return items.flatMap((it) => {
      const s = sampleBySlug(it.slug);
      return s ? [{ ...it, ...sampleQuoteLine(s, it.variantId, it.qty), flash: inFlash(it.slug, Date.now()) }] : [];
    });
  }
  const ids = items.map((i) => i.variantId);
  const { data, error } = await secretDb()
    .from("product_skus")
    .select("id, active, promo_paused, props_text, price_list, price_midnight, price_event, price_flash, price_retailer, cost_ngn, planned_profit_ngn, products!inner(slug, title, status, categories(is_gadget, ship_mode))")
    .in("id", ids);
  if (error) throw new Error(`Quote: ${error.message}`);
  type SkuRow = {
    id: string; active: boolean; promo_paused: boolean; price_list: number; price_midnight: number; price_event: number; price_flash: number; price_retailer: number;
    cost_ngn: number; planned_profit_ngn: number; props_text: string | null;
    products: { slug: string; title: string; status: string; categories: { is_gadget: boolean; ship_mode: "air" | "sea" } | null };
  };
  const byId = new Map(((data ?? []) as unknown as SkuRow[]).map((r) => [r.id, r]));
  return items.flatMap((it) => {
    const r = byId.get(it.variantId);
    if (!r || !r.active || r.products.status !== "active" || r.products.slug !== it.slug) return [];
    return [{
      ...it,
      prices: guard(r.promo_paused, { list: r.price_list, midnight: r.price_midnight, event: r.price_event, flash: r.price_flash, retailer: r.price_retailer }),
      cost: Number(r.cost_ngn),
      plannedProfit: Number(r.planned_profit_ngn),
      gadget: r.products.categories?.is_gadget ?? false,
      noDiscounts: r.promo_paused,
      title: r.products.title,
      variantLabel: (r.props_text ?? "").split(";").map((kv) => kv.split(":")[1] ?? kv).filter(Boolean).join(" / "),
      shipMode: r.products.categories?.ship_mode ?? "air",
      flash: inFlash(it.slug, Date.now()),
    }];
  });
}

/** Answered questions for a product, newest first. Refreshed when staff answer (tag `qa:<slug>`). */
export async function getQuestions(slug: string): Promise<QA[] | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("qa", `qa:${slug}`);
  if (!hasSupabase) return null; // sample products carry their own demo Q&A
  const { data, error } = await publicDb()
    .from("product_questions")
    .select("question, asker_name, answer, answered_at, products!inner(slug)")
    .eq("products.slug", slug)
    .eq("status", "answered")
    .order("created_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(`Q&A: ${error.message}`);
  const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Africa/Lagos" }) : "");
  return (data ?? []).map((r) => ({ q: r.question, who: r.asker_name, a: r.answer ?? undefined, by: `FastChina team · ${day(r.answered_at)}` }));
}

/** Ranked product slugs for a search, or null when search must run in the browser (no database). */
export async function searchSlugs(q: string): Promise<string[] | null> {
  if (!hasSupabase) return null;
  const { data, error } = await publicDb().rpc("search_products", { q, lim: 200 });
  if (error) throw new Error(`Search: ${error.message}`);
  return ((data ?? []) as { slug: string }[]).map((r) => r.slug);
}

/**
 * Search results are hydrated a page at a time. The existing search_products RPC ranks
 * up to 120 slugs; this keeps the RPC unchanged while avoiding a full-catalogue page load.
 */
export async function getSearchProductsPage(q: string, offset = 0, pageSize = 24): Promise<ProductFeedPage> {
  const size = Math.min(24, Math.max(1, Math.floor(pageSize)));
  const start = Math.max(0, Math.floor(offset));
  const term = q.trim().slice(0, 120);
  if (term.length < 2) return { products: [], nextCursor: null };

  if (!hasSupabase) {
    const words = term.toLowerCase().split(/\s+/).filter((word) => word.length > 1);
    const matches = SAMPLE_PRODUCTS.map(sampleToProduct).filter((p) =>
      words.some((word) => `${p.name} ${p.category} ${p.description}`.toLowerCase().includes(word.replace(/s$/, ""))),
    );
    const page = matches.slice(start, start + size + 1);
    return {
      products: page.slice(0, size),
      nextCursor: page.length > size ? String(start + size) : null,
    };
  }

  const rankedSlugs = (await searchSlugs(term)) ?? [];
  const pageSlugs = rankedSlugs.slice(start, start + size);
  if (!pageSlugs.length) return { products: [], nextCursor: null };

  const { data, error } = await publicDb()
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("status", ["active", "sold_out"])
    .in("slug", pageSlugs);
  if (error) throw new Error(`Search results: ${error.message}`);

  const bySlug = new Map(
    ((data ?? []) as unknown as Row[])
      .map(rowToProduct)
      .filter((product): product is Product => product !== null)
      .map((product) => [product.slug, product]),
  );
  const products = pageSlugs.flatMap((slug) => {
    const product = bySlug.get(slug);
    return product ? [product] : [];
  });
  const nextOffset = start + pageSlugs.length;
  return { products, nextCursor: nextOffset < rankedSlugs.length ? String(nextOffset) : null };
}

/**
 * Products ranked by purchased quantities in paid orders. If no qualifying order
 * items exist yet, fall back to the catalogue's accumulated sale_count ranking.
 */
export async function getHotSearchProducts(): Promise<Product[]> {
  if (!hasSupabase) {
    return SAMPLE_PRODUCTS.map(sampleToProduct).sort((a, b) => b.sold - a.sold).slice(0, 9);
  }

  const { data: orderItems, error: orderError } = await publicDb()
    .from("order_items")
    .select("qty, removed_at, orders!inner(paid_at, status), product_skus!inner(products!inner(slug))")
    .is("removed_at", null)
    .not("orders.paid_at", "is", null)
    .not("orders.status", "in", '("cancelled","refunded")');

  if (orderError) throw new Error(`Search hot list orders: ${orderError.message}`);

  type PurchasedItem = {
    qty: number;
    product_skus: { products: { slug: string } | null } | null;
  };
  const quantities = new Map<string, number>();
  for (const item of (orderItems ?? []) as unknown as PurchasedItem[]) {
    const slug = item.product_skus?.products?.slug;
    if (slug) quantities.set(slug, (quantities.get(slug) ?? 0) + Math.max(0, Number(item.qty) || 0));
  }

  let rankedSlugs = [...quantities.entries()]
    .filter(([, quantity]) => quantity > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 9)
    .map(([slug]) => slug);

  // A new store may not have any paid orders yet. In that case use lifetime sales.
  if (!rankedSlugs.length) {
    const { data, error } = await publicDb()
      .from("products")
      .select("slug")
      .in("status", ["active", "sold_out"])
      .order("sale_count", { ascending: false })
      .order("slug", { ascending: true })
      .limit(9);
    if (error) throw new Error(`Search hot list fallback: ${error.message}`);
    rankedSlugs = (data ?? []).map((product) => product.slug);
  }

  if (!rankedSlugs.length) return [];

  const { data, error } = await publicDb()
    .from("products")
    .select(PRODUCT_COLUMNS)
    .in("status", ["active", "sold_out"])
    .in("slug", rankedSlugs);
  if (error) throw new Error(`Search hot list products: ${error.message}`);

  const bySlug = new Map(
    ((data ?? []) as unknown as Row[])
      .map(rowToProduct)
      .filter((product): product is Product => product !== null)
      .map((product) => [product.slug, product]),
  );
  return rankedSlugs.flatMap((slug) => {
    const product = bySlug.get(slug);
    return product ? [product] : [];
  });
}

/** Saves a new question as pending; staff answer it in admin. Server-only (uses the secret key). */
export async function insertQuestion(slug: string, question: string, name: string): Promise<"ok" | "unknown-product" | "busy"> {
  if (!hasSupabase) return "ok";
  const db = secretDb();
  const { data: p } = await db.from("products").select("id").eq("slug", slug).eq("status", "active").maybeSingle();
  if (!p) return "unknown-product";
  // Simple flood guard: at most 20 unanswered questions per product per hour, and no exact repeats.
  const since = new Date(Date.now() - 3_600_000).toISOString();
  const { count } = await db.from("product_questions").select("id", { count: "exact", head: true }).eq("product_id", p.id).eq("status", "pending").gte("created_at", since);
  if ((count ?? 0) >= 20) return "busy";
  const { data: dup } = await db.from("product_questions").select("id").eq("product_id", p.id).ilike("question", question).limit(1);
  if (dup?.length) return "ok";
  const { error } = await db.from("product_questions").insert({ product_id: p.id, question, asker_name: name });
  if (error) throw new Error(`Ask: ${error.message}`);
  return "ok";
}

/** Server-only: wholesale prices and costs for a wholesale cart (sea only). */
export interface WholesaleServerLine extends LineRequest {
  unit: number;
  cost: number;
  title: string;
  variantLabel: string;
}

export async function getWholesaleLines(items: LineRequest[]): Promise<WholesaleServerLine[]> {
  if (!hasSupabase) {
    return items.flatMap((it) => {
      const s = sampleBySlug(it.slug);
      if (!s) return [];
      const p = sampleToProduct(s);
      const v = p.variants.find((x) => x.id === it.variantId);
      return v ? [{ ...it, unit: v.wholesale, cost: Math.round(v.wholesale * 0.85), title: p.name, variantLabel: Object.values(v.props).join(" / ") }] : [];
    });
  }
  const { data, error } = await secretDb()
    .from("product_skus")
    .select("id, active, props_text, price_wholesale, wholesale_cost_ngn, products!inner(slug, title, status, wholesale, categories(wholesale_enabled))")
    .in("id", items.map((i) => i.variantId));
  if (error) throw new Error(`Wholesale quote: ${error.message}`);
  type R = {
    id: string; active: boolean; props_text: string | null; price_wholesale: number | null; wholesale_cost_ngn: number | null;
    products: { slug: string; title: string; status: string; wholesale: boolean; categories: { wholesale_enabled: boolean } | null };
  };
  const byId = new Map(((data ?? []) as unknown as R[]).map((r) => [r.id, r]));
  return items.flatMap((it) => {
    const r = byId.get(it.variantId);
    if (!r || !r.active || !r.price_wholesale || r.products.status !== "active" || r.products.slug !== it.slug) return [];
    if (!r.products.wholesale || r.products.categories?.wholesale_enabled === false) return [];
    return [{
      ...it,
      unit: r.price_wholesale,
      cost: Number(r.wholesale_cost_ngn ?? 0),
      title: r.products.title,
      variantLabel: (r.props_text ?? "").split(";").map((kv) => kv.split(":")[1] ?? kv).filter(Boolean).join(" / "),
    }];
  });
}

export interface KitRow { slug: string; title: string; subtitle: string | null; tone: string; categories: string[]; max_products: number; units_each: number }

/** Wholesale starter kits (Admin → Wholesale). Tag "kits". */
export async function getKitRows(): Promise<KitRow[] | null> {
  "use cache";
  cacheLife("minutes");
  cacheTag("kits");
  if (!hasSupabase) return null;
  const { data, error } = await publicDb().from("wholesale_kits").select("slug, title, subtitle, tone, categories, max_products, units_each").eq("active", true).order("sort");
  if (error) return null;
  return data as KitRow[];
}

export interface Review { id: number; author: string; variant: string | null; rating: number; body: string | null; photos: string[]; at: string }

/** Published reviews for a product, newest first (tag "reviews"). */
export async function getReviews(slug: string): Promise<Review[]> {
  "use cache";
  cacheLife("minutes");
  cacheTag("reviews", `reviews:${slug}`);
  if (!hasSupabase) return [];
  const { data } = await publicDb()
    .from("product_reviews")
    .select("id, author, variant_label, rating, body, photos, created_at, products!inner(slug)")
    .eq("products.slug", slug)
    .eq("status", "published")
    .order("created_at", { ascending: false })
    .limit(20);
  return (data ?? []).map((r) => ({ id: r.id, author: r.author, variant: r.variant_label, rating: r.rating, body: r.body, photos: r.photos ?? [], at: r.created_at }));
}
