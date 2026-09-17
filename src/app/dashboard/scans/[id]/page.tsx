import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";

const riskStyles: Record<string, string> = {
  Safe: "bg-[#e4f5ed] text-[#18794e]",
  Suspicious: "bg-[#fff3d9] text-[#996c00]",
  "Likely Phishing": "bg-[#ffeadf] text-[#b44a21]",
  "Confirmed Malicious": "bg-[#ffe2e5] text-[#b42335]",
};

type BackendScan = {
  senderEmail: string;
  senderDomain: string;
  createdAt: string;
  trustScore: number;
  riskLabel: string;
  originIp: string | null;
  reasons: string[];
  authResults: { spf?: string; dkim?: string; dmarc?: string };
  geolocation: {
    latitude?: number | null;
    longitude?: number | null;
    city?: string | null;
    country?: string | null;
    isp?: string | null;
    isProxy?: boolean | null;
  };
  groqAnalysis: {
    category: string;
    confidence: number;
    urgencyScore: number;
    impersonationDetected: boolean;
  };
  geminiAnalysis?: {
    triggered?: boolean;
    reason?: string;
    finalCategory?: string;
  } | null;
  domainIntelligence?: {
    available?: boolean;
    ageDays?: number | null;
    registrationDate?: string | null;
    registrar?: string | null;
  } | null;
};

export default async function ScanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId, getToken } = await auth();
  if (!userId) redirect("/sign-in");

  const { id } = await params;
  const token = await getToken();
  const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL ?? "http://localhost:4000";
  const scanResponse = await fetch(`${backendUrl}/api/scans/${encodeURIComponent(id)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    cache: "no-store",
  });
  if (scanResponse.status === 404) notFound();
  if (!scanResponse.ok) throw new Error("Could not load scan.");
  const scanData = (await scanResponse.json()) as { scan?: BackendScan };
  const scan = scanData.scan;
  if (!scan) notFound();

  const scoreColor = scan.trustScore >= 75 ? "#18794e" : scan.trustScore >= 50 ? "#996c00" : "#b42335";
  const latitude = scan.geolocation.latitude ?? null;
  const longitude = scan.geolocation.longitude ?? null;

  return (
    <main className="min-h-screen bg-[#f4f6f8] text-[#102a43]">
      <nav className="border-b border-[#dce5eb] bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6 sm:py-5 lg:px-8">
          <Link href="/dashboard" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#0f766e] text-white"><span className="text-lg font-bold">M</span></span>
            <span className="font-bold tracking-[-0.03em]">mailguard</span>
          </Link>
          <UserButton />
        </div>
      </nav>
      <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:px-8">
        <Link href="/dashboard" className="text-sm font-semibold text-[#0f766e] hover:text-[#115e59]">← Back to dashboard</Link>
        <div className="mt-6 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f766e]">Scan detail</p>
            <h1 className="mt-3 break-all text-2xl font-semibold tracking-[-0.05em] sm:text-3xl">{scan.senderEmail}</h1>
            <p className="mt-2 break-words text-sm text-[#71859a]">{new Date(scan.createdAt).toLocaleString()} · {scan.senderDomain}</p>
          </div>
          <span className={`rounded-full px-4 py-2 text-sm font-semibold ${riskStyles[scan.riskLabel] ?? "bg-[#f0f4f7] text-[#71859a]"}`}>{scan.riskLabel}</span>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <section className="rounded-2xl border border-[#dce5eb] bg-white p-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8193a5]">Trust score</p>
            <div className="mt-6 flex flex-col items-start gap-5 sm:flex-row sm:items-center sm:gap-6">
              <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-full border-[10px] sm:h-32 sm:w-32 sm:border-[12px]" style={{ borderColor: `${scoreColor}33` }}>
                <div className="text-center">
                  <p className="text-4xl font-bold" style={{ color: scoreColor }}>{scan.trustScore}</p>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[#8193a5]">out of 100</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-[#173a54]">Final category</p>
                <p className="mt-1 capitalize text-[#52677d]">{scan.geminiAnalysis?.finalCategory ?? scan.groqAnalysis.category}</p>
                <p className="mt-4 text-sm font-semibold text-[#173a54]">Origin</p>
                <p className="mt-1 text-[#52677d]">{scan.originIp ?? "Not established"}</p>
              </div>
            </div>
            <div className="mt-8">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#8193a5]">Why this score</p>
              <ul className="mt-3 space-y-3">
                {(scan.reasons.length > 0 ? scan.reasons : ["No stored score reasons are available for this scan."]).map((reason, index) => <li key={`${reason}-${index}`} className="flex gap-2 text-sm leading-6 text-[#52677d]"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0f766e]" />{reason}</li>)}
              </ul>
            </div>
          </section>

          <div className="grid gap-6 sm:grid-cols-2">
            <InfoCard title="Authentication">
              <Metric label="SPF" value={scan.authResults.spf ?? "Unknown"} />
              <Metric label="DKIM" value={scan.authResults.dkim ?? "Unknown"} />
              <Metric label="DMARC" value={scan.authResults.dmarc ?? "Unknown"} />
            </InfoCard>
            <InfoCard title="Origin intelligence">
              <Metric label="IP" value={scan.originIp ?? "Unknown"} />
              <Metric label="Location" value={[scan.geolocation.city, scan.geolocation.country].filter(Boolean).join(", ") || "Unknown"} />
              <Metric label="ISP" value={scan.geolocation.isp ?? "Unknown"} />
              <Metric label="Proxy / hosting" value={scan.geolocation.isProxy === true ? "Flagged" : "Not flagged"} />
            </InfoCard>
            <section className="overflow-hidden rounded-2xl border border-[#dce5eb] bg-white sm:col-span-2">
              <div className="flex items-center justify-between gap-3 p-5">
                <div>
                  <h2 className="text-sm font-bold text-[#173a54]">Origin map</h2>
                  <p className="mt-1 text-xs text-[#8193a5]">Approximate IP geolocation, not a physical address.</p>
                </div>
                {latitude !== null && longitude !== null && (
                  <a
                    href={`https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=10/${latitude}/${longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-semibold text-[#0f766e] hover:text-[#115e59]"
                  >
                    Open larger map →
                  </a>
                )}
              </div>
              {latitude !== null && longitude !== null ? (
                <iframe
                  title="Approximate email origin map"
                  src={`https://www.openstreetmap.org/export/embed.html?bbox=${longitude - 0.5}%2C${latitude - 0.35}%2C${longitude + 0.5}%2C${latitude + 0.35}&layer=mapnik&marker=${latitude}%2C${longitude}`}
                  className="h-72 w-full border-0"
                  loading="lazy"
                />
              ) : (
                <p className="border-t border-[#edf1f4] px-5 py-8 text-sm text-[#71859a]">Map coordinates were not available for this origin.</p>
              )}
            </section>
            <InfoCard title="Groq first pass">
              <Metric label="Category" value={scan.groqAnalysis.category} />
              <Metric label="Confidence" value={`${Math.round(scan.groqAnalysis.confidence * 100)}%`} />
              <Metric label="Urgency" value={`${scan.groqAnalysis.urgencyScore}/100`} />
              <Metric label="Impersonation" value={scan.groqAnalysis.impersonationDetected ? "Detected" : "Not detected"} />
            </InfoCard>
            <InfoCard title="Gemini second pass">
              <Metric label="Triggered" value={scan.geminiAnalysis?.triggered ? "Yes" : "Skipped"} />
              <Metric label="Reason" value={scan.geminiAnalysis?.reason ?? "Signals agreed"} />
              <Metric label="Final category" value={scan.geminiAnalysis?.finalCategory ?? scan.groqAnalysis.category} />
            </InfoCard>
            <InfoCard title="Domain intelligence">
              <Metric label="Status" value={scan.domainIntelligence?.available ? "Available" : "Unavailable"} />
              <Metric label="Domain age" value={scan.domainIntelligence?.ageDays != null ? `${scan.domainIntelligence.ageDays} days` : "Unknown"} />
              <Metric label="Registered" value={scan.domainIntelligence?.registrationDate ?? "Unknown"} />
              <Metric label="Registrar" value={scan.domainIntelligence?.registrar ?? "Unknown"} />
            </InfoCard>
          </div>
        </div>
      </section>
    </main>
  );
}

function InfoCard({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-2xl border border-[#dce5eb] bg-white p-5"><h2 className="text-sm font-bold text-[#173a54]">{title}</h2><div className="mt-4 space-y-3">{children}</div></section>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="flex items-start justify-between gap-3 text-sm"><span className="text-[#8193a5]">{label}</span><span className="max-w-[65%] text-right font-medium capitalize text-[#405c73]">{value}</span></div>;
}
