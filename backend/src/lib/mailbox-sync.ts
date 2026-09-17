import { decryptValue } from "./encryption.js";
import type { MailboxProvider } from "./mailbox-oauth.js";

export type MailboxMessageSummary = {
  providerMessageId: string;
  threadId: string | null;
  subject: string;
  sender: string;
  receivedAt: string | null;
};

function accessTokenFromEncryptedValue(encryptedTokens: string): string {
  const tokens = JSON.parse(decryptValue(encryptedTokens)) as Record<string, unknown>;
  if (typeof tokens.access_token !== "string" || !tokens.access_token) {
    throw new Error("Mailbox connection has no usable access token.");
  }
  return tokens.access_token;
}

function headerValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((header) => header.name?.toLowerCase() === name)?.value?.trim() ?? "";
}

export async function listRecentMailboxMessages(
  provider: MailboxProvider,
  encryptedTokens: string,
): Promise<MailboxMessageSummary[]> {
  const accessToken = accessTokenFromEncryptedValue(encryptedTokens);
  const headers = { Authorization: `Bearer ${accessToken}` };

  if (provider === "gmail") {
    const listResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=10",
      { headers, signal: AbortSignal.timeout(15000) },
    );
    const listPayload = (await listResponse.json()) as {
      messages?: Array<{ id?: string; threadId?: string }>;
    };
    if (!listResponse.ok) {
      throw new Error(`Gmail message listing failed with status ${listResponse.status}.`);
    }

    const messages = await Promise.all(
      (listPayload.messages ?? []).filter((message): message is { id: string; threadId?: string } => typeof message.id === "string")
        .map(async (message) => {
          const detailResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
            { headers, signal: AbortSignal.timeout(15000) },
          );
          const detail = (await detailResponse.json()) as {
            payload?: { headers?: Array<{ name?: string; value?: string }> };
            internalDate?: string;
          };
          if (!detailResponse.ok) {
            throw new Error(`Gmail message lookup failed with status ${detailResponse.status}.`);
          }
          const messageHeaders = detail.payload?.headers;
          return {
            providerMessageId: message.id,
            threadId: message.threadId ?? null,
            subject: headerValue(messageHeaders, "subject"),
            sender: headerValue(messageHeaders, "from"),
            receivedAt: headerValue(messageHeaders, "date") || (
              detail.internalDate ? new Date(Number(detail.internalDate)).toISOString() : null
            ),
          };
        }),
    );
    return messages;
  }

  const response = await fetch(
    "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$top=10&$select=id,conversationId,subject,from,receivedDateTime&$orderby=receivedDateTime%20desc",
    { headers, signal: AbortSignal.timeout(15000) },
  );
  const payload = (await response.json()) as {
    value?: Array<{
      id?: string;
      conversationId?: string;
      subject?: string;
      from?: { emailAddress?: { address?: string } };
      receivedDateTime?: string;
    }>;
  };
  if (!response.ok) {
    throw new Error(`Microsoft message listing failed with status ${response.status}.`);
  }
  return (payload.value ?? [])
    .filter((message): message is NonNullable<typeof message> & { id: string } => typeof message.id === "string")
    .map((message) => ({
      providerMessageId: message.id,
      threadId: message.conversationId ?? null,
      subject: message.subject ?? "",
      sender: message.from?.emailAddress?.address ?? "",
      receivedAt: message.receivedDateTime ?? null,
    }));
}
