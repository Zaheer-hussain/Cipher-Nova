import { decryptValue } from "./encryption.js";
import type { MailboxProvider } from "./mailbox-oauth.js";

function getAccessToken(encryptedTokens: string): string {
  const tokens = JSON.parse(decryptValue(encryptedTokens)) as Record<string, unknown>;
  if (typeof tokens.access_token !== "string" || !tokens.access_token) {
    throw new Error("Mailbox connection has no usable access token.");
  }
  return tokens.access_token;
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export async function fetchMailboxMessageSource(
  provider: MailboxProvider,
  encryptedTokens: string,
  providerMessageId: string,
): Promise<string> {
  const accessToken = getAccessToken(encryptedTokens);
  const headers = { Authorization: `Bearer ${accessToken}` };

  if (provider === "gmail") {
    const response = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(providerMessageId)}?format=raw`,
      { headers, signal: AbortSignal.timeout(15000) },
    );
    const payload = (await response.json()) as { raw?: string };
    if (!response.ok || typeof payload.raw !== "string") {
      throw new Error(`Gmail message retrieval failed with status ${response.status}.`);
    }
    return decodeBase64Url(payload.raw);
  }

  const response = await fetch(
    `https://graph.microsoft.com/v1.0/me/messages/${encodeURIComponent(providerMessageId)}/$value`,
    { headers: { ...headers, Accept: "message/rfc822" }, signal: AbortSignal.timeout(15000) },
  );
  if (!response.ok) {
    throw new Error(`Microsoft message retrieval failed with status ${response.status}.`);
  }
  return response.text();
}
