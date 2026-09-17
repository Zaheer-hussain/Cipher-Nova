import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import DashboardClient from "./dashboard-client";
import MailboxClient from "./mailbox-client";

export default async function DashboardPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect("/sign-in");
  }

  return (
    <main className="min-h-screen bg-[#f4f6f8] text-[#102a43]">
      <nav className="border-b border-[#dce5eb] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0f766e] text-white">
              <span className="text-lg font-bold">M</span>
            </span>
            <span className="font-bold tracking-[-0.03em]">mailguard</span>
          </Link>
          <UserButton />
        </div>
      </nav>
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-12 lg:px-8">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f766e]">Protected workspace</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-0.05em] sm:text-4xl">Your email intelligence dashboard.</h1>
        <p className="mt-4 max-w-xl text-sm leading-6 text-[#667b8f] sm:text-base">Paste an email source or upload an .eml file to trace its origin and understand its trust score.</p>
        <div className="mt-8 sm:mt-10">
          <DashboardClient />
          <div className="mt-8">
            <MailboxClient />
          </div>
        </div>
      </section>
    </main>
  );
}
