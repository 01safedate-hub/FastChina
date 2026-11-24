"use server";

import { getProductFeedPage } from "@/lib/data/catalog";

/** Loads the next small batch for the seller catalogue. */
export async function loadSellerProductPage(cursor: string | null) {
  return getProductFeedPage(cursor, 12);
}
