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

    // Reviews are gathered first since, for a direct Play/App Store URL, it
    // resolves the REAL app name (e.g. "Zomato") — a bare store URL/id is
    // never usable as the search subject for competitor/financial lookups,
    // and using it directly was confirmed to search for/attribute data to
    // "play.google.com" instead of the actual company.
    const reviews = await autoGatherReviews(companyOrLink, desc);
    const cleanName = reviews.resolvedCompanyName ?? deriveCleanCompanyName(companyOrLink);

    const [competitors, ownFinancial] = await Promise.all([
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
      resolvedCompanyName: reviews.resolvedCompanyName ?? null,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Auto-gather failed" },
      { status: 500 }
    );
  }
}
