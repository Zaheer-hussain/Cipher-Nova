import { auth } from "@clerk/nextjs/server";
import { connectToDatabase } from "@/lib/mongodb";
import { ScanModel } from "@/models/scan";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get("limit") ?? "10") || 10));

  await connectToDatabase();
  const [scans, total] = await Promise.all([
    ScanModel.find({ userId })
      .select("senderEmail senderDomain originIp trustScore riskLabel createdAt")
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    ScanModel.countDocuments({ userId }),
  ]);

  return Response.json({
    scans: scans.map((scan) => ({ ...scan, id: scan._id.toString(), _id: undefined })),
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
