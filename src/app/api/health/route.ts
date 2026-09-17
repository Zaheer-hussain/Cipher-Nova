export const runtime = "nodejs";

export async function GET() {
  return Response.json({
    status: "ok",
    service: "mailguard",
    timestamp: new Date().toISOString(),
  });
}
