/**
 * Canonical marketplace origin. Set NEXT_PUBLIC_SITE_URL to the registered custom
 * domain when it is ready; until then use the stable Netlify site hostname.
 * Never use a Deploy Preview hostname as the canonical origin.
 */
const DEFAULT_SITE_URL = "https://stunning-youtiao-4a78bd.netlify.app";
const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();

function canonicalOrigin(value: string | undefined): string {
  if (!value) return DEFAULT_SITE_URL;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return DEFAULT_SITE_URL;
    if (url.hostname.startsWith("deploy-preview-") || url.hostname.startsWith("deploy-preview")) return DEFAULT_SITE_URL;
    return url.origin;
  } catch {
    return DEFAULT_SITE_URL;
  }
}

export const SHOP_URL = canonicalOrigin(configured);
