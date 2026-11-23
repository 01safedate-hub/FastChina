"use client";

import { usePathname } from "next/navigation";
import { ShopFooter } from "@/components/shop/footer";

export function ShopFooterVisibility() {
  const pathname = usePathname();
  if (pathname === "/checkout") return null;
  return <ShopFooter />;
}
