import { getAnalysisById } from "./db";
import { runReport } from "./pipeline";
import type { AnalysisResult, DashboardReport } from "./types";
import type { CompetitorProfile } from "./gatherReviews";

export async function generateReportForAnalysis(
  id: string
): Promise<{ companyName: string; direction: string; report: DashboardReport } | null> {
  const analysis = await getAnalysisById(id);

  if (!analysis || !analysis.result_json) return null;

  const result: AnalysisResult = JSON.parse(analysis.result_json);
  const competitors: CompetitorProfile[] = analysis.competitor_context
    ? JSON.parse(analysis.competitor_context)
    : [];

  const report = await runReport(
    analysis.company_name,
    analysis.direction as "competitor" | "own",
    result,
    competitors,
    analysis.financial_context ?? ""
  );
  report.summary = result.summary;

  return { companyName: analysis.company_name, direction: analysis.direction, report };
}
