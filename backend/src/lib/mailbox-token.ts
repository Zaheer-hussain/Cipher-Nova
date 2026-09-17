import { decryptValue, encryptValue } from "./encryption.js";
import { refreshMailboxTokens, type MailboxProvider } from "./mailbox-oauth.js";

type TokenPayload = Record<string, unknown>;

function parseTokens(encryptedTokens: string): TokenPayload {
  const parsed = JSON.parse(decryptValue(encryptedTokens)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Mailbox connection has an invalid token payload.");
  }
  return parsed as TokenPayload;
}

export async function refreshMailboxTokensIfNeeded(
  provider: MailboxProvider,
  encryptedTokens: string,
): Promise<{ encryptedTokens: string; accessToken: string }> {
  const tokens = parseTokens(encryptedTokens);
  const accessToken = tokens.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Mailbox connection has no usable access token.");
  }

  const expiresAt = typeof tokens.expires_at === "number"
    ? tokens.expires_at
    : typeof tokens.expires_in === "number" ? 0 : null;
  if (expiresAt === null || expiresAt > Date.now() + 60_000) {
    return { encryptedTokens, accessToken };
  }

  const refreshToken = tokens.refresh_token;
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new Error("Mailbox connection access token expired and no refresh token is available.");
  }

  const refreshed = await refreshMailboxTokens(provider, refreshToken);
  const refreshedExpiresIn = typeof refreshed.expires_in === "number" ? refreshed.expires_in : 3600;
  const mergedTokens: TokenPayload = {
    ...tokens,
    ...refreshed,
    refresh_token: typeof refreshed.refresh_token === "string" ? refreshed.refresh_token : refreshToken,
    expires_at: Date.now() + refreshedExpiresIn * 1000,
  };
  const nextEncryptedTokens = encryptValue(JSON.stringify(mergedTokens));
  const nextAccessToken = mergedTokens.access_token;
  if (typeof nextAccessToken !== "string" || !nextAccessToken) {
    throw new Error("Mailbox token refresh returned no usable access token.");
  }
  return { encryptedTokens: nextEncryptedTokens, accessToken: nextAccessToken };
}
