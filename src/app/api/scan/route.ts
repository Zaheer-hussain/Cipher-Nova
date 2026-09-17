import { auth } from "@clerk/nextjs/server";
import { analyzeWithGemini, getGeminiTriggerReason } from "@/lib/gemini-analysis";
import { analyzeHeaders } from "@/lib/header-analysis";
import { parseEmailSource, type ParsedEmail } from "@/lib/email-parser";
import { geolocateIp } from "@/lib/geolocation";
import { analyzeWithGroq } from "@/lib/groq-analysis";
import { calculateTrustScore } from "@/lib/trust-score";
import { connectToDatabase } from "@/lib/mongodb";
import { getDomainIntelligence } from "@/lib/domain-intelligence";
import { ScanModel } from "@/models/scan";

export const runtime = "nodejs";
const MAX_EMAIL_BYTES = 10 * 1024 * 1024;

async function getParsedEmail(request: Request): Promise<ParsedEmail> {
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      throw new Error("Upload an .eml file in the file field.");
    }
    if (file.size > MAX_EMAIL_BYTES) {
      throw new Error("The .eml file must be smaller than 10 MB.");
    }
    return parseEmailSource(Buffer.from(await file.arrayBuffer()));
  }

  const body = (await request.json()) as { rawEmail?: unknown };
  if (typeof body.rawEmail !== "string") {
    throw new Error("Provide rawEmail as a string.");
  }
  if (Buffer.byteLength(body.rawEmail, "utf8") > MAX_EMAIL_BYTES) {
    throw new Error("The raw email must be smaller than 10 MB.");
  }
  return parseEmailSource(body.rawEmail);
}

function senderDomainFromEmail(senderEmail: string): string {
  return senderEmail.split("@").pop()?.trim().toLowerCase() || "unknown.invalid";
}

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  try {
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

    await connectToDatabase();
    const savedScan = await ScanModel.create({
      userId,
      senderEmail,
      senderDomain,
      originIp: headerAnalysis.originIp,
      geolocation,
      authResults: headerAnalysis.authResults,
      groqAnalysis,
      geminiAnalysis,
      domainIntelligence,
      trustScore: trustScore.trustScore,
      riskLabel: trustScore.riskLabel,
      reasons: trustScore.reasons,
    });

    return Response.json({
      id: savedScan._id.toString(),
      parsedEmail,
      headerAnalysis,
      geolocation,
      groqAnalysis,
      geminiAnalysis,
      domainIntelligence,
      ...trustScore,
      createdAt: savedScan.createdAt,
    });
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "The email scan failed.",
      },
      { status: 502 },
    );
  }
}
