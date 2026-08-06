import puppeteer from "puppeteer-core";
import { chromium } from "playwright-core";

// Confirmed connection format from Browserless's own docs: a single CDP
// WebSocket endpoint that both Puppeteer (browserWSEndpoint) and Playwright
// (connectOverCDP) can speak — no local Chromium download needed, Browserless
// runs the actual browser remotely.
function browserlessWsEndpoint(): string {
  const token = process.env.BROWSERLESS_API_KEY;
  if (!token) throw new Error("BROWSERLESS_API_KEY is not set");
  return `wss://production-sfo.browserless.io?token=${token}`;
}

export async function scrapeWithPuppeteer(url: string): Promise<string> {
  const browser = await puppeteer.connect({ browserWSEndpoint: browserlessWsEndpoint() });
  try {
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: "networkidle2", timeout: 30000 });
    return await page.evaluate(() => document.body.innerText);
  } finally {
    await browser.disconnect();
  }
}

export async function scrapeWithPlaywright(url: string): Promise<string> {
  const browser = await chromium.connectOverCDP(browserlessWsEndpoint());
  try {
    const context = browser.contexts()[0] ?? (await browser.newContext());
    const page = await context.newPage();
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
    return await page.evaluate(() => document.body.innerText);
  } finally {
    await browser.close();
  }
}
