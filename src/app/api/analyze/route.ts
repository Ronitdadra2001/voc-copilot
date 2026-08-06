import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { insertAnalysis } from "@/lib/db";
import { runAnalysis } from "@/lib/pipeline";
import type { CompetitorProfile } from "@/lib/gatherReviews";

const DIRECTION = "competitor" as const;

export async function POST(req: NextRequest) {
  try {
    const { companyName, rawReviews, competitors, ownFinancialContext, userQuestion } =
      (await req.json()) as {
        companyName?: string;
        rawReviews?: string;
        competitors?: CompetitorProfile[];
        ownFinancialContext?: string;
        userQuestion?: string;
      };

    if (!companyName?.trim() || !rawReviews?.trim()) {
      return NextResponse.json(
        { error: "companyName and rawReviews are required" },
        { status: 400 }
      );
    }

    const result = await runAnalysis(companyName, DIRECTION, rawReviews, userQuestion);

    const id = randomUUID();
    await insertAnalysis({
      id,
      company_name: companyName,
      direction: DIRECTION,
      raw_reviews: rawReviews,
      competitor_context:
        competitors && competitors.length > 0 ? JSON.stringify(competitors) : null,
      financial_context: ownFinancialContext ?? null,
      result_json: JSON.stringify(result),
    });

    return NextResponse.json({ id, result });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Analysis failed" },
      { status: 500 }
    );
  }
}
