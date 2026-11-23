import { NextRequest, NextResponse } from "next/server";
import { getSearchProductsPage } from "@/lib/data/catalog";
import { allow } from "@/lib/rate-limit";

const PAGE_SIZE = 24;

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  const cursor = request.nextUrl.searchParams.get("cursor");
  if (q.length < 2) {
    return NextResponse.json({ products: [], nextCursor: null }, { headers: { "Cache-Control": "no-store" } });
  }
  if (cursor !== null && !/^\d+$/.test(cursor)) {
    return NextResponse.json({ error: "Invalid search cursor" }, { status: 400 });
  }

  if (!(await allow("search", 120, 60))) {
    return NextResponse.json({ error: "Too many searches. Please wait a moment." }, { status: 429 });
  }

  try {
    const page = await getSearchProductsPage(q, cursor ? Number(cursor) : 0, PAGE_SIZE);
    return NextResponse.json(page, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Search is temporarily unavailable" }, { status: 500 });
  }
}
