import { auth } from "@clerk/nextjs/server";
import { analyzeWithGemini, getGeminiTriggerReason } from "@/lib/gemini-analysis";
import type { GroqAnalysis } from "@/lib/groq-analysis";
import type { HeaderAnalysis } from "@/lib/header-analysis";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    subject?: unknown;
    text?: unknown;
    groqAnalysis?: unknown;
    headerAnalysis?: unknown;
  };

  if (
    typeof body.subject !== "string" ||
    typeof body.text !== "string" ||
    !body.groqAnalysis ||
    !body.headerAnalysis
  ) {
    return Response.json(
      { error: "Provide subject, text, groqAnalysis, and headerAnalysis." },
      { status: 400 },
    );
  }

  const groqAnalysis = body.groqAnalysis as GroqAnalysis;
  const headerAnalysis = body.headerAnalysis as HeaderAnalysis;
  const reason = getGeminiTriggerReason(groqAnalysis, headerAnalysis.riskSignal);

  if (!reason) {
    return Response.json({
      triggered: false,
      reason: "Groq confidence is sufficient and signals agree.",
      finalCategory: groqAnalysis.category,
      explanation: null,
    });
  }

  const analysis = await analyzeWithGemini({
    subject: body.subject,
    body: body.text,
    groq: groqAnalysis,
    headerAnalysis,
    reason,
  });

  return Response.json(analysis);
}
