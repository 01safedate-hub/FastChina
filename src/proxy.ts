import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";

/**
 * One app, several kinds of address:
 *  - fastchina.shop            → marketplace (app/(shop))
 *  - fastchina.store           → dropship site (/) and the seller dashboard (/seller) (app/store)
 *  - fastchina.store/<name>    → a seller's storefront, by store name or staff-set alias (app/s/[store])
 *  - name.fastchina.store      → the same storefront, once wildcard DNS is set up
 *  - /store/<name> on the marketplace or preview hosts → the storefront too (handy for testing)
 *  - a seller's own domain     → their storefront too (looked up by verified domain)
 */
const STORE_HOSTS = (process.env.STORE_HOSTS ?? "fastchina.store,www.fastchina.store").split(",").map((h) => h.trim());
const MAIN_HOSTS = (process.env.MAIN_HOSTS ?? "stunning-youtiao-4a78bd.netlify.app,fastchina.shop,www.fastchina.shop").split(",").map((h) => h.trim().toLowerCase());
const STORE_ROOT = process.env.STORE_ROOT_DOMAIN ?? "fastchina.store";
/** Pages that work the same on every domain (sign-in, legal, APIs, app files). */
const SHARED = /^\/(sign-in|api|legal|track|offline|unsubscribe|notifications|pwa|manifest\.webmanifest|sw\.js|robots\.txt|sitemap\.xml)(\/|$)/;
/** Pages of the dropship site itself; any other first path segment on fastchina.store is a store name. */
const STORE_PAGES = new Set(["", "seller", "opengraph-image", "store", "pwa", "admin", "api"]);
const NAME = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
/** Development and preview hosts are never treated as a seller's own domain. */
const isInfraHost = (h: string) => h === "localhost" || /^[\d.]+$/.test(h) || h.endsWith(".netlify.app") || h.endsWith(".vercel.app") || h.endsWith(".local");

/** Keeps the Supabase sign-in fresh: refreshes the session cookie when it is close to expiring. */
async function withSession(request: NextRequest, response: NextResponse) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return response;
  const db = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value, options } of list) {
          request.cookies.set(name, value);
          response.cookies.set(name, value, options);
        }
      },
    },
  });
  await db.auth.getUser();
  return response;
}

export async function proxy(request: NextRequest) {
  const host = (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const { pathname } = request.nextUrl;

  // Cache Components streams dynamic product routes. A notFound() thrown after
  // streaming starts can render the not-found UI with HTTP 200, so validate
  // product slugs here before the route begins rendering.
  const productMatch = /^\/product\/([^/]+)\/?$/.exec(pathname);
  const isMarketplaceHost = MAIN_HOSTS.includes(host) || isInfraHost(host);
  if (productMatch && isMarketplaceHost) {
    const slug = productMatch[1];
    const missingProduct = () => new NextResponse(
      "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"robots\" content=\"noindex,nofollow\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta name=\"theme-color\" content=\"#f8f7f4\"><title>404 — FastChina</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:28px 20px;background:#f8f7f4;color:#171717;font-family:Arial,Helvetica,sans-serif;text-align:center}.wrap{width:100%;max-width:440px}.brand{display:inline-block;margin-bottom:28px;color:#171717;text-decoration:none;font-size:21px;font-weight:900;letter-spacing:3px}.brand span{color:#b88735}.code{margin:0;font-size:clamp(112px,32vw,164px);font-weight:950;line-height:.82;letter-spacing:-.09em}.rule{width:64px;height:6px;margin:20px auto 26px;border-radius:8px;background:#b88735}.eyebrow{margin:0 0 12px;color:#a47a35;font-size:11px;font-weight:900;letter-spacing:2.5px;text-transform:uppercase}h1{margin:0;font-size:clamp(27px,7vw,36px);font-weight:900;line-height:1.12;letter-spacing:-1px}p{margin:16px auto 0;max-width:360px;color:#69645d;font-size:16px;line-height:1.7}.home{min-height:56px;margin-top:30px;padding:0 24px;display:flex;align-items:center;justify-content:center;gap:12px;border-radius:11px;background:#171717;color:#fff;text-decoration:none;font-size:13px;font-weight:900;letter-spacing:.7px;box-shadow:0 10px 24px rgba(0,0,0,.1)}.search{display:inline-block;margin-top:20px;color:#6d665c;font-size:13px;font-weight:700;text-decoration:underline;text-decoration-color:#c9b58e;text-underline-offset:4px}</style></head><body><main class=\"wrap\"><a class=\"brand\" href=\"/\">FAST<span>CHINA</span></a><p class=\"code\">404</p><div class=\"rule\"></div><p class=\"eyebrow\">Page not found</p><h1>This page seems to have gone missing.</h1><p>The product or page may have moved or is no longer available. Let’s get you back to FastChina.</p><a class=\"home\" href=\"/\">⌂&nbsp; BACK TO HOMEPAGE</a><a class=\"search\" href=\"/search\">Or search for a product</a></main></body></html>",
      { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" } },
    );

    // Reject malformed slugs without making a database request.
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return missingProduct();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (supabaseUrl && publishableKey) {
      try {
        const lookup = new URL("/rest/v1/products", supabaseUrl);
        lookup.searchParams.set("select", "slug");
        lookup.searchParams.set("slug", `eq.${slug}`);
        lookup.searchParams.set("status", "in.(active,sold_out)");
        lookup.searchParams.set("limit", "1");
        const result = await fetch(lookup, {
          headers: { apikey: publishableKey, Authorization: `Bearer ${publishableKey}` },
          cache: "no-store",
        });
        if (result.ok) {
          const products = await result.json() as { slug: string }[];
          if (!products.some((product) => product.slug === slug)) return missingProduct();
        }
      } catch {
        // Fail open during a temporary Supabase outage; the page still performs
        // its own notFound() check and can show the branded not-found UI.
      }
    }
  }

  const rewrite = (to: string) => {
    const url = request.nextUrl.clone();
    url.pathname = to;
    return withSession(request, NextResponse.rewrite(url, { request }));
  };

  if (!SHARED.test(pathname) && !pathname.startsWith("/s/")) {
    // fastchina.store itself: the dropship site and seller dashboard, or fastchina.store/<store name>.
    if (STORE_HOSTS.includes(host)) {
      const [, first = "", ...rest] = pathname.split("/");
      if (!STORE_PAGES.has(first) && NAME.test(first)) return rewrite(`/s/${first}${rest.length ? `/${rest.join("/")}` : ""}`);
      if (!pathname.startsWith("/store")) return rewrite(`/store${pathname === "/" ? "" : pathname}`);
    }
    // name.fastchina.store: a seller's storefront.
    if (host.endsWith(`.${STORE_ROOT}`) && !STORE_HOSTS.includes(host)) {
      return rewrite(`/s/${host.slice(0, -STORE_ROOT.length - 1)}${pathname === "/" ? "" : pathname}`);
    }
    // Anything else that isn't ours or a preview host: a seller's own domain.
    if (host && !MAIN_HOSTS.includes(host) && !STORE_HOSTS.includes(host) && !isInfraHost(host)) {
      return rewrite(`/s/${host.replace(/^www\./, "")}${pathname === "/" ? "" : pathname}`);
    }
  }

  // Marketplace and preview hosts: /store/<name> opens that seller's storefront.
  const m = /^\/store\/([a-z0-9-]+)(\/.*)?$/.exec(pathname);
  if (m && !STORE_HOSTS.includes(host) && !STORE_PAGES.has(m[1]) && NAME.test(m[1])) return rewrite(`/s/${m[1]}${m[2] ?? ""}`);

  const res = NextResponse.next({ request });
  if (pathname.startsWith("/admin")) res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return withSession(request, res);
}

export const config = {
  matcher: ["/((?!_next/|favicon.ico|icon.svg|.*\\.[a-z0-9]+$).*)"],
};
