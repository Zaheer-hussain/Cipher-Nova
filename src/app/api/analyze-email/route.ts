import { auth } from "@clerk/nextjs/server";
import { analyzeHeaders } from "@/lib/header-analysis";
import { geolocateIp } from "@/lib/geolocation";
import { parseEmailSource, type ParsedEmail } from "@/lib/email-parser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json()) as { rawEmail?: unknown; parsedEmail?: unknown };
  let parsedEmail: ParsedEmail;

  if (typeof body.rawEmail === "string") {
    parsedEmail = await parseEmailSource(body.rawEmail);
  } else if (body.parsedEmail && typeof body.parsedEmail === "object") {
    parsedEmail = body.parsedEmail as ParsedEmail;
  } else {
    return Response.json({ error: "Provide rawEmail or parsedEmail." }, { status: 400 });
  }

  const headerAnalysis = analyzeHeaders(parsedEmail);
  const geolocation = await geolocateIp(headerAnalysis.originIp);

  return Response.json({ parsedEmail, headerAnalysis, geolocation });
}
