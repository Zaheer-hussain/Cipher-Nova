import Link from "next/link";
import { SignInButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";

const features = [
  {
    number: "01",
    title: "Parse",
    description: "Extract the signal from raw headers, body text, links, and attachments.",
  },
  {
    number: "02",
    title: "Trace",
    description: "Reconstruct the relay path and locate the earliest external origin IP.",
  },
  {
    number: "03",
    title: "Score",
    description: "Combine authentication, infrastructure, and AI signals into one clear verdict.",
  },
];

export default async function Home() {
  const { userId } = await auth();

  return (
    <main className="min-h-screen bg-[#f4f6f8] text-[#102a43]">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7 lg:px-8">
        <Link href="/" className="flex items-center gap-3" aria-label="MailGuard home">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0f766e] text-white shadow-sm">
            <ShieldIcon />
          </span>
          <span className="text-lg font-bold tracking-[-0.03em]">mailguard</span>
        </Link>
        <div className="flex items-center gap-6 text-sm font-medium">
          <Link href="#how-it-works" className="hidden text-[#52677d] transition hover:text-[#0f766e] sm:block">
            How it works
          </Link>
          {!userId ? (
            <SignInButton mode="modal">
              <button className="rounded-lg border border-[#cbd5df] bg-white px-4 py-2.5 text-[#1f3b53] transition hover:border-[#0f766e] hover:text-[#0f766e]">
                Sign in
              </button>
            </SignInButton>
          ) : (
            <Link href="/dashboard" className="rounded-lg bg-[#0f766e] px-4 py-2.5 text-white transition hover:bg-[#115e59]">
              Open dashboard
            </Link>
          )}
        </div>
      </nav>

      <section className="mx-auto grid max-w-6xl gap-14 px-6 pb-20 pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:px-8 lg:pb-28 lg:pt-24">
        <div>
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#b6ded8] bg-[#e5f4f1] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.16em] text-[#0f766e]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0f766e]" />
            Email threat intelligence
          </div>
          <h1 className="max-w-2xl text-5xl font-semibold leading-[1.05] tracking-[-0.055em] text-[#102a43] sm:text-6xl">
            Know what&apos;s behind the email.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-[#52677d]">
            MailGuard turns confusing email headers into a clear, explainable trust score. Trace the origin, verify the sender, and spot threats before they reach your team.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            {!userId ? (
              <SignInButton mode="modal">
                <button className="rounded-lg bg-[#0f766e] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(15,118,110,0.2)] transition hover:bg-[#115e59]">
                  Start a scan <span className="ml-2">→</span>
                </button>
              </SignInButton>
            ) : (
              <Link href="/dashboard" className="rounded-lg bg-[#0f766e] px-5 py-3.5 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(15,118,110,0.2)] transition hover:bg-[#115e59]">
                Start a scan <span className="ml-2">→</span>
              </Link>
            )}
            <span className="text-sm text-[#71859a]">Built for clarity, not guesswork.</span>
          </div>
        </div>

        <div className="relative">
          <div className="absolute -inset-5 rounded-[2rem] bg-[#dcefeb] blur-2xl" />
          <div className="relative overflow-hidden rounded-2xl border border-[#d7e1e8] bg-white p-6 shadow-[0_20px_60px_rgba(32,61,82,0.1)]">
            <div className="flex items-center justify-between border-b border-[#e7edf1] pb-5">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#8193a5]">Latest scan</p>
                <p className="mt-1 font-semibold text-[#173a54]">invoice-update.eml</p>
              </div>
              <span className="rounded-full bg-[#e4f5ed] px-3 py-1 text-xs font-semibold text-[#18794e]">Safe</span>
            </div>
            <div className="grid grid-cols-[auto_1fr_auto] items-center gap-5 py-7">
              <div className="relative flex h-28 w-28 items-center justify-center rounded-full border-[10px] border-[#d8eee6]">
                <div className="absolute inset-[-10px] rounded-full border-[10px] border-transparent border-t-[#0f766e] border-r-[#0f766e] rotate-[-35deg]" />
                <div className="text-center">
                  <p className="text-3xl font-bold text-[#173a54]">88</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8193a5]">trust score</p>
                </div>
              </div>
              <div className="space-y-3 text-sm">
                <Signal label="SPF" value="Pass" positive />
                <Signal label="DKIM" value="Pass" positive />
                <Signal label="Origin" value="Amsterdam, NL" />
              </div>
              <div className="hidden h-24 w-px bg-[#e7edf1] sm:block" />
            </div>
            <div className="rounded-xl bg-[#f4f8fa] p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[#8193a5]">Why this score</p>
              <p className="mt-2 text-sm leading-6 text-[#52677d]">All authentication checks pass and the sending domain has a consistent relay history.</p>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-t border-[#dce5eb] bg-white">
        <div className="mx-auto max-w-6xl px-6 py-16 lg:px-8">
          <div className="mb-10 max-w-md">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f766e]">Simple by design</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#102a43]">From raw email to confident action.</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-3">
            {features.map((feature) => (
              <div key={feature.number} className="rounded-xl border border-[#e0e8ed] p-6">
                <span className="text-sm font-bold text-[#0f766e]">{feature.number}</span>
                <h3 className="mt-9 text-xl font-semibold text-[#173a54]">{feature.title}</h3>
                <p className="mt-3 text-sm leading-6 text-[#667b8f]">{feature.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}

function Signal({ label, value, positive = false }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-14 text-xs font-semibold text-[#8193a5]">{label}</span>
      <span className={`h-1.5 w-1.5 rounded-full ${positive ? "bg-[#2aa876]" : "bg-[#8aa0b2]"}`} />
      <span className="font-medium text-[#405c73]">{value}</span>
    </div>
  );
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5 fill-none stroke-current stroke-[1.8]" aria-hidden="true">
      <path d="M12 3.5 19 6v5.2c0 4.4-2.8 7.9-7 9.3-4.2-1.4-7-4.9-7-9.3V6l7-2.5Z" />
      <path d="m8.5 12 2.2 2.2 4.8-4.8" />
    </svg>
  );
}
