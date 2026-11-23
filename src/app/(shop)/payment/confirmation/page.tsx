import type { Metadata } from "next";
import { LoaderCircle } from "lucide-react";
import { Suspense } from "react";
import { PaymentConfirmation } from "./payment-confirmation";

export const metadata: Metadata = { title: "Payment confirmation", robots: { index: false } };

export default function PaymentConfirmationPage() {
  return <Suspense fallback={<div className="mx-auto flex min-h-80 max-w-xl flex-col items-center justify-center gap-3 px-4 py-12 text-muted"><LoaderCircle aria-hidden size={30} className="animate-spin" /><span className="text-sm">Loading payment confirmation…</span></div>}>
    <PaymentConfirmation />
  </Suspense>;
}
