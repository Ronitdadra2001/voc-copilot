import { z } from "zod";
import { chatCompletion } from "./llm";
import { getKnowledgeBase } from "./knowledge-base";
import type { AnalysisResult, Direction, DashboardReport } from "./types";

const ThemeSchema = z.object({
  title: z.string(),
  mention_count: z.number().int(),
  pct_of_reviews: z.number(),
  quotes: z.array(z.string()),
  at_risk: z.boolean(),
  at_risk_signals: z.array(z.string()),
  product_recommendation: z.string(),
  marketing_recommendation: z.string(),
  finance_recommendation: z.string(),
});

const AnalysisResultSchema = z.object({
  summary: z.string(),
  total_reviews_analyzed: z.number().int(),
  themes: z.array(ThemeSchema),
});

const SCHEMA_INSTRUCTIONS = `Respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly this shape:

{
  "summary": string,
  "total_reviews_analyzed": integer,
  "themes": [
    {
      "title": string,
      "mention_count": integer,
      "pct_of_reviews": number,
      "quotes": string[],
      "at_risk": boolean,
      "at_risk_signals": string[],
      "product_recommendation": string,
      "marketing_recommendation": string,
      "finance_recommendation": string
    }
  ]
}`;

// A scraped product/listing page's markdown is mostly nav links, image
// syntax, price tags and one-word spec bullets — none of that is a review.
// Confirmed in practice: splitting such a page naively inflated
// "total reviews analyzed" to 883 for a brand with a handful of genuine
// complaints (5, 4, 3 mentions), making every theme's pct_of_reviews read as
// a fraction of a percent — mathematically correct given the (wrong)
// denominator, but meaningless to read. A block only counts as a review if
// it reads like a sentence someone wrote, not a markdown fragment.
const MIN_REVIEW_WORDS = 4;
// Each pattern must match the ENTIRE block (fully anchored) — a block is
// junk only if it IS one of these things, not merely if it starts with a
// character one of these also uses. An earlier unanchored version of the
// dash-check (`^[-*|]{2,}`) matched the START of the "--- from URL (title)
// ---" prefix that gatherReviews.ts prepends to every real chunk, so it
// silently rejected 100% of otherwise-legitimate review content — confirmed
// in practice: 66KB of real Trustpilot review text reduced to 0 reviews.
const JUNK_LINE_PATTERNS = [
  /^!?\[[^\]]*\]\([^)]*\)$/, // a line that is only a markdown link/image
  /^#{1,6}\s.*$/, // a markdown heading line
  /^[-*|]{2,}\s*$/, // a bare divider/separator line (only dashes/asterisks/pipes)
  /^[\d.,%$₹]+$/, // a bare number/price/percentage with nothing else
];

function looksLikeReview(block: string): boolean {
  if (JUNK_LINE_PATTERNS.some((re) => re.test(block))) return false;
  const words = block.split(/\s+/).filter(Boolean);
  if (words.length < MIN_REVIEW_WORDS) return false;
  // Needs actual prose (letters), not just a table row of numbers/symbols.
  return /[a-zA-Z]{3,}/.test(block);
}

function splitReviews(raw: string): string[] {
  const blankLineBlocks = raw
    .split(/\n\s*\n/g)
    .map((r) => r.trim())
    .filter(Boolean);

  // If the input has no blank-line separators (one review per line), fall
  // back to splitting on single newlines instead of treating it as one blob.
  const candidates =
    blankLineBlocks.length > 1
      ? blankLineBlocks
      : raw
          .split(/\r?\n/g)
          .map((r) => r.trim())
          .filter(Boolean);

  return candidates.filter(looksLikeReview);
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  return JSON.parse(candidate.trim());
}

export async function runAnalysis(
  companyName: string,
  direction: Direction,
  rawReviews: string,
  userQuestion?: string
): Promise<AnalysisResult> {
  const reviews = splitReviews(rawReviews);
  const knowledgeBase = getKnowledgeBase();

  const perspective =
    direction === "competitor"
      ? `The user is sizing up a COMPETITOR ("${companyName}") to find exactly where it is failing customers, so they can beat them or avoid the same mistakes.`
      : `The user is analyzing THEIR OWN product ("${companyName}") to find their top customer problems to prioritize on the roadmap.`;

  const questionBlock = userQuestion?.trim()
    ? `\nThe user provided this product context / question: "${userQuestion.trim()}". If it reads as a genuine question (e.g. "how are the reviews," "what do customers need," anything about the company or its customers), the "summary" field must directly answer it in plain language, grounded only in the reviews below (say "the reviews don't cover that" if they genuinely don't). If it's just a product category descriptor (e.g. "food delivery app in India"), use it only as context for interpreting the reviews.\n`
    : "";

  const system = `You are the analysis engine behind a Voice-of-Customer copilot. Given raw customer reviews, you must:

1. Find the top pain points customers complain about.
2. Cluster related complaints into specific, named themes (e.g. group "app crashes", "kept freezing", "wouldn't load" into one "Stability" theme) — never output a vague theme like "general dissatisfaction."
3. Attach the REAL verbatim customer quotes behind each theme (copy exact substrings from the input reviews — do not paraphrase quotes).
4. Flag at-risk / stated-exit signals per theme ONLY when the reviews in that theme actually contain explicit exit language: "cancelled," "switching to X," "uninstalled," "asking for refund," "never using again." at_risk_signals must quote the exact phrase found — if you cannot quote a real exit-intent phrase from the reviews, at_risk_signals must be an empty array and at_risk must be false. Do NOT default every theme to at_risk=true — most themes are just complaints, not stated exits, and marking all of them at-risk is a fabrication the user has explicitly flagged as wrong. Do not call this "churn" — you cannot observe churn from reviews, only stated exit intent.
5. For each theme, write ONE recommendation per lens (product, marketing, finance), applying the opinionated frameworks in the knowledge base below. Every recommendation must be specific and quantified where the data allows (cite the mention count/percentage) — never a vague platitude like "improve the experience."

${perspective}
${questionBlock}
Rank themes by mention_count descending. Only include themes with at least 2 supporting mentions. pct_of_reviews = mention_count / total_reviews_analyzed * 100, rounded to 1 decimal.

=== OPINIONATED KNOWLEDGE BASE (apply these frameworks in your recommendations) ===
${knowledgeBase}

${SCHEMA_INSTRUCTIONS}`;

  const user = `Company: ${companyName}\nDirection: ${direction}\nTotal reviews provided: ${reviews.length}\n\nReviews:\n${reviews
    .map((r, i) => `[${i + 1}] ${r}`)
    .join("\n")}`;

  const content = await chatCompletion({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    jsonMode: true,
    temperature: 0.3,
  });

  const parsed = extractJson(content);
  const result = AnalysisResultSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(
      `Model response didn't match expected schema: ${result.error.message}`
    );
  }
  return result.data;
}

const DashboardReportSchema = z.object({
  summary: z.string().default(""),
  metrics: z.object({
    total_reviews: z.number().int(),
    theme_count: z.number().int(),
    at_risk_theme_count: z.number().int(),
    top_theme_title: z.string().nullable(),
    top_theme_pct: z.number().nullable(),
  }),
  highs: z.array(z.object({ label: z.string(), detail: z.string() })),
  lows: z.array(
    z.object({
      label: z.string(),
      detail: z.string(),
      pct: z.number(),
      at_risk: z.boolean(),
      kano: z.enum(["must-be", "performance", "delighter"]),
    })
  ),
  porters_five_forces: z.object({
    rivalry: z.string(),
    threat_of_new_entrants: z.string(),
    threat_of_substitutes: z.string(),
    buyer_power: z.string(),
    supplier_power: z.string(),
  }),
  gtm: z.object({
    segment: z.string(),
    target: z.string(),
    position: z.string(),
    points_of_difference: z.array(z.string()),
    points_of_parity: z.array(z.string()),
  }),
  product_roadmap: z.array(
    z.object({
      action: z.string(),
      reach: z.number(),
      impact: z.number(),
      confidence: z.number(),
      effort: z.number(),
      score: z.number(),
      rationale: z.string(),
      how_to_implement: z.array(z.string()),
      metric_to_track: z.string(),
    })
  ),
  finance: z.object({
    own: z.object({ found: z.boolean(), findings: z.array(z.string()) }),
    competitors: z.array(
      z.object({
        name: z.string(),
        found: z.boolean(),
        findings: z.array(z.string()),
        comparison: z.string().nullable(),
      })
    ),
    unit_economics_notes: z.array(z.string()),
    revenue_at_risk: z.object({
      applicable: z.boolean(),
      estimate: z.string().nullable(),
      assumptions: z.array(z.string()),
    }),
  }),
  roadmap: z.array(
    z.object({
      priority: z.enum(["now", "near", "far"]),
      action: z.string(),
      rationale: z.string(),
    })
  ),
  brand: z.object({
    node_word: z.string().nullable(),
    node_word_evidence: z.string(),
    weakest_cbbe_layer: z.string(),
    weakest_cbbe_layer_evidence: z.string(),
    personas: z.array(
      z.object({
        name: z.string(),
        context: z.string(),
        goals: z.string(),
        pain_points: z.string(),
      })
    ),
    campaign: z
      .object({
        enemy: z.string(),
        stand: z.string(),
        mantra: z.string(),
      })
      .nullable(),
  }),
});

const DASHBOARD_SCHEMA_INSTRUCTIONS = `Respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly this shape:

{
  "metrics": {
    "total_reviews": integer, "theme_count": integer, "at_risk_theme_count": integer,
    "top_theme_title": string | null, "top_theme_pct": number | null
  },
  "highs": [{ "label": string, "detail": string }],
  "lows": [{ "label": string, "detail": string, "pct": number, "at_risk": boolean, "kano": "must-be" | "performance" | "delighter" }],
  "porters_five_forces": {
    "rivalry": string, "threat_of_new_entrants": string, "threat_of_substitutes": string,
    "buyer_power": string, "supplier_power": string
  },
  "gtm": {
    "segment": string, "target": string, "position": string,
    "points_of_difference": string[], "points_of_parity": string[]
  },
  "product_roadmap": [
    { "action": string, "reach": number, "impact": number, "confidence": number, "effort": number, "score": number, "rationale": string, "how_to_implement": string[], "metric_to_track": string }
  ],
  "finance": {
    "own": { "found": boolean, "findings": string[] },
    "competitors": [{ "name": string, "found": boolean, "findings": string[], "comparison": string | null }],
    "unit_economics_notes": string[],
    "revenue_at_risk": { "applicable": boolean, "estimate": string | null, "assumptions": string[] }
  },
  "roadmap": [{ "priority": "now" | "near" | "far", "action": string, "rationale": string }],
  "brand": {
    "node_word": string | null,
    "node_word_evidence": string,
    "weakest_cbbe_layer": string,
    "weakest_cbbe_layer_evidence": string,
    "personas": [{ "name": string, "context": string, "goals": string, "pain_points": string }],
    "campaign": { "enemy": string, "stand": string, "mantra": string } | null
  }
}`;

export interface CompetitorInput {
  name: string;
  productFindings: string;
  financial: { found: boolean; markdown: string };
}

export async function runReport(
  companyName: string,
  direction: Direction,
  analysisResult: AnalysisResult,
  competitors: CompetitorInput[],
  ownFinancialContext: string
): Promise<DashboardReport> {
  const knowledgeBase = getKnowledgeBase();

  const competitorsBlock = competitors.length
    ? competitors
        .map(
          (c) => `Competitor: ${c.name}
Product/positioning context: ${c.productFindings.slice(0, 700) || "(none found)"}
Financial context: ${c.financial.found ? c.financial.markdown.slice(0, 700) : "(none found)"}`
        )
        .join("\n\n")
    : "(no named competitors found)";

  const system = `You produce a metrics-first dashboard + report (NOT prose, no executive summary) from a completed Voice-of-Customer analysis for "${companyName}" (direction: ${direction}). This must read like a real analyst's dashboard: every number/finding traceable to the data below, nothing invented.

1. "metrics" — total_reviews = total_reviews_analyzed, theme_count = number of themes, at_risk_theme_count = count of at_risk themes, top_theme_title/pct = highest pct_of_reviews theme (null if none).
2. "highs" — concrete positives ONLY if the data supports them; empty array if genuinely none — never invent one.
3. "lows" — one entry per theme, at_risk first then by pct_of_reviews descending. "kano" (Kano model): "must-be" for baseline/core-function failures (crashes, can't complete a core task, billing/refund failures — absence of these causes major dissatisfaction, they are not "nice to haves"), "performance" for issues where more-is-better (speed, support responsiveness, feature completeness), "delighter" for issues that are absent-but-not-fatal (missing polish, minor UX friction). Must-be violations should dominate the "now" priority in the roadmap below.
4. "porters_five_forces" — qualitative, one sentence each, grounded ONLY in what's actually in front of you. NAMED COMPETITORS below is real, verified data — use it, do not default to "insufficient data" when it's non-empty:
    - rivalry: 0 named competitors → "competitive intensity can't be assessed from available data." 1+ named competitors → you MUST name them and describe the rivalry qualitatively from what their product/financial context actually shows (e.g. "Moderate-to-high — Swiggy is a named, well-funded direct competitor in the same category, per public comparison sources"). Never say "insufficient data" when at least one real competitor name is present below.
    - threat_of_new_entrants/substitutes/buyer_power/supplier_power = reasoned from the product category, review evidence, AND named competitors (e.g. many complaints about pricing → high buyer power; a funded direct competitor exists → substitution risk is real, say so). Only say "insufficient data" for a force when there is truly nothing below to reason from — not as a default when data exists but requires synthesis.
5. "gtm" (bhupesh GTM/branding frameworks: STP + 3C positioning + POD/POP) — segment/target/position inferred from the product description and review evidence; points_of_difference = things this product does that named competitors' context does NOT show (grounded in the competitor product context below, not invented); points_of_parity = things reviews show this product does that competitors also seem to do. If no competitor context exists, points_of_difference/points_of_parity can be empty arrays — do not invent competitor behavior.
6. "product_roadmap" (RICE prioritization) — one row per major theme/opportunity: reach (0-100 estimate from pct_of_reviews), impact (1-3), confidence (0-1, lower if evidence is thin), effort (1-3 person-months estimate), score = (reach*impact*confidence)/effort rounded to 1 decimal. rationale must cite the specific theme/data.
   - "how_to_implement": 2-4 concrete, sequenced steps to actually execute the action — not a restatement of the rationale. Apply the Consultant Engine's cheapest-fix-first doctrine: step 1 should be the free/near-free version if one exists (a copy/config/policy change) before anything requiring engineering or spend; only recommend paid marketing/spend AFTER the underlying issue is addressed (the Sequencing Law — never recommend advertising into a broken experience). Each step must be something a named role could actually start on Monday (e.g. "Set up a dedicated 'order accuracy' ticket tag in the support queue and route it to a senior agent" — not "improve support").
   - "metric_to_track": one sentence naming the single number that proves this worked, its baseline if inferable from the review data (e.g. "currently 55.6% of reviews cite this"), and a target.
7. "finance" — own.found/competitors[].found must be true ONLY when real text is present in the sections below; findings must be traceable to that text (never invent a number). "comparison" per competitor: a factual one-sentence comparison of the competitor's real financial standing vs this company's, using ONLY numbers present in both texts — if either side lacks real numbers, comparison MUST be null (do not guess who's "winning"). unit_economics_notes: apply finance-lens reasoning (relevant cost, unit economics, cost-of-problem from the at-risk themes) ONLY where real figures support it; otherwise leave empty.
8. "finance.revenue_at_risk" (Guesstimate framework: state assumptions, then compute) — applicable=true ONLY if a real revenue figure exists in OWN COMPANY FINANCIAL CONTEXT below; if applicable, estimate = a modeled dollar range computed as: stated revenue × (sum of at-risk themes' pct_of_reviews as a proxy for the share of customers at risk of churning), with assumptions listing every step of that logic explicitly (e.g. "using X% at-risk mention share as a proxy for at-risk revenue share — an approximation, not a measured churn rate"). If no real revenue figure was found, applicable=false, estimate=null, assumptions=[] — do not compute a number from nothing.
9. "roadmap" — legacy compact view: Impact-Effort Now/Near/Far, each citing its source theme/data. Must-be Kano violations belong in "now".
10. "brand" (bhupesh consumer-behavior/branding frameworks — CBBE, node word, ESM) — grounded ONLY in review language and competitor context below, never invented demographics or claims:
    - "node_word": the single word this brand owns in customers' minds, if the evidence supports one (e.g. reviews/positioning repeatedly signal "reliable" or "cheap"). null if no clear word emerges — do not force one.
    - "node_word_evidence": one sentence citing what in the reviews/competitor text supports it, or "insufficient data" if node_word is null.
    - "weakest_cbbe_layer": one of salience / performance / imagery / judgements / feelings / resonance — pick whichever the review evidence shows is weakest (e.g. many reviews are surprised the company exists = salience; many function complaints = performance; complaints about feeling cheap despite working fine = imagery; no repeat-purchase/advocacy language = resonance).
    - "weakest_cbbe_layer_evidence": one sentence citing the specific review pattern that shows this.
    - "personas": 2-3 personas ONLY if the reviews contain enough concrete detail (stated use case, role, complaint pattern) to build one honestly — each persona's context/goals/pain_points must trace to actual review language, not invented demographics (no fabricated age/income/city unless a review states it). Return an empty array if reviews are too generic/thin to support real personas.
    - "campaign": an Enemy-Stand-Mantra angle (enemy = the ideology/behavior/condition the brand fights, NOT a competitor; stand = the brand's higher purpose; mantra = a short memorable phrase) ONLY if a real customer pain point in the reviews clearly justifies one. null if the data doesn't support a genuine enemy — do not invent a manufactured one.

=== OPINIONATED KNOWLEDGE BASE (finance/marketing/product frameworks) ===
${knowledgeBase}

=== ANALYSIS RESULT (condensed) ===
${JSON.stringify(
  {
    summary: analysisResult.summary,
    total_reviews_analyzed: analysisResult.total_reviews_analyzed,
    themes: analysisResult.themes.map((t) => ({
      title: t.title,
      mention_count: t.mention_count,
      pct_of_reviews: t.pct_of_reviews,
      at_risk: t.at_risk,
      at_risk_signals: t.at_risk_signals,
      product_recommendation: t.product_recommendation.slice(0, 200),
      marketing_recommendation: t.marketing_recommendation.slice(0, 200),
      finance_recommendation: t.finance_recommendation.slice(0, 200),
    })),
  },
  null,
  2
)}

=== OWN COMPANY FINANCIAL CONTEXT (empty = none found — do not fabricate) ===
${(ownFinancialContext || "(none found)").slice(0, 1200)}

=== NAMED COMPETITORS (empty = none found — do not invent a competitor) ===
${competitorsBlock}

${DASHBOARD_SCHEMA_INSTRUCTIONS}`;

  const content = await chatCompletion({
    messages: [{ role: "system", content: system }],
    jsonMode: true,
    temperature: 0.2,
  });

  const parsed = extractJson(content);
  const result = DashboardReportSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Report response didn't match expected schema: ${result.error.message}`);
  }
  const report = result.data;

  // Hard backstop, not just a prompt instruction: confirmed in practice that
  // when analysisResult.themes is empty, the model still fabricated a full
  // RICE roadmap, Kano-tagged action items, and personas out of thin air —
  // grounded in nothing, since there were no themes to ground them in. A
  // prompt instruction alone didn't stop it once; force it in code instead
  // of trusting the model to self-police every time.
  if (analysisResult.themes.length === 0) {
    report.lows = [];
    report.product_roadmap = [];
    report.roadmap = [];
    report.metrics.theme_count = 0;
    report.metrics.at_risk_theme_count = 0;
    report.metrics.top_theme_title = null;
    report.metrics.top_theme_pct = null;
    report.brand.personas = [];
    report.brand.node_word = null;
    report.brand.node_word_evidence = "No review themes were found to derive a brand association from.";
    report.brand.weakest_cbbe_layer = "unknown";
    report.brand.weakest_cbbe_layer_evidence = "No review themes were found to diagnose brand health from.";
    report.brand.campaign = null;
  }

  return report;
}
