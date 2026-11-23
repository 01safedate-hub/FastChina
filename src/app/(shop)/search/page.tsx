import type { Metadata } from "next";
import { Suspense } from "react";
import { getHotSearchProducts } from "@/lib/data/catalog";
import { SearchView } from "./search-view";

export const metadata: Metadata = { title: "Search" };

export default async function SearchPage() {
  const hotProducts = await getHotSearchProducts();
  return (
    <Suspense fallback={<div className="h-40" />}>
      <SearchView hotProducts={hotProducts} />
    </Suspense>
  );
}
