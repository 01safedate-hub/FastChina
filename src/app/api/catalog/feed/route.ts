import { getProductFeedPage } from "@/lib/data/catalog";

const PAGE_SIZE = 12;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");

  try {
    const page = await getProductFeedPage(cursor, PAGE_SIZE);
    return Response.json(page, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load products";
    const invalidCursor = message === "Invalid catalogue cursor";
    return Response.json(
      { error: invalidCursor ? "Invalid catalogue cursor" : "Unable to load products" },
      { status: invalidCursor ? 400 : 500 },
    );
  }
}
