import type { ParsedEmail } from "./email-parser.js";

export type AuthStatus = "pass" | "fail" | "none" | "neutral" | "unknown";

export type HeaderAnalysis = {
  senderDomain: string | null;
  originIp: string | null;
  relayHops: number;
  authResults: {
    spf: AuthStatus;
    dkim: AuthStatus;
    dmarc: AuthStatus;
  };
  anomalies: string[];
  reasons: string[];
  riskSignal: "low" | "medium" | "high";
};

const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const IPV6_PATTERN = /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/gi;

function getDomain(address: string | undefined): string | null {
  const domain = address?.split("@").pop()?.trim().toLowerCase();
  return domain && domain.includes(".") ? domain : null;
}

function normalizeStatus(value: string | null): AuthStatus {
  const status = value?.toLowerCase().match(/\b(pass|fail|none|neutral|softfail|temperror|permerror)\b/)?.[1];
  if (status === "softfail" || status === "temperror" || status === "permerror") return "fail";
  return status === "pass" || status === "fail" || status === "none" || status === "neutral"
    ? status
    : "unknown";
}

function authStatus(parsed: ParsedEmail, method: "spf" | "dkim" | "dmarc"): AuthStatus {
  const authText = parsed.authenticationResults ?? "";
  const headerText = Object.entries(parsed.headers)
    .filter(([name]) => name === "received-spf" || name === "arc-authentication-results")
    .map(([, value]) => (Array.isArray(value) ? value.join(" ") : value))
    .join(" ");

  return normalizeStatus(
    `${authText} ${headerText}`.match(new RegExp(`${method}\\s*[=:]\\s*\\w+|${method}\\s+\\w+`, "i"))?.[0] ?? null,
  );
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return true;
  return (
    parts[0] === 10 ||
    parts[0] === 127 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    (parts[0] === 169 && parts[1] === 254)
  );
}

function isPrivateIp(ip: string): boolean {
  return ip.includes(":")
    ? ip === "::1" || ip.toLowerCase().startsWith("fc") || ip.toLowerCase().startsWith("fd")
    : isPrivateIpv4(ip);
}

function extractOriginIp(received: string[]): string | null {
  for (const header of [...received].reverse()) {
    const candidates = [...(header.match(IPV4_PATTERN) ?? []), ...(header.match(IPV6_PATTERN) ?? [])];
    const publicIp = candidates.find((ip) => !isPrivateIp(ip));
    if (publicIp) return publicIp;
  }
  return null;
}

export function analyzeHeaders(parsed: ParsedEmail): HeaderAnalysis {
  const from = parsed.from[0]?.address;
  const senderDomain = getDomain(from);
  const replyToDomain = getDomain(parsed.replyTo[0]?.address);
  const returnPathDomain = getDomain(parsed.returnPath ?? undefined);
  const displayName = parsed.from[0]?.name ?? "";
  const authResults = {
    spf: authStatus(parsed, "spf"),
    dkim: authStatus(parsed, "dkim"),
    dmarc: authStatus(parsed, "dmarc"),
  };
  const anomalies: string[] = [];

  if (displayName && senderDomain && displayName.includes("@")) anomalies.push("Display name contains an email-like value.");
  if (senderDomain && replyToDomain && senderDomain !== replyToDomain) anomalies.push("Reply-To domain differs from the From domain.");
  if (senderDomain && returnPathDomain && senderDomain !== returnPathDomain) anomalies.push("Return-Path domain differs from the From domain.");
  if (parsed.received.length > 6) anomalies.push("Email passed through an unusually high number of relays.");
  if (authResults.spf === "fail") anomalies.push("SPF authentication failed.");
  if (authResults.dkim === "fail") anomalies.push("DKIM authentication failed.");
  if (authResults.dmarc === "fail") anomalies.push("DMARC authentication failed.");
  if (!parsed.authenticationResults) anomalies.push("No Authentication-Results header was provided.");

  const authFailures = Object.values(authResults).filter((status) => status === "fail").length;
  const riskSignal = authFailures >= 2 || anomalies.length >= 3 ? "high" : anomalies.length > 0 ? "medium" : "low";

  return {
    senderDomain,
    originIp: extractOriginIp(parsed.received),
    relayHops: parsed.received.length,
    authResults,
    anomalies,
    reasons: anomalies.length > 0 ? anomalies : ["No obvious header anomalies detected."],
    riskSignal,
  };
}
