import { NextRequest, NextResponse } from "next/server";
import { parseSpreadsheet } from "@/lib/parseSpreadsheet";

const MAX_SIZE_BYTES = 10 * 1024 * 1024;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "file is required" }, { status: 400 });
    }
    if (file.size > MAX_SIZE_BYTES) {
      return NextResponse.json({ error: "file exceeds 10MB limit" }, { status: 400 });
    }

    const filename = "name" in file ? (file as File).name : "upload";
    const buffer = Buffer.from(await file.arrayBuffer());
    const text = await parseSpreadsheet(buffer, filename);

    if (!text.trim()) {
      return NextResponse.json(
        { error: "No readable rows found in this file" },
        { status: 422 }
      );
    }

    return NextResponse.json({ text, filename });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload parsing failed" },
      { status: 500 }
    );
  }
}
