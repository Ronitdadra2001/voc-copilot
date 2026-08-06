import { NextRequest, NextResponse } from "next/server";
import { generateReportForAnalysis } from "@/lib/loadReportInputs";
import { generateDashboardPdf } from "@/lib/generatePdf";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await generateReportForAnalysis(id);
    if (!data) {
      return NextResponse.json({ error: "Analysis not found" }, { status: 404 });
    }

    const pdfBytes = await generateDashboardPdf(data.companyName, data.report);

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${data.companyName.replace(/[^a-z0-9]/gi, "_")}_voc_report.pdf"`,
      },
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "PDF generation failed" },
      { status: 500 }
    );
  }
}
