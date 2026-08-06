import { apify } from "./clients";

const GOOGLE_PLAY_ACTOR = "curious_coder/google-play-scraper";
const APP_STORE_ACTOR = "johnvc/apple-app-store-reviews-api";

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

/** A bare company/product name isn't a Play Store package id (e.g. "Zomato"
 * vs the real id "com.application.zomato") — search the store first to
 * resolve it. The result is verified against the query name before use —
 * accepting Apify's top search hit unconditionally was confirmed to return
 * an unrelated app when no real match exists, rather than an empty result. */
async function searchGooglePlayAppId(keywords: string, country = "us"): Promise<string | null> {
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

export async function scrapeGooglePlayReviews(
  input: string,
  country = "us"
): Promise<string> {
  // If input already looks like a package id or Play Store URL, use it
  // directly; otherwise treat it as a search query to resolve first.
  const looksLikeAppId = /^([a-z][a-z0-9_]*\.)+[a-z][a-z0-9_]*$/i.test(input.trim());
  let appId = parseGooglePlayAppId(input);

  if (!looksLikeAppId && !input.includes("play.google.com")) {
    const resolved = await searchGooglePlayAppId(input, country);
    if (!resolved) {
      throw new Error(`Couldn't find a real Google Play app matching "${input}"`);
    }
    appId = resolved;
  }

  const run = await apify.actor(GOOGLE_PLAY_ACTOR).call({
    action: "scrapeReviews",
    "scrapeReviews.appId": appId,
    "scrapeReviews.country": country,
    count: 50,
  });

  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  if (items.length === 0) {
    throw new Error(`No reviews returned for Google Play app "${appId}"`);
  }

  return items.map((item) => extractReviewText(item as Record<string, unknown>)).join("\n");
}

export async function scrapeAppStoreReviews(
  input: string,
  country = "us"
): Promise<string> {
  const { productId, appName } = parseAppStoreIdentifier(input);

  let resolvedProductId = productId;
  if (!resolvedProductId && appName) {
    // Verify via Apple's own search first — do NOT pass app_name straight to
    // the Apify actor (confirmed bug: its internal resolution matched a
    // completely unrelated app instead of finding nothing).
    const resolved = await resolveAppleAppId(appName);
    if (!resolved) {
      throw new Error(`Couldn't find a real App Store app matching "${appName}"`);
    }
    resolvedProductId = resolved.id;
  }

  const run = await apify.actor(APP_STORE_ACTOR).call({
    product_ids: [resolvedProductId!],
    country,
  });

  const { items } = await apify.dataset(run.defaultDatasetId).listItems();
  if (items.length === 0) {
    throw new Error(`No reviews returned for App Store app "${input}"`);
  }

  return items.map((item) => extractReviewText(item as Record<string, unknown>)).join("\n");
}
