const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL ?? "http://localhost:8000";

export type PythonEngine = "crawl4ai" | "scrapling" | "scrapegraph" | "selenium" | "scrapy";

// SCRAPER_SERVICE_URL is unset in production (confirmed via `vercel env
// ls` — never configured), so this was silently pointing at
// http://localhost:8000 from inside a Vercel serverless function, which
// has no Python service running at all. Without an explicit timeout, a
// fetch to an unreachable/misbehaving host can hang far longer than a
// user will wait — every caller of this function already treats a
// failure as non-fatal (falls through to the next scraper or returns
// null/empty), so failing fast here is strictly better than hanging.
const SCRAPER_TIMEOUT_MS = 8000;

export async function scrapeWithPythonService(
  url: string,
  engine: PythonEngine,
  options?: { scroll?: boolean }
): Promise<string> {
  const res = await fetch(`${SCRAPER_SERVICE_URL}/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, engine, scroll: options?.scroll ?? false }),
    signal: AbortSignal.timeout(SCRAPER_TIMEOUT_MS),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail ?? `${engine} scrape failed`);
  }
  return data.content as string;
}
