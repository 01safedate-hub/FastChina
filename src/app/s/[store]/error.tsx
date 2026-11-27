"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function StorefrontError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[FastChina storefront]", error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-[70vh] max-w-xl flex-col items-center justify-center px-6 py-16 text-center">
      <p className="text-xs font-bold uppercase tracking-[0.24em] text-neutral-500">FastChina storefront</p>
      <h1 className="mt-4 text-3xl font-black tracking-tight text-neutral-950">This store could not load</h1>
      <p className="mt-3 max-w-md text-sm leading-6 text-neutral-600">
        The store page encountered a loading error. Your store and products have not been changed.
        Please try again.
      </p>
      {error.digest ? <p className="mt-3 text-xs text-neutral-500">Reference: {error.digest}</p> : null}
      <button
        type="button"
        onClick={() => reset()}
        className="mt-7 inline-flex min-h-11 items-center justify-center rounded-lg bg-neutral-950 px-6 text-sm font-bold text-white"
      >
        Try again
      </button>
      <Link href="/" className="mt-4 text-sm font-semibold text-neutral-600 underline underline-offset-4">
        Return to FastChina
      </Link>
    </main>
  );
}
