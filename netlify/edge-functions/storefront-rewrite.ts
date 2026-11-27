/**
 * Netlify edge routing for seller storefront aliases.
 *
 * Next.js 16 Proxy runs on Node.js, while Netlify adapts Next middleware
 * through Edge Functions. Keep storefront URL resolution here as well so
 * production store URLs do not depend on the adapter's Proxy execution path.
 */
const SITE_HOST = "stunning-youtiao-4a78bd.netlify.app";
const STORE_ROOT_DOMAIN = "fastchina.store";
const ROOT_STORE_HOSTS = new Set([STORE_ROOT_DOMAIN, "www." + STORE_ROOT_DOMAIN]);
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
    /^deploy-preview-\d+--stunning-youtiao-4a78bd\.netlify\.app$/.test(host) ||
    ROOT_STORE_HOSTS.has(host) ||
    (host.endsWith("." + STORE_ROOT_DOMAIN) && !ROOT_STORE_HOSTS.has(host));
}

export default async function storefrontRewrite(request: Request): Promise<URL | undefined> {
  const url = new URL(request.url);
  const host = url.hostname.toLowerCase();
  if (!isFastChinaNetlifyHost(host)) return;

  // Wildcard subdomains (name.fastchina.store) identify the store by hostname.
  // Include "/" in config.path so the storefront root is handled too.
  if (host.endsWith("." + STORE_ROOT_DOMAIN) && !ROOT_STORE_HOSTS.has(host)) {
    const slug = host.slice(0, host.length - STORE_ROOT_DOMAIN.length - 1);
    if (!STORE_SLUG.test(slug) || RESERVED.has(slug)) return;
    url.pathname = "/s/" + slug + (url.pathname === "/" ? "" : url.pathname);
    console.info("[FastChina storefront rewrite]", host, request.url, "->", url.pathname);
    return url;
  }

  // Root domain, www, and Netlify preview URLs use /<store-name> paths.
  const match = /^\/([a-z0-9][a-z0-9-]{1,38}[a-z0-9])(?:\/(.*))?$/.exec(url.pathname);
  if (!match) return;

  const [, slug, remainder] = match;
  if (!STORE_SLUG.test(slug) || RESERVED.has(slug)) return;

  // Keep the original query string and path suffix (product pages, bag, etc.).
  url.pathname = "/s/" + slug + (remainder ? "/" + remainder : "");
  console.info("[FastChina storefront rewrite]", host, request.url, "->", url.pathname);
  return url;
}

export const config = {
  path: ["/", "/:store", "/:store/*"],
  excludedPath: [
    "/_next/*", "/api/*", "/favicon.ico", "/icon.svg", "/robots.txt",
    "/sitemap.xml", "/sw.js", "/manifest.webmanifest",
  ],
  onError: "bypass",
};
