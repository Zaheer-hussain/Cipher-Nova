"use client";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f4f6f8] px-6 text-center text-[#102a43]">
      <section className="max-w-md rounded-2xl border border-[#dce5eb] bg-white p-8">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b42335]">Dashboard error</p>
        <h1 className="mt-3 text-2xl font-semibold">This workspace could not load.</h1>
        <p className="mt-3 text-sm leading-6 text-[#71859a]">Try again. If the problem continues, check your database and authentication configuration.</p>
        <button onClick={reset} className="mt-6 rounded-lg bg-[#0f766e] px-5 py-3 text-sm font-semibold text-white hover:bg-[#115e59]">
          Try again
        </button>
      </section>
    </main>
  );
}
