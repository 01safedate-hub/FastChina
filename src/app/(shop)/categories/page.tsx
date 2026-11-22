import type { Metadata } from "next";
import { Suspense } from "react";
import { getCategoryPhotoProducts, getProductsBySlugs } from "@/lib/data/catalog";
import { inDepartment } from "@/lib/catalog/audience";
import { CATEGORIES } from "@/lib/catalog/categories";
import { CategoryBrowser } from "./category-browser";

export const metadata: Metadata = { title: "Categories" };

export default function CategoriesPage({ searchParams }: PageProps<"/categories">) {
  return (
    <Suspense fallback={<div className="h-40" />}>
      <CategoryContent searchParams={searchParams} />
    </Suspense>
  );
}

async function CategoryContent({ searchParams }: { searchParams: PageProps<"/categories">["searchParams"] }) {
  const params = await searchParams;
  const requested = typeof params.c === "string" ? params.c : "for-you";
  const category = CATEGORIES.find((item) => item.slug === requested) ?? CATEGORIES[0];
  const photoProducts = await getCategoryPhotoProducts();

  const matching = photoProducts.filter((product) =>
    category.slug === "for-you" ? true
      : category.slug === "women" ? inDepartment(product, "women")
      : category.slug === "men" ? inDepartment(product, "men")
      : category.slug === "retailer" ? product.wholesale
      : product.category === category.slug,
  );
  const products = await getProductsBySlugs(matching.slice(0, 10).map((product) => product.slug));

  return <CategoryBrowser products={products} photoProducts={photoProducts} selectedCategory={category.slug} />;
}
