import type { Geolocation } from "./geolocation.js";
import type { GeminiAnalysis } from "./gemini-analysis.js";
import type { GroqAnalysis, GroqCategory } from "./groq-analysis.js";
import type { HeaderAnalysis } from "./header-analysis.js";

export type RiskLabel = "Safe" | "Suspicious" | "Likely Phishing" | "Confirmed Malicious";

export type TrustScoreResult = {
  trustScore: number;
  riskLabel: RiskLabel;
  reasons: string[];
  finalCategory: GroqCategory;
};

function addReason(reasons: string[], reason: string): void {
  if (!reasons.includes(reason)) reasons.push(reason);
}

function categoryIsMalicious(category: GroqCategory): boolean {
  return category === "phishing" || category === "BEC";
}

export function calculateTrustScore(input: {
  headerAnalysis: HeaderAnalysis;
  geolocation: Geolocation;
  groqAnalysis: GroqAnalysis;
  geminiAnalysis?: GeminiAnalysis | null;
  domainIntelligence?: { ageDays?: number | null } | null;
}): TrustScoreResult {
  let score = 60;
  const reasons: string[] = [];
  const { headerAnalysis, geolocation, groqAnalysis, geminiAnalysis, domainIntelligence } = input;
  const finalCategory = geminiAnalysis?.finalCategory ?? groqAnalysis.category;

  const authStatuses = Object.values(headerAnalysis.authResults);
  const authFailures = authStatuses.filter((status) => status === "fail").length;
  if (authFailures > 0) {
    score -= authFailures * 10;
    addReason(reasons, `${authFailures} email authentication check${authFailures === 1 ? "" : "s"} failed.`);
  } else if (authStatuses.every((status) => status === "pass")) {
    score += 20;
    addReason(reasons, "SPF, DKIM, and DMARC all passed.");
  }

  if (headerAnalysis.anomalies.some((anomaly) => anomaly.includes("Reply-To"))) {
    score -= 15;
    addReason(reasons, "Reply-To domain does not match the sender domain.");
  }
  if (headerAnalysis.anomalies.some((anomaly) => anomaly.includes("Return-Path"))) {
    score -= 10;
    addReason(reasons, "Return-Path domain does not match the sender domain.");
  }
  if (headerAnalysis.anomalies.some((anomaly) => anomaly.includes("Display name"))) {
    score -= 10;
    addReason(reasons, "Display name contains an email-like value.");
  }
  if (headerAnalysis.relayHops > 6) {
    score -= 10;
    addReason(reasons, "The email passed through an unusually high number of relays.");
  }

  if (groqAnalysis.impersonationDetected) {
    score -= 20;
    addReason(reasons, "AI detected possible sender impersonation.");
  }
  if (categoryIsMalicious(finalCategory)) {
    score -= 25;
    addReason(reasons, `AI classified the message as ${finalCategory}.`);
  } else if (finalCategory === "spam") {
    score -= 12;
    addReason(reasons, "AI classified the message as spam.");
  } else if (finalCategory === "legitimate" && groqAnalysis.confidence >= 0.8) {
    score += 10;
    addReason(reasons, "AI found the message likely legitimate with high confidence.");
  }

  if (geolocation.isProxy === true) {
    score -= 15;
    addReason(reasons, "Origin infrastructure is flagged as proxy or hosting.");
  }
  if (!headerAnalysis.originIp) {
    score -= 5;
    addReason(reasons, "No public origin IP could be established from the relay chain.");
  }

  if (domainIntelligence?.ageDays !== null && domainIntelligence?.ageDays !== undefined) {
    if (domainIntelligence.ageDays < 30) {
      score -= 15;
      addReason(reasons, "Sender domain was registered less than 30 days ago.");
    } else if (domainIntelligence.ageDays < 90) {
      score -= 8;
      addReason(reasons, "Sender domain was registered less than 90 days ago.");
    }
  }

  const trustScore = Math.max(0, Math.min(100, Math.round(score)));
  const riskLabel: RiskLabel =
    trustScore >= 75 ? "Safe" : trustScore >= 50 ? "Suspicious" : trustScore >= 25 ? "Likely Phishing" : "Confirmed Malicious";

  return {
    trustScore,
    riskLabel,
    reasons: reasons.length > 0 ? reasons : ["No significant risk signals were detected."],
    finalCategory,
  };
}
