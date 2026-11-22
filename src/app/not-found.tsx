import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#f8f7f4] px-6 py-16 text-center text-[#171717]">
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#f1e6cf] opacity-60 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-[#e9e3d8] opacity-70 blur-3xl" />

      <section className="relative z-10 flex w-full max-w-md flex-col items-center">
        <Link href="/" aria-label="FastChina home" className="mb-12 text-xl font-black tracking-[0.16em]">
          FAST<span className="text-[#b88735]">CHINA</span>
        </Link>

        <div className="mb-7 flex h-28 w-28 items-center justify-center rounded-full border border-[#e8dfd0] bg-white shadow-[0_12px_40px_rgba(35,25,10,0.07)]">
          <svg viewBox="0 0 64 64" aria-hidden="true" className="h-14 w-14" fill="none">
            <path d="M14 20.5 32 11l18 9.5v22L32 53l-18-10.5v-22Z" stroke="#B88735" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="m14.5 21 17.5 10 17.5-10M32 31v21" stroke="#B88735" strokeWidth="2.5" strokeLinejoin="round" />
            <path d="M25 25.5 39 39.5M39 25.5 25 39.5" stroke="#171717" strokeWidth="2.5" strokeLinecap="round" />
          </svg>
        </div>

        <p className="mb-3 text-xs font-bold uppercase tracking-[0.22em] text-[#a47a35]">404 · Page not found</p>
        <h1 className="text-3xl font-extrabold leading-tight tracking-tight sm:text-4xl">Looks like this page took a wrong turn.</h1>
        <p className="mt-4 max-w-sm text-base leading-7 text-[#69645d]">
          The product or page you’re looking for may have moved or is no longer available. Let’s get you back to exploring.
        </p>

        <Link href="/" className="mt-9 inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#171717] px-7 py-4 text-sm font-bold tracking-wide text-white shadow-lg shadow-black/10 transition hover:bg-[#343434] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b88735]">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V10Z" />
          </svg>
          BACK TO HOMEPAGE
        </Link>

        <Link href="/search" className="mt-5 text-sm font-semibold text-[#6d665c] underline decoration-[#c9b58e] underline-offset-4 hover:text-[#171717]">
          Or search for a product
        </Link>
      </section>
    </main>
  );
}
