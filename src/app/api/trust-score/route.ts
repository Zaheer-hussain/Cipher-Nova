import { auth } from "@clerk/nextjs/server";
import { calculateTrustScore } from "@/lib/trust-score";
import type { GeminiAnalysis } from "@/lib/gemini-analysis";
import type { Geolocation } from "@/lib/geolocation";
import type { GroqAnalysis } from "@/lib/groq-analysis";
import type { HeaderAnalysis } from "@/lib/header-analysis";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    headerAnalysis?: unknown;
    geolocation?: unknown;
    groqAnalysis?: unknown;
    geminiAnalysis?: unknown;
  };

  if (!body.headerAnalysis || !body.geolocation || !body.groqAnalysis) {
    return Response.json(
      { error: "Provide headerAnalysis, geolocation, and groqAnalysis." },
      { status: 400 },
    );
  }

  const result = calculateTrustScore({
    headerAnalysis: body.headerAnalysis as HeaderAnalysis,
    geolocation: body.geolocation as Geolocation,
    groqAnalysis: body.groqAnalysis as GroqAnalysis,
    geminiAnalysis: (body.geminiAnalysis as GeminiAnalysis | null | undefined) ?? null,
  });

  return Response.json(result);
}
