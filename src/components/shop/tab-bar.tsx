"use client";

import { House, LayoutGrid, Ship, ShoppingBag, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/format";
import { useWholesaleCart } from "@/lib/wholesale/cart";
import { useCart } from "./cart-provider";

const TABS: { href: string; label: string; icon: LucideIcon; match: (p: string) => boolean }[] = [
  { href: "/", label: "Shop", icon: House, match: (p) => p === "/" },
  { href: "/categories", label: "Categories", icon: LayoutGrid, match: (p) => p.startsWith("/categor") },
  { href: "/wholesale", label: "Wholesale", icon: Ship, match: (p) => p.startsWith("/wholesale") },
  { href: "/cart", label: "Cart", icon: ShoppingBag, match: (p) => p.startsWith("/cart") },
  { href: "/account", label: "Me", icon: User, match: (p) => p.startsWith("/account") },
];

/** Fixed mobile app navigation. Kept above page overlays and browser-safe-area insets. */
export function TabBar() {
  const path = usePathname() ?? "/";
  const { count } = useCart();
  const wholesale = useWholesaleCart().length;

  // These pages provide their own sticky purchase/checkout controls.
  if (
    path.startsWith("/product/") ||
    path.startsWith("/wholesale/p/") ||
    path.startsWith("/checkout") ||
    path.startsWith("/c/")
  ) return null;

  return (
    <nav
      aria-label="App navigation"
      className="fixed inset-x-0 bottom-0 z-[2147483647] grid grid-cols-5 border-t border-[#e5e5e5] bg-white text-[#555] shadow-[0_-5px_20px_rgba(0,0,0,0.08)] md:hidden"
      style={{ minHeight: "62px", paddingBottom: "max(6px, env(safe-area-inset-bottom))", paddingTop: "6px", pointerEvents: "auto" }}
    >
      {TABS.map(({ href, label, icon: Icon, match }) => {
        const active = match(path);
        const badge = href === "/cart" ? count : href === "/wholesale" ? wholesale : 0;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            aria-label={badge > 0 ? `${label}, ${badge} items` : label}
            className={cn(
              "relative flex min-h-[46px] flex-col items-center justify-center gap-1 px-1 text-[10px] leading-none no-underline outline-offset-[-2px]",
              active ? "font-extrabold text-[#171717]" : "font-medium text-[#666]",
            )}
          >
            <span className="relative flex h-6 w-7 items-center justify-center">
              <Icon aria-hidden size={22} strokeWidth={active ? 2.4 : 1.8} className={cn(href === "/wholesale" && "text-[#c8102e]")} />
              {badge > 0 && (
                <span className="absolute -right-2 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#c8102e] px-1 text-[9px] font-extrabold text-white">
                  {badge}
                </span>
              )}
            </span>
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
