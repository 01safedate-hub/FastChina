import type { Metadata } from "next";
import { Suspense } from "react";
import { PaymentConfirmation } from "./payment-confirmation";

export const metadata: Metadata = { title: "Payment confirmation", robots: { index: false } };

export default function PaymentConfirmationPage() {
  return <Suspense fallback={<div className="mx-auto min-h-80 max-w-xl px-4 py-12" />}>
    <PaymentConfirmation />
  </Suspense>;
}
