const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL ?? "http://localhost:8000";

export type PythonEngine = "crawl4ai" | "scrapling" | "scrapegraph" | "selenium" | "scrapy";

export async function scrapeWithPythonService(
  url: string,
  engine: PythonEngine
): Promise<string> {
  const res = await fetch(`${SCRAPER_SERVICE_URL}/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, engine }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.detail ?? `${engine} scrape failed`);
  }
  return data.content as string;
}
