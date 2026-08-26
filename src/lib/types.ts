export type Direction = "competitor" | "own";

/** A complaint cluster found directly in the raw review text — the input to
 * the report step, not the final output. Named plainly (e.g. "Missing
 * charging cable"), never as an abstract "theme". */
export interface RawIssue {
  title: string;
  mention_count: number;
  pct_of_reviews: number;
  quotes: string[];
  at_risk: boolean;
  at_risk_signals: string[];
  product_recommendation: string;
  marketing_recommendation: string;
  behavior_recommendation: string;
}

export interface AnalysisResult {
  summary: string;
  total_reviews_analyzed: number;
  issues: RawIssue[];
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

/** One concrete, actionable finding — evidence, a costed fix, and an
 * estimated impact. Named directly (e.g. "Missing charging cable in the
 * box"), never as an abstract "theme". Replaces the old lows/product_roadmap/
 * roadmap split: one issue, one place, one thing to actually do about it. */
export interface Issue {
  /** The issue itself, plainly named — never prefixed "Theme:" or similar. */
  title: string;
  pct_of_reviews: number;
  at_risk: boolean;
  /** 1-3 real quoted/grounded bullets proving this issue is real. */
  evidence: string[];
  /** 2-4 concrete, sequenced steps to fix it — cheapest/free step first
   * (Consultant Engine's cheapest-fix-first doctrine). */
  fix: string[];
  /** At least 2 named PM frameworks (from RICE, CIRCLES, Kano, AARRR) used to
   * diagnose this issue and sequence its fix, each stated as one concrete
   * sentence — e.g. "Kano: must-be violation, not a nice-to-have" — not just
   * the bare framework name. */
  frameworks_applied: string[];
  /** What the fix costs to execute — a rupee/dollar estimate, "engineering
   * time only", or "$0 — config/policy change", whichever is honest. */
  cost: string;
  /** A modeled, assumption-stated estimate of what fixing this is worth —
   * never a bare invented number (Guesstimate framework). */
  impact: string;
  metric_to_track: string;
  priority: "now" | "near" | "far";
}

export interface DashboardReport {
  /** Direct-answer summary — restates what the reviews show, or answers the
   * user's specific question verbatim if one was asked at intake. Carried
   * over from the analysis step, not regenerated here. */
  summary: string;
  metrics: {
    total_reviews: number;
    issue_count: number;
    at_risk_issue_count: number;
    top_issue_title: string | null;
    top_issue_pct: number | null;
  };
  highs: { label: string; detail: string }[];
  /** At most 3-4 issues, ranked by pct_of_reviews/at-risk severity — a short,
   * unambiguous list of what to actually work on, not a longer theme
   * dashboard. */
  issues: Issue[];

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
    /** Ansoff Matrix — which of the 4 growth quadrants the recommended
     * moves actually fall into, grounded in what the issues/competitor
     * data show (not a generic growth-strategy essay). null quadrant if
     * the evidence doesn't clearly point to one. */
    ansoff: {
      quadrant: "market_penetration" | "product_development" | "market_development" | "diversification" | null;
      rationale: string;
    };
  };

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
    /** Kapferer's Brand Identity Prism — all 6 facets, each grounded in
     * review/competitor evidence. null (with an explanatory evidence
     * string) for any facet the data genuinely doesn't support — never a
     * generic filler sentence. */
    kapferer_prism: {
      physique: string | null;
      personality: string | null;
      relationship: string | null;
      culture: string | null;
      reflection: string | null;
      self_image: string | null;
    };
  };
}
