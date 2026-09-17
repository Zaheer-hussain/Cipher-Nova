import type { MailboxProvider } from "./mailbox-oauth.js";

type GmailHistoryResponse = {
  history?: Array<{
    messagesAdded?: Array<{ message?: { id?: string } }>;
  }>;
};

type OutlookPayload = {
  resource?: string;
  value?: Array<{ resource?: string; resourceData?: { id?: string } }>;
};

export function normalizeGmailPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const message = payload.message;
  if (!message || typeof message !== "object" || typeof (message as { data?: unknown }).data !== "string") {
    return payload;
  }
  try {
    const decoded = Buffer.from((message as { data: string }).data, "base64").toString("utf8");
    const nested = JSON.parse(decoded) as unknown;
    return nested && typeof nested === "object" ? nested as Record<string, unknown> : payload;
  } catch {
    return payload;
  }
}

function accessTokenHeaders(accessToken: string): HeadersInit {
  return { Authorization: `Bearer ${accessToken}` };
}

async function gmailMessageIds(accessToken: string, historyId: string): Promise<string[]> {
  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/history?startHistoryId=${encodeURIComponent(historyId)}&historyTypes=messageAdded`,
    { headers: accessTokenHeaders(accessToken), signal: AbortSignal.timeout(15000) },
  );
  const payload = (await response.json()) as GmailHistoryResponse;
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Gmail history lookup failed with status ${response.status}.`);
  }
  return [...new Set((payload.history ?? []).flatMap((entry) =>
    (entry.messagesAdded ?? [])
      .map((added) => added.message?.id)
      .filter((id): id is string => typeof id === "string"),
  ))];
}

export async function resolveWebhookMessageIds(
  provider: MailboxProvider,
  payload: Record<string, unknown>,
  accessToken: string,
): Promise<string[]> {
  if (provider === "gmail") {
    payload = normalizeGmailPayload(payload);
    const directMessageId = payload.messageId;
    if (typeof directMessageId === "string" && directMessageId.trim()) {
      return [directMessageId.trim()];
    }
    const historyId = payload.historyId;
    return typeof historyId === "string" && historyId.trim()
      ? gmailMessageIds(accessToken, historyId.trim())
      : [];
  }

  const outlookPayload = payload as OutlookPayload;
  const resources = [
    ...(Array.isArray(outlookPayload.value) ? outlookPayload.value : []),
    { resource: outlookPayload.resource },
  ];
  return [...new Set(resources.flatMap((entry) => {
    const directId = entry.resourceData?.id;
    if (typeof directId === "string" && directId.trim()) {
      return [directId.trim()];
    }
    const resource = entry.resource;
    const match = typeof resource === "string"
      ? resource.match(/\/messages\/([^/?]+)/i)
      : null;
    return match?.[1] ? [decodeURIComponent(match[1])] : [];
  }))];
}
