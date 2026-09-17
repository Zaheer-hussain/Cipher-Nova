import crypto from "node:crypto";

export type MailboxProvider = "gmail" | "outlook";

type OAuthState = {
  provider: MailboxProvider;
  userId: string;
  orgId: string;
  issuedAt: number;
};

function getRequired(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}. Configure mailbox OAuth before connecting a mailbox.`);
  return value;
}

function getStateSecret(): string {
  return getRequired("ENCRYPTION_KEY");
}

function signState(payload: string): string {
  return crypto.createHmac("sha256", getStateSecret()).update(payload).digest("base64url");
}

export function createMailboxOAuthState(input: Omit<OAuthState, "issuedAt">): string {
  const payload = Buffer.from(JSON.stringify({ ...input, issuedAt: Date.now() }), "utf8").toString("base64url");
  return `${payload}.${signState(payload)}`;
}

export function readMailboxOAuthState(value: string): OAuthState {
  const [payload, signature] = value.split(".");
  const expectedSignature = payload ? signState(payload) : "";
  const signatureBuffer = Buffer.from(signature ?? "");
  const expectedBuffer = Buffer.from(expectedSignature);
  if (
    !payload ||
    !signature ||
    signatureBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    throw new Error("Invalid mailbox OAuth state.");
  }

  const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
  if (!parsed.provider || !parsed.userId || !parsed.orgId || Date.now() - parsed.issuedAt > 10 * 60 * 1000) {
    throw new Error("Mailbox OAuth state expired.");
  }
  return parsed;
}

export function getMailboxAuthorizationUrl(provider: MailboxProvider, state: string): string {
  if (provider === "gmail") {
    const params = new URLSearchParams({
      client_id: getRequired("GOOGLE_CLIENT_ID"),
      redirect_uri: getRequired("GOOGLE_REDIRECT_URI"),
      response_type: "code",
      access_type: "offline",
      prompt: "consent",
      scope: "https://www.googleapis.com/auth/gmail.readonly",
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  const params = new URLSearchParams({
    client_id: getRequired("MICROSOFT_CLIENT_ID"),
    redirect_uri: getRequired("MICROSOFT_REDIRECT_URI"),
    response_type: "code",
    response_mode: "query",
    scope: "offline_access Mail.Read User.Read",
    state,
  });
  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeMailboxCode(provider: MailboxProvider, code: string): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({ code, grant_type: "authorization_code" });
  const endpoint = provider === "gmail"
    ? "https://oauth2.googleapis.com/token"
    : "https://login.microsoftonline.com/common/oauth2/v2.0/token";

  if (provider === "gmail") {
    body.set("client_id", getRequired("GOOGLE_CLIENT_ID"));
    body.set("client_secret", getRequired("GOOGLE_CLIENT_SECRET"));
    body.set("redirect_uri", getRequired("GOOGLE_REDIRECT_URI"));
  } else {
    body.set("client_id", getRequired("MICROSOFT_CLIENT_ID"));
    body.set("client_secret", getRequired("MICROSOFT_CLIENT_SECRET"));
    body.set("redirect_uri", getRequired("MICROSOFT_REDIRECT_URI"));
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(`Mailbox token exchange failed with status ${response.status}.`);
  }
  return payload;
}

export async function refreshMailboxTokens(
  provider: MailboxProvider,
  refreshToken: string,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const endpoint = provider === "gmail"
    ? "https://oauth2.googleapis.com/token"
    : "https://login.microsoftonline.com/common/oauth2/v2.0/token";

  body.set("client_id", getRequired(provider === "gmail" ? "GOOGLE_CLIENT_ID" : "MICROSOFT_CLIENT_ID"));
  body.set("client_secret", getRequired(provider === "gmail" ? "GOOGLE_CLIENT_SECRET" : "MICROSOFT_CLIENT_SECRET"));
  if (provider === "outlook") {
    body.set("scope", "offline_access Mail.Read User.Read");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(15000),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(`Mailbox token refresh failed with status ${response.status}.`);
  }
  return payload;
}

export async function revokeMailboxAccess(
  provider: MailboxProvider,
  accessToken: string,
): Promise<void> {
  if (provider === "outlook") {
    return;
  }

  const response = await fetch("https://oauth2.googleapis.com/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: accessToken }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok && response.status !== 400) {
    throw new Error(`Gmail token revocation failed with status ${response.status}.`);
  }
}

export async function resolveMailboxProfile(
  provider: MailboxProvider,
  tokens: Record<string, unknown>,
): Promise<{ providerAccountId: string; accountEmail: string }> {
  const accessToken = tokens.access_token;
  if (typeof accessToken !== "string" || !accessToken) {
    throw new Error("Mailbox token exchange returned no access token.");
  }

  const profileUrl = provider === "gmail"
    ? "https://gmail.googleapis.com/gmail/v1/users/me/profile"
    : "https://graph.microsoft.com/v1.0/me?$select=id,mail,userPrincipalName";
  const response = await fetch(profileUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const profile = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(`Mailbox profile lookup failed with status ${response.status}.`);
  }

  if (provider === "gmail") {
    if (typeof profile.emailAddress !== "string") {
      throw new Error("Gmail profile did not include an email address.");
    }
    return {
      providerAccountId: profile.emailAddress,
      accountEmail: profile.emailAddress,
    };
  }

  const providerAccountId = profile.id;
  const accountEmail = profile.mail ?? profile.userPrincipalName;
  if (typeof providerAccountId !== "string" || typeof accountEmail !== "string") {
    throw new Error("Microsoft profile did not include an account identity.");
  }
  return { providerAccountId, accountEmail };
}
