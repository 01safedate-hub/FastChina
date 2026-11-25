/**
 * Netlify's supported edge entry point for seller storefront aliases.
 *
 * Next.js 16 renamed middleware.ts to proxy.ts and moved Proxy to the Node.js
 * runtime. Netlify's Next.js adapter documents Edge Middleware integration,
 * so this native Edge Function guarantees that preview store links reach the
 * App Router storefront route even if the adapter does not run Next Proxy.
 */
const SITE_HOST = "stunning-youtiao-4a78bd.netlify.app";
const STORE_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const RESERVED = new Set([
  "about", "account", "admin", "api", "bag", "blog", "cart", "c", "categories",
  "category", "contact", "d", "deals", "guides", "legal", "manifest.webmanifest",
  "notifications", "offline", "opengraph-image", "payment", "pwa", "privacy",
  "product", "robots.txt", "s", "search", "seller", "sign-in", "sitemap.xml",
  "store", "terms", "track", "unsubscribe", "wholesale", "why-fastchina",
  "wishlist", "sw.js",
]);

function isFastChinaNetlifyHost(host: string): boolean {
  return host === SITE_HOST ||
    /^deploy-preview-\d+--stunning-youtiao-4a78bd\.netlify\.app$/.test(host);
}

export default async function storefrontRewrite(request: Request): Promise<URL | undefined> {
  const url = new URL(request.url);
  if (!isFastChinaNetlifyHost(url.hostname.toLowerCase())) return;

  const match = /^\/([a-z0-9][a-z0-9-]{1,38}[a-z0-9])(?:\/(.*))?$/.exec(url.pathname);
  if (!match) return;

  const [, slug, remainder] = match;
  if (!STORE_SLUG.test(slug) || RESERVED.has(slug)) return;

  // Keep the original query string and path suffix (product pages, bag, etc.).
  url.pathname = `/s/${slug}${remainder ? `/${remainder}` : ""}`;
  console.info("[FastChina storefront rewrite]", url.hostname, request.url, "->", url.pathname);
  return url;
}

export const config = {
  path: ["/:store", "/:store/*"],
  excludedPath: [
    "/_next/*", "/api/*", "/favicon.ico", "/icon.svg", "/robots.txt",
    "/sitemap.xml", "/sw.js", "/manifest.webmanifest",
  ],
  onError: "bypass",
};
