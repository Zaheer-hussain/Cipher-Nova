import crypto from "node:crypto";
import type { MailboxProvider } from "./mailbox-oauth.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Configure mailbox webhooks before subscribing.`);
  return value;
}

function headers(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
}

export type MailboxSubscription = {
  subscriptionId: string;
  resource: string;
  expiresAt: Date;
  clientState?: string;
  historyId?: string;
};

export async function createMailboxSubscription(
  provider: MailboxProvider,
  accessToken: string,
): Promise<MailboxSubscription> {
  if (provider === "gmail") {
    const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/watch", {
      method: "POST",
      headers: headers(accessToken),
      body: JSON.stringify({ topicName: required("GOOGLE_PUBSUB_TOPIC"), labelIds: ["INBOX"] }),
      signal: AbortSignal.timeout(15000),
    });
    const payload = (await response.json()) as { historyId?: string; expiration?: string };
    if (!response.ok || typeof payload.historyId !== "string" || typeof payload.expiration !== "string") {
      throw new Error(`Gmail mailbox watch failed with status ${response.status}.`);
    }
    return {
      subscriptionId: `gmail:${payload.historyId}`,
      resource: "users/me",
      historyId: payload.historyId,
      expiresAt: new Date(Number(payload.expiration)),
    };
  }

  const clientState = crypto.randomBytes(24).toString("base64url");
  const expiration = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const response = await fetch("https://graph.microsoft.com/v1.0/subscriptions", {
    method: "POST",
    headers: headers(accessToken),
    body: JSON.stringify({
      changeType: "created",
      notificationUrl: required("MICROSOFT_NOTIFICATION_URL"),
      resource: "/me/mailFolders('Inbox')/messages",
      expirationDateTime: expiration.toISOString(),
      clientState,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const payload = (await response.json()) as { id?: string; resource?: string; expirationDateTime?: string };
  if (!response.ok || typeof payload.id !== "string" || typeof payload.resource !== "string") {
    throw new Error(`Microsoft mailbox subscription failed with status ${response.status}.`);
  }
  return {
    subscriptionId: payload.id,
    resource: payload.resource,
    clientState,
    expiresAt: typeof payload.expirationDateTime === "string"
      ? new Date(payload.expirationDateTime)
      : expiration,
  };
}

export async function deleteMailboxSubscription(
  provider: MailboxProvider,
  accessToken: string,
  subscriptionId: string | null,
): Promise<void> {
  if (!subscriptionId || provider === "gmail") return;
  const response = await fetch(
    `https://graph.microsoft.com/v1.0/subscriptions/${encodeURIComponent(subscriptionId)}`,
    { method: "DELETE", headers: headers(accessToken), signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`Microsoft mailbox subscription deletion failed with status ${response.status}.`);
  }
}
