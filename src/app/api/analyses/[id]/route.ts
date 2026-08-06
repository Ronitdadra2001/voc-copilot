import { NextRequest, NextResponse } from "next/server";
import { getAnalysisById } from "@/lib/db";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const row = await getAnalysisById(id);

  if (!row) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({
    id: row.id,
    companyName: row.company_name,
    direction: row.direction,
    result: row.result_json ? JSON.parse(row.result_json) : null,
  });
}
