import { NextResponse } from "next/server";
import { SUPABASE_URL } from "@/lib/supabase/env";

/** Compatibility endpoint: forward signed provider webhooks to the Supabase Edge Function. */
export async function POST(request: Request) {
  if (!SUPABASE_URL) return NextResponse.json({ error: "Payment webhook is not configured." }, { status: 503 });
  const raw = await request.text();
  try {
    const upstream = await fetch(`${SUPABASE_URL}/functions/v1/flutterwave-webhook`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "verif-hash": request.headers.get("verif-hash") || "" },
      body: raw,
      cache: "no-store",
    });
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "Content-Type": upstream.headers.get("content-type") || "application/json" },
    });
  } catch {
    return NextResponse.json({ error: "Could not forward payment webhook." }, { status: 502 });
  }
}
