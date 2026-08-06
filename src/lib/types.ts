export type Direction = "competitor" | "own";

export interface Theme {
  title: string;
  mention_count: number;
  pct_of_reviews: number;
  quotes: string[];
  at_risk: boolean;
  at_risk_signals: string[];
  product_recommendation: string;
  marketing_recommendation: string;
  finance_recommendation: string;
}

export interface AnalysisResult {
  summary: string;
  total_reviews_analyzed: number;
  themes: Theme[];
}

export interface Analysis {
  id: string;
  company_name: string;
  direction: Direction;
  raw_reviews: string;
  // JSON-serialized CompetitorProfile[] (see lib/gatherReviews.ts)
  competitor_context: string | null;
  // Own company's public financial context markdown, if found
  financial_context: string | null;
  result_json: string | null;
  created_at: string;
}

export interface DashboardReport {
  /** Direct-answer summary — restates what the reviews show, or answers the
   * user's specific question verbatim if one was asked at intake. Carried
   * over from the analysis step, not regenerated here. */
  summary: string;
  metrics: {
    total_reviews: number;
    theme_count: number;
    at_risk_theme_count: number;
    top_theme_title: string | null;
    top_theme_pct: number | null;
  };
  highs: { label: string; detail: string }[];
  /** kano: Must-be/Performance/Delighter classification (finance/PM
   * framework) — Must-be violations (crashes, core-function failures) are
   * floor issues to fix immediately; Performance issues scale with effort;
   * Delighters are absent-but-not-fatal. */
  lows: {
    label: string;
    detail: string;
    pct: number;
    at_risk: boolean;
    kano: "must-be" | "performance" | "delighter";
  }[];

  /** Porter's Five Forces — qualitative, grounded only in what the review
   * data and named-competitor count actually show (e.g. rivalry intensity
   * from how many real competitors were found) — never invented figures. */
  porters_five_forces: {
    rivalry: string;
    threat_of_new_entrants: string;
    threat_of_substitutes: string;
    buyer_power: string;
    supplier_power: string;
  };

  /** GTM — Segmentation/Targeting/Positioning + Points of Difference/Parity,
   * grounded in review evidence and named competitors (bhupesh GTM/branding
   * frameworks: STP, 3C positioning, POD/POP). */
  gtm: {
    segment: string;
    target: string;
    position: string;
    points_of_difference: string[];
    points_of_parity: string[];
  };

  /** Product roadmap scored with RICE (slide/PM frameworks), not just a flat
   * Now/Near/Far tag — grounded in specific themes. */
  product_roadmap: {
    action: string;
    reach: number;
    impact: number;
    confidence: number;
    effort: number;
    score: number;
    rationale: string;
    /** 2-4 concrete steps to actually execute the action — not a restatement
     * of the score. Drawn from the Consultant Engine's cheapest-fix-first
     * doctrine and instrumentation contract: what to do first (usually free/
     * cheap), what to build/change, and what to measure to know it worked. */
    how_to_implement: string[];
    /** The single metric to track, its current baseline (from the review
     * data if inferable, else "not measured yet"), and a target. */
    metric_to_track: string;
  }[];

  /** Finance section — own company's real findings plus, per named
   * competitor, their real financial findings and an honest comparison.
   * found=false / empty arrays whenever no real data was located; never
   * fabricated (finance skill: relevant-cost / unit-economics reasoning only
   * applied to numbers actually present in the source text). */
  finance: {
    own: { found: boolean; findings: string[] };
    competitors: {
      name: string;
      found: boolean;
      findings: string[];
      comparison: string | null;
    }[];
    unit_economics_notes: string[];
    /** "How much is this bleeding out of revenue" — a Guesstimate-framework
     * estimate (finance skill): only computed when a real revenue figure was
     * found, built from explicitly stated assumptions (never presented as a
     * measured fact). applicable=false whenever no real revenue figure was
     * located — the UI must not show a number in that case. */
    revenue_at_risk: {
      applicable: boolean;
      estimate: string | null;
      assumptions: string[];
    };
  };

  /** Legacy flat Now/Near/Far view, kept for the compact in-app dashboard. */
  roadmap: {
    priority: "now" | "near" | "far";
    action: string;
    rationale: string;
  }[];

  /** Brand & consumer-behavior diagnosis (bhupesh CBBE/node-word/ESM
   * frameworks) — grounded only in review evidence; every field must say
   * "insufficient data" rather than invent a brand association or persona
   * detail the reviews don't support. */
  brand: {
    /** The one word this brand owns in customers' minds (e.g. "reliable"),
     * or null if the evidence doesn't support one. */
    node_word: string | null;
    node_word_evidence: string;
    /** Which CBBE pyramid layer the evidence shows is weakest: salience,
     * performance, imagery, judgements, feelings, or resonance. */
    weakest_cbbe_layer: string;
    weakest_cbbe_layer_evidence: string;
    /** 2-3 personas inferred from review language/context — not invented
     * demographics, only what the review text actually implies. */
    personas: {
      name: string;
      context: string;
      goals: string;
      pain_points: string;
    }[];
    /** Enemy-Stand-Mantra campaign angle — null if there isn't a real
     * customer-pain-driven enemy to build one around. */
    campaign: {
      enemy: string;
      stand: string;
      mantra: string;
    } | null;
  };
}
