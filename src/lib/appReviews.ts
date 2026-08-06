import { apify } from "./clients";
import { scrapeWithPythonService } from "./pythonScraper";

const GOOGLE_PLAY_ACTOR = "curious_coder/google-play-scraper";
const APP_STORE_ACTOR = "johnvc/apple-app-store-reviews-api";
const APIFY_TOKEN_PRESENT = Boolean(process.env.APIFY_API_TOKEN?.trim());

function extractReviewText(item: Record<string, unknown>): string {
  const candidates = [
    "text",
    "review",
    "content",
    "comment",
    "body",
    "reviewText",
    "title",
  ];
  for (const key of candidates) {
    const val = item[key];
    if (typeof val === "string" && val.trim()) return val.trim();
  }
  return JSON.stringify(item);
}

function parseGooglePlayAppId(input: string): string {
  const match = input.match(/[?&]id=([^&]+)/);
  if (match) return decodeURIComponent(match[1]);
  return input.trim();
}

function parseAppStoreIdentifier(input: string): { productId?: string; appName?: string } {
  const urlMatch = input.match(/\/id(\d+)/);
  if (urlMatch) return { productId: urlMatch[1] };
  if (/^\d+$/.test(input.trim())) return { productId: input.trim() };
  return { appName: input.trim() };
}

/** True if `candidate` plausibly refers to `query` — neither store's own
 * "name search" can be trusted blindly (confirmed in practice: Apify's Play
 * Store search and the App Store actor's app_name search both silently
 * matched to a completely unrelated app rather than returning nothing for a
 * brand with no real app). Word-level containment in either direction,
 * case-insensitive. */
function nameLooksRelated(query: string, candidate: string): boolean {
  const q = query.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  const c = candidate.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
  if (!q || !c) return false;
  if (c.includes(q) || q.includes(c)) return true;
  const qWords = q.split(/\s+/).filter((w) => w.length >= 3);
  return qWords.some((w) => c.includes(w));
}

/** Resolves a company/product name to a REAL, verified iOS app id using
 * Apple's own free public iTunes Search API — not the Apify actor's
 * internal name search, which was confirmed (via this exact bug) to return
 * an unrelated app rather than "no match" when a brand has no real app. */
async function resolveAppleAppId(name: string): Promise<{ id: string; name: string } | null> {
  const res = await fetch(
    `https://itunes.apple.com/search?term=${encodeURIComponent(name)}&entity=software&limit=5`
  );
  if (!res.ok) return null;
  const data = (await res.json()) as {
    results?: { trackId?: number; trackName?: string }[];
  };
  for (const r of data.results ?? []) {
    if (r.trackId && r.trackName && nameLooksRelated(name, r.trackName)) {
      return { id: String(r.trackId), name: r.trackName };
    }
  }
  return null;
}

interface ItunesRssEntry {
  title?: { label?: string };
  content?: { label?: string };
  "im:rating"?: { label?: string };
}

/** FREE App Store reviews via Apple's own public iTunes RSS feed — no Apify,
 * no key, no credits to run out of. This is the default path now; Apify is
 * only ever an optional enhancement on top of it. Pulls up to 3 pages
 * (~150 reviews) and stops early once a page comes back empty. */
async function scrapeAppStoreReviewsFree(productId: string, country: string): Promise<string> {
  const chunks: string[] = [];
  for (let page = 1; page <= 3; page++) {
    const res = await fetch(
      `https://itunes.apple.com/${country}/rss/customerreviews/page=${page}/id=${productId}/sortby=mostrecent/json`
    );
    if (!res.ok) break;
    const data = (await res.json()) as { feed?: { entry?: ItunesRssEntry[] } };
    const entries = data.feed?.entry;
    // The feed's first entry is the app metadata itself, not a review, when
    // there's at least one real review present — reviews have a title+content
    // pair, so filter on that rather than assuming index 0 is always metadata.
    const reviews = (Array.isArray(entries) ? entries : []).filter(
      (e) => e.content?.label?.trim() && e.title?.label?.trim()
    );
    if (reviews.length === 0) break;
    for (const r of reviews) {
      chunks.push(`${r.title!.label}. ${r.content!.label}`);
    }
  }
  return chunks.join("\n");
}

/** A bare company/product name isn't a Play Store package id (e.g. "Zomato"
 * vs the real id "com.application.zomato") — search the store first to
 * resolve it. The result is verified against the query name before use —
 * accepting Apify's top search hit unconditionally was confirmed to return
 * an unrelated app when no real match exists, rather than an empty result. */
async function searchGooglePlayAppIdViaApify(keywords: string, country = "us"): Promise<string | null> {
  const run = await apify.actor(GOOGLE_PLAY_ACTOR).call({
    action: "scrapeAppSearch",
    "scrapeAppSearch.keywords": [keywords],
    "scrapeAppSearch.country": country,
    count: 3,
  });
  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  for (const raw of items) {
    const item = raw as Record<string, unknown>;
    const appId = item.appId ?? item.id ?? item.packageName;
    const title = item.title ?? item.appName ?? item.name;
    if (
      typeof appId === "string" &&
      typeof title === "string" &&
      nameLooksRelated(keywords, title)
    ) {
      return appId;
    }
  }
  return null;
}

/** FREE Play Store app-id resolution: scrapes Google Play's own public search
 * results page (no key needed) via the crawl4ai Python service, and reads the
 * package id out of the first result link whose visible name plausibly
 * matches the query — same verification discipline as the Apify path, just
 * without the paid actor. */
async function searchGooglePlayAppIdFree(keywords: string, country = "us"): Promise<string | null> {
  const page = await scrapeWithPythonService(
    `https://play.google.com/store/search?q=${encodeURIComponent(keywords)}&c=apps&gl=${country}`,
    "crawl4ai"
  );
  // The result card's link anchor is icon-only (empty markdown link text) —
  // the actual app name renders as plain text a few lines after the link,
  // not inside it (confirmed against a real scrape). So: find each detail
  // link, then check the next ~150 chars of page text for a plausible name
  // match, rather than requiring the name inside the anchor itself.
  const linkPattern = /\]\(https:\/\/play\.google\.com\/store\/apps\/details\?id=([a-zA-Z0-9_.]+)[^)]*\)/g;
  for (const match of page.matchAll(linkPattern)) {
    const appId = match[1];
    const windowText = page.slice(match.index!, match.index! + 250);
    if (nameLooksRelated(keywords, windowText)) return appId;
  }
  return null;
}

/** FREE Play Store reviews: scrapes the app's own public reviews page
 * (showAllReviews=true) via crawl4ai. Google server-renders a real, if
 * smaller, set of visible reviews for logged-out users — genuine review
 * text, just less volume than Apify's actor pulls. Reviews only appear
 * after scrolling — Google lazy-loads them via infinite scroll, confirmed in
 * practice: a plain fetch of this same URL returns the app's description/
 * metadata but zero review cards. */
async function scrapeGooglePlayReviewsFree(appId: string, country: string): Promise<string> {
  const page = await scrapeWithPythonService(
    `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=en&gl=${country}&showAllReviews=true`,
    "crawl4ai",
    { scroll: true }
  );
  return page;
}

/** Extracts the real app name from a scraped Play Store detail page's own
 * markdown — the page always renders it as the first "# Heading" (confirmed:
 * "# Zomato: Food Delivery & Dining" appears right after the app icon).
 * Used so the UI/search never falls back to a raw hostname like
 * "play.google.com" when the user pastes a direct store link. */
function extractGooglePlayAppName(pageContent: string): string | null {
  const match = pageContent.match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : null;
}

/** Free, no-key lookup of the real app name from just a numeric App Store id
 * (Apple's public lookup API — distinct from /search, which needs a name). */
async function resolveAppleNameById(productId: string): Promise<string | null> {
  const res = await fetch(`https://itunes.apple.com/lookup?id=${productId}`);
  if (!res.ok) return null;
  const data = (await res.json()) as { results?: { trackName?: string }[] };
  return data.results?.[0]?.trackName ?? null;
}

/** Resolves a human-readable product name for whichever store URL the user
 * pasted directly — a URL/id is never itself a usable "company name" for
 * competitor/financial search or dashboard display. Best-effort: returns
 * null (caller falls back to its own naive derivation) rather than throwing,
 * since this is a display/search-quality improvement, not a hard requirement. */
export async function resolveStoreAppName(
  storeUrl: string,
  store: "google-play" | "app-store"
): Promise<string | null> {
  try {
    if (store === "app-store") {
      const { productId, appName } = parseAppStoreIdentifier(storeUrl);
      if (appName) return appName;
      if (productId) return await resolveAppleNameById(productId);
      return null;
    }
    const appId = parseGooglePlayAppId(storeUrl);
    const page = await scrapeWithPythonService(
      `https://play.google.com/store/apps/details?id=${encodeURIComponent(appId)}&hl=en`,
      "crawl4ai"
    );
    return extractGooglePlayAppName(page);
  } catch {
    return null;
  }
}

export interface AppReviewResult {
  content: string;
  source: "free" | "apify";
}

export async function scrapeGooglePlayReviews(
  input: string,
  country = "us"
): Promise<AppReviewResult> {
  const looksLikeAppId = /^([a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/i.test(input.trim());
  let appId = parseGooglePlayAppId(input);

  if (!looksLikeAppId && !input.includes("play.google.com")) {
    // Free search first; Apify's search only tried if the free path (and its
    // token) both come up empty — never let a missing/exhausted Apify token
    // be the reason nothing is found at all.
    const resolved =
      (await searchGooglePlayAppIdFree(input, country).catch(() => null)) ??
      (APIFY_TOKEN_PRESENT ? await searchGooglePlayAppIdViaApify(input, country).catch(() => null) : null);
    if (!resolved) {
      throw new Error(`Couldn't find a real Google Play app matching "${input}"`);
    }
    appId = resolved;
  }

  const freeResult = await scrapeGooglePlayReviewsFree(appId, country).catch(() => "");
  if (freeResult.trim().length >= 200) return { content: freeResult, source: "free" };

  if (APIFY_TOKEN_PRESENT) {
    try {
      const run = await apify.actor(GOOGLE_PLAY_ACTOR).call({
        action: "scrapeReviews",
        "scrapeReviews.appId": appId,
        "scrapeReviews.country": country,
        count: 50,
      });
      const { items } = await apify.dataset(run.defaultDatasetId).listItems();
      if (items.length > 0) {
        return {
          content: items.map((item) => extractReviewText(item as Record<string, unknown>)).join("\n"),
          source: "apify",
        };
      }
    } catch {
      // fall through to whatever the free scrape returned, even if thin
    }
  }

  if (freeResult.trim()) return { content: freeResult, source: "free" };
  throw new Error(`No reviews found for Google Play app "${appId}"`);
}

export async function scrapeAppStoreReviews(
  input: string,
  country = "us"
): Promise<AppReviewResult> {
  const { productId, appName } = parseAppStoreIdentifier(input);

  let resolvedProductId = productId;
  if (!resolvedProductId && appName) {
    // Verify via Apple's own free search first — do NOT pass app_name
    // straight to any actor/API (confirmed bug: internal resolution matched
    // a completely unrelated app instead of finding nothing).
    const resolved = await resolveAppleAppId(appName);
    if (!resolved) {
      throw new Error(`Couldn't find a real App Store app matching "${appName}"`);
    }
    resolvedProductId = resolved.id;
  }

  // Free iTunes RSS feed first — genuinely no key/credits required, and no
  // reason to ever prefer the paid Apify actor over it.
  const freeResult = await scrapeAppStoreReviewsFree(resolvedProductId!, country).catch(() => "");
  if (freeResult.trim().length >= 200) return { content: freeResult, source: "free" };

  if (APIFY_TOKEN_PRESENT) {
    try {
      const run = await apify.actor(APP_STORE_ACTOR).call({
        product_ids: [resolvedProductId!],
        country,
      });
      const { items } = await apify.dataset(run.defaultDatasetId).listItems();
      if (items.length > 0) {
        return {
          content: items.map((item) => extractReviewText(item as Record<string, unknown>)).join("\n"),
          source: "apify",
        };
      }
    } catch {
      // fall through to whatever the free RSS feed returned, even if thin
    }
  }

  if (freeResult.trim()) return { content: freeResult, source: "free" };
  throw new Error(`No reviews returned for App Store app "${input}"`);
}
