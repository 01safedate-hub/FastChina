import { getRelatedProductsPage } from "@/lib/data/catalog";

const PAGE_SIZE = 12;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);
  const cursor = searchParams.get("cursor");

  try {
    const page = await getRelatedProductsPage(slug, cursor, PAGE_SIZE);
    return Response.json(page, {
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load related products";
    const invalidCursor = message === "Invalid related catalogue cursor";
    return Response.json(
      { error: invalidCursor ? "Invalid related catalogue cursor" : "Unable to load related products" },
      { status: invalidCursor ? 400 : 500 },
    );
  }
}
