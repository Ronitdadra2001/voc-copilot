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

export function getKnowledgeBase(): string {
  return [
    load("consultant-engine.md"),
    load("product.md"),
    load("marketing.md"),
    load("finance.md"),
    load("strategy.md"),
    load("omnichannel.md"),
  ].join("\n\n---\n\n");
}

/** Consumer behavior + customer journey lens — attitude functions (why a
 * failure actually hurts a brand) and the four-pillar/journey-stage framing
 * of where in the customer's path something broke. Read FIRST in the report
 * pipeline: everything downstream (branding, product fixes) is grounded in
 * understanding the customer before prescribing anything. */
export function getConsumerBehaviorJourneyKnowledge(): string {
  return withMandate("marketing.md", "omnichannel.md");
}

/** Marketing & branding lens — STP, 3C positioning, POD/POP, CBBE pyramid,
 * node-word test, Enemy-Stand-Mantra campaigns. */
export function getMarketingBrandingKnowledge(): string {
  return withMandate("marketing.md", "strategy.md");
}

/** Product management lens — RICE/CIRCLES prioritization, Kano-style
 * severity, AARRR funnel staging, cheapest-fix-first sequencing. */
export function getProductKnowledge(): string {
  return withMandate("product.md");
}

/** Finance lens — unit economics, relevant cost, Guesstimate-framework
 * revenue-at-risk modeling. */
export function getFinanceKnowledge(): string {
  return withMandate("finance.md");
}
