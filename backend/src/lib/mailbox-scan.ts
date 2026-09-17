import crypto from "node:crypto";
import { CampaignModel } from "../models/campaign.js";
import { ScanModel } from "../models/scan.js";
import { writeAuditLog } from "../audit.js";
import { createSecurityAlert } from "../alerts.js";
import { encryptRawEmail } from "./encryption.js";
import { geolocateIp } from "./geolocation.js";
import { analyzeWithGemini, getGeminiTriggerReason } from "./gemini-analysis.js";
import { analyzeWithGroq } from "./groq-analysis.js";
import { analyzeHeaders } from "./header-analysis.js";
import { parseEmailSource } from "./email-parser.js";
import { getDomainIntelligence } from "./domain-intelligence.js";
import { calculateTrustScore } from "./trust-score.js";
import { fetchMailboxMessageSource } from "./mailbox-message.js";
import type { MailboxProvider } from "./mailbox-oauth.js";
import { assertFreePlanScanAvailable } from "./plan.js";

const MAX_EMAIL_BYTES = 10 * 1024 * 1024;

function senderDomainFromEmail(senderEmail: string): string {
  return senderEmail.split("@")[1]?.toLowerCase() || "unknown.invalid";
}

function linkDomainsFromEmail(parsedEmail: { from: Array<{ address?: string }>; replyTo: Array<{ address?: string }>; returnPath?: string | null }): string[] {
  return [...new Set([
    ...parsedEmail.from.map((entry) => entry.address ? senderDomainFromEmail(entry.address) : ""),
    ...parsedEmail.replyTo.map((entry) => entry.address ? senderDomainFromEmail(entry.address) : ""),
    parsedEmail.returnPath ? senderDomainFromEmail(parsedEmail.returnPath) : "",
  ].filter(Boolean))];
}

function campaignRiskLevel(riskLabel: string): "low" | "medium" | "high" {
  return riskLabel === "Safe" ? "low" : riskLabel === "Suspicious" ? "medium" : "high";
}

export async function scanMailboxMessage(input: {
  provider: MailboxProvider;
  encryptedTokens: string;
  providerMessageId: string;
  userId: string;
  orgId: string;
  mailboxConnectionId: string;
  ipAddress?: string;
}): Promise<string> {
  await assertFreePlanScanAvailable(input.orgId);
  const rawEmail = await fetchMailboxMessageSource(input.provider, input.encryptedTokens, input.providerMessageId);
  if (Buffer.byteLength(rawEmail, "utf8") > MAX_EMAIL_BYTES) {
    throw new Error("The provider message is larger than 10 MB.");
  }

  const parsedEmail = await parseEmailSource(rawEmail);
  const headerAnalysis = analyzeHeaders(parsedEmail);
  const geolocation = await geolocateIp(headerAnalysis.originIp);
  const senderEmail = parsedEmail.from[0]?.address || "unknown@unknown.invalid";
  const senderDomain = headerAnalysis.senderDomain ?? senderDomainFromEmail(senderEmail);
  const domainIntelligence = await getDomainIntelligence(senderDomain);
  const groqAnalysis = await analyzeWithGroq({
    subject: parsedEmail.subject,
    body: parsedEmail.text,
    senderEmail,
  });
  const geminiReason = getGeminiTriggerReason(groqAnalysis, headerAnalysis.riskSignal);
  const geminiAnalysis = geminiReason
    ? await analyzeWithGemini({
        subject: parsedEmail.subject,
        body: parsedEmail.text,
        groq: groqAnalysis,
        headerAnalysis,
        reason: geminiReason,
      })
    : {
        triggered: false as const,
        reason: "not_triggered" as const,
        finalCategory: groqAnalysis.category,
        explanation: "Gemini was skipped because the first-pass signals were sufficiently confident and consistent.",
      };
  const trustScore = calculateTrustScore({
    headerAnalysis,
    geolocation,
    groqAnalysis,
    geminiAnalysis,
    domainIntelligence,
  });
  const linkedDomains = [senderDomain, ...linkDomainsFromEmail(parsedEmail)];
  const linkedIps = headerAnalysis.originIp ? [headerAnalysis.originIp] : [];
  const campaignKey = crypto.createHash("sha256").update(JSON.stringify({
    senderDomain,
    originIp: headerAnalysis.originIp,
    linkedDomains: [...linkedDomains].sort(),
  })).digest("hex");
  const savedScan = await ScanModel.create({
    orgId: input.orgId,
    userId: input.userId,
    source: "auto",
    rawEmailHash: crypto.createHash("sha256").update(rawEmail).digest("hex"),
    rawEmailEncrypted: encryptRawEmail(rawEmail),
    senderEmail,
    senderDomain,
    replyToDomain: parsedEmail.replyTo[0]?.address ? senderDomainFromEmail(parsedEmail.replyTo[0].address) : null,
    returnPathDomain: parsedEmail.returnPath ? senderDomainFromEmail(parsedEmail.returnPath) : null,
    relayChain: parsedEmail.received,
    originIp: headerAnalysis.originIp,
    geolocation,
    authResults: headerAnalysis.authResults,
    domainIntel: domainIntelligence,
    groqAnalysis,
    geminiAnalysis,
    attribution: {
      source: "mailbox",
      mailboxConnectionId: input.mailboxConnectionId,
      providerMessageId: input.providerMessageId,
    },
    trustScore: trustScore.trustScore,
    riskLabel: trustScore.riskLabel,
    reasons: trustScore.reasons,
    alertSent: false,
  });
  const campaign = await CampaignModel.findOneAndUpdate(
    { orgId: input.orgId, campaignKey },
    {
      $set: { name: `Campaign: ${senderDomain}`, lastSeen: new Date(), riskLevel: campaignRiskLevel(trustScore.riskLabel) },
      $setOnInsert: { firstSeen: new Date() },
      $addToSet: { linkedDomains: { $each: linkedDomains }, linkedIps: { $each: linkedIps }, scanIds: savedScan._id },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await ScanModel.updateOne(
    { _id: savedScan._id },
    { $set: { attribution: { source: "mailbox", mailboxConnectionId: input.mailboxConnectionId, providerMessageId: input.providerMessageId, campaignId: campaign?._id?.toString() ?? null } } },
  );
  await writeAuditLog({
    actorId: input.userId,
    action: "mailbox.message_scanned",
    targetId: savedScan._id.toString(),
    targetType: "scan",
    ipAddress: input.ipAddress,
  });
  await createSecurityAlert({
    orgId: input.orgId,
    userId: input.userId,
    scanId: savedScan._id.toString(),
    riskLabel: trustScore.riskLabel,
    senderEmail,
    senderDomain,
    reasons: trustScore.reasons,
  });
  return savedScan._id.toString();
}
