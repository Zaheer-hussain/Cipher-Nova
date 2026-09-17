"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useBackendClient } from "@/lib/backend-client";

type ScanSummary = {
  id: string;
  senderEmail: string;
  senderDomain: string;
  originIp: string | null;
  trustScore: number;
  riskLabel: string;
  createdAt: string;
};

type PlanUsage = {
  plan: { name: string; monthlyScanLimit: number };
  usage: { scansThisMonth: number };
  remaining: { scansThisMonth: number };
};

type SecurityAlert = {
  _id: string;
  severity: "medium" | "high" | "critical";
  title: string;
  message: string;
  status: "open" | "acknowledged" | "resolved";
  createdAt: string;
};

const riskStyles: Record<string, string> = {
  Safe: "bg-[#e4f5ed] text-[#18794e]",
  Suspicious: "bg-[#fff3d9] text-[#996c00]",
  "Likely Phishing": "bg-[#ffeadf] text-[#b44a21]",
  "Confirmed Malicious": "bg-[#ffe2e5] text-[#b42335]",
};

export default function DashboardClient() {
  const { request } = useBackendClient();
  const [rawEmail, setRawEmail] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [scans, setScans] = useState<ScanSummary[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [planUsage, setPlanUsage] = useState<PlanUsage | null>(null);
  const [alerts, setAlerts] = useState<SecurityAlert[]>([]);
  const [openAlertCount, setOpenAlertCount] = useState(0);
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    request("/api/scans?limit=20", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load scan history.");
        return response.json() as Promise<{ scans: ScanSummary[] }>;
      })
      .then((data) => {
        if (!cancelled) setScans(data.scans);
      })
      .catch((loadError: unknown) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Could not load scan history.");
      })
      .finally(() => {
        if (!cancelled) setLoadingHistory(false);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    let cancelled = false;
    const loadAlerts = () => request("/api/alerts?limit=5", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load alerts.");
        return response.json() as Promise<{ alerts: SecurityAlert[]; openCount: number }>;
      })
      .then((data) => {
        if (!cancelled) {
          setAlerts(data.alerts);
          setOpenAlertCount(data.openCount);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAlerts([]);
          setOpenAlertCount(0);
        }
      });
    loadAlerts();
    const timer = window.setInterval(loadAlerts, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [request]);

  async function updateAlert(id: string, action: "acknowledge" | "resolve") {
    const response = await request(`/api/alerts/${id}/${action}`, { method: "POST" });
    if (!response.ok) return;
    setAlerts((current) => current.map((alert) => alert._id === id
      ? { ...alert, status: action === "resolve" ? "resolved" : "acknowledged" }
      : alert));
    if (action === "resolve" || action === "acknowledge") {
      setOpenAlertCount((count) => Math.max(0, count - 1));
    }
  }

  useEffect(() => {
    let cancelled = false;
    request("/api/account/plan", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load plan usage.");
        return response.json() as Promise<PlanUsage>;
      })
      .then((data) => {
        if (!cancelled) setPlanUsage(data);
      })
      .catch(() => {
        if (!cancelled) setPlanUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [request]);

  async function submitScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setScanning(true);

    try {
      let response: Response;
      if (file) {
        response = await request("/api/scan", {
          method: "POST",
          body: JSON.stringify({ rawEmail: await file.text() }),
        });
      } else {
        response = await request("/api/scan", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rawEmail }),
        });
      }

      const responseText = await response.text();
      let data: { error?: string; id?: string };
      try {
        data = JSON.parse(responseText) as { error?: string; id?: string };
      } catch {
        throw new Error(`Scan failed with HTTP ${response.status}. Restart the server and try again.`);
      }
      if (!response.ok || !data.id) {
        throw new Error(data.error ?? "Scan failed.");
      }

      setRawEmail("");
      setFile(null);
      router.push(`/dashboard/scans/${data.id}`);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Scan failed.");
    } finally {
      setScanning(false);
    }
  }

  function selectFile(nextFile: File | null) {
    if (nextFile && nextFile.size > 10 * 1024 * 1024) {
      setError("The .eml file must be smaller than 10 MB.");
      setFile(null);
      return;
    }
    setError("");
    setFile(nextFile);
    setRawEmail("");
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
      <section className="rounded-2xl border border-[#dce5eb] bg-white p-4 shadow-[0_10px_30px_rgba(32,61,82,0.04)] sm:p-6">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f766e]">New investigation</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Scan an email</h2>
            <p className="mt-2 text-sm leading-6 text-[#71859a]">Paste the complete source or upload an .eml file.</p>
          </div>
          <span className="rounded-full bg-[#e5f4f1] px-3 py-1 text-xs font-semibold text-[#0f766e]">
            {planUsage ? `${planUsage.plan.name} · ${planUsage.remaining.scansThisMonth} scans left` : "Private"}
          </span>
        </div>
        <form onSubmit={submitScan} className="mt-6">
          <textarea
            value={rawEmail}
            onChange={(event) => {
              setRawEmail(event.target.value);
              setFile(null);
            }}
            placeholder={"From: sender@example.com\nSubject: Paste an email source\n\nEmail body..."}
            className="min-h-64 w-full resize-y rounded-xl border border-[#d5e0e7] bg-[#fbfcfd] p-4 font-mono text-xs leading-6 text-[#405c73] outline-none transition focus:border-[#0f766e] focus:ring-2 focus:ring-[#b6ded8]"
            disabled={scanning || Boolean(file)}
          />
          <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="cursor-pointer text-sm font-semibold text-[#0f766e] hover:text-[#115e59]">
              <input
                type="file"
                accept=".eml,message/rfc822"
                className="sr-only"
                onChange={(event) => {
                  selectFile(event.target.files?.[0] ?? null);
                }}
                disabled={scanning}
              />
              {file ? `Selected: ${file.name}` : "Or choose an .eml file"}
            </label>
            <button
              type="submit"
              disabled={scanning || (!rawEmail.trim() && !file)}
              className="w-full rounded-lg bg-[#0f766e] px-5 py-3 text-sm font-semibold text-white transition hover:bg-[#115e59] disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
            >
              {scanning ? "Analyzing..." : "Run full scan →"}
            </button>
          </div>
          {error && <p className="mt-4 rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#b42335]">{error}</p>}
        </form>
      </section>

      <section className="rounded-2xl border border-[#dce5eb] bg-white p-4 sm:p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f766e]">Your activity</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Recent scans</h2>
          </div>
          <span className="rounded-full bg-[#f0f4f7] px-3 py-1 text-xs font-semibold text-[#71859a]">{scans.length}</span>
        </div>
        <div className="mt-6 divide-y divide-[#edf1f4]">
          {loadingHistory ? (
            <p className="py-8 text-sm text-[#71859a]">Loading history...</p>
          ) : scans.length === 0 ? (
            <p className="py-8 text-sm text-[#71859a]">No scans yet. Your results will appear here.</p>
          ) : (
            scans.map((scan) => (
              <Link key={scan.id} href={`/dashboard/scans/${scan.id}`} className="block py-4 transition hover:bg-[#f8fafb]">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[#173a54]">{scan.senderEmail}</p>
                    <p className="mt-1 text-xs text-[#8193a5]">{new Date(scan.createdAt).toLocaleString()}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-lg font-bold text-[#173a54]">{scan.trustScore}</span>
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${riskStyles[scan.riskLabel] ?? "bg-[#f0f4f7] text-[#71859a]"}`}>
                      {scan.riskLabel}
                    </span>
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </section>
      {alerts.length > 0 && (
        <section className="rounded-2xl border border-[#f2d1d5] bg-white p-4 sm:p-6 lg:col-span-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#b42335]">Security operations</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Open alerts</h2>
            </div>
            <span className="rounded-full bg-[#ffe2e5] px-3 py-1 text-xs font-semibold text-[#b42335]">{openAlertCount}</span>
          </div>
          <div className="mt-4 space-y-3">
            {alerts.map((alert) => (
              <div key={alert._id} className="rounded-xl border border-[#f3e1e3] bg-[#fffafb] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-[#7f1d2d]">{alert.title} · {alert.severity}</p>
                    <p className="mt-1 text-sm text-[#667b8f]">{alert.message}</p>
                  </div>
                  {alert.status === "open" && (
                    <div className="flex w-full gap-2 sm:w-auto">
                      <button onClick={() => updateAlert(alert._id, "acknowledge")} className="flex-1 rounded-lg border border-[#e8c4c9] px-3 py-2 text-xs font-semibold text-[#8b3040] sm:flex-none">Acknowledge</button>
                      <button onClick={() => updateAlert(alert._id, "resolve")} className="flex-1 rounded-lg bg-[#b42335] px-3 py-2 text-xs font-semibold text-white sm:flex-none">Resolve</button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
