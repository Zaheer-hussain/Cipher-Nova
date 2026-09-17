import { MailboxConnectionModel } from "../models/mailbox-connection.js";
import { ScanModel } from "../models/scan.js";

export const FREE_PLAN = {
  id: "free",
  name: "Free",
  monthlyScanLimit: 25,
  mailboxLimit: 1,
} as const;

export class PlanLimitError extends Error {
  readonly code = "PLAN_LIMIT_REACHED";
  readonly statusCode = 429;

  constructor(message: string) {
    super(message);
    this.name = "PlanLimitError";
  }
}

function monthStart(): Date {
  const date = new Date();
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

export async function getFreePlanUsage(orgId: string) {
  const [scanCount, mailboxCount] = await Promise.all([
    ScanModel.countDocuments({ orgId, createdAt: { $gte: monthStart() } }),
    MailboxConnectionModel.countDocuments({ orgId, status: { $ne: "revoked" } }),
  ]);
  return {
    plan: FREE_PLAN,
    usage: {
      scansThisMonth: scanCount,
      mailboxes: mailboxCount,
    },
    remaining: {
      scansThisMonth: Math.max(FREE_PLAN.monthlyScanLimit - scanCount, 0),
      mailboxes: Math.max(FREE_PLAN.mailboxLimit - mailboxCount, 0),
    },
  };
}

export async function assertFreePlanScanAvailable(orgId: string): Promise<void> {
  const scanCount = await ScanModel.countDocuments({ orgId, createdAt: { $gte: monthStart() } });
  if (scanCount >= FREE_PLAN.monthlyScanLimit) {
    throw new PlanLimitError(`The Free plan includes ${FREE_PLAN.monthlyScanLimit} scans per month. Upgrade to continue scanning.`);
  }
}

export async function assertFreePlanMailboxAvailable(orgId: string): Promise<void> {
  const mailboxCount = await MailboxConnectionModel.countDocuments({ orgId, status: { $ne: "revoked" } });
  if (mailboxCount >= FREE_PLAN.mailboxLimit) {
    throw new PlanLimitError(`The Free plan includes ${FREE_PLAN.mailboxLimit} connected mailbox. Upgrade to connect another.`);
  }
}
