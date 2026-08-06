import { NextRequest, NextResponse } from "next/server";
import {
  autoGatherReviews,
  deriveCleanCompanyName,
  gatherCompetitorProfiles,
  gatherFinancialContext,
} from "@/lib/gatherReviews";

export async function POST(req: NextRequest) {
  try {
    const { companyOrLink, description } = (await req.json()) as {
      companyOrLink?: string;
      description?: string;
    };

    if (!companyOrLink?.trim()) {
      return NextResponse.json({ error: "companyOrLink is required" }, { status: 400 });
    }
    const desc = description ?? "";
    const cleanName = deriveCleanCompanyName(companyOrLink);

    // Run all independent searches in parallel for speed. Competitor/financial
    // search need the clean name ("Notion"), never the raw link — a URL
    // string never appears verbatim in the articles being searched.
    const [reviews, competitors, ownFinancial] = await Promise.all([
      autoGatherReviews(companyOrLink, desc),
      gatherCompetitorProfiles(cleanName, desc, 2),
      gatherFinancialContext(cleanName, desc),
    ]);

    if (!reviews.markdown.trim()) {
      return NextResponse.json(
        {
          error:
            "Couldn't find review content automatically. Try uploading a file or audio recording of feedback instead.",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      markdown: reviews.markdown,
      sourcesUsed: reviews.sourcesUsed,
      reviewCount: reviews.reviewCount,
      competitors,
      ownFinancialContext: ownFinancial.found ? ownFinancial.markdown : "",
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Auto-gather failed" },
      { status: 500 }
    );
  }
}
