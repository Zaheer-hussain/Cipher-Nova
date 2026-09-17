import { auth } from "@clerk/nextjs/server";
import { parseEmailSource } from "@/lib/email-parser";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") ?? "";
  let source: string | Buffer;

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Upload an .eml file in the file field." }, { status: 400 });
    }

    source = Buffer.from(await file.arrayBuffer());
  } else {
    const body = (await request.json()) as { rawEmail?: unknown };
    if (typeof body.rawEmail !== "string") {
      return Response.json({ error: "Provide rawEmail as a string." }, { status: 400 });
    }

    source = body.rawEmail;
  }

  const parsedEmail = await parseEmailSource(source);
  return Response.json(parsedEmail);
}
