import { chatCompletion } from "./llm";
import { scrapeWithPythonService } from "./pythonScraper";
import { scrapeAppStoreReviews, scrapeGooglePlayReviews, resolveStoreAppName } from "./appReviews";

export interface GatherResult {
  markdown: string;
  sourcesUsed: string[];
  reviewCount: number;
  // Set only when companyOrLink was a direct Play/App Store URL and the real
  // app name could be resolved — a bare store URL/id is never itself a
  // usable company name for search or display (was silently showing
  // "play.google.com" as the company before this).
  resolvedCompanyName?: string;
}

const REVIEW_PLATFORM_HOSTS = [
  "g2.com",
  "trustpilot.com",
  "capterra.com",
  "glassdoor.com",
  "reddit.com",
  "producthunt.com",
  "getapp.com",
  "sitejabber.com",
  "consumeraffairs.com",
  // Added because the original list is entirely SaaS/B2B review sites — it
  // has zero coverage for physical consumer products (electronics,
  // accessories, D2C brands), which is exactly the category that returns
  // almost no data otherwise. Amazon/Flipkart are where Indian consumer
  // electronics brands actually get reviewed.
  "amazon.in",
  "amazon.com",
  "flipkart.com",
  "mouthshut.com",
  // quora.com deliberately excluded: confirmed in practice to return an
  // AI-bot-written generic summary answer ("Ubon is an Indian accessories
  // brand known for...") instead of real customer complaints — that's
  // marketing copy, not voice-of-customer data, and it silently degrades
  // theme quality to generic boilerplate.
];

/** Signatures of scraped content that isn't real user text — bot answers,
 * dead pages, auth walls. Confirmed in practice (Quora's "Something went
 * wrong" error page, and its own AI Assistant bot preface) that these slip
 * through as if they were genuine review content otherwise. */
const JUNK_CONTENT_SIGNATURES = [
  "something went wrong",
  "sign in to continue",
  "please enable javascript",
  "checking your browser",
  "access denied",
  // Amazon's cookie-consent interstitial — confirmed in practice: a plain
  // scrape of several Amazon product URLs returned only this wall ("Click
  // the button below to continue shopping") with none of the real page
  // content behind it, and that wall text alone was passing the "looks like
  // a review" sentence heuristic downstream.
  "click the button below to continue shopping",
];

// Amazon and Flipkart both actively block anonymous/headless access to real
// review text — confirmed directly (not assumed): Amazon's own dedicated
// `/product-reviews/{ASIN}` page hard-redirects an unauthenticated scrape to
// a full "Sign in or create account" wall (zero review content reachable at
// all without a logged-in session), and Flipkart's product page renders no
// review content in its markup even with scroll enabled — review cards need
// a further click/interaction crawl4ai's plain load doesn't trigger. Free
// scraping genuinely cannot get real review text from either site; every
// URL matching these hosts is dropped from the review corpus rather than
// injecting nav chrome, spec sheets, or a sign-in wall as if it were review
// content. A proper fix needs a paid scraper (e.g. an Apify Amazon-reviews
// actor using a real session/residential proxy) — flagged to the user
// rather than silently degrading quality.
function isUnscrapableEcommerceUrl(url: URL): boolean {
  return url.hostname.includes("amazon.") || url.hostname.includes("flipkart.com");
}

function looksLikeJunkContent(text: string): boolean {
  const head = text.slice(0, 500).toLowerCase();
  return JUNK_CONTENT_SIGNATURES.some((sig) => head.includes(sig));
}

// A bare domain typed without a scheme (e.g. "ubonindia.com" — the common
// case, since most people don't type "https://") has no protocol, so
// `new URL()` throws and the whole string, dot-com suffix included, used to
// fall through as a literal "company name." That literal ".com" then
// corrupted App Store name-matching downstream (nameLooksRelated in
// appReviews.ts treated the stray word "com" as a real match signal,
// false-matching brand-unrelated apps whose own name happens to contain
// "com," e.g. "Sangam.com" — confirmed in practice). Only attempt the
// scheme-less parse when the string actually looks like a domain (no
// spaces, has a dot, plausible TLD) so a genuine bare company name like
// "Nike Inc" or "Ubon" is never misread as a URL.
const BARE_DOMAIN_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?:\/\S*)?$/i;

function isUrl(input: string): URL | null {
  const trimmed = input.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") return parsed;
    return null;
  } catch {
    if (BARE_DOMAIN_PATTERN.test(trimmed)) {
      try {
        return new URL(`https://${trimmed}`);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function isGooglePlayUrl(url: URL): boolean {
  return url.hostname.includes("play.google.com");
}

function isAppStoreUrl(url: URL): boolean {
  return url.hostname.includes("apps.apple.com");
}

function isKnownReviewPlatform(url: URL): boolean {
  return REVIEW_PLATFORM_HOSTS.some((host) => url.hostname.includes(host));
}

function deriveNameFromUrl(url: URL): string {
  return url.hostname.replace(/^www\./, "").split(".")[0];
}

/** A URL should never be used as a search query subject — articles/pages
 * talk about "Notion," not "https://notion.so." Callers that need a clean
 * name for competitor/financial search (as opposed to the raw
 * company-or-link input) should go through this. */
export function deriveCleanCompanyName(companyOrLink: string): string {
  const url = isUrl(companyOrLink);
  return url ? deriveNameFromUrl(url) : companyOrLink;
}

const MIN_USEFUL_LENGTH = 200;

async function tryStep(
  label: string,
  fn: () => Promise<string>
): Promise<{ label: string; content: string } | null> {
  try {
    const content = await fn();
    if (
      content &&
      content.trim().length >= MIN_USEFUL_LENGTH &&
      !looksLikeJunkContent(content)
    ) {
      return { label, content };
    }
    return null;
  } catch {
    return null;
  }
}

// Raw scraped pages can run 50-100K+ characters (nav chrome, footers, etc.)
// which blows through the LLM's per-minute token budget — cap each result so
// prompts stay small regardless of how big the source page is.
const MAX_CHARS_PER_RESULT = 3000;

/** Strips HTML tags and entities down to plain visible text. */
function stripHtml(text: string): string {
  return text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bing wraps every result href as a `bing.com/ck/a?...&u=a1<base64url>&...`
 * redirect — decode that back to the actual destination URL. Confirmed
 * directly against a real response: stripping the "a1" prefix and
 * base64-decoding (with padding restored) yields the real URL. */
function decodeBingRedirectUrl(href: string): string | null {
  try {
    // The href comes straight out of raw HTML attribute text, where Bing
    // encodes literal "&" as "&amp;" — URLSearchParams needs the real "&"
    // separator, so this must be un-escaped before parsing or every query
    // param after the first merges into one unparseable blob (confirmed
    // live: this exact bug left every result URL undecoded).
    const parsed = new URL(href.replace(/&amp;/g, "&"));
    const u = parsed.searchParams.get("u");
    if (!u || !u.startsWith("a1")) return href; // not a redirect wrapper — already a direct URL
    const b64 = u.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    return Buffer.from(padded, "base64").toString("utf-8");
  } catch {
    return null;
  }
}

const SEARCH_TIMEOUT_MS = 10000;

/** Plain, dependency-free page fetch — no headless browser, no external
 * scraper service, no API key. Works for server-rendered/static pages;
 * won't see content a page only renders via client-side JS. Used as the
 * first attempt for direct review-platform URLs specifically because it's
 * the only scraping path in this file with zero external dependencies —
 * crawl4ai/scrapling/selenium/scrapy all route through a Python scraper
 * service that was never actually deployed to production (confirmed:
 * SCRAPER_SERVICE_URL is unset there), and Firecrawl was removed entirely
 * per direct instruction. Kept deliberately simple; this is a fallback of
 * last resort, not meant to replace a real rendering engine. */
async function scrapePlainFetch(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`plain fetch ${res.status}`);
  const html = await res.text();
  // Strip script/style blocks first so their contents never leak into the
  // stripped text (stripHtml only removes tags, not element contents).
  const withoutScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "");
  return stripHtml(withoutScripts);
}

/** Primary (only) web search — Bing's plain HTML results page, fetched
 * directly, no external service or API key involved at all. Firecrawl was
 * removed entirely (its key was found empty in production, silently
 * zeroing out every review/competitor/financial web search behind a caught
 * exception — confirmed live via `vercel env pull`). DuckDuckGo was tried
 * first as the free replacement but confirmed live to return an HTTP 202
 * bot-challenge page with zero results, on both its main and "lite"
 * endpoints, from this environment's IP — Bing's HTML results page, tested
 * the same way, returns real HTTP 200 results with no such block. No
 * external dependency beyond Bing itself being reachable. Real search
 * results, real URLs, real snippet text — just the snippet Bing shows, not
 * each target page's full body, which Firecrawl used to provide; less
 * content per result but a source that's actually reachable. */
async function searchWebViaBing(
  query: string
): Promise<{ url: string; title?: string; markdown: string }[]> {
  try {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Each organic result lives in a `<li class="b_algo"` block containing
    // an `<h2><a href=...>` title link and a `<p class="b_lineclampN">`
    // snippet — confirmed directly against a real response. Parses EVERY
    // block Bing returns (up to ~10 per page, its natural page size) — the
    // caller's `mustMention`/host-allowlist filters run over the full set,
    // not a pre-truncated slice. Truncating here BEFORE those filters was
    // a real bug: confirmed live, a broad "X reviews complaints" query's
    // raw top-4 results are rarely third-party review platforms (mostly
    // the company's own site/news), so limiting collection to 4 before
    // filtering silently produced zero results even when relevant review
    // platforms existed further down Bing's own results.
    const items: { url: string; title?: string; markdown: string }[] = [];
    const resultBlocks = html.split(/<li class="b_algo"/).slice(1);
    for (const block of resultBlocks) {
      const linkMatch = block.match(/<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>/);
      if (!linkMatch) continue;
      const url = decodeBingRedirectUrl(linkMatch[1]);
      if (!url) continue;
      const title = stripHtml(linkMatch[2]);
      const snippetMatch = block.match(/<p class="b_lineclamp\d*"[^>]*>([\s\S]*?)<\/p>/);
      const snippet = snippetMatch ? stripHtml(snippetMatch[1]).slice(0, MAX_CHARS_PER_RESULT) : "";
      if (!title && !snippet) continue;
      items.push({ url, title, markdown: `${title}. ${snippet}` });
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * `mustMention`, when given, drops results that don't actually mention the
 * subject anywhere in title/content. Search engines happily return
 * near-miss matches (e.g. "Appflowy" → AppLovin Corp's investor page,
 * "Anytype" → an unrelated government annual report) — without this check,
 * that noise reads as real data about the wrong company entirely.
 */
export type SearchEngine = "bing";
export interface SearchResultItem {
  url: string;
  title?: string;
  markdown: string;
  engine: SearchEngine;
}

// Firecrawl deliberately removed as a dependency — see searchWebViaBing.
async function searchWeb(
  query: string,
  limit = 4,
  mustMention?: string
): Promise<SearchResultItem[]> {
  const needle = mustMention?.toLowerCase();

  function applyFilters(
    raw: { url: string; title?: string; markdown: string }[]
  ): SearchResultItem[] {
    const items: SearchResultItem[] = [];
    for (const doc of raw) {
      if (!doc.markdown?.trim() || !doc.url) continue;
      if (looksLikeJunkContent(doc.markdown)) continue;
      if (needle) {
        const haystack = `${doc.title ?? ""} ${doc.markdown}`.toLowerCase();
        if (!haystack.includes(needle)) continue;
      }
      items.push({
        url: doc.url,
        title: doc.title,
        markdown: doc.markdown.slice(0, MAX_CHARS_PER_RESULT),
        engine: "bing",
      });
      // Cap AFTER filtering, not before — capping the raw Bing fetch
      // itself was the bug (see searchWebViaBing's comment).
      if (items.length >= limit) break;
    }
    return items;
  }

  const results = await searchWebViaBing(query);
  return applyFilters(results);
}

/**
 * Automatically gathers customer review content — and, opportunistically,
 * competitor and public-financial context — for a company/product.
 *
 * Critical rule: this NEVER treats the company's own website as a review
 * source. A bare company URL/name is only ever used to identify the company;
 * actual review content always comes from a web search across known review
 * platforms (G2, Trustpilot, Reddit, app stores, etc.), or from directly
 * scraping a URL the user gave IF that URL is already a known review
 * platform (i.e. the user pointed at a reviews page on purpose).
 *
 * No manual engine choice: free/local scrapers (crawl4ai, scrapling) are
 * tried first when scraping a direct review-platform URL; paid APIs
 * (Firecrawl, Apify) only run as fallback or when a platform requires them
 * (Apify for App/Play Store, which have no free path to review text at all).
 */
export async function autoGatherReviews(
  companyOrLink: string,
  description: string
): Promise<GatherResult> {
  const url = isUrl(companyOrLink);
  const sourcesUsed: string[] = [];
  const reviewChunks: string[] = [];

  if (url && (isGooglePlayUrl(url) || isAppStoreUrl(url))) {
    const storeKind = isGooglePlayUrl(url) ? "google-play" : "app-store";
    try {
      const [result, resolvedCompanyName] = await Promise.all([
        isGooglePlayUrl(url) ? scrapeGooglePlayReviews(companyOrLink) : scrapeAppStoreReviews(companyOrLink),
        resolveStoreAppName(companyOrLink, storeKind),
      ]);
      if (result.content.trim()) {
        sourcesUsed.push(`${result.source}-${storeKind}`);
        reviewChunks.push(result.content);
      }
      return {
        markdown: reviewChunks.join("\n\n"),
        sourcesUsed,
        reviewCount: reviewChunks.length,
        resolvedCompanyName: resolvedCompanyName ?? undefined,
      };
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "App store scrape failed");
    }
  }

  if (url && isKnownReviewPlatform(url)) {
    // The user pointed directly at a reviews page — scrape it directly.
    // Plain fetch first: zero external dependencies, works for server-
    // rendered pages. crawl4ai/scrapling/selenium/scrapy all route through
    // a Python scraper service that isn't reachable in production (never
    // deployed there — SCRAPER_SERVICE_URL is unset) — kept as later
    // attempts since they cost nothing to try and will start working the
    // moment that service is actually deployed somewhere.
    for (const [label, fn] of [
      ["plain-fetch", () => scrapePlainFetch(companyOrLink)],
      ["crawl4ai", () => scrapeWithPythonService(companyOrLink, "crawl4ai")],
      ["scrapling", () => scrapeWithPythonService(companyOrLink, "scrapling")],
      ["selenium", () => scrapeWithPythonService(companyOrLink, "selenium")],
      ["scrapy", () => scrapeWithPythonService(companyOrLink, "scrapy")],
    ] as const) {
      const step = await tryStep(label, fn);
      if (step) {
        sourcesUsed.push(step.label);
        reviewChunks.push(step.content);
        break;
      }
    }
    return {
      markdown: reviewChunks.join("\n\n"),
      sourcesUsed,
      reviewCount: reviewChunks.length,
    };
  }

  // Anything else — the company's own site, or a bare name — is ONLY used to
  // identify the company. Reviews always come from a web search targeting
  // review platforms, never from the company's own marketing pages. Also
  // opportunistically try Play Store and App Store by name in parallel —
  // many products are apps even when the user only gave a name/website, and
  // review text lives nowhere else for those platforms. Failures here are
  // silent (empty result), never surfaced as an error, since this is on top
  // of — not instead of — the web review search.
  const companyName = url ? deriveNameFromUrl(url) : companyOrLink;
  const descSuffix = description.trim() ? ` ${description.trim()}` : "";

  const [rawWebResults, playStoreContent, appStoreContent] = await Promise.all([
    searchWeb(
      // amazon.in/amazon.com/flipkart.com deliberately excluded — see
      // isUnscrapableEcommerceUrl. Their results get filtered out
      // downstream regardless, so including them here just burns search
      // slots that could otherwise surface real review content from
      // platforms that actually work.
      `${companyName}${descSuffix} reviews complaints (site:g2.com OR site:trustpilot.com OR site:reddit.com OR site:capterra.com OR site:sitejabber.com OR site:consumeraffairs.com OR site:mouthshut.com)`,
      // Bing (no per-result fetch cost, unlike the old Firecrawl full-page
      // scrape) returns ~10 organic results per page regardless; this needs
      // to stay high because a REAL review-platform host is then filtered
      // for downstream (site: hints don't reliably restrict Bing's ranking,
      // confirmed elsewhere) — a broad "X reviews complaints" query's raw
      // top results skew toward the company's own site/news, not review
      // platforms, so a low limit here was leaving nothing left after that
      // filter (confirmed live: this was the actual cause of empty
      // dashboards, not a code crash).
      10,
      // Without this, near-miss results (a platform's own homepage, a
      // same-category unrelated brand, a generic "reviews are fake" thread)
      // were passing straight through as if they were real data about this
      // company — confirmed in practice: "ubon" search results included
      // "Ubuy India" reviews (an unrelated company) and Trustpilot/
      // MouthShut/ConsumerAffairs' own generic homepages, none of which
      // mention UBON at all. Every other searchWeb() caller in this file
      // already passes this; the review-gathering call was the one gap.
      companyName
    ),
    scrapeGooglePlayReviews(companyName).catch(() => null),
    scrapeAppStoreReviews(companyName).catch(() => null),
  ]);

  // Firecrawl's search API does not reliably honor the `site:` filters above
  // (confirmed in practice: a "reviews complaints" query for ubonindia.com
  // returned ubonindia.com's own "About Us" and blog pages, and a YouTube
  // unboxing video — none of which are real customer review text). The query
  // is only a hint; this hard allowlist against REVIEW_PLATFORM_HOSTS is the
  // actual enforcement of "never the company's own site." Amazon/Flipkart
  // are also filtered out here as defense-in-depth (they're no longer in
  // the query above, but REVIEW_PLATFORM_HOSTS still lists them for the
  // direct-URL-paste branch elsewhere) — see isUnscrapableEcommerceUrl:
  // anonymous scraping of either yields nav chrome/sign-in walls, never
  // real review text.
  const webResults = rawWebResults.filter((item) => {
    const itemUrl = isUrl(item.url);
    if (!itemUrl) return false;
    if (isUnscrapableEcommerceUrl(itemUrl)) return false;
    return isKnownReviewPlatform(itemUrl);
  });

  for (const item of webResults) {
    reviewChunks.push(`--- from ${item.url} (${item.title ?? "untitled"}) ---\n${item.markdown}`);
  }
  if (webResults.some((r) => r.engine === "bing")) sourcesUsed.push("bing-search:reviews");

  if (playStoreContent?.content.trim()) {
    reviewChunks.push(`--- from Google Play reviews ---\n${playStoreContent.content}`);
    sourcesUsed.push(`${playStoreContent.source}-google-play`);
  }
  if (appStoreContent?.content.trim()) {
    reviewChunks.push(`--- from App Store reviews ---\n${appStoreContent.content}`);
    sourcesUsed.push(`${appStoreContent.source}-app-store`);
  }

  return {
    markdown: reviewChunks.join("\n\n"),
    sourcesUsed,
    reviewCount: reviewChunks.length,
  };
}

/** Opportunistic, non-fabricated competitor context: only returns what a web
 * search actually surfaces — callers must treat an empty result as "no
 * competitor data found," not fill in a guess.
 *
 * Note: each result is already capped at MAX_CHARS_PER_RESULT by searchWeb —
 * do NOT re-truncate further here. A second, tighter truncation cut articles
 * off inside their nav/header chrome before reaching the actual body text
 * (confirmed: a real "Best Notion Alternatives" article was found, but a
 * 1200-char re-slice never reached the list of alternatives). Any additional
 * size trimming for LLM token budget belongs at the prompt-building step,
 * not here where the text still needs to contain the actual named entities. */
export async function gatherCompetitorContext(
  companyName: string,
  description: string
): Promise<{ markdown: string; found: boolean }> {
  const results = await searchWeb(
    `${companyName} ${description} top competitors alternatives comparison`,
    2,
    companyName
  );
  if (results.length === 0) return { markdown: "", found: false };
  const markdown = results
    .map((r) => `--- from ${r.url} (${r.title ?? "untitled"}) ---\n${r.markdown}`)
    .join("\n\n");
  return { markdown, found: true };
}

/** Opportunistic, non-fabricated public financial context (funding, revenue,
 * reported losses, etc.) — only from what a web search actually surfaces.
 *
 * `qualifier` (e.g. the product description) is appended and the name is
 * exact-phrase-quoted to bias the search away from unrelated companies that
 * happen to share a short/common name (seen in practice: "Appflowy" →
 * AppLovin Corp, "Affine" → an unrelated French real-estate firm). This
 * reduces but does not eliminate name collisions — the report generation's
 * own instruction to only use facts literally present in the source text is
 * the actual backstop against attributing the wrong company's numbers. */
export async function gatherFinancialContext(
  companyName: string,
  qualifier = ""
): Promise<{ markdown: string; found: boolean }> {
  const q = qualifier.trim() ? ` ${qualifier.trim()}` : "";

  // screener.in and moneycontrol.com carry real, structured financial
  // statements (revenue, margins, ratios) for every NSE/BSE-listed Indian
  // company — a much higher-quality source than a generic web search for
  // any Indian company that's actually public (Zomato, Swiggy, and most
  // Indian D2C/consumer brands analyzed here are or will be). A `site:`
  // query does NOT reliably restrict results here — confirmed directly
  // against Bing's own HTML endpoint: even the simplest possible
  // `site:screener.in Zomato` query returned zomato.com/Wikipedia/Play
  // Store results with zero screener.in hits, so the operator is being
  // ignored outright, not just loosely honored (matches the same
  // already-documented Firecrawl limitation elsewhere in this file — this
  // isn't backend-specific). Post-filtering a plain query by hostname,
  // same pattern already used for review-platform matching, is reliable
  // where the site: operator itself is not.
  const financeSearchResults = await searchWeb(
    `"${companyName}"${q} financial results annual report screener.in moneycontrol`,
    6,
    companyName
  );
  const indianFinanceResults = financeSearchResults.filter((r) => {
    const host = isUrl(r.url)?.hostname ?? "";
    return host.includes("screener.in") || host.includes("moneycontrol.com");
  });
  if (indianFinanceResults.length > 0) {
    const markdown = indianFinanceResults
      .map((r) => `--- from ${r.url} (${r.title ?? "untitled"}) ---\n${r.markdown}`)
      .join("\n\n");
    return { markdown, found: true };
  }

  const results = await searchWeb(
    `"${companyName}"${q} company revenue funding financial results annual report`,
    2,
    companyName
  );
  if (results.length === 0) return { markdown: "", found: false };
  const markdown = results
    .map((r) => `--- from ${r.url} (${r.title ?? "untitled"}) ---\n${r.markdown}`)
    .join("\n\n");
  return { markdown, found: true };
}

/** Extracts up to `count` real, named competitor companies from search text
 * via a small/cheap LLM call. Returns [] rather than guessing if the source
 * text doesn't clearly name any — callers must not invent competitor names. */
async function extractCompetitorNames(
  companyName: string,
  sourceText: string,
  count: number
): Promise<string[]> {
  if (!sourceText.trim()) return [];
  try {
    const raw = await chatCompletion({
      messages: [
        {
          role: "system",
          content: `Extract up to ${count} real, named competitor companies of "${companyName}" from the text below. Only include names that are explicitly mentioned as alternatives/competitors in the text — never invent one. Respond with ONLY a JSON object: {"competitors": string[]}. If none are clearly named, return {"competitors": []}.`,
        },
        { role: "user", content: sourceText.slice(0, 4000) },
      ],
      jsonMode: true,
      temperature: 0,
    });
    const parsed = JSON.parse(raw) as { competitors?: unknown };
    if (!Array.isArray(parsed.competitors)) return [];
    return parsed.competitors
      .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
      .slice(0, count);
  } catch {
    return [];
  }
}

export interface CompetitorProfile {
  name: string;
  productFindings: string; // how their product compares / positions, from real search text
  financial: { found: boolean; markdown: string };
}

/**
 * Finds up to `count` REAL named competitors (never invented) and, for each,
 * gathers real product-comparison and financial context via web search. Any
 * competitor or number for which nothing is found is simply omitted — this
 * must never be padded with guesses.
 */
export async function gatherCompetitorProfiles(
  companyName: string,
  description: string,
  count = 2
): Promise<CompetitorProfile[]> {
  const overview = await gatherCompetitorContext(companyName, description);
  const names = await extractCompetitorNames(companyName, overview.markdown, count);
  if (names.length === 0) return [];

  const profiles = await Promise.all(
    names.map(async (name): Promise<CompetitorProfile> => {
      const [productResults, financial] = await Promise.all([
        searchWeb(`${name} vs ${companyName} comparison review ${description}`, 2, name),
        gatherFinancialContext(name, description),
      ]);
      const productFindings = productResults
        .map((r) => `--- from ${r.url} (${r.title ?? "untitled"}) ---\n${r.markdown}`)
        .join("\n\n");
      return { name, productFindings, financial };
    })
  );

  return profiles;
}
