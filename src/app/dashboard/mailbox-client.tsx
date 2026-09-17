"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useBackendClient } from "@/lib/backend-client";

type Mailbox = {
  _id: string;
  provider: "gmail" | "outlook";
  accountEmail: string;
  status: string;
  lastSyncedAt?: string | null;
  subscriptionId?: string | null;
  subscriptionExpiresAt?: string | null;
};

type Message = {
  providerMessageId: string;
  subject: string;
  sender: string;
  receivedAt: string | null;
};

export default function MailboxClient() {
  const { request } = useBackendClient();
  const router = useRouter();
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [messages, setMessages] = useState<Record<string, Message[]>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const loadMailboxes = useCallback(async () => {
    const response = await request("/api/mailboxes", { cache: "no-store" });
    const data = (await response.json()) as { connections?: Mailbox[]; error?: string };
    if (!response.ok) throw new Error(data.error ?? "Could not load mailboxes.");
    setMailboxes(data.connections ?? []);
  }, [request]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      loadMailboxes()
        .catch((loadError: unknown) => setError(loadError instanceof Error ? loadError.message : "Could not load mailboxes."))
        .finally(() => setLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMailboxes]);

  async function connect(provider: "gmail" | "outlook") {
    setBusy(provider);
    setError("");
    try {
      const response = await request(`/api/mailboxes/${provider}/authorize`);
      const data = (await response.json()) as { authorizationUrl?: string; error?: string };
      if (!response.ok || !data.authorizationUrl) throw new Error(data.error ?? "Could not start mailbox authorization.");
      window.location.assign(data.authorizationUrl);
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : "Could not connect mailbox.");
      setBusy("");
    }
  }

  async function sync(mailbox: Mailbox) {
    setBusy(mailbox._id);
    setError("");
    try {
      const response = await request(`/api/mailboxes/${mailbox._id}/sync`, { method: "POST" });
      const data = (await response.json()) as { messages?: Message[]; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not sync mailbox.");
      setMessages((current) => ({ ...current, [mailbox._id]: data.messages ?? [] }));
      await loadMailboxes();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Could not sync mailbox.");
    } finally {
      setBusy("");
    }
  }

  async function revoke(mailbox: Mailbox) {
    setBusy(mailbox._id);
    setError("");
    try {
      const response = await request(`/api/mailboxes/${mailbox._id}/revoke`, { method: "POST" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not revoke mailbox.");
      await loadMailboxes();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : "Could not revoke mailbox.");
    } finally {
      setBusy("");
    }

  }

  async function subscribe(mailbox: Mailbox) {
    setBusy(`${mailbox._id}:subscribe`);
    setError("");
    try {
      const response = await request(`/api/mailboxes/${mailbox._id}/subscribe`, { method: "POST" });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not enable mailbox monitoring.");
      await loadMailboxes();
    } catch (subscribeError) {
      setError(subscribeError instanceof Error ? subscribeError.message : "Could not enable mailbox monitoring.");
    } finally {
      setBusy("");
    }
  }

  async function scanMessage(mailbox: Mailbox, message: Message) {
    setBusy(`${mailbox._id}:${message.providerMessageId}`);
    setError("");
    try {
      const response = await request(`/api/mailboxes/${mailbox._id}/scan-message`, {
        method: "POST",
        body: JSON.stringify({ providerMessageId: message.providerMessageId }),
      });
      const data = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !data.id) throw new Error(data.error ?? "Could not scan message.");
      router.push(`/dashboard/scans/${data.id}`);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "Could not scan message.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="rounded-2xl border border-[#dce5eb] bg-white p-4 sm:p-6 lg:col-span-2">
      <div className="flex flex-col items-start gap-4 sm:flex-row sm:flex-wrap sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-[#0f766e]">Mailbox monitoring</p>
          <h2 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">Connect a mailbox</h2>
          <p className="mt-2 text-sm leading-6 text-[#71859a]">Provider tokens stay encrypted on the backend. MailShield only displays message metadata until you start a scan.</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
          <button onClick={() => connect("gmail")} disabled={Boolean(busy)} className="rounded-lg border border-[#d5e0e7] px-3 py-2 text-xs font-semibold text-[#405c73] hover:border-[#0f766e] disabled:opacity-50 sm:text-sm">
            {busy === "gmail" ? "Connecting..." : "Connect Gmail"}
          </button>
          <button onClick={() => connect("outlook")} disabled={Boolean(busy)} className="rounded-lg border border-[#d5e0e7] px-3 py-2 text-xs font-semibold text-[#405c73] hover:border-[#0f766e] disabled:opacity-50 sm:text-sm">
            {busy === "outlook" ? "Connecting..." : "Connect Outlook"}
          </button>
        </div>
      </div>
      {error && <p className="mt-4 rounded-lg bg-[#fff1f0] px-4 py-3 text-sm text-[#b42335]">{error}</p>}
      <div className="mt-6 space-y-4">
        {loading ? <p className="text-sm text-[#71859a]">Loading mailbox connections...</p> : mailboxes.length === 0 ? (
          <p className="text-sm text-[#71859a]">No mailboxes connected.</p>
        ) : mailboxes.map((mailbox) => (
          <div key={mailbox._id} className="rounded-xl border border-[#edf1f4] p-3 sm:p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="break-all text-sm font-semibold capitalize text-[#173a54]">{mailbox.provider} · {mailbox.accountEmail}</p>
                <p className="mt-1 text-xs text-[#8193a5]">
                  Status: {mailbox.status}
                  {mailbox.lastSyncedAt ? ` · Last sync ${new Date(mailbox.lastSyncedAt).toLocaleString()}` : ""}
                  {mailbox.subscriptionExpiresAt ? ` · Monitoring until ${new Date(mailbox.subscriptionExpiresAt).toLocaleString()}` : ""}
                </p>
              </div>
              <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto">
                <button onClick={() => sync(mailbox)} disabled={Boolean(busy) || mailbox.status !== "active"} className="rounded-lg bg-[#0f766e] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                  {busy === mailbox._id ? "Working..." : "Sync recent"}
                </button>
                <button onClick={() => subscribe(mailbox)} disabled={Boolean(busy) || mailbox.status !== "active"} className="rounded-lg border border-[#b6ded8] px-3 py-2 text-xs font-semibold text-[#0f766e] disabled:opacity-50">
                  {busy === `${mailbox._id}:subscribe` ? "Enabling..." : mailbox.subscriptionId ? "Renew monitoring" : "Enable monitoring"}
                </button>
                <button onClick={() => revoke(mailbox)} disabled={Boolean(busy) || mailbox.status === "revoked"} className="rounded-lg border border-[#ffd0d5] px-3 py-2 text-xs font-semibold text-[#b42335] disabled:opacity-50">
                  Revoke
                </button>
              </div>
            </div>
            {messages[mailbox._id] && (
              <div className="mt-4 divide-y divide-[#edf1f4] border-t border-[#edf1f4]">
                {messages[mailbox._id].map((message) => (
                  <div key={message.providerMessageId} className="py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[#405c73]">{message.subject || "(No subject)"}</p>
                        <p className="mt-1 truncate text-xs text-[#8193a5]">{message.sender || "Unknown sender"}{message.receivedAt ? ` · ${new Date(message.receivedAt).toLocaleString()}` : ""}</p>
                      </div>
                      <button
                        onClick={() => scanMessage(mailbox, message)}
                        disabled={Boolean(busy)}
                        className="shrink-0 rounded-lg border border-[#b6ded8] px-3 py-2 text-xs font-semibold text-[#0f766e] disabled:opacity-50"
                      >
                        {busy === `${mailbox._id}:${message.providerMessageId}` ? "Scanning..." : "Scan message"}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
