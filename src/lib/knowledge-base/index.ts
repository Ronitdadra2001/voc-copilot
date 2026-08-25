import fs from "fs";
import path from "path";

function load(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), "src/lib/knowledge-base", file), "utf-8");
}

// The consultant mandate/anti-fabrication rules apply to every pass, no
// matter which domain it's reasoning through — always included.
function withMandate(...files: string[]): string {
  return [load("consultant-engine.md"), ...files.map(load)].join("\n\n---\n\n");
}

// finance.md (opinionated finance-framework lens: margin waterfall, ABC
// costing, break-even/operating leverage) is deliberately not loaded here —
// removed as a reasoning lens per product direction. Factual finance DATA
// (competitor revenue findings, revenue-at-risk modeling) still flows
// through the product/finance pass in pipeline.ts, just without this
// opinionated-framework layer applied on top of it.
//
// strategy.md and omnichannel.md are also excluded — this function backs
// runAnalysis(), which only writes product/marketing/behavior
// recommendations per issue (three lenses, matching product.md/marketing.md
// /consumer-behavior-bhupesh.md exactly); strategy.md's M&A/PE content and
// omnichannel.md's four-pillar framing don't serve that task. This also
// matters for size: the full 6-file version ran ~7,700 tokens on its own
// and, combined with review text + instructions + output budget, exceeded
// Groq's account-wide 8,000-tokens/minute cap outright (confirmed via a
// live 413) — every knowledge-base function in this file is scoped to only
// what its consuming pass's instructions actually use, both for prompt
// hygiene and because that cap makes prompt size a hard constraint now.
export function getKnowledgeBase(): string {
  return withMandate("product.md", "marketing.md", "consumer-behavior-bhupesh.md");
}

/** Consumer behavior + customer journey lens — Bhupesh's CB concepts (CDM
 * funnel, motivation/valence, memory nodes, perception, attitude functions,
 * personality segmentation, AAAERRR journey, attribution, decision rules,
 * culture) plus the four-pillar omni-channel framing. Read FIRST in the
 * report pipeline: everything downstream (branding, product fixes) is
 * grounded in understanding the customer before prescribing anything.
 * marketing.md deliberately excluded — this pass's instructions only ask
 * for journey_stage + a behavior_insight, neither of which touches
 * marketing.md's STP/positioning content (that's Pass 2's job) — cut to
 * fit Groq's account-wide 8,000-tokens/minute cap (confirmed via response
 * headers: this is a hard account limit, not something a bigger/smaller
 * model changes), not just as a token-budget trim. */
export function getConsumerBehaviorJourneyKnowledge(): string {
  return withMandate("consumer-behavior-bhupesh.md", "omnichannel.md");
}

/** Marketing & branding lens — STP, 3C positioning, POD/POP, CBBE pyramid,
 * node-word test, brand fidelity matrix, brand archetypes, Enemy-Stand-Mantra
 * campaigns, Hofstede/cultural grounding. strategy.md deliberately excluded
 * — its content (profitability trees, M&A synergy, PE/investment scoring)
 * is general business strategy, not branding, and doesn't serve this pass's
 * narrow instructions; also needed to fit under Groq's 8k TPM cap (see note
 * on getConsumerBehaviorJourneyKnowledge). */
export function getMarketingBrandingKnowledge(): string {
  return withMandate("consumer-behavior-bhupesh.md", "marketing.md");
}

/** Product management lens — RICE/CIRCLES prioritization, Kano-style
 * severity, AARRR funnel staging, cheapest-fix-first sequencing. */
export function getProductKnowledge(): string {
  return withMandate("product.md");
}
