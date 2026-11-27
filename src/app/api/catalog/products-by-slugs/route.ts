import { NextResponse } from "next/server";
import { getProductsBySlugs } from "@/lib/data/catalog";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const slugs = (body as { slugs?: unknown } | null)?.slugs;
  if (!Array.isArray(slugs) || slugs.length > 10 || !slugs.every(
    (slug): slug is string => typeof slug === "string" && /^[a-z0-9][a-z0-9-]{0,119}$/.test(slug),
  )) {
    return NextResponse.json({ error: "Provide up to 10 valid product slugs" }, { status: 400 });
  }

  try {
    const products = await getProductsBySlugs([...new Set(slugs)]);
    return NextResponse.json({ products });
  } catch (error) {
    console.error("Wishlist product lookup failed", error);
    return NextResponse.json({ error: "Unable to load saved products" }, { status: 503 });
  }
}
