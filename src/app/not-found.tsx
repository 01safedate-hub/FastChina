import Link from "next/link";

export default function NotFound() {
  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-[#f8f7f4] px-5 py-10 text-center text-[#171717]">
      <div aria-hidden="true" className="pointer-events-none absolute -left-24 -top-24 h-72 w-72 rounded-full bg-[#f1e6cf] opacity-60 blur-3xl" />
      <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -right-20 h-80 w-80 rounded-full bg-[#e9e3d8] opacity-70 blur-3xl" />
      <section className="relative z-10 flex w-full max-w-md flex-col items-center">
        <Link href="/" aria-label="FastChina home" className="mb-7 text-xl font-black tracking-[0.16em]">
          FAST<span className="text-[#b88735]">CHINA</span>
        </Link>
        <div className="mb-2 select-none text-[clamp(112px,32vw,164px)] font-black leading-[0.82] tracking-[-0.09em] text-[#171717]">404</div>
        <div className="mb-7 h-1.5 w-16 rounded-full bg-[#b88735]" />
        <p className="mb-3 text-xs font-extrabold uppercase tracking-[0.22em] text-[#a47a35]">Page not found</p>
        <h1 className="text-[clamp(27px,7vw,36px)] font-extrabold leading-[1.12] tracking-tight">
          This page seems to have gone missing.
        </h1>
        <p className="mt-4 max-w-sm text-base leading-7 text-[#69645d]">
          The product or page may have moved or is no longer available. Let’s get you back to FastChina.
        </p>
        <Link href="/" className="mt-8 inline-flex min-h-14 w-full items-center justify-center gap-3 rounded-xl bg-[#171717] px-7 py-4 text-sm font-extrabold tracking-wide text-white shadow-lg shadow-black/10 transition hover:bg-[#343434] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#b88735]">
          <svg viewBox="0 0 24 24" aria-hidden="true" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7h-6v7H4a1 1 0 0 1-1-1V10Z" />
          </svg>
          BACK TO HOMEPAGE
        </Link>
        <Link href="/search" className="mt-5 text-sm font-bold text-[#6d665c] underline decoration-[#c9b58e] underline-offset-4 hover:text-[#171717]">
          Or search for a product
        </Link>
      </section>
    </main>
  );
}
