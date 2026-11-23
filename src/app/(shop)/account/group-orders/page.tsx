import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { GroupOrdersList } from "./group-orders-list";
import { linkProgress } from "../../actions";
import { getSessionUser, userDb } from "@/lib/supabase/auth";
import { SettingsShell } from "../settings/ui";

export const metadata: Metadata = { title: "My Group Pay orders", robots: { index: false } };

export default function GroupOrdersPage() {
  return (
    <SettingsShell title="My Group Pay orders" back="/account">
      <GroupOrdersBody />
    </SettingsShell>
  );
}

async function GroupOrdersBody() {
  await connection();
  const user = await getSessionUser();
  if (!user) redirect("/sign-in?mode=signin&next=/account/group-orders");
  const db = await userDb();
  const { data, error } = await db
    .from("group_links")
    .select("code, expires_at, settled_at, created_at, orders!inner(code, status, created_at)")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) {
    return <p className="rounded-xl border border-line bg-white p-4 text-sm text-muted">We couldn't load your Group Pay orders. Please refresh in a moment.</p>;
  }
  const links = await Promise.all((data ?? []).map(async (row) => {
    const order = Array.isArray(row.orders) ? row.orders[0] : row.orders;
    if (!order) return null;
    const progress = await linkProgress(row.code);
    return progress ? { code: row.code, orderCode: order.code, status: order.status, createdAt: order.created_at, settledAt: row.settled_at, ...progress } : null;
  }));
  const valid = links.filter((item): item is NonNullable<typeof item> => item !== null);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted">Track contributions and share links for Group Pay orders you created while signed in.</p>
      {valid.length ? <GroupOrdersList orders={valid} /> : (
        <section className="rounded-xl border border-line bg-white p-6 text-center">
          <h2 className="font-extrabold">No Group Pay orders yet</h2>
          <p className="mt-2 text-sm text-muted">When you create a Group Pay order, it will appear here with its contribution link and funding progress.</p>
          <Link href="/account/orders" className="mt-4 inline-flex min-h-11 items-center rounded-md bg-ink px-4 text-sm font-bold text-white">View my orders</Link>
        </section>
      )}
    </div>
  );
}
