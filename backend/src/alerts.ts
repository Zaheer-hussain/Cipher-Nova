import { AlertModel } from "./models/alert.js";

type AlertInput = {
  orgId: string;
  userId: string;
  scanId: string;
  riskLabel: string;
  senderEmail: string;
  senderDomain: string;
  reasons: string[];
};

function severityFor(riskLabel: string): "medium" | "high" | "critical" | null {
  if (riskLabel === "Confirmed Malicious") return "critical";
  if (riskLabel === "Likely Phishing") return "high";
  if (riskLabel === "Suspicious") return "medium";
  return null;
}

export async function createSecurityAlert(input: AlertInput): Promise<void> {
  const severity = severityFor(input.riskLabel);
  if (!severity) return;

  await AlertModel.updateOne(
    { scanId: input.scanId },
    {
      $setOnInsert: {
        orgId: input.orgId,
        userId: input.userId,
        scanId: input.scanId,
        severity,
        title: `${severity === "critical" ? "Critical" : "Suspicious"} email detected`,
        message: `${input.senderEmail} (${input.senderDomain}) was classified as ${input.riskLabel}. ${input.reasons.slice(0, 2).join(" ")}`,
        status: "open",
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}
