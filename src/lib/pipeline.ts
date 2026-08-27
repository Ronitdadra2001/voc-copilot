import { z } from "zod";
import { chatCompletion } from "./llm";
import {
  getKnowledgeBase,
  getConsumerBehaviorJourneyKnowledge,
  getMarketingBrandingKnowledge,
  getProductKnowledge,
  getFinanceKnowledge,
} from "./knowledge-base";
import type { AnalysisResult, Direction, DashboardReport } from "./types";

const RawIssueSchema = z.object({
  title: z.string(),
  mention_count: z.number().int(),
  pct_of_reviews: z.number(),
  quotes: z.array(z.string()),
  at_risk: z.boolean(),
  at_risk_signals: z.array(z.string()),
  product_recommendation: z.string(),
  marketing_recommendation: z.string(),
  behavior_recommendation: z.string(),
});

const AnalysisResultSchema = z.object({
  summary: z.string(),
  total_reviews_analyzed: z.number().int(),
  issues: z.array(RawIssueSchema),
});

const SCHEMA_INSTRUCTIONS = `Respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly this shape:

{
  "summary": string,
  "total_reviews_analyzed": integer,
  "issues": [
    {
      "title": string,
      "mention_count": integer,
      "pct_of_reviews": number,
      "quotes": string[],
      "at_risk": boolean,
      "at_risk_signals": string[],
      "product_recommendation": string,
      "marketing_recommendation": string,
      "behavior_recommendation": string
    }
  ]
}`;

// A scraped product/listing page's markdown is mostly nav links, image
// syntax, price tags and one-word spec bullets — none of that is a review.
// Confirmed in practice: splitting such a page naively inflated
// "total reviews analyzed" to 883 for a brand with a handful of genuine
// complaints (5, 4, 3 mentions), making every issue's pct_of_reviews read as
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

// LLM JSON-mode output occasionally isn't quite valid JSON — confirmed live
// via "Expected property name or '}' in JSON at position ..." on real report
// generations, most likely a trailing comma the model left before a closing
// brace/bracket when a field near the end of a large schema (this app's
// schemas grew substantially this session) got cut short mid-list. A strict
// JSON.parse has no tolerance for that single-character defect and throws
// away an otherwise-complete, otherwise-valid response. Retry once with this
// one defect class stripped before giving up — cheap, safe (only rewrites
// syntax JSON.parse already rejected, never touches valid content).
function repairJsonSyntax(text: string): string {
  return text.replace(/,(\s*[}\]])/g, "$1");
}

function extractJson(content: string): unknown {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : content;
  const trimmed = candidate.trim();
  try {
    return JSON.parse(trimmed);
  } catch (err) {
    try {
      return JSON.parse(repairJsonSyntax(trimmed));
    } catch {
      throw err; // report the ORIGINAL parse error — it's the more useful one to debug from
    }
  }
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
2. Cluster related complaints into specific, plainly-named issues (e.g. group "app crashes", "kept freezing", "wouldn't load" into one issue named "App stability/crashes") — never output a vague issue like "general dissatisfaction," and never label it as an abstract "theme."
3. Attach the REAL verbatim customer quotes behind each issue (copy exact substrings from the input reviews — do not paraphrase quotes).
4. Flag at-risk / stated-exit signals per issue ONLY when the reviews for that issue actually contain explicit exit language: "cancelled," "switching to X," "uninstalled," "asking for refund," "never using again." at_risk_signals must quote the exact phrase found — if you cannot quote a real exit-intent phrase from the reviews, at_risk_signals must be an empty array and at_risk must be false. Do NOT default every issue to at_risk=true — most issues are just complaints, not stated exits, and marking all of them at-risk is a fabrication the user has explicitly flagged as wrong. Do not call this "churn" — you cannot observe churn from reviews, only stated exit intent.
5. For each issue, write ONE recommendation per lens (product, marketing, consumer-behavior), applying the opinionated frameworks in the knowledge base below. Every recommendation must be specific and quantified where the data allows (cite the mention count/percentage) — never a vague platitude like "improve the experience." The consumer-behavior recommendation must name the specific concept it's applying (e.g. "this is a Conjunctive-elimination dealbreaker" or "this damages the Ego-Defensive attitude function") — plain language first, concept name second. Never attribute a concept to a person's name — cite the concept itself (e.g. "the CBBE pyramid," "Kapferer's Prism," "Loss Aversion"), not a professor or course name.

${perspective}
${questionBlock}
Rank issues by mention_count descending. Only include issues with at least 2 supporting mentions. pct_of_reviews = mention_count / total_reviews_analyzed * 100, rounded to 1 decimal.

=== OPINIONATED KNOWLEDGE BASE (apply these frameworks in your recommendations) ===
${knowledgeBase}

${SCHEMA_INSTRUCTIONS}`;

  // A live scrape can return far more reviews than a single LLM call can
  // afford — measure the actual system prompt that will be sent and size the
  // review sample against the budget that's ACTUALLY left, so this stays
  // correct regardless of future edits to the knowledge base or instructions.
  // ~4 chars/token is a standard, safely-conservative estimate for English
  // prose (real BPE tokenizers usually do a bit better than this, so this
  // slightly over-estimates cost, which is the safe direction to err in).
  //
  // This budget is calibrated to Gemini (the primary provider — effectively
  // unbounded input context) and OpenAI (128k context, third in the failover
  // chain), NOT to Groq's account-wide 8,000-tokens/minute cap. Confirmed
  // live: getKnowledgeBase()'s three combined files (product/marketing/
  // consumer-behavior) alone now run ~6,200 tokens, which left this budget
  // clamping reviewCharBudget to 0 when it was still sized for Groq — every
  // real analysis silently sent ZERO review text to the model and came back
  // "0 reviews found" even though gather-reviews had fetched genuine data.
  // Groq is no longer primary, so sizing this call to Groq's cap was
  // over-constraining the common case (Gemini succeeding) to protect an
  // uncommon one (Groq being reached at all) — and the provider loop in
  // llm.ts already fails a too-large Groq request over to OpenAI/OpenRouter
  // gracefully, so there is no correctness cost to raising this.
  const estimateTokens = (text: string) => Math.ceil(text.length / 4);
  const REQUEST_TOKEN_BUDGET = 30000;
  const OUTPUT_TOKEN_RESERVE = 4000; // matches maxTokens passed to chatCompletion below
  const fixedPromptTokens = estimateTokens(system);
  const reviewCharBudget = Math.max(
    0,
    (REQUEST_TOKEN_BUDGET - OUTPUT_TOKEN_RESERVE - fixedPromptTokens) * 4
  );

  const MAX_REVIEWS_PER_ANALYSIS = 40;
  const analyzedReviews: string[] = [];
  let charBudget = 0;
  for (const r of reviews) {
    if (analyzedReviews.length >= MAX_REVIEWS_PER_ANALYSIS || charBudget + r.length > reviewCharBudget) break;
    analyzedReviews.push(r);
    charBudget += r.length;
  }
  const sampledNote =
    reviews.length > analyzedReviews.length
      ? ` (sampled from ${reviews.length} found — analyzing the first ${analyzedReviews.length} to stay within provider limits)`
      : "";

  const user = `Company: ${companyName}\nDirection: ${direction}\nTotal reviews provided: ${analyzedReviews.length}${sampledNote}\n\nReviews:\n${analyzedReviews
    .map((r, i) => `[${i + 1}] ${r}`)
    .join("\n")}`;

  const content = await chatCompletion({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    jsonMode: true,
    temperature: 0.3,
    // Was 1200, matching an OUTPUT_TOKEN_RESERVE that assumed the review-
    // budget clamp above would keep review count tiny. Now that the budget
    // fix lets a real sample (up to 40 reviews) through, the model has far
    // more to cluster/quote/recommend on — 1200 tokens truncated mid-string
    // on a real run ("Unterminated string in JSON"), confirmed live.
    maxTokens: 4000,
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

export interface CompetitorInput {
  name: string;
  productFindings: string;
  financial: { found: boolean; markdown: string };
}

// ============================================================================
// Report generation: three deliberate, domain-scoped passes instead of one
// do-everything call. Confirmed in practice that a single pass with the full
// knowledge base dumped in produces answers that name-drop frameworks without
// actually reasoning through them. Splitting into passes forces each domain
// to be read and applied on its own before the next pass builds on it —
// consumer behavior/journey first (understand the customer), then marketing/
// branding and product/finance in parallel (both only need the behavior
// pass's output, not each other's).
// ============================================================================

function condenseIssuesForPrompt(analysisResult: AnalysisResult) {
  return analysisResult.issues.map((t) => ({
    title: t.title,
    mention_count: t.mention_count,
    pct_of_reviews: t.pct_of_reviews,
    at_risk: t.at_risk,
    at_risk_signals: t.at_risk_signals,
    // Real verbatim quotes — the only legitimate source for evidence bullets
    // downstream. Without these, later passes have nothing to cite and were
    // confirmed in practice to leave "evidence" empty rather than inventing
    // one — better than fabricating, but still a compliance gap this closes.
    quotes: t.quotes.slice(0, 3),
    product_recommendation: t.product_recommendation.slice(0, 200),
    marketing_recommendation: t.marketing_recommendation.slice(0, 200),
    behavior_recommendation: t.behavior_recommendation.slice(0, 200),
  }));
}

const BehaviorJourneySchema = z.object({
  issues: z.array(
    z.object({
      title: z.string(),
      journey_stage: z.string(),
      behavior_insight: z.string(),
    })
  ),
});
type BehaviorJourneyResult = z.infer<typeof BehaviorJourneySchema>;

/** Pass 1 — Consumer Behavior & Customer Journey. Read this domain FIRST:
 * every downstream pass (branding, product fixes) should be grounded in
 * understanding why the customer reacted the way they did and where in
 * their journey it happened, not just what they said. */
async function runConsumerBehaviorJourneyPass(
  companyName: string,
  analysisResult: AnalysisResult
): Promise<BehaviorJourneyResult> {
  if (analysisResult.issues.length === 0) return { issues: [] };
  const knowledgeBase = getConsumerBehaviorJourneyKnowledge();

  const system = `You are reasoning through ONE lens only: consumer behavior and customer journey — for "${companyName}". Do not produce a final report. The knowledge base below lists 24 named CB concepts (CDM funnel, value equation, valence, conditioning, memory nodes, positioning-vs-perceptual gap, JND, selective attention, assimilation-contrast, attitude ABC + 4 functions, hierarchy of effects, Horney personality types, AAAERRR journey, attribution theory, decision rules, diffusion of innovation, CBBE layers, brand fidelity matrix, Hofstede, ESM, RFM, brand-switch signal, crisis-coping style, trust-involvement relationship depth). Deliberately spread your reasoning across a WIDE set of these across the issues below — do not lean on the same 2-3 concepts for every issue. For each issue below, determine:
- "journey_stage": where in the customer's path this breaks (e.g. "discover", "consider/evaluate", "purchase/checkout", "onboarding/first-use", "core use", "support/service", "renewal/advocacy") — pick the stage the quotes actually describe, not a guess.
- "behavior_insight": one to two sentences naming the SPECIFIC concept(s) from the knowledge base that best diagnose this issue (e.g. attitude function damaged, which decision rule this fails under, which Horney type the complaining voice reads as, whether it crosses JND, which CBBE layer it erodes) and why that changes how serious or urgent this is — grounded strictly in the actual quotes for that issue. Never invent a behavioral claim the quotes don't support — if the quotes are too thin to diagnose confidently, say the evidence is limited rather than forcing a concept onto it.

=== CONSUMER BEHAVIOR + CUSTOMER JOURNEY KNOWLEDGE ===
${knowledgeBase}

=== ISSUES (from the completed review analysis) ===
${JSON.stringify(condenseIssuesForPrompt(analysisResult), null, 2)}

Respond with ONLY a single JSON object (no markdown fences, no commentary):
{ "issues": [{ "title": string, "journey_stage": string, "behavior_insight": string }] }
One entry per issue above, "title" must match exactly.`;

  const content = await chatCompletion({
    messages: [{ role: "system", content: system }],
    jsonMode: true,
    temperature: 0.2,
  });

  const parsed = extractJson(content);
  const result = BehaviorJourneySchema.safeParse(parsed);
  if (!result.success) {
    // This pass is context for the ones that follow, not user-facing output
    // — degrade gracefully to "no behavioral grounding yet" rather than
    // failing the whole report over an intermediate pass.
    return { issues: [] };
  }
  return result.data;
}

function behaviorContextBlock(behavior: BehaviorJourneyResult): string {
  if (behavior.issues.length === 0) {
    return "(consumer-behavior/journey pass returned nothing — proceed without this grounding rather than inventing it)";
  }
  return JSON.stringify(behavior.issues, null, 2);
}

const GtmBrandSchema = z.object({
  gtm: z.object({
    segment: z.string(),
    target: z.string(),
    position: z.string(),
    points_of_difference: z.array(z.string()),
    points_of_parity: z.array(z.string()),
    ansoff: z.object({
      quadrant: z
        .enum(["market_penetration", "product_development", "market_development", "diversification"])
        .nullable(),
      rationale: z.string(),
    }),
    product_life_cycle: z.object({
      stage: z.enum(["introduction", "growth", "maturity", "decline"]).nullable(),
      rationale: z.string(),
    }),
  }),
  brand: z.object({
    node_word: z.string().nullable(),
    node_word_evidence: z.string(),
    weakest_cbbe_layer: z.string(),
    weakest_cbbe_layer_evidence: z.string(),
    archetype: z.object({
      name: z
        .enum([
          "Innocent", "Explorer", "Sage", "Hero", "Outlaw", "Magician",
          "Lover", "Jester", "Caregiver", "Ruler", "Creator", "Everyman",
        ])
        .nullable(),
      rationale: z.string(),
    }),
    posture: z.object({
      stance: z.enum(["offensive", "defensive", "assertive"]).nullable(),
      rationale: z.string(),
    }),
    asset_valuator: z.object({
      vitality: z.number().min(1).max(10).nullable(),
      stature: z.number().min(1).max(10).nullable(),
      quadrant: z
        .enum(["leadership", "niche_unrealized_potential", "declining_eroded", "new_unfocused_commodity"])
        .nullable(),
      rationale: z.string(),
    }),
    personas: z.array(
      z.object({
        name: z.string(),
        context: z.string(),
        goals: z.string(),
        pain_points: z.string(),
      })
    ),
    campaign: z
      .object({ enemy: z.string(), stand: z.string(), mantra: z.string() })
      .nullable(),
    kapferer_prism: z.object({
      physique: z.string().nullable(),
      personality: z.string().nullable(),
      relationship: z.string().nullable(),
      culture: z.string().nullable(),
      reflection: z.string().nullable(),
      self_image: z.string().nullable(),
    }),
  }),
});
type GtmBrandResult = z.infer<typeof GtmBrandSchema>;

const DEFAULT_GTM_BRAND: GtmBrandResult = {
  gtm: {
    segment: "insufficient data",
    target: "insufficient data",
    position: "insufficient data",
    points_of_difference: [],
    points_of_parity: [],
    ansoff: { quadrant: null, rationale: "insufficient data" },
    product_life_cycle: { stage: null, rationale: "insufficient data" },
  },
  brand: {
    node_word: null,
    node_word_evidence: "insufficient data",
    weakest_cbbe_layer: "unknown",
    weakest_cbbe_layer_evidence: "insufficient data",
    archetype: { name: null, rationale: "insufficient data" },
    posture: { stance: null, rationale: "insufficient data" },
    asset_valuator: { vitality: null, stature: null, quadrant: null, rationale: "insufficient data" },
    personas: [],
    campaign: null,
    kapferer_prism: {
      physique: null,
      personality: null,
      relationship: null,
      culture: null,
      reflection: null,
      self_image: null,
    },
  },
};

/** Pass 2 — Marketing & Branding. Runs in parallel with the product/finance
 * pass; both only depend on the behavior/journey pass, not on each other. */
async function runMarketingBrandingPass(
  companyName: string,
  direction: Direction,
  analysisResult: AnalysisResult,
  competitors: CompetitorInput[],
  behavior: BehaviorJourneyResult
): Promise<GtmBrandResult> {
  if (analysisResult.issues.length === 0) return DEFAULT_GTM_BRAND;
  const knowledgeBase = getMarketingBrandingKnowledge();

  const competitorsBlock = competitors.length
    ? competitors
        .map(
          (c) => `Competitor: ${c.name}
Product/positioning context: ${c.productFindings.slice(0, 700) || "(none found)"}
Financial context: ${c.financial.found ? c.financial.markdown.slice(0, 700) : "(none found)"}`
        )
        .join("\n\n")
    : "(no named competitors found)";

  const system = `You are reasoning through ONE lens only: marketing and branding — for "${companyName}" (direction: ${direction}). Apply the STP/3C/POD-POP/CBBE/node-word/Enemy-Stand-Mantra/brand-fidelity-matrix/Kapferer-Prism/Ansoff-Matrix/Brand-Asset-Valuator/Recognition-Recall-Matrix/Offensive-Defensive-Assertive-posture/Brand-Archetype frameworks in the knowledge base below. Tone: plain language first (what the customer actually experiences), THEN name the framework — never framework-name-dropping with no plain-English anchor.

- "gtm": segment/target/position inferred from the product/reviews; points_of_difference = things this product does that named competitors' context does NOT show (grounded in competitor data below, never invented); points_of_parity = things reviews show this product does that competitors also seem to do. Empty arrays if no competitor context exists — do not invent competitor behavior.
- "gtm.ansoff": which of the 4 Ansoff growth quadrants the recommended direction actually falls into, grounded in what the issues/competitor data show — market_penetration (fix issues to win more of the existing market with the existing product), product_development (build new features/products for existing customers), market_development (take the existing product to a new segment/geography), diversification (new product + new market). null quadrant + "insufficient data" if the evidence doesn't clearly point to one — never force a quadrant.
- "gtm.product_life_cycle": which PLC stage the evidence points to — introduction (few reviews, awareness/education complaints, "never heard of this" signals), growth (rapid adoption, feature-gap complaints as new segments arrive), maturity (high review volume, complaints skew to service/reliability/price rather than the core offering, named competitors crowding the space), decline (churn/switching-to-rival language dominates, "used to be good," shrinking relevance). The stage changes urgency, not just the diagnosis — say so in the rationale (e.g. maturity means execution fixes compound, introduction means awareness matters more than incremental polish). null + "insufficient data" if the evidence doesn't clearly point to one.
- "brand.node_word": the single word this brand owns in customers' minds, ONLY if the evidence supports one. null + "insufficient data" if no clear word emerges — do not force one.
- "brand.weakest_cbbe_layer": one of salience / performance / imagery / judgements / feelings / resonance — whichever the review evidence shows is weakest.
- "brand.personas": 2-3 ONLY if the reviews contain enough concrete detail to build one honestly — no invented demographics. Empty array if reviews are too thin.
- "brand.campaign": Enemy-Stand-Mantra ONLY if a real customer pain point clearly justifies one (enemy = the ideology/behavior/condition the brand fights, NOT a competitor). null if unjustified.
- "brand.kapferer_prism": Kapferer's Brand Identity Prism, all 6 facets, ONE sentence each, each grounded in review/competitor evidence — physique (tangible/visible traits), personality (character traits as if human), relationship (nature of the brand-consumer bond), culture (values/origins the brand emanates), reflection (who the brand's communication appears to target), self_image (how using it makes the customer feel about themselves). null for any facet the evidence genuinely doesn't support — never a generic filler sentence just to fill the field.
- "brand.archetype": the ONE Jungian archetype (from the 12 in the knowledge base) the review/competitor evidence best supports the brand projecting — name + one-sentence rationale grounded in actual tone/behavior shown in the data. IMPORTANT: if you were able to fill in "brand.kapferer_prism.personality" with real evidence-grounded content, that IS enough signal to pick an archetype too — do not leave this null just because no facet is a perfect textbook match; pick the closest fit and say so honestly in the rationale (e.g. "closest to Ruler, though evidence is mixed"). Reserve null + "insufficient data" for when personality/tone evidence is genuinely absent, not merely imperfect.
- "brand.posture": Offensive (challenging a leader / aggressive acquisition), Defensive (protecting an established position via heritage/endorsement/halo), or Assertive (steady identity-building, no active market war) — whichever the competitive evidence actually supports. If NAMED COMPETITORS below is non-empty OR the reviews themselves mention customers switching to/from a rival, that IS competitor context — pick a stance rather than defaulting to null. Reserve null + "insufficient data" only for when there is truly zero competitive signal anywhere in the input.
- "brand.asset_valuator": Brand Asset Valuator — vitality (1-10: differentiation x relevance, how distinct AND how needed the brand actually is per the evidence) and stature (1-10: esteem x knowledge, how trusted AND how well-understood it is) as separate integer scores, each grounded in specific review evidence (not a vibe), plus the resulting quadrant (leadership = high both; niche_unrealized_potential = high vitality, low stature; declining_eroded = low vitality, high stature; new_unfocused_commodity = low both). The same evidence that supports "weakest_cbbe_layer" and the Kapferer Prism is enough to estimate both axes roughly — a low score grounded in real complaints is still a real, honest answer, not a forced one. Reserve null for vitality/stature/quadrant only when there's truly no usable evidence at all (e.g. near-zero reviews) — do not invent evidence that isn't there, but do commit to a defensible estimate when evidence exists, even if imperfect.

=== MARKETING & BRANDING KNOWLEDGE ===
${knowledgeBase}

=== ISSUES (from the completed review analysis) ===
${JSON.stringify(condenseIssuesForPrompt(analysisResult), null, 2)}

=== CONSUMER BEHAVIOR & JOURNEY GROUNDING (from the prior pass — use this, don't re-derive it) ===
${behaviorContextBlock(behavior)}

=== NAMED COMPETITORS (empty = none found — do not invent a competitor) ===
${competitorsBlock}

Respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly:
{
  "gtm": {
    "segment": string, "target": string, "position": string, "points_of_difference": string[], "points_of_parity": string[],
    "ansoff": { "quadrant": "market_penetration" | "product_development" | "market_development" | "diversification" | null, "rationale": string },
    "product_life_cycle": { "stage": "introduction" | "growth" | "maturity" | "decline" | null, "rationale": string }
  },
  "brand": {
    "node_word": string | null, "node_word_evidence": string,
    "weakest_cbbe_layer": string, "weakest_cbbe_layer_evidence": string,
    "archetype": { "name": "Innocent" | "Explorer" | "Sage" | "Hero" | "Outlaw" | "Magician" | "Lover" | "Jester" | "Caregiver" | "Ruler" | "Creator" | "Everyman" | null, "rationale": string },
    "posture": { "stance": "offensive" | "defensive" | "assertive" | null, "rationale": string },
    "asset_valuator": { "vitality": number | null, "stature": number | null, "quadrant": "leadership" | "niche_unrealized_potential" | "declining_eroded" | "new_unfocused_commodity" | null, "rationale": string },
    "personas": [{ "name": string, "context": string, "goals": string, "pain_points": string }],
    "campaign": { "enemy": string, "stand": string, "mantra": string } | null,
    "kapferer_prism": {
      "physique": string | null, "personality": string | null, "relationship": string | null,
      "culture": string | null, "reflection": string | null, "self_image": string | null
    }
  }
}`;

  const content = await chatCompletion({
    messages: [{ role: "system", content: system }],
    jsonMode: true,
    temperature: 0.2,
    // Bumped again for the archetype/posture/asset_valuator fields — this
    // pass's knowledge base grew today (BAV, archetypes, posture taxonomy
    // added), so the output budget needs the same margin restored. Bumped
    // once more for product_life_cycle.
    maxTokens: 2700,
  });

  const parsed = extractJson(content);
  const result = GtmBrandSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Marketing/branding pass response didn't match expected schema: ${result.error.message}`);
  }
  return result.data;
}

const IssueSchema = z.object({
  title: z.string(),
  pct_of_reviews: z.number(),
  // .default(false) rather than a bare boolean — confirmed live: the model
  // occasionally omits this field on the last issue in a 3-issue array
  // (a schema-adherence slip under output-length pressure, not JSON
  // truncation — the surrounding JSON was otherwise valid), which used to
  // hard-fail the entire pass over one missing flag on one issue. Defaulting
  // to false (never at_risk) is the safe direction to err in — it just
  // means that one issue doesn't get flagged at-risk, not a fabricated true.
  at_risk: z.boolean().default(false),
  evidence: z.array(z.string()),
  fix: z.array(z.string()),
  frameworks_applied: z.array(z.string()).min(2),
  cost: z.string(),
  impact: z.string(),
  metric_to_track: z.string(),
  priority: z.enum(["now", "near", "far"]),
});

const ProductFinanceSchema = z.object({
  summary: z.string().default(""),
  metrics: z.object({
    total_reviews: z.number().int(),
    issue_count: z.number().int(),
    at_risk_issue_count: z.number().int(),
    top_issue_title: z.string().nullable(),
    top_issue_pct: z.number().nullable(),
  }),
  highs: z.array(z.object({ label: z.string(), detail: z.string() })),
  // The prompt asks for AT MOST 3 — validated loosely here (generous
  // ceiling against genuinely runaway output) and trimmed to 3 in code
  // after a successful parse instead of hard-rejecting the whole pass.
  // Confirmed live: the model returned 4 once, otherwise-valid, and a
  // strict .max(3) here threw away a perfectly usable response over a
  // one-item overshoot.
  issues: z.array(IssueSchema).max(8),
  porters_five_forces: z.object({
    rivalry: z.string(),
    threat_of_new_entrants: z.string(),
    threat_of_substitutes: z.string(),
    buyer_power: z.string(),
    supplier_power: z.string(),
  }),
  // Parallel 1-5 intensity scores so the dashboard can render a radar chart
  // instead of five paragraphs — kept as a SEPARATE object rather than
  // nesting {text, intensity} inside porters_five_forces so the existing
  // qualitative fields/UI/PDF code above didn't need to change shape.
  porters_five_forces_intensity: z.object({
    rivalry: z.number().min(1).max(5).nullable(),
    threat_of_new_entrants: z.number().min(1).max(5).nullable(),
    threat_of_substitutes: z.number().min(1).max(5).nullable(),
    buyer_power: z.number().min(1).max(5).nullable(),
    supplier_power: z.number().min(1).max(5).nullable(),
  }),
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
});
type ProductFinanceResult = z.infer<typeof ProductFinanceSchema>;

/** Pass 3 — Product Management & Finance. Runs in parallel with the
 * marketing/branding pass. Produces the actual issues[] (fix/cost/impact/
 * priority), the metrics rollup, the top-line summary, Porter's Five Forces,
 * and the finance section. */
async function runProductFinancePass(
  companyName: string,
  direction: Direction,
  analysisResult: AnalysisResult,
  competitors: CompetitorInput[],
  ownFinancialContext: string,
  behavior: BehaviorJourneyResult
): Promise<ProductFinanceResult> {
  const productKnowledge = getProductKnowledge();
  const financeKnowledge = getFinanceKnowledge();

  const competitorsBlock = competitors.length
    ? competitors
        .map(
          (c) => `Competitor: ${c.name}
Product/positioning context: ${c.productFindings.slice(0, 700) || "(none found)"}
Financial context: ${c.financial.found ? c.financial.markdown.slice(0, 700) : "(none found)"}`
        )
        .join("\n\n")
    : "(no named competitors found)";

  const system = `You are reasoning through TWO lenses that stay strictly separate: product management for the issues/fixes, and finance ONLY for the dedicated "finance" section below — never mix the two. Issue diagnosis and fixes ("frameworks_applied") must ONLY use the PM frameworks (RICE/CIRCLES/Kano/AARRR); the finance frameworks (margin waterfall, LTV:CAC, break-even/operating leverage, relevant-cost/ABC logic) are ONLY for reasoning about revenue_at_risk/unit_economics_notes, and ONLY when real financial figures are actually present in the data below — never invented. This must read like a real analyst's dashboard: every number/finding traceable to the data below, nothing invented.

Tone (applies to "summary" and every issue's "fix"/"impact"): write the way an MBA professor explains a case back to a student. Plain, humanized language first (what actually happened to the customer, in one clear sentence), THEN name the framework used to get there.

1. "metrics" — total_reviews = total_reviews_analyzed, issue_count = number of issues returned, at_risk_issue_count = count of at_risk issues, top_issue_title/pct = highest pct_of_reviews issue (null if none).
2. "highs" — concrete positives ONLY if the data supports them; empty array if genuinely none.
3. "issues" — AT MOST 3 items, the top 2-3 by pct_of_reviews/at-risk severity. Rank at_risk issues first, then by pct_of_reviews descending. For each issue:
   - "title": name the issue plainly and directly (e.g. "Missing charging cable in the box") — NEVER "Theme:" or an abstract category.
   - "evidence": 1-2 bullets. Every issue below carries a "quotes" array (real verbatim review text) — use those directly as evidence. This field must NEVER be empty.
   - "fix": 2-3 concrete, sequenced steps. Apply cheapest-fix-first: step 1 should be the free/near-free version if one exists (a copy/config/policy change) before anything requiring engineering or spend; only recommend paid marketing/spend AFTER the underlying issue is fixed. Each step must be something a named role could start on Monday. Use the CONSUMER BEHAVIOR & JOURNEY GROUNDING below — an issue tagged "purchase/checkout" needs a different kind of fix than one tagged "support/service."
   - "frameworks_applied": AT LEAST 2 entries — this is where you diagnose what the issue actually IS and how urgently to address it, using AT LEAST 2 of the named PM frameworks from the knowledge base below (RICE, CIRCLES, Kano must-be/performance/delighter, AARRR funnel stage) — OR, if this issue is about price/discounts/subscriptions/"feels expensive", at least one entry should instead be a pricing framework (EVE/value-communication gap, Price Fence/Metric, Weber-Fechner framing, 4-box competitive reaction, incremental-vs-average cost). Each entry is one concrete sentence naming the framework and its verdict for THIS issue — e.g. "Kano: must-be violation — absence causes major dissatisfaction, this is floor not ceiling, not a nice-to-have" and "AARRR: Retention-stage — existing paying customers leaving, so this compounds against revenue already earned, not just future growth." For a pricing issue: e.g. "EVE: this is a value-communication gap, not overpricing — the fix is explaining the differentiation, not cutting price" and "Price Metric: the complaint is about an unpredictable delivery fee, not the core price." Never a bare framework name with no verdict attached.
   - "cost": a rupee/dollar estimate if reasonably inferable, "engineering time only" for investigation work, or "$0 — config/policy change" if free. Never vague.
   - "impact": a modeled, assumption-stated estimate (Guesstimate method: state each assumption explicitly, then compute — never a bare invented number).
   - "metric_to_track": the single number that proves this worked, its baseline if inferable, and a target.
   - "priority": "now" (0-30 days) for must-fix-first — baseline/core-function failures or at_risk=true — "near" (31-60 days) for real but less urgent, "far" (61-90 days) for lower-severity items.
4. "porters_five_forces" — qualitative, one sentence each. NAMED COMPETITORS below is real data — use it, do not default to "insufficient data" when non-empty. 0 named competitors → "competitive intensity can't be assessed from available data." 1+ → name them and describe rivalry from what their context actually shows.
4b. "porters_five_forces_intensity" — for each force, a 1-5 integer rating (1 = weak/low threat, 5 = strong/high threat) that matches the qualitative sentence in "porters_five_forces" for that same force — null ONLY for a force whose qualitative text above genuinely says data is insufficient to judge; never null just because it's harder to quantify than the text version.
5. "finance" — own.found/competitors[].found true ONLY when real text is present below; never invent a number. "comparison": factual, using ONLY numbers present in both texts, else null. unit_economics_notes: apply the FINANCE KNOWLEDGE below (margin waterfall, LTV:CAC ratio, break-even/operating leverage, relevant-cost/ABC hidden-loser check) ONLY where real figures in the data actually support that specific framework — name the framework applied, e.g. "Gross margin of X% relative to a Y% COGS suggests a sourcing/pricing problem (margin waterfall), not something downstream fixes solve." Never apply a framework the data can't actually support just to fill the field.
6. "finance.revenue_at_risk" (Guesstimate method: state assumptions, then compute) — applicable=true ONLY if a real revenue figure exists in OWN COMPANY FINANCIAL CONTEXT below; estimate = stated revenue × (sum of at-risk issues' pct_of_reviews as a proxy for at-risk revenue share), assumptions listing every step explicitly. If no real revenue figure found, applicable=false, estimate=null, assumptions=[].
7. "summary" — direct-answer, restating what the reviews show in plain language (or answering the user's specific question if one was asked at intake — that question, if any, is embedded in the issues' recommendation fields below). MUST name the actual issues themselves (e.g. "customers report the app crashing at checkout and delivery partners marking orders delivered when they weren't") — NEVER just a count ("2 issues were found" on its own, with no description of what they are, is not acceptable — a reader should know what's actually wrong after reading only this sentence).

=== PRODUCT MANAGEMENT & PRICING KNOWLEDGE (apply AT LEAST 2 named frameworks per issue — issues/fixes ONLY, never the finance section; for a pricing-related issue, at least one of the 2 should be a pricing framework — EVE, price fences/metrics, Weber-Fechner framing, the 4-box competitive-reaction framework, or incremental-vs-average cost) ===
${productKnowledge}

=== FINANCE KNOWLEDGE (apply ONLY inside the "finance" section, ONLY where real figures below actually support a given framework) ===
${financeKnowledge}

=== ANALYSIS RESULT (condensed) ===
${JSON.stringify(
  {
    summary: analysisResult.summary,
    total_reviews_analyzed: analysisResult.total_reviews_analyzed,
    issues: condenseIssuesForPrompt(analysisResult),
  },
  null,
  2
)}

=== CONSUMER BEHAVIOR & JOURNEY GROUNDING (from the prior pass — use this to sequence/target each fix, don't re-derive it) ===
${behaviorContextBlock(behavior)}

=== OWN COMPANY FINANCIAL CONTEXT (empty = none found — do not fabricate) ===
${(ownFinancialContext || "(none found)").slice(0, 1200)}

=== NAMED COMPETITORS (empty = none found — do not invent a competitor) ===
${competitorsBlock}

Respond with ONLY a single JSON object (no markdown fences, no commentary) matching exactly:
{
  "summary": string,
  "metrics": { "total_reviews": integer, "issue_count": integer, "at_risk_issue_count": integer, "top_issue_title": string | null, "top_issue_pct": number | null },
  "highs": [{ "label": string, "detail": string }],
  "issues": [{ "title": string, "pct_of_reviews": number, "at_risk": boolean, "evidence": string[], "fix": string[], "frameworks_applied": string[], "cost": string, "impact": string, "metric_to_track": string, "priority": "now" | "near" | "far" }],
  "porters_five_forces": { "rivalry": string, "threat_of_new_entrants": string, "threat_of_substitutes": string, "buyer_power": string, "supplier_power": string },
  "porters_five_forces_intensity": { "rivalry": number | null, "threat_of_new_entrants": number | null, "threat_of_substitutes": number | null, "buyer_power": number | null, "supplier_power": number | null },
  "finance": {
    "own": { "found": boolean, "findings": string[] },
    "competitors": [{ "name": string, "found": boolean, "findings": string[], "comparison": string | null }],
    "unit_economics_notes": string[],
    "revenue_at_risk": { "applicable": boolean, "estimate": string | null, "assumptions": string[] }
  }
}`;

  const content = await chatCompletion({
    messages: [{ role: "system", content: system }],
    jsonMode: true,
    temperature: 0.2,
    // This pass's JSON schema is the largest of the three (up to 4 issues,
    // each with evidence/fix/frameworks_applied arrays, plus Porter's Five
    // Forces + its parallel intensity scores, and the full finance section)
    // — the default budget truncated it mid-response before reaching
    // porters_five_forces/finance, confirmed in practice via a schema-
    // validation failure on exactly those two fields. Bumped again from
    // 2000 after product.md/pricing.md grew this session (supply-chain
    // diagnosis, price-war alternatives) and porters_five_forces_intensity
    // was added — confirmed live: the model started omitting a field
    // (at_risk) on the last issue under the tighter budget, a sign of
    // output-length pressure even though the JSON itself stayed valid.
    // Groq's 8k TPM cap no longer sizes this (see llm.ts) — Gemini/OpenAI
    // have the headroom.
    maxTokens: 2800,
  });

  const parsed = extractJson(content);
  const result = ProductFinanceSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Product/finance pass response didn't match expected schema: ${result.error.message}`);
  }
  // Rank at-risk issues first, then by pct_of_reviews descending — matches
  // the prompt's own stated ranking rule — before trimming to the top 3,
  // so an overshoot never accidentally drops the most important issue.
  result.data.issues = result.data.issues
    .sort((a, b) => Number(b.at_risk) - Number(a.at_risk) || b.pct_of_reviews - a.pct_of_reviews)
    .slice(0, 3);
  // Recompute from the (possibly trimmed) issues array rather than trusting
  // the model's own counts — keeps "Issues Found"/"At-Risk Issues" stat
  // tiles consistent with what's actually rendered below them.
  const trimmed = result.data.issues;
  result.data.metrics.issue_count = trimmed.length;
  result.data.metrics.at_risk_issue_count = trimmed.filter((i) => i.at_risk).length;
  // top_issue = highest pct_of_reviews specifically, independent of the
  // at-risk-first display order above.
  const top = [...trimmed].sort((a, b) => b.pct_of_reviews - a.pct_of_reviews)[0] ?? null;
  result.data.metrics.top_issue_title = top?.title ?? null;
  result.data.metrics.top_issue_pct = top?.pct_of_reviews ?? null;
  return result.data;
}

export async function runReport(
  companyName: string,
  direction: Direction,
  analysisResult: AnalysisResult,
  competitors: CompetitorInput[],
  ownFinancialContext: string
): Promise<DashboardReport> {
  // Pass 1 runs alone first — passes 2 and 3 are both grounded in its output,
  // so it must complete before either starts. This is the deliberate
  // "understand the customer before prescribing anything" ordering.
  const behavior = await runConsumerBehaviorJourneyPass(companyName, analysisResult);

  // Passes 2 and 3 are independent of each other — both only need pass 1's
  // output — so they run concurrently rather than adding latency for no
  // reason.
  const [marketingBranding, productFinance] = await Promise.all([
    runMarketingBrandingPass(companyName, direction, analysisResult, competitors, behavior),
    runProductFinancePass(companyName, direction, analysisResult, competitors, ownFinancialContext, behavior),
  ]);

  const report: DashboardReport = {
    summary: productFinance.summary,
    metrics: productFinance.metrics,
    highs: productFinance.highs,
    issues: productFinance.issues,
    porters_five_forces: productFinance.porters_five_forces,
    porters_five_forces_intensity: productFinance.porters_five_forces_intensity,
    gtm: marketingBranding.gtm,
    finance: productFinance.finance,
    brand: marketingBranding.brand,
  };

  // Hard backstop, not just a prompt instruction: confirmed in practice that
  // the model sometimes left "evidence" empty for every issue after the
  // first, rather than inventing something — better than fabricating, but
  // still leaves a card with a fix and no proof. Backfill from the real
  // verbatim quotes gathered in the analysis step (matched by title) before
  // ever showing an issue with zero evidence.
  for (const issue of report.issues) {
    if (issue.evidence.length > 0) continue;
    const matched = analysisResult.issues.find((raw) => raw.title === issue.title);
    if (matched && matched.quotes.length > 0) {
      issue.evidence = matched.quotes.slice(0, 2);
    }
  }

  // Hard backstop, not just a prompt instruction: confirmed in practice that
  // when analysisResult.issues is empty, the model still fabricated a full
  // roadmap of costed fixes and personas out of thin air — grounded in
  // nothing, since there were no issues to ground them in. A prompt
  // instruction alone didn't stop it once; force it in code instead of
  // trusting the model to self-police every time.
  if (analysisResult.issues.length === 0) {
    report.issues = [];
    report.metrics.issue_count = 0;
    report.metrics.at_risk_issue_count = 0;
    report.metrics.top_issue_title = null;
    report.metrics.top_issue_pct = null;
    report.brand.personas = [];
    report.brand.node_word = null;
    report.brand.node_word_evidence = "No review issues were found to derive a brand association from.";
    report.brand.weakest_cbbe_layer = "unknown";
    report.brand.weakest_cbbe_layer_evidence = "No review issues were found to diagnose brand health from.";
    report.brand.campaign = null;
    report.brand.kapferer_prism = {
      physique: null,
      personality: null,
      relationship: null,
      culture: null,
      reflection: null,
      self_image: null,
    };
    report.gtm.ansoff = { quadrant: null, rationale: "No review issues were found to ground a growth direction in." };
    report.gtm.product_life_cycle = { stage: null, rationale: "No review issues were found to ground a lifecycle stage in." };
  }

  return report;
}
