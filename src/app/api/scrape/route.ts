import { NextRequest, NextResponse } from "next/server";
import { scrapeAppStoreReviews, scrapeGooglePlayReviews } from "@/lib/appReviews";
import { scrapeWithPythonService, type PythonEngine } from "@/lib/pythonScraper";
import { scrapeWithPuppeteer, scrapeWithPlaywright } from "@/lib/browserlessScraper";

type Engine =
  | PythonEngine
  | "apify-google-play"
  | "apify-app-store"
  | "puppeteer"
  | "playwright";

const URL_REQUIRED_ENGINES: Engine[] = [
  "crawl4ai",
  "scrapling",
  "scrapegraph",
  "selenium",
  "scrapy",
  "puppeteer",
  "playwright",
];

export async function POST(req: NextRequest) {
  try {
    const { url, engine = "crawl4ai", country } = (await req.json()) as {
      url?: string;
      engine?: Engine;
      country?: string;
    };

    if (!url?.trim()) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    if (URL_REQUIRED_ENGINES.includes(engine)) {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        return NextResponse.json({ error: "url is not a valid URL" }, { status: 400 });
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return NextResponse.json({ error: "url must be http(s)" }, { status: 400 });
      }
    }

    if (engine === "apify-google-play") {
      const markdown = await scrapeGooglePlayReviews(url, country);
      return NextResponse.json({ markdown, sourceUrl: url, engine });
    }

    if (engine === "apify-app-store") {
      const markdown = await scrapeAppStoreReviews(url, country);
      return NextResponse.json({ markdown, sourceUrl: url, engine });
    }

    if (engine === "puppeteer") {
      const markdown = await scrapeWithPuppeteer(url);
      return NextResponse.json({ markdown, sourceUrl: url, engine });
    }

    if (engine === "playwright") {
      const markdown = await scrapeWithPlaywright(url);
      return NextResponse.json({ markdown, sourceUrl: url, engine });
    }

    const markdown = await scrapeWithPythonService(url, engine);
    return NextResponse.json({ markdown, sourceUrl: url, engine });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scrape failed" },
      { status: 500 }
    );
  }
}
