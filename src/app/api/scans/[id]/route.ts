import { auth } from "@clerk/nextjs/server";
import { connectToDatabase } from "@/lib/mongodb";
import { ScanModel } from "@/models/scan";
import mongoose from "mongoose";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { userId } = await auth();
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  if (!mongoose.isValidObjectId(id)) {
    return Response.json({ error: "Invalid scan ID." }, { status: 400 });
  }

  await connectToDatabase();
  const scan = await ScanModel.findOne({ _id: id, userId }).lean();
  if (!scan) return Response.json({ error: "Scan not found." }, { status: 404 });

  return Response.json({ ...scan, id: scan._id.toString(), _id: undefined });
}
