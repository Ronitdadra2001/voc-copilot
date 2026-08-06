import { firecrawl } from "./clients";
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
];

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

/** Strips markdown link/image syntax down to plain visible text, so a
 * DuckDuckGo results block (full of `[text](url)` and `![](icon)` noise)
 * reads as normal prose for the LLM steps that consume it downstream. */
function stripMarkdownLinks(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo wraps every result href as `duckduckgo.com/l/?uddg=<encoded
 * real URL>&rut=...` — decode that back to the actual destination URL. */
function decodeDuckDuckGoUrl(href: string): string | null {
  try {
    const uddg = new URL(href).searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : null;
  } catch {
    return null;
  }
}

/** Free fallback search when Firecrawl's paid /search is unavailable
 * (confirmed in practice: the account can run out of search credits, which
 * silently zeroes out competitor/financial discovery otherwise). Scrapes
 * DuckDuckGo's plain HTML results page via the crawl4ai Python service —
 * DuckDuckGo's HTML endpoint needs no JS/login and is scrape-friendly. Real
 * search results, real URLs, real snippet text — just less content per
 * result than a full Firecrawl scrape, since we only get the snippet DDG
 * shows, not the target page's full body. */
async function searchWebViaDuckDuckGo(
  query: string,
  limit: number
): Promise<{ url: string; title?: string; markdown: string }[]> {
  try {
    const page = await scrapeWithPythonService(
      `https://duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      "crawl4ai"
    );
    const blocks = page.split(/\n##\s+\[/).slice(1); // first chunk is page chrome, discard
    const items: { url: string; title?: string; markdown: string }[] = [];
    for (const block of blocks) {
      const linkMatch = block.match(/^(.+?)\]\((https:\/\/duckduckgo\.com\/l\/\?uddg=[^)]+)\)/);
      if (!linkMatch) continue;
      const title = stripMarkdownLinks(linkMatch[1]);
      const url = decodeDuckDuckGoUrl(linkMatch[2]);
      if (!url) continue;
      // Everything after the matched title+link is the favicon image, the
      // repeated display-url link, and the actual snippet — all in valid
      // `[text](url)`/`![](url)` form, so stripping from THIS point on (not
      // the raw block) avoids leaving the title's dangling `](url)` behind,
      // which isn't valid markdown-link syntax on its own and survived the
      // stripper untouched, contaminating every result with URL fragments.
      const rest = block.slice(linkMatch[0].length);
      const snippet = stripMarkdownLinks(rest).slice(0, MAX_CHARS_PER_RESULT);
      if (!snippet) continue;
      items.push({ url, title, markdown: `${title}. ${snippet}` });
      if (items.length >= limit) break;
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
export type SearchEngine = "firecrawl" | "duckduckgo";
export interface SearchResultItem {
  url: string;
  title?: string;
  markdown: string;
  engine: SearchEngine;
}

async function searchWeb(
  query: string,
  limit = 4,
  mustMention?: string
): Promise<SearchResultItem[]> {
  const needle = mustMention?.toLowerCase();

  function applyFilters(
    raw: { url: string; title?: string; markdown: string }[],
    engine: SearchEngine
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
        engine,
      });
    }
    return items;
  }

  try {
    const results = await firecrawl.search(query, {
      limit,
      sources: ["web"],
      scrapeOptions: { formats: ["markdown"] },
    });
    const raw = (results.web ?? []) as { url?: string; title?: string; markdown?: string }[];
    const filtered = applyFilters(
      raw.filter((d): d is { url: string; title?: string; markdown: string } =>
        Boolean(d.url && d.markdown)
      ),
      "firecrawl"
    );
    if (filtered.length > 0) return filtered;
  } catch {
    // fall through to the free fallback below
  }

  const fallback = await searchWebViaDuckDuckGo(query, limit);
  return applyFilters(fallback, "duckduckgo");
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
    // The user pointed directly at a reviews page — scrape it directly,
    // free scrapers first.
    for (const [label, fn] of [
      ["crawl4ai", () => scrapeWithPythonService(companyOrLink, "crawl4ai")],
      ["scrapling", () => scrapeWithPythonService(companyOrLink, "scrapling")],
      [
        "firecrawl",
        async () => {
          const doc = await firecrawl.scrape(companyOrLink, { formats: ["markdown"] });
          return doc.markdown ?? "";
        },
      ],
      // Last-resort engines, tried only if the three above all fail (JS-heavy
      // pages crawl4ai/scrapling/firecrawl can't render, or ones actively
      // blocking headless fetches) — selenium drives a real Chrome instance,
      // scrapy is a plain HTTP+CSS/XPath fetch. Both were wired into the
      // Python scraper service but never actually called from here before.
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
      `${companyName}${descSuffix} reviews complaints (site:g2.com OR site:trustpilot.com OR site:reddit.com OR site:capterra.com OR site:sitejabber.com OR site:consumeraffairs.com OR site:amazon.in OR site:amazon.com OR site:flipkart.com OR site:mouthshut.com)`,
      8
    ),
    scrapeGooglePlayReviews(companyName).catch(() => null),
    scrapeAppStoreReviews(companyName).catch(() => null),
  ]);

  // Firecrawl's search API does not reliably honor the `site:` filters above
  // (confirmed in practice: a "reviews complaints" query for ubonindia.com
  // returned ubonindia.com's own "About Us" and blog pages, and a YouTube
  // unboxing video — none of which are real customer review text). The query
  // is only a hint; this hard allowlist against REVIEW_PLATFORM_HOSTS is the
  // actual enforcement of "never the company's own site."
  const webResults = rawWebResults.filter((item) => {
    const itemUrl = isUrl(item.url);
    return itemUrl ? isKnownReviewPlatform(itemUrl) : false;
  });

  for (const item of webResults) {
    reviewChunks.push(`--- from ${item.url} (${item.title ?? "untitled"}) ---\n${item.markdown}`);
  }
  if (webResults.some((r) => r.engine === "firecrawl")) sourcesUsed.push("firecrawl-search:reviews");
  if (webResults.some((r) => r.engine === "duckduckgo")) sourcesUsed.push("duckduckgo-search:reviews");

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
