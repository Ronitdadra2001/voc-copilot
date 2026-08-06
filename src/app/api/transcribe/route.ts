import { NextRequest, NextResponse } from "next/server";
import { groq } from "@/lib/clients";
import { toFile } from "groq-sdk/uploads";

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("audio");

    if (!(file instanceof Blob)) {
      return NextResponse.json({ error: "audio file is required" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const uploadable = await toFile(buffer, "recording.webm");

    const transcription = await groq.audio.transcriptions.create({
      file: uploadable,
      model: "whisper-large-v3",
    });

    return NextResponse.json({ text: transcription.text });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Transcription failed" },
      { status: 500 }
    );
  }
}
