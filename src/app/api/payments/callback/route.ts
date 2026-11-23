import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const provider = url.searchParams.get("provider");
  const status = provider === "paystack" || provider === "flutterwave" ? "pending" : "unverified";
  // This compatibility route does not verify payments. The provider callback must
  // go directly to the server-side Supabase payment-return function.
  const destination = new URL("/payment/confirmation", url.origin);
  destination.searchParams.set("status", status);
  return NextResponse.redirect(destination);
}
