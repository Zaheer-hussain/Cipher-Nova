import "./env.js";
import cors from "cors";
import { clerkMiddleware, getAuth } from "@clerk/express";
import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import mongoose from "mongoose";
import { decryptValue, encryptRawEmail } from "./lib/encryption.js";
import { geolocateIp } from "./lib/geolocation.js";
import { analyzeWithGemini, getGeminiTriggerReason } from "./lib/gemini-analysis.js";
import { analyzeWithGroq } from "./lib/groq-analysis.js";
import { analyzeHeaders } from "./lib/header-analysis.js";
import { parseEmailSource, type ParsedEmail } from "./lib/email-parser.js";
import { calculateTrustScore } from "./lib/trust-score.js";
import { getDomainIntelligence } from "./lib/domain-intelligence.js";
import { connectDatabase, getDatabaseStatus } from "./db.js";
import { ScanModel } from "./models/scan.js";
import { CampaignModel } from "./models/campaign.js";
import { MailboxConnectionModel } from "./models/mailbox-connection.js";
import { WebhookEventModel } from "./models/webhook-event.js";
import { writeAuditLog } from "./audit.js";
import {
  createMailboxOAuthState,
  exchangeMailboxCode,
  getMailboxAuthorizationUrl,
  readMailboxOAuthState,
  resolveMailboxProfile,
  revokeMailboxAccess,
  type MailboxProvider,
} from "./lib/mailbox-oauth.js";
import { encryptValue } from "./lib/encryption.js";
import { listRecentMailboxMessages } from "./lib/mailbox-sync.js";
import { fetchMailboxMessageSource } from "./lib/mailbox-message.js";
import { refreshMailboxTokensIfNeeded } from "./lib/mailbox-token.js";
import { normalizeGmailPayload, resolveWebhookMessageIds } from "./lib/mailbox-webhook.js";
import { scanMailboxMessage } from "./lib/mailbox-scan.js";
import { createMailboxSubscription, deleteMailboxSubscription } from "./lib/mailbox-subscriptions.js";
import { assertFreePlanMailboxAvailable, assertFreePlanScanAvailable, getFreePlanUsage, PlanLimitError } from "./lib/plan.js";
import { createSecurityAlert } from "./alerts.js";
import { AlertModel } from "./models/alert.js";

const allowedOrigin = process.env.ALLOWED_ORIGIN ?? "http://localhost:3000";
const webhookSecret = process.env.MAILBOX_WEBHOOK_SECRET?.trim();
const hasClerkConfiguration = Boolean(
  process.env.CLERK_PUBLISHABLE_KEY && process.env.CLERK_SECRET_KEY,
);

export const app = express();

async function ensureMailboxTokens(
  connectionId: string,
  provider: MailboxProvider,
  encryptedTokens: string,
): Promise<string> {
  const refreshed = await refreshMailboxTokensIfNeeded(provider, encryptedTokens);
  if (refreshed.encryptedTokens !== encryptedTokens) {
    await MailboxConnectionModel.updateOne(
      { _id: connectionId, provider, status: "active" },
      { $set: { encryptedTokens: refreshed.encryptedTokens, status: "active" } },
    );
  }
  return refreshed.encryptedTokens;
}

app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: "10mb" }));
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  skip: (request) => request.path === "/api/health",
}));
const clerk = hasClerkConfiguration ? clerkMiddleware() : null;
app.use((request, response, next) => {
  if (
    request.path === "/api/health" ||
    request.path === "/api/mailboxes/oauth/callback" ||
    request.path.startsWith("/api/webhooks/mailboxes")
  ) {
    next();
    return;
  }
  if (!clerk) {
    response.status(503).json({ error: "Clerk authentication is not configured." });
    return;
  }
  clerk(request, response, next);
});

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "mailshield-backend",
    database: getDatabaseStatus(),
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/webhooks/mailboxes/microsoft", (request, response) => {
    const validationToken = typeof request.query.validationToken === "string"
      ? request.query.validationToken
      : null;
    if (!validationToken) {
      response.status(400).send("Missing validationToken.");
      return;
    }
    response.type("text/plain").send(validationToken);
});

app.post("/api/webhooks/mailboxes/:provider", async (request, response) => {
    if (!webhookSecret || request.header("x-mailshield-webhook-secret") !== webhookSecret) {
      response.status(401).json({ error: "Invalid webhook credentials." });
      return;
    }

    const provider = request.params.provider;
    if (provider !== "gmail" && provider !== "outlook") {
      response.status(400).json({ error: "Provider must be gmail or outlook." });
      return;
    }

    try {
      await connectDatabase();
      const eventBody = request.body && typeof request.body === "object" ? request.body : {};
    if (provider === "outlook") {
      const notifications = Array.isArray((eventBody as { value?: unknown }).value)
        ? (eventBody as { value: unknown[] }).value
        : [];
      const validNotification = notifications.some((notification) => {
        if (!notification || typeof notification !== "object") return false;
        const subscriptionId = (notification as { subscriptionId?: unknown }).subscriptionId;
        const clientState = (notification as { clientState?: unknown }).clientState;
        return typeof subscriptionId === "string" && typeof clientState === "string";
      });
      if (!validNotification) {
        response.status(400).json({ error: "Microsoft webhook payload has no valid notification." });
        return;
      }
      const subscriptionIds = notifications
        .filter((notification): notification is Record<string, unknown> => Boolean(notification && typeof notification === "object"))
        .map((notification) => notification.subscriptionId)
        .filter((subscriptionId): subscriptionId is string => typeof subscriptionId === "string");
      const validSubscription = await MailboxConnectionModel.exists({
        provider: "outlook",
        status: "active",
        subscriptionId: { $in: subscriptionIds },
        subscriptionClientState: {
          $in: notifications
            .map((notification) => notification && typeof notification === "object"
              ? (notification as { clientState?: unknown }).clientState
              : null)
            .filter((clientState): clientState is string => typeof clientState === "string"),
        },
      });
      if (!validSubscription) {
        response.status(401).json({ error: "Microsoft webhook client state is invalid." });
        return;
      }
    }
    const suppliedEventId = request.header("x-mailbox-event-id")?.trim();
      const eventKey = suppliedEventId
        ? `${provider}:${suppliedEventId}`
        : `${provider}:${crypto.createHash("sha256").update(JSON.stringify(eventBody)).digest("hex")}`;
      const existingEvent = await WebhookEventModel.findOne({ eventKey }).lean();
      if (existingEvent) {
        response.status(202).json({
          accepted: true,
          duplicate: true,
          eventId: String((existingEvent as { _id: unknown })._id),
        });
        return;
      }

      const resourceId = typeof eventBody.resource === "string"
        ? eventBody.resource
        : typeof eventBody.historyId === "string"
          ? eventBody.historyId
          : null;
      const event = {
        provider,
        receivedAt: new Date().toISOString(),
        notificationCount: Array.isArray(eventBody.value)
          ? eventBody.value.length
          : 1,
      };
      const savedEvent = await WebhookEventModel.create({
        provider,
        eventKey,
        resourceId,
        payload: eventBody,
        status: "accepted",
      });
      await writeAuditLog({
        actorId: `webhook:${provider}`,
        action: "mailbox.webhook_received",
        targetId: savedEvent._id.toString(),
        targetType: "mailbox_webhook",
        ipAddress: request.ip,
      });
    response.status(202).json({
      accepted: true,
      duplicate: false,
      eventId: savedEvent._id.toString(),
      event,
    });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to accept mailbox webhook.";
      response.status(503).json({ error: message });
    }
});

function hasWebhookSecret(request: express.Request): boolean {
  return Boolean(webhookSecret && request.header("x-mailshield-webhook-secret") === webhookSecret);
}

app.get("/api/internal/mailbox-webhooks/pending", async (request, response) => {
  if (!hasWebhookSecret(request)) {
    response.status(401).json({ error: "Invalid webhook credentials." });
    return;
  }

  try {
    await connectDatabase();
    const events = await WebhookEventModel.find({
      $or: [
        { status: "accepted" },
        { status: "processing", claimedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
      ],
    })
      .sort({ receivedAt: 1 })
      .limit(25)
      .lean();
    response.json({ events });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load pending webhook events.";
    response.status(503).json({ error: message });
  }
});

app.post("/api/internal/mailbox-webhooks/:id/claim", async (request, response) => {
  if (!hasWebhookSecret(request)) {
    response.status(401).json({ error: "Invalid webhook credentials." });
    return;
  }

  const workerId = typeof request.body?.workerId === "string" && request.body.workerId.trim()
    ? request.body.workerId.trim().slice(0, 200)
    : "";
  if (!workerId) {
    response.status(400).json({ error: "workerId is required." });
    return;
  }
  if (!mongoose.isValidObjectId(request.params.id)) {
    response.status(400).json({ error: "Invalid webhook event ID." });
    return;
  }

  try {
    await connectDatabase();
    const event = await WebhookEventModel.findOneAndUpdate(
      {
        _id: request.params.id,
        $or: [
          { status: "accepted" },
          { status: "processing", claimedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
        ],
      },
      {
        $set: {
          status: "processing",
          claimedAt: new Date(),
          claimedBy: workerId,
        },
      },
      { new: true },
    ).lean();

    if (!event) {
      response.status(409).json({ error: "Webhook event is already claimed or completed." });
      return;
    }
    response.json({ event });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to claim webhook event.";
    response.status(503).json({ error: message });
  }
});

app.post("/api/internal/mailbox-webhooks/:id/complete", async (request, response) => {
  if (!hasWebhookSecret(request)) {
    response.status(401).json({ error: "Invalid webhook credentials." });
    return;
  }

  const status = request.body?.status;
  if (status !== "processed" && status !== "failed") {
    response.status(400).json({ error: "status must be processed or failed." });
    return;
  }
  if (!mongoose.isValidObjectId(request.params.id)) {
    response.status(400).json({ error: "Invalid webhook event ID." });
    return;
  }

  try {
    await connectDatabase();
    const event = await WebhookEventModel.findOneAndUpdate(
      { _id: request.params.id, status: "processing" },
      {
        $set: {
          status,
          processedAt: new Date(),
          errorMessage: status === "failed" && typeof request.body?.errorMessage === "string"
            ? request.body.errorMessage.slice(0, 1000)
            : null,
        },
      },
      { new: true },
    ).lean();

    if (!event) {
      response.status(404).json({ error: "Pending webhook event not found." });
      return;
    }

    await writeAuditLog({
      actorId: "webhook-worker",
      action: `mailbox.webhook_${status}`,
      targetId: request.params.id,
      targetType: "mailbox_webhook",
      ipAddress: request.ip,
    });

    response.json({ event });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to complete webhook event.";
    response.status(503).json({ error: message });
  }
});

app.post("/api/internal/mailbox-webhooks/:id/process", async (request, response) => {
  if (!hasWebhookSecret(request)) {
    response.status(401).json({ error: "Invalid webhook credentials." });
    return;
  }
  if (!mongoose.isValidObjectId(request.params.id)) {
    response.status(400).json({ error: "Invalid webhook event ID." });
    return;
  }

  const workerId = typeof request.body?.workerId === "string" && request.body.workerId.trim()
    ? request.body.workerId.trim().slice(0, 200)
    : "mailbox-worker";

  try {
    await connectDatabase();
    const event = await WebhookEventModel.findOneAndUpdate(
      {
        _id: request.params.id,
        $or: [
          { status: "accepted" },
          { status: "processing", claimedAt: { $lt: new Date(Date.now() - 5 * 60 * 1000) } },
        ],
      },
      { $set: { status: "processing", claimedAt: new Date(), claimedBy: workerId } },
      { new: true },
    ).lean() as unknown as {
      _id: unknown;
      provider: MailboxProvider;
      payload?: Record<string, unknown>;
    } | null;

    if (!event) {
      response.status(409).json({ error: "Webhook event is already claimed or completed." });
      return;
    }

    const payload = event.provider === "gmail"
      ? normalizeGmailPayload(event.payload ?? {})
      : event.payload ?? {};
    const connections = await MailboxConnectionModel.find({
      provider: event.provider,
      status: "active",
    }).select("+encryptedTokens +subscriptionClientState").lean() as unknown as Array<{
      _id: unknown;
      userId: string;
      orgId: string;
      provider: MailboxProvider;
      accountEmail: string;
      providerAccountId: string;
      encryptedTokens?: string;
      subscriptionId?: string | null;
      subscriptionClientState?: string | null;
    }>;
    const connection = connections.find((candidate) => {
      if (event.provider === "gmail") {
        return typeof payload.emailAddress === "string"
          && candidate.accountEmail.toLowerCase() === payload.emailAddress.toLowerCase();
      }
      const resources = Array.isArray(payload.value) ? payload.value : [payload];
      return resources.some((resource) => resource && typeof resource === "object"
        && typeof (resource as { subscriptionId?: unknown }).subscriptionId === "string"
        && (resource as { subscriptionId: string }).subscriptionId === candidate.subscriptionId
        && (typeof candidate.subscriptionClientState !== "string"
          || (resource as { clientState?: unknown }).clientState === candidate.subscriptionClientState));
    });
    if (!connection?.encryptedTokens) {
      throw new Error("No active mailbox connection matched the webhook notification.");
    }

    const encryptedTokens = await ensureMailboxTokens(
      String(connection._id),
      connection.provider,
      connection.encryptedTokens,
    );
    const tokenPayload = JSON.parse(decryptValue(encryptedTokens)) as Record<string, unknown>;
    const accessToken = tokenPayload.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("Mailbox connection has no usable access token.");
    }
    const messageIds = await resolveWebhookMessageIds(event.provider, payload, accessToken);
    const scanIds: string[] = [];
    for (const providerMessageId of messageIds.slice(0, 10)) {
      scanIds.push(await scanMailboxMessage({
        provider: connection.provider,
        encryptedTokens,
        providerMessageId,
        userId: connection.userId,
        orgId: connection.orgId,
        mailboxConnectionId: String(connection._id),
        ipAddress: request.ip,
      }));
    }

    await WebhookEventModel.updateOne(
      { _id: event._id, status: "processing" },
      { $set: { status: "processed", processedAt: new Date(), errorMessage: null } },
    );
    await writeAuditLog({
      actorId: workerId,
      action: "mailbox.webhook_processed",
      targetId: String(event._id),
      targetType: "mailbox_webhook",
      ipAddress: request.ip,
    });
    response.json({ processed: true, messageCount: messageIds.length, scanIds });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to process mailbox webhook.";
    await WebhookEventModel.updateOne(
      { _id: request.params.id, status: "processing" },
      { $set: { status: "failed", processedAt: new Date(), errorMessage: message.slice(0, 1000) } },
    );
    response.status(502).json({ error: message });
  }
});

app.get("/api/auth/me", (request, response) => {
  const { userId, sessionId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  response.json({ userId, sessionId });
});

app.get("/api/account/plan", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await connectDatabase();
    response.json(await getFreePlanUsage(orgId ?? "personal"));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load plan usage.";
    response.status(503).json({ error: message });
  }
});

app.get("/api/alerts", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsedLimit = Number.parseInt(String(request.query.limit ?? "25"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 25;
  try {
    await connectDatabase();
    const filter = { orgId: orgId ?? "personal", userId };
    const [alerts, openCount] = await Promise.all([
      AlertModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean(),
      AlertModel.countDocuments({ ...filter, status: "open" }),
    ]);
    response.json({ alerts, openCount });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load security alerts.";
    response.status(503).json({ error: message });
  }
});

app.post("/api/alerts/:id/:action", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  if (request.params.action !== "acknowledge" && request.params.action !== "resolve") {
    response.status(400).json({ error: "Action must be acknowledge or resolve." });
    return;
  }
  if (!mongoose.isValidObjectId(request.params.id)) {
    response.status(400).json({ error: "Invalid alert ID." });
    return;
  }

  try {
    await connectDatabase();
    const status = request.params.action === "acknowledge" ? "acknowledged" : "resolved";
    const now = new Date();
    const alert = await AlertModel.findOneAndUpdate(
      { _id: request.params.id, orgId: orgId ?? "personal", userId },
      {
        $set: {
          status,
          ...(status === "acknowledged" ? { acknowledgedAt: now } : { resolvedAt: now }),
        },
      },
      { new: true },
    ).lean();
    if (!alert) {
      response.status(404).json({ error: "Alert not found." });
      return;
    }
    await writeAuditLog({
      actorId: userId,
      action: `alert.${status}`,
      targetId: request.params.id,
      targetType: "security_alert",
      ipAddress: request.ip,
    });
    response.json({ alert });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to update security alert.";
    response.status(503).json({ error: message });
  }
});

app.post("/api/parse-email", async (request, response) => {
  const rawEmail = request.body?.rawEmail;
  if (typeof rawEmail !== "string" || rawEmail.trim().length === 0) {
    response.status(400).json({ error: "rawEmail must be a non-empty string." });
    return;
  }

  try {
    response.json({ email: await parseEmailSource(rawEmail) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to parse email.";
    response.status(400).json({ error: message });
  }
});

app.post("/api/analyze-email", async (request, response) => {
  const rawEmail = request.body?.rawEmail;
  if (typeof rawEmail !== "string" || rawEmail.trim().length === 0) {
    response.status(400).json({ error: "rawEmail must be a non-empty string." });
    return;
  }

  try {
    const parsedEmail = await parseEmailSource(rawEmail);
    const headerAnalysis = analyzeHeaders(parsedEmail);
    const geolocation = await geolocateIp(headerAnalysis.originIp);

    response.json({ parsedEmail, headerAnalysis, geolocation });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to analyze email.";
    response.status(400).json({ error: message });
  }
});

app.post("/api/analyze-content", async (request, response) => {
  const subject = typeof request.body?.subject === "string" ? request.body.subject : "";
  const rawBody = typeof request.body?.body === "string" ? request.body.body : typeof request.body?.text === "string" ? request.body.text : "";
  const senderEmail = typeof request.body?.senderEmail === "string" ? request.body.senderEmail : undefined;

  if (!subject.trim() && !rawBody.trim()) {
    response.status(400).json({ error: "Provide a non-empty subject or body." });
    return;
  }

  try {
    const groqAnalysis = await analyzeWithGroq({
      subject,
      body: rawBody,
      senderEmail,
    });

    response.json(groqAnalysis);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to analyze email content.";
    response.status(400).json({ error: message });
  }
});

app.post("/api/analyze-second-pass", async (request, response) => {
  const { subject, body, groqAnalysis, headerAnalysis } = request.body ?? {};

  if (!subject || !body || !groqAnalysis || !headerAnalysis) {
    response.status(400).json({ error: "Provide subject, body, groqAnalysis, and headerAnalysis." });
    return;
  }

  try {
    const reason = getGeminiTriggerReason(groqAnalysis, headerAnalysis.riskSignal);
    if (!reason) {
      response.json({ triggered: false, reason: "not_triggered", finalCategory: groqAnalysis.category, explanation: "No second-pass review was necessary." });
      return;
    }

    const geminiAnalysis = await analyzeWithGemini({
      subject,
      body,
      groq: groqAnalysis,
      headerAnalysis,
      reason,
    });

    response.json(geminiAnalysis);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to run second-pass analysis.";
    response.status(400).json({ error: message });
  }
});

app.post("/api/trust-score", async (request, response) => {
  const { headerAnalysis, geolocation, groqAnalysis, geminiAnalysis, domainIntelligence } = request.body ?? {};

  if (!headerAnalysis || !geolocation || !groqAnalysis) {
    response.status(400).json({ error: "Provide headerAnalysis, geolocation, and groqAnalysis." });
    return;
  }

  try {
    const result = calculateTrustScore({
      headerAnalysis,
      geolocation,
      groqAnalysis,
      geminiAnalysis,
      domainIntelligence,
    });

    response.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to calculate trust score.";
    response.status(400).json({ error: message });
  }
});

const MAX_EMAIL_BYTES = 10 * 1024 * 1024;

function senderDomainFromEmail(senderEmail: string): string {
  return senderEmail.split("@").pop()?.trim().toLowerCase() || "unknown.invalid";
}

function linkDomainsFromEmail(parsedEmail: ParsedEmail): string[] {
  return [...new Set(parsedEmail.links.flatMap((link) => {
    try {
      const hostname = new URL(link).hostname.toLowerCase();
      return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
    } catch {
      return [];
    }
  }))];
}

function campaignRiskLevel(riskLabel: string): "low" | "medium" | "high" {
  return riskLabel === "Safe" ? "low" : riskLabel === "Suspicious" ? "medium" : "high";
}

async function getParsedEmail(request: express.Request): Promise<ParsedEmail> {
  const rawEmail = request.body?.rawEmail;
  if (typeof rawEmail !== "string") {
    throw new Error("Provide rawEmail as a string.");
  }
  if (Buffer.byteLength(rawEmail, "utf8") > MAX_EMAIL_BYTES) {
    throw new Error("The raw email must be smaller than 10 MB.");
  }
  return parseEmailSource(rawEmail);
}

app.post("/api/scan", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await connectDatabase();
    await assertFreePlanScanAvailable(orgId ?? "personal");
    const parsedEmail = await getParsedEmail(request);
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

    const rawEmail = request.body?.rawEmail as string;
    const organizationId = orgId ?? "personal";
    const linkedDomains = [senderDomain, ...linkDomainsFromEmail(parsedEmail)];
    const linkedIps = headerAnalysis.originIp ? [headerAnalysis.originIp] : [];
    const campaignKey = crypto
      .createHash("sha256")
      .update(JSON.stringify({
        senderDomain,
        originIp: headerAnalysis.originIp,
        linkedDomains: [...linkedDomains].sort(),
      }))
      .digest("hex");
    const savedScan = await ScanModel.create({
      orgId: organizationId,
      userId,
      source: "manual",
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
      attribution: { source: "backend" },
      trustScore: trustScore.trustScore,
      riskLabel: trustScore.riskLabel,
      reasons: trustScore.reasons,
      alertSent: false,
    });
    const campaign = await CampaignModel.findOneAndUpdate(
      { orgId: organizationId, campaignKey },
      {
        $set: {
          name: `Campaign: ${senderDomain}`,
          lastSeen: new Date(),
          riskLevel: campaignRiskLevel(trustScore.riskLabel),
        },
        $setOnInsert: { firstSeen: new Date() },
        $addToSet: {
          linkedDomains: { $each: linkedDomains },
          linkedIps: { $each: linkedIps },
          scanIds: savedScan._id,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await ScanModel.updateOne(
      { _id: savedScan._id },
      { $set: { attribution: { source: "backend", campaignId: campaign?._id?.toString() ?? null } } },
    );
    await writeAuditLog({
      actorId: userId,
      action: "scan.created",
      targetId: savedScan._id.toString(),
      targetType: "scan",
      ipAddress: request.ip,
    });
    await createSecurityAlert({
      orgId: organizationId,
      userId,
      scanId: savedScan._id.toString(),
      riskLabel: trustScore.riskLabel,
      senderEmail,
      senderDomain,
      reasons: trustScore.reasons,
    });

    const createdAt = (savedScan as { createdAt?: Date }).createdAt ?? new Date();

    response.json({
      id: savedScan._id.toString(),
      parsedEmail,
      headerAnalysis,
      geolocation,
      groqAnalysis,
      geminiAnalysis,
      domainIntelligence,
      ...trustScore,
      createdAt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "The email scan failed.";
    response.status(error instanceof PlanLimitError ? error.statusCode : 502).json({ error: message, code: error instanceof PlanLimitError ? error.code : undefined });
  }
});

app.get("/api/scans", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsedLimit = Number.parseInt(String(request.query.limit ?? "25"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 25;
  const parsedOffset = Number.parseInt(String(request.query.offset ?? "0"), 10);
  const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
  const query = typeof request.query.q === "string" ? request.query.q.trim() : "";

  try {
    await connectDatabase();
    const scope = { userId, orgId: orgId ?? "personal" };
    const filter = query ? { ...scope, $text: { $search: query } } : scope;
    const [scans, total] = await Promise.all([
      ScanModel.find(filter)
        .sort({ createdAt: -1 })
        .skip(offset)
        .limit(limit)
        .lean(),
      ScanModel.countDocuments(filter),
    ]);

    await writeAuditLog({
      actorId: userId,
      action: "scan.listed",
      targetId: orgId ?? "personal",
      targetType: "scan_collection",
      ipAddress: request.ip,
    });
    response.json({
      scans: scans.map((scan) => {
        const record = scan as Record<string, unknown>;
        return {
          ...record,
          id: String(record._id),
          domainIntelligence: record.domainIntel ?? null,
          reasons: Array.isArray(record.reasons) ? record.reasons : [],
        };
      }),
      total,
      limit,
      offset,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load scan history.";
    response.status(500).json({ error: message });
  }
});

app.get("/api/scans/:id", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await connectDatabase();
    const scan = await ScanModel.findOne({
      _id: request.params.id,
      userId,
      orgId: orgId ?? "personal",
    }).lean();

    if (!scan) {
      response.status(404).json({ error: "Scan not found." });
      return;
    }

    await writeAuditLog({
      actorId: userId,
      action: "scan.viewed",
      targetId: request.params.id,
      targetType: "scan",
      ipAddress: request.ip,
    });
    const record = scan as Record<string, unknown>;
    response.json({
      scan: {
        ...record,
        id: String(record._id),
        domainIntelligence: record.domainIntel ?? null,
        reasons: Array.isArray(record.reasons) ? record.reasons : [],
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load scan.";
    response.status(404).json({ error: message });
  }
});

app.get("/api/campaigns", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsedLimit = Number.parseInt(String(request.query.limit ?? "25"), 10);
  const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 50) : 25;

  try {
    await connectDatabase();
    const campaigns = await CampaignModel.find({ orgId: orgId ?? "personal" })
      .sort({ lastSeen: -1 })
      .limit(limit)
      .lean();
    await writeAuditLog({
      actorId: userId,
      action: "campaign.listed",
      targetId: orgId ?? "personal",
      targetType: "campaign_collection",
      ipAddress: request.ip,
    });
    response.json({ campaigns });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load campaigns.";
    response.status(500).json({ error: message });
  }
});

app.get("/api/mailboxes", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await connectDatabase();
    const connections = await MailboxConnectionModel.find({
      userId,
      orgId: orgId ?? "personal",
    })
      .select("-encryptedTokens")
      .sort({ createdAt: -1 })
      .lean();

    await writeAuditLog({
      actorId: userId,
      action: "mailbox.listed",
      targetId: orgId ?? "personal",
      targetType: "mailbox_collection",
      ipAddress: request.ip,
    });

    response.json({ connections });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to load mailbox connections.";
    response.status(500).json({ error: message });
  }
});

app.get("/api/mailboxes/:provider/authorize", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }
  const provider = request.params.provider as MailboxProvider;
  if (provider !== "gmail" && provider !== "outlook") {
    response.status(400).json({ error: "Provider must be gmail or outlook." });
    return;
  }

  try {
    await connectDatabase();
    await assertFreePlanMailboxAvailable(orgId ?? "personal");
    const state = createMailboxOAuthState({
      provider,
      userId,
      orgId: orgId ?? "personal",
    });
    response.json({ authorizationUrl: getMailboxAuthorizationUrl(provider, state) });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to start mailbox authorization.";
    response.status(error instanceof PlanLimitError ? error.statusCode : 503).json({ error: message, code: error instanceof PlanLimitError ? error.code : undefined });
  }
});

app.get("/api/mailboxes/oauth/callback", async (request, response) => {
  const code = typeof request.query.code === "string" ? request.query.code : "";
  const stateValue = typeof request.query.state === "string" ? request.query.state : "";
  if (!code || !stateValue) {
    response.status(400).json({ error: "OAuth callback requires code and state." });
    return;
  }

  try {
    const state = readMailboxOAuthState(stateValue);
    const tokens = await exchangeMailboxCode(state.provider, code);
    const profile = await resolveMailboxProfile(state.provider, tokens);
    const normalizedTokens = {
      ...tokens,
      ...(typeof tokens.expires_in === "number"
        ? { expires_at: Date.now() + tokens.expires_in * 1000 }
        : {}),
    };
    await connectDatabase();
    const connection = await MailboxConnectionModel.findOneAndUpdate(
      {
        orgId: state.orgId,
        provider: state.provider,
        providerAccountId: profile.providerAccountId,
      },
      {
        orgId: state.orgId,
        userId: state.userId,
        provider: state.provider,
        providerAccountId: profile.providerAccountId,
        accountEmail: profile.accountEmail,
        encryptedTokens: encryptValue(JSON.stringify(normalizedTokens)),
        status: "active",
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await writeAuditLog({
      actorId: state.userId,
      action: "mailbox.connected",
      targetId: connection._id.toString(),
      targetType: "mailbox_connection",
    });
    response.json({ connected: true, connectionId: connection._id.toString() });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Mailbox authorization failed.";
    response.status(400).json({ error: message });
  }
});

app.post("/api/mailboxes/:id/revoke", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await connectDatabase();
    const connection = await MailboxConnectionModel.findOne({
      _id: request.params.id,
      userId,
      orgId: orgId ?? "personal",
    })
      .select("+encryptedTokens")
      .lean() as {
        _id: unknown;
        provider: MailboxProvider;
        encryptedTokens?: string;
        subscriptionId?: string | null;
      } | null;

    if (!connection) {
      response.status(404).json({ error: "Mailbox connection not found." });
      return;
    }

    const encryptedTokens = connection.encryptedTokens;
    if (typeof encryptedTokens === "string") {
      const tokens = JSON.parse(decryptValue(encryptedTokens)) as Record<string, unknown>;
      const accessToken = tokens.access_token;
      if (typeof accessToken === "string" && accessToken) {
        await deleteMailboxSubscription(
          connection.provider as MailboxProvider,
          accessToken,
          typeof connection.subscriptionId === "string" ? connection.subscriptionId : null,
        );
        await revokeMailboxAccess(connection.provider as MailboxProvider, accessToken);
      }
    }

    const revokedConnection = await MailboxConnectionModel.findOneAndUpdate(
      { _id: connection._id, userId, orgId: orgId ?? "personal" },
      { $set: { status: "revoked", watchExpiry: null } },
      { new: true },
    )
      .select("-encryptedTokens")
      .lean();

    await writeAuditLog({
      actorId: userId,
      action: "mailbox.revoked",
      targetId: request.params.id,
      targetType: "mailbox_connection",
      ipAddress: request.ip,
    });

    response.json({ connection: revokedConnection });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to revoke mailbox connection.";
    response.status(400).json({ error: message });
  }
});

app.post("/api/mailboxes/:id/subscribe", async (request, response) => {
  const { userId, orgId } = getAuth(request);
  if (!userId) {
    response.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    await connectDatabase();
    const connection = await MailboxConnectionModel.findOne({
      _id: request.params.id,
      userId,
      orgId: orgId ?? "personal",
      status: "active",
    }).select("+encryptedTokens").lean() as unknown as {
      _id: unknown;
      provider: MailboxProvider;
      encryptedTokens?: string;
      subscriptionId?: string | null;
    } | null;
    if (!connection?.encryptedTokens) {
      response.status(404).json({ error: "Active mailbox connection with tokens not found." });
      return;
    }

    const encryptedTokens = await ensureMailboxTokens(
      String(connection._id),
      connection.provider,
      connection.encryptedTokens,
    );
    const tokens = JSON.parse(decryptValue(encryptedTokens)) as Record<string, unknown>;
    const accessToken = tokens.access_token;
    if (typeof accessToken !== "string" || !accessToken) {
      throw new Error("Mailbox connection has no usable access token.");
    }
    if (connection.subscriptionId) {
      await deleteMailboxSubscription(connection.provider, accessToken, connection.subscriptionId);
    }
    const subscription = await createMailboxSubscription(connection.provider, accessToken);
    await MailboxConnectionModel.updateOne(
      { _id: connection._id },
      {
        $set: {
          subscriptionId: subscription.subscriptionId,
          subscriptionResource: subscription.resource,
          subscriptionClientState: subscription.clientState ?? null,
          subscriptionExpiresAt: subscription.expiresAt,
          watchExpiry: subscription.expiresAt,
          lastWebhookHistoryId: subscription.historyId ?? null,
        },
      },
    );
    await writeAuditLog({
      actorId: userId,
      action: "mailbox.subscription_created",
      targetId: String(connection._id),
      targetType: "mailbox_connection",
      ipAddress: request.ip,
    });
    response.json({
      connectionId: String(connection._id),
      provider: connection.provider,
      subscriptionId: subscription.subscriptionId,
      expiresAt: subscription.expiresAt,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to subscribe mailbox.";
    response.status(502).json({ error: message });
  }
});

app.post("/api/internal/mailbox-subscriptions/renew", async (request, response) => {
  if (!hasWebhookSecret(request)) {
    response.status(401).json({ error: "Invalid webhook credentials." });
    return;
  }

  try {
    await connectDatabase();
    const renewalWindow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const connections = await MailboxConnectionModel.find({
      status: "active",
      subscriptionId: { $ne: null },
      subscriptionExpiresAt: { $lte: renewalWindow },
    })
      .select("+encryptedTokens")
      .limit(50)
      .lean() as unknown as Array<{
        _id: unknown;
        userId: string;
        provider: MailboxProvider;
        encryptedTokens?: string;
        subscriptionId?: string | null;
      }>;
    const renewed: string[] = [];
    const failed: Array<{ connectionId: string; error: string }> = [];

    for (const connection of connections) {
      try {
        if (!connection.encryptedTokens) throw new Error("Mailbox connection has no encrypted token payload.");
        const encryptedTokens = await ensureMailboxTokens(
          String(connection._id),
          connection.provider,
          connection.encryptedTokens,
        );
        const tokens = JSON.parse(decryptValue(encryptedTokens)) as Record<string, unknown>;
        if (typeof tokens.access_token !== "string" || !tokens.access_token) {
          throw new Error("Mailbox connection has no usable access token.");
        }
        await deleteMailboxSubscription(connection.provider, tokens.access_token, connection.subscriptionId ?? null);
        const subscription = await createMailboxSubscription(connection.provider, tokens.access_token);
        await MailboxConnectionModel.updateOne(
          { _id: connection._id, status: "active" },
          {
            $set: {
              subscriptionId: subscription.subscriptionId,
              subscriptionResource: subscription.resource,
              subscriptionClientState: subscription.clientState ?? null,
              subscriptionExpiresAt: subscription.expiresAt,
              watchExpiry: subscription.expiresAt,
              lastWebhookHistoryId: subscription.historyId ?? null,
            },
          },
        );
        renewed.push(String(connection._id));
      } catch (error: unknown) {
        failed.push({
          connectionId: String(connection._id),
          error: error instanceof Error ? error.message : "Unable to renew subscription.",
        });
      }
    }

    await writeAuditLog({
      actorId: "mailbox-subscription-worker",
      action: "mailbox.subscriptions_renewed",
      targetId: String(renewed.length),
      targetType: "mailbox_subscription_batch",
    });
    response.json({ renewed, failed });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unable to renew mailbox subscriptions.";
    response.status(503).json({ error: message });
  }
});

app.post("/api/mailboxes/:id/sync", async (request, response) => {
      const { userId, orgId } = getAuth(request);
      if (!userId) {
        response.status(401).json({ error: "Unauthorized" });
        return;
      }

      try {
        await connectDatabase();
        const connection = await MailboxConnectionModel.findOne({
          _id: request.params.id,
          userId,
          orgId: orgId ?? "personal",
          status: "active",
        })
          .select("+encryptedTokens")
          .lean() as { _id: unknown; provider: "gmail" | "outlook"; encryptedTokens?: string } | null;

        if (!connection) {
          response.status(404).json({ error: "Active mailbox connection not found." });
          return;
        }
        if (!connection.encryptedTokens) {
          response.status(409).json({ error: "Mailbox connection has no encrypted token payload." });
          return;
        }

        const encryptedTokens = await ensureMailboxTokens(
          String(connection._id),
          connection.provider,
          connection.encryptedTokens,
        );
        const messages = await listRecentMailboxMessages(connection.provider, encryptedTokens);
        await MailboxConnectionModel.updateOne(
          { _id: request.params.id },
          { $set: { lastSyncedAt: new Date() } },
        );
        await writeAuditLog({
          actorId: userId,
          action: "mailbox.synced",
          targetId: request.params.id,
          targetType: "mailbox_connection",
          ipAddress: request.ip,
        });

        response.json({ connectionId: String(connection._id), count: messages.length, messages });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unable to sync mailbox.";
        response.status(502).json({ error: message });
      }
    });

app.post("/api/mailboxes/:id/message-preview", async (request, response) => {
          const { userId, orgId } = getAuth(request);
          if (!userId) {
            response.status(401).json({ error: "Unauthorized" });
            return;
          }
          const providerMessageId = typeof request.body?.providerMessageId === "string"
            ? request.body.providerMessageId.trim()
            : "";
          if (!providerMessageId) {
            response.status(400).json({ error: "providerMessageId is required." });
            return;
          }

          try {
            await connectDatabase();
            const connection = await MailboxConnectionModel.findOne({
              _id: request.params.id,
              userId,
              orgId: orgId ?? "personal",
              status: "active",
            })
              .select("+encryptedTokens")
              .lean() as {
                _id: unknown;
                provider: "gmail" | "outlook";
                encryptedTokens?: string;
              } | null;

            if (!connection) {
              response.status(404).json({ error: "Active mailbox connection not found." });
              return;
            }
            if (!connection.encryptedTokens) {
              response.status(409).json({ error: "Mailbox connection has no encrypted token payload." });
              return;
            }

            const encryptedTokens = await ensureMailboxTokens(
              String(connection._id),
              connection.provider,
              connection.encryptedTokens,
            );
            const rawEmail = await fetchMailboxMessageSource(
              connection.provider,
              encryptedTokens,
              providerMessageId,
            );
            if (Buffer.byteLength(rawEmail, "utf8") > MAX_EMAIL_BYTES) {
              response.status(413).json({ error: "The provider message is larger than 10 MB." });
              return;
            }

            const parsedEmail = await parseEmailSource(rawEmail);
            await writeAuditLog({
              actorId: userId,
              action: "mailbox.message_previewed",
              targetId: request.params.id,
              targetType: "mailbox_connection",
              ipAddress: request.ip,
            });

            response.json({
              providerMessageId,
              parsedEmail,
            });
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : "Unable to retrieve provider message.";
            response.status(502).json({ error: message });
          }
        });

app.post("/api/mailboxes/:id/scan-message", async (request, response) => {
              const { userId, orgId } = getAuth(request);
              if (!userId) {
                response.status(401).json({ error: "Unauthorized" });
                return;
              }
              const providerMessageId = typeof request.body?.providerMessageId === "string"
                ? request.body.providerMessageId.trim()
                : "";
              if (!providerMessageId) {
                response.status(400).json({ error: "providerMessageId is required." });
                return;
              }

              try {
                await connectDatabase();
                const connection = await MailboxConnectionModel.findOne({
                  _id: request.params.id,
                  userId,
                  orgId: orgId ?? "personal",
                  status: "active",
                })
                  .select("+encryptedTokens")
                  .lean() as {
                    _id: unknown;
                    provider: "gmail" | "outlook";
                    encryptedTokens?: string;
                  } | null;

                if (!connection?.encryptedTokens) {
                  response.status(404).json({ error: "Active mailbox connection with tokens not found." });
                  return;
                }

                const encryptedTokens = await ensureMailboxTokens(
                  String(connection._id),
                  connection.provider,
                  connection.encryptedTokens,
                );
                const rawEmail = await fetchMailboxMessageSource(
                  connection.provider,
                  encryptedTokens,
                  providerMessageId,
                );
                if (Buffer.byteLength(rawEmail, "utf8") > MAX_EMAIL_BYTES) {
                  response.status(413).json({ error: "The provider message is larger than 10 MB." });
                  return;
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
                const organizationId = orgId ?? "personal";
                const linkedDomains = [senderDomain, ...linkDomainsFromEmail(parsedEmail)];
                const linkedIps = headerAnalysis.originIp ? [headerAnalysis.originIp] : [];
                const campaignKey = crypto.createHash("sha256").update(JSON.stringify({
                  senderDomain,
                  originIp: headerAnalysis.originIp,
                  linkedDomains: [...linkedDomains].sort(),
                })).digest("hex");
                const savedScan = await ScanModel.create({
                  orgId: organizationId,
                  userId,
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
                  attribution: { source: "mailbox", mailboxConnectionId: request.params.id, providerMessageId },
                  trustScore: trustScore.trustScore,
                  riskLabel: trustScore.riskLabel,
                  reasons: trustScore.reasons,
                  alertSent: false,
                });
                const campaign = await CampaignModel.findOneAndUpdate(
                  { orgId: organizationId, campaignKey },
                  {
                    $set: { name: `Campaign: ${senderDomain}`, lastSeen: new Date(), riskLevel: campaignRiskLevel(trustScore.riskLabel) },
                    $setOnInsert: { firstSeen: new Date() },
                    $addToSet: { linkedDomains: { $each: linkedDomains }, linkedIps: { $each: linkedIps }, scanIds: savedScan._id },
                  },
                  { upsert: true, new: true, setDefaultsOnInsert: true },
                );
                await ScanModel.updateOne(
                  { _id: savedScan._id },
                  { $set: { attribution: { source: "mailbox", mailboxConnectionId: request.params.id, providerMessageId, campaignId: campaign?._id?.toString() ?? null } } },
                );
                await writeAuditLog({
                  actorId: userId,
                  action: "mailbox.message_scanned",
                  targetId: savedScan._id.toString(),
                  targetType: "scan",
                  ipAddress: request.ip,
                });

                response.json({
                  id: savedScan._id.toString(),
                  parsedEmail,
                  headerAnalysis,
                  geolocation,
                  groqAnalysis,
                  geminiAnalysis,
                  domainIntelligence,
                  ...trustScore,
                  createdAt: (savedScan as { createdAt?: Date }).createdAt ?? new Date(),
                });
              } catch (error: unknown) {
                const message = error instanceof Error ? error.message : "Unable to scan provider message.";
                response.status(502).json({ error: message });
              }
            });

export default app;
