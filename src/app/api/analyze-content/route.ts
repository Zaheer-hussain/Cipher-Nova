import { auth } from "@clerk/nextjs/server";
import { analyzeWithGroq } from "@/lib/groq-analysis";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    subject?: unknown;
    text?: unknown;
    senderEmail?: unknown;
  };

  if (typeof body.subject !== "string" || typeof body.text !== "string") {
    return Response.json({ error: "Provide subject and text as strings." }, { status: 400 });
  }

  const analysis = await analyzeWithGroq({
    subject: body.subject,
    body: body.text,
    senderEmail: typeof body.senderEmail === "string" ? body.senderEmail : undefined,
  });

  return Response.json(analysis);
}
