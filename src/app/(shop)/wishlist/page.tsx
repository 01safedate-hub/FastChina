import type { Metadata } from "next";
import { WishlistView } from "./wishlist-view";

export const metadata: Metadata = { title: "Saved items", robots: { index: false } };

export default function WishlistPage() {
  // Product data is loaded after hydration from the visitor's saved slugs.
  // This keeps Supabase catalogue queries out of static prerendering.
  return <WishlistView />;
}
