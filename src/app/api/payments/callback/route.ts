import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  if (provider !== "paystack" && provider !== "flutterwave") {
    return NextResponse.redirect(new URL("/track?payment=unverified", url.origin));
  }
  // Payment verification and fulfilment are handled by the Supabase payment-return
  // function and signed provider webhooks. This route never reads gateway secrets.
  return NextResponse.redirect(new URL("/track?payment=pending", url.origin));
}
