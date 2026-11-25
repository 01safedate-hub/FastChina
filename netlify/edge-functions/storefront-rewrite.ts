/**
 * Netlify's supported edge entry point for seller storefront aliases.
 *
 * Next.js 16 renamed middleware.ts to proxy.ts and moved Proxy to the Node.js
 * runtime. Netlify's Next.js adapter documents Edge Middleware integration,
 * so this small native Edge Function guarantees that preview/production
 * one-segment store links reach the App Router storefront route.
 */
const SITE_HOST = "stunning-youtiao-4a78bd.netlify.app";
const STORE_SLUG = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

const RESERVED = new Set([
  "account", "admin", "api", "bag", "cart", "categories", "category",
  "c", "d", "deals", "guides", "legal", "notifications", "offline",
  "payment", "product", "search", "sign-in", "s", "store", "track",
  "unsubscribe", "wholesale", "wishlist", "why-fastchina",
]);

function isFastChinaNetlifyHost(host: string): boolean {
  return host === SITE_HOST ||
    new RegExp(`^deploy-preview-[0-9]+--${SITE_HOST.replaceAll(".", "\\\\.")}$`).test(host);
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
