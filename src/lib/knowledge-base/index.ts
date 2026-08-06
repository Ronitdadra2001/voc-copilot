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
export function getKnowledgeBase(): string {
  return [
    load("consultant-engine.md"),
    load("product.md"),
    load("marketing.md"),
    load("consumer-behavior-bhupesh.md"),
    load("strategy.md"),
    load("omnichannel.md"),
  ].join("\n\n---\n\n");
}

/** Consumer behavior + customer journey lens — Bhupesh's CB concepts (CDM
 * funnel, motivation/valence, memory nodes, perception, attitude functions,
 * personality segmentation, AAAERRR journey, attribution, decision rules,
 * culture) plus the four-pillar omni-channel framing. Read FIRST in the
 * report pipeline: everything downstream (branding, product fixes) is
 * grounded in understanding the customer before prescribing anything. */
export function getConsumerBehaviorJourneyKnowledge(): string {
  return withMandate("consumer-behavior-bhupesh.md", "marketing.md", "omnichannel.md");
}

/** Marketing & branding lens — STP, 3C positioning, POD/POP, CBBE pyramid,
 * node-word test, brand fidelity matrix, brand archetypes, Enemy-Stand-Mantra
 * campaigns, Hofstede/cultural grounding. */
export function getMarketingBrandingKnowledge(): string {
  return withMandate("consumer-behavior-bhupesh.md", "marketing.md", "strategy.md");
}

/** Product management lens — RICE/CIRCLES prioritization, Kano-style
 * severity, AARRR funnel staging, cheapest-fix-first sequencing. */
export function getProductKnowledge(): string {
  return withMandate("product.md");
}
