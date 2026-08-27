"use client";

import { useEffect, useState } from "react";
import type { DashboardReport } from "@/lib/types";
import DashboardCharts, { AssetValuatorChart, PortersRadarChart } from "@/components/DashboardCharts";

// Status palette from the dataviz skill (validated, fixed — never themed):
// good/warning/serious/critical. Distinct from the categorical chart slots
// so a status color never impersonates a data series.
const STATUS = {
  critical: "#d03b3b",
  warning: "#fab219",
  good: "#0ca30c",
};

const PRIORITY_COLOR: Record<DashboardReport["issues"][number]["priority"], string> = {
  now: "bg-red-50 text-red-700 border border-red-200",
  near: "bg-amber-50 text-amber-700 border border-amber-200",
  far: "bg-slate-100 text-fg-muted border divider",
};

const PRIORITY_LABEL: Record<DashboardReport["issues"][number]["priority"], string> = {
  now: "NOW (0-30 days)",
  near: "NEAR (31-60 days)",
  far: "FAR (61-90 days)",
};

const POSTURE_LABEL: Record<"offensive" | "defensive" | "assertive", string> = {
  offensive: "Offensive",
  defensive: "Defensive",
  assertive: "Assertive",
};

const POSTURE_COLOR: Record<"offensive" | "defensive" | "assertive", string> = {
  offensive: "bg-red-50 text-red-700 border border-red-200",
  defensive: "bg-blue-50 text-blue-700 border border-blue-200",
  assertive: "bg-emerald-50 text-emerald-700 border border-emerald-200",
};

const BAV_QUADRANT_LABEL: Record<
  "leadership" | "niche_unrealized_potential" | "declining_eroded" | "new_unfocused_commodity",
  string
> = {
  leadership: "Leadership",
  niche_unrealized_potential: "Niche / Unrealized Potential",
  declining_eroded: "Declining / Eroded",
  new_unfocused_commodity: "New / Unfocused / Commodity",
};

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-label="How these numbers were calculated"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="h-5 w-5 rounded-full text-xs font-bold flex items-center justify-center cursor-pointer"
        style={{ backgroundColor: "var(--color-muted)", color: "var(--color-foreground)" }}
      >
        i
      </button>
      {open && (
        <div
          className="absolute bottom-full right-0 mb-2 w-72 text-xs rounded-md p-3 shadow-lg z-10"
          style={{ backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)" }}
        >
          {text}
        </div>
      )}
    </div>
  );
}

function SectionCard({
  title,
  info,
  className = "",
  children,
}: {
  title: string;
  info?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`card p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-fg-soft">{title}</h3>
        {info && <InfoTooltip text={info} />}
      </div>
      {children}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card p-4">
      <p className="text-xs uppercase tracking-wide text-fg-soft">{label}</p>
      <p className="text-2xl font-bold text-fg mt-1">{value}</p>
    </div>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md skeleton ${className}`} />;
}

function DashboardSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Building dashboard">
      <div className="flex items-center justify-between">
        <SkeletonBlock className="h-7 w-64" />
        <SkeletonBlock className="h-9 w-40" />
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-4">
            <SkeletonBlock className="h-3 w-20 mb-2" />
            <SkeletonBlock className="h-7 w-12" />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="card p-4 space-y-3">
          <SkeletonBlock className="h-3 w-40" />
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-5/6" />
          <SkeletonBlock className="h-4 w-2/3" />
        </div>
      ))}
      <p className="text-sm text-fg-soft text-center">
        Searching reviews, competitors, and financial data — this can take a little while for full competitor research…
      </p>
    </div>
  );
}

export default function Dashboard({ analysisId }: { analysisId: string }) {
  const [data, setData] = useState<{
    companyName: string;
    report: DashboardReport;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/report/${analysisId}`)
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Failed to load dashboard");
        setData(json);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Something went wrong"))
      .finally(() => setLoading(false));
  }, [analysisId]);

  if (loading) {
    return <DashboardSkeleton />;
  }
  if (error) {
    return (
      <div className="card shadow-sm p-6 text-red-600">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const { report } = data;
  const maxPct = Math.max(1, ...report.issues.map((i) => i.pct_of_reviews));
  // Below this, every percentage/score on the page is an artifact of a
  // tiny denominator (e.g. "100%" from 1 of 1 review), not a real pattern —
  // sample-size honesty per the evidence-ladder rule: report direction, not
  // precision, until there's enough data to support it.
  const THIN_DATA_THRESHOLD = 10;
  const isThinData = report.metrics.total_reviews < THIN_DATA_THRESHOLD;
  const forces = report.porters_five_forces;
  const hasForces =
    forces &&
    Object.values(forces).some((v) => v && !/insufficient data/i.test(v));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-fg">{data.companyName} — Dashboard</h2>
      </div>

      {isThinData && (
        <div className="bg-amber-50 border border-amber-300 rounded-lg p-4">
          <p className="text-sm font-semibold text-amber-900">
            Only {report.metrics.total_reviews} review{report.metrics.total_reviews === 1 ? "" : "s"}{" "}
            found for this company.
          </p>
          <p className="text-sm text-amber-800 mt-1">
            That&apos;s too few to trust any percentage or score below at face value — with this
            few reviews, a single complaint can show up as &quot;100%&quot;. Treat everything on
            this page as a rough first read, not a verdict. Upload more reviews (a support-ticket
            export, a survey, or a file of past feedback) above for a real analysis.
          </p>
        </div>
      )}

      {report.summary && (
        <div
          className="rounded-lg p-4"
          style={{ backgroundColor: "var(--color-primary)", color: "var(--color-on-primary)" }}
        >
          <p className="text-xs font-semibold uppercase tracking-wide opacity-70 mb-1">
            Answer
          </p>
          <p className="text-sm leading-relaxed">{report.summary}</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Reviews Analyzed" value={report.metrics.total_reviews} />
        <StatTile label="Issues Found" value={report.metrics.issue_count} />
        <StatTile label="At-Risk Issues" value={report.metrics.at_risk_issue_count} />
        <StatTile
          label="Top Issue"
          value={report.metrics.top_issue_title ? `${report.metrics.top_issue_pct}%` : "—"}
        />
      </div>

      {report.finance.revenue_at_risk.applicable && report.finance.revenue_at_risk.estimate && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-red-700 mb-1">
            Estimated Revenue at Risk (modeled, not measured)
          </p>
          <p className="text-lg font-bold text-red-800">
            {report.finance.revenue_at_risk.estimate}
          </p>
          <ul className="text-xs text-red-700 mt-1 list-disc list-inside">
            {report.finance.revenue_at_risk.assumptions.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      <DashboardCharts report={report} />

      <div className="grid xl:grid-cols-2 gap-4">
        <SectionCard title="Issues at a Glance">
          <div className="space-y-2.5">
            {report.issues.map((issue, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-fg flex items-center gap-2">
                    {issue.title}
                    <span
                      title={PRIORITY_LABEL[issue.priority]}
                      className={`cursor-help text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_COLOR[issue.priority]}`}
                    >
                      {issue.priority.toUpperCase()}
                    </span>
                    {issue.at_risk && (
                      <span
                        title="Customers used explicit exit language for this issue"
                        className="cursor-help text-[10px] font-semibold px-1.5 py-0.5 rounded text-white"
                        style={{ backgroundColor: STATUS.critical }}
                      >
                        AT RISK
                      </span>
                    )}
                  </span>
                  <span className="text-fg-muted">{issue.pct_of_reviews}%</span>
                </div>
                <div className="h-2 rounded-full skeleton overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(issue.pct_of_reviews / maxPct) * 100}%`,
                      backgroundColor: issue.at_risk ? STATUS.critical : "#94a3b8",
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Highs — What's Working">
          {report.highs.length === 0 ? (
            <p className="text-sm text-fg-soft">No clear positive signal found in the data.</p>
          ) : (
            <ul className="space-y-1.5">
              {report.highs.map((h, i) => (
                <li key={i} className="text-sm text-fg">
                  <span className="font-medium" style={{ color: STATUS.good }}>
                    {h.label}
                  </span>{" "}
                  — {h.detail}
                </li>
              ))}
            </ul>
          )}
        </SectionCard>
      </div>

      <div className="grid xl:grid-cols-2 gap-4">
        {hasForces && (
          <SectionCard title="Porter's Five Forces">
            {report.porters_five_forces_intensity && (
              <PortersRadarChart intensity={report.porters_five_forces_intensity} />
            )}
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-fg mt-2">
              <p>
                <span className="font-medium">Rivalry:</span> {forces.rivalry}
              </p>
              <p>
                <span className="font-medium">New Entrants:</span> {forces.threat_of_new_entrants}
              </p>
              <p>
                <span className="font-medium">Substitutes:</span> {forces.threat_of_substitutes}
              </p>
              <p>
                <span className="font-medium">Buyer Power:</span> {forces.buyer_power}
              </p>
              <p>
                <span className="font-medium">Supplier Power:</span> {forces.supplier_power}
              </p>
            </div>
          </SectionCard>
        )}

        <SectionCard
          title="GTM — STP & Positioning"
          info="Segment / Target / Position via the STP framework; Points of Difference / Parity via the 3C Positioning model (Customer × Company × Competitor)."
          className={hasForces ? "" : "xl:col-span-2"}
        >
          <div className="text-sm text-fg space-y-1 mb-3">
            <p>
              <span className="font-medium">Segment:</span> {report.gtm.segment}
            </p>
            <p>
              <span className="font-medium">Target:</span> {report.gtm.target}
            </p>
            <p>
              <span className="font-medium">Position:</span> {report.gtm.position}
            </p>
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold uppercase text-fg-soft mb-1">
                Points of Difference
              </p>
              {report.gtm.points_of_difference.length === 0 ? (
                <p className="text-sm text-fg-soft">None identified from available data.</p>
              ) : (
                <ul className="text-sm text-fg list-disc list-inside space-y-0.5">
                  {report.gtm.points_of_difference.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-fg-soft mb-1">
                Points of Parity
              </p>
              {report.gtm.points_of_parity.length === 0 ? (
                <p className="text-sm text-fg-soft">None identified from available data.</p>
              ) : (
                <ul className="text-sm text-fg list-disc list-inside space-y-0.5">
                  {report.gtm.points_of_parity.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          {(report.gtm.ansoff || report.gtm.product_life_cycle) && (
            <div className="mt-3 pt-3 border-t divider grid sm:grid-cols-2 gap-3">
              {report.gtm.ansoff && (
                <div>
                  <p className="text-xs font-semibold uppercase text-fg-soft mb-1">
                    Growth direction (Ansoff Matrix)
                  </p>
                  {report.gtm.ansoff.quadrant ? (
                    <p className="text-sm text-fg">
                      <span className="badge-accent capitalize">
                        {report.gtm.ansoff.quadrant.replace(/_/g, " ")}
                      </span>{" "}
                      — {report.gtm.ansoff.rationale}
                    </p>
                  ) : (
                    <p className="text-sm text-fg-soft">{report.gtm.ansoff.rationale}</p>
                  )}
                </div>
              )}
              {report.gtm.product_life_cycle && (
                <div>
                  <p className="text-xs font-semibold uppercase text-fg-soft mb-1">
                    Lifecycle stage (Product Life Cycle)
                  </p>
                  {report.gtm.product_life_cycle.stage ? (
                    <p className="text-sm text-fg">
                      <span className="badge-accent capitalize">
                        {report.gtm.product_life_cycle.stage}
                      </span>{" "}
                      — {report.gtm.product_life_cycle.rationale}
                    </p>
                  ) : (
                    <p className="text-sm text-fg-soft">{report.gtm.product_life_cycle.rationale}</p>
                  )}
                </div>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {report.brand && (
        <div className="grid xl:grid-cols-2 gap-4">
          <SectionCard
            title="Brand Diagnosis (CBBE)"
            info="Keller's Customer-Based Brand Equity pyramid, built bottom-up: Salience (do they know you?) → Performance + Imagery (what it does / what it means) → Judgements + Feelings (their evaluation) → Resonance (loyalty, advocacy). The weakest layer caps everything built on top of it."
          >
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-fg-soft mb-1">
                  Node word — the one thing this brand owns in customers&apos; minds
                </p>
                {report.brand.node_word ? (
                  <p className="text-fg">
                    <span className="badge-accent">
                      &quot;{report.brand.node_word}&quot;
                    </span>{" "}
                    — {report.brand.node_word_evidence}
                  </p>
                ) : (
                  <p className="text-fg-soft">
                    No clear association found. {report.brand.node_word_evidence}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-fg-soft mb-1">
                  Weakest brand layer
                </p>
                <p className="text-fg">
                  <span className="font-semibold capitalize">
                    {report.brand.weakest_cbbe_layer}
                  </span>{" "}
                  — {report.brand.weakest_cbbe_layer_evidence}
                </p>
              </div>
              {(report.brand.archetype?.name || report.brand.posture?.stance) && (
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t divider">
                  {report.brand.archetype?.name && (
                    <span
                      title={report.brand.archetype.rationale}
                      className="cursor-help text-xs font-semibold px-2 py-1 rounded badge-accent"
                    >
                      Archetype: {report.brand.archetype.name}
                    </span>
                  )}
                  {report.brand.posture?.stance && (
                    <span
                      title={report.brand.posture.rationale}
                      className={`cursor-help text-xs font-semibold px-2 py-1 rounded ${POSTURE_COLOR[report.brand.posture.stance]}`}
                    >
                      Posture: {POSTURE_LABEL[report.brand.posture.stance]}
                    </span>
                  )}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Campaign Angle (Enemy — Stand — Mantra)">
            {report.brand.campaign ? (
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-xs font-semibold uppercase text-fg-soft">Enemy: </span>
                  <span className="text-fg">{report.brand.campaign.enemy}</span>
                </p>
                <p>
                  <span className="text-xs font-semibold uppercase text-fg-soft">Stand: </span>
                  <span className="text-fg">{report.brand.campaign.stand}</span>
                </p>
                <p className="pt-1 border-t divider">
                  <span className="text-xs font-semibold uppercase text-fg-soft">Mantra: </span>
                  <span className="text-fg font-semibold italic">
                    &quot;{report.brand.campaign.mantra}&quot;
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-fg-soft">
                No customer pain point in the data clearly justifies a campaign angle yet.
              </p>
            )}
          </SectionCard>
        </div>
      )}

      {report.brand?.asset_valuator?.quadrant &&
        report.brand.asset_valuator.vitality != null &&
        report.brand.asset_valuator.stature != null && (
          <SectionCard
            title="Brand Asset Valuator"
            info="Vitality (differentiation × relevance) on the x-axis, Stature (esteem × knowledge) on the y-axis — the same 2x2 Young & Rubicam model marketers use to tell a differentiated-but-unproven brand apart from a trusted-but-generic one."
          >
            <div className="grid md:grid-cols-[1fr,auto] gap-4 items-center">
              <AssetValuatorChart assetValuator={report.brand.asset_valuator} />
              <div className="text-sm space-y-2 md:max-w-[220px]">
                <p className="badge-accent inline-block">
                  {BAV_QUADRANT_LABEL[report.brand.asset_valuator.quadrant]}
                </p>
                <p className="text-fg-muted text-xs">{report.brand.asset_valuator.rationale}</p>
                <dl className="text-xs text-fg-soft space-y-0.5 pt-1 border-t divider">
                  <div className="flex justify-between">
                    <dt>Vitality</dt>
                    <dd className="font-semibold text-fg">{report.brand.asset_valuator.vitality}/10</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt>Stature</dt>
                    <dd className="font-semibold text-fg">{report.brand.asset_valuator.stature}/10</dd>
                  </div>
                </dl>
              </div>
            </div>
          </SectionCard>
        )}

      {report.brand?.kapferer_prism &&
        Object.values(report.brand.kapferer_prism).some((v) => v) && (
          <SectionCard title="Brand Identity Prism (Kapferer)">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
              {(
                [
                  ["physique", "Physique"],
                  ["personality", "Personality"],
                  ["relationship", "Relationship"],
                  ["culture", "Culture"],
                  ["reflection", "Reflection"],
                  ["self_image", "Self-Image"],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="card p-3">
                  <p className="text-xs font-semibold uppercase text-fg-soft mb-1">{label}</p>
                  <p className={report.brand.kapferer_prism[key] ? "text-fg" : "text-fg-soft"}>
                    {report.brand.kapferer_prism[key] ?? "Not enough evidence in the data."}
                  </p>
                </div>
              ))}
            </div>
          </SectionCard>
        )}

      {report.brand?.personas && report.brand.personas.length > 0 && (
        <SectionCard
          title="Ideal Customer Personas (Market Research)"
          info="Segmentation output, not a demographic guess — each persona is built only from goals/pain-points that real review evidence actually shows for that segment (the STP segment/target above names the group; these are who's inside it). No invented ages, incomes, or backstories."
        >
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {report.brand.personas.map((p, i) => (
              <div key={i} className="card p-3">
                <p className="font-semibold text-fg mb-1">{p.name}</p>
                <p className="text-xs text-fg-soft mb-2">{p.context}</p>
                <p className="text-xs text-fg-muted mb-1">
                  <span className="font-semibold">Goals: </span>
                  {p.goals}
                </p>
                <p className="text-xs text-fg-muted">
                  <span className="font-semibold">Pain points: </span>
                  {p.pain_points}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Issues & Solutions"
        info="At most 3-4 issues, ranked by how many reviews cite them and whether customers used real exit language. Each one names the problem directly, cites the evidence behind it, and gives a costed, sequenced fix — not an abstract theme score. Priority and at-risk severity are calibrated using the Brand Fidelity Matrix (how sacred the broken promise was, not just how many people mentioned it) before the product frameworks below name what to actually build."
      >
        <div className="space-y-4">
          {report.issues.map((issue, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-start gap-3 mb-3">
                <span
                  className="flex-shrink-0 h-7 w-7 rounded-md flex items-center justify-center text-sm font-bold"
                  style={{ backgroundColor: "var(--color-accent)", color: "var(--color-on-primary)" }}
                >
                  {i + 1}
                </span>
                <div className="flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold text-fg">{issue.title}</p>
                    <span
                      className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_COLOR[issue.priority]}`}
                    >
                      {issue.priority.toUpperCase()}
                    </span>
                    {issue.at_risk && (
                      <span
                        className="text-[10px] font-semibold px-1.5 py-0.5 rounded text-white"
                        style={{ backgroundColor: STATUS.critical }}
                      >
                        AT RISK
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-fg-soft mt-0.5">{issue.pct_of_reviews}% of reviews</p>
                </div>
              </div>

              <p className="text-xs font-semibold uppercase text-red-600 mb-1">What&apos;s broken (evidence)</p>
              <ul className="text-sm text-fg-muted list-disc list-inside space-y-0.5 mb-3">
                {issue.evidence.map((e, j) => (
                  <li key={j}>{e}</li>
                ))}
              </ul>

              <p className="text-xs font-semibold uppercase mb-1" style={{ color: "var(--color-success)" }}>
                The fix
              </p>
              <ol className="text-sm text-fg-muted list-decimal list-inside space-y-0.5 mb-3">
                {issue.fix.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>

              {issue.frameworks_applied?.length > 0 && (
                <>
                  <p className="text-xs font-semibold uppercase text-fg-soft mb-1">Frameworks applied</p>
                  <ul className="text-sm text-fg-muted list-disc list-inside space-y-0.5 mb-3">
                    {issue.frameworks_applied.map((f, j) => (
                      <li key={j}>{f}</li>
                    ))}
                  </ul>
                </>
              )}

              <div className="grid sm:grid-cols-2 gap-2 text-xs rounded-md p-3" style={{ backgroundColor: "var(--color-muted)" }}>
                <p className="text-fg">
                  <span className="font-semibold">Cost: </span>
                  {issue.cost}
                </p>
                <p className="text-fg">
                  <span className="font-semibold">Estimated impact: </span>
                  {issue.impact}
                </p>
              </div>
              <p className="text-xs badge-accent mt-2">
                <span className="font-semibold">Track: </span>
                {issue.metric_to_track}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Finance">
        <div className="grid xl:grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <p className="text-xs font-semibold uppercase text-fg-soft mb-1">
              {data.companyName}
            </p>
            {!report.finance.own.found ? (
              <p className="text-sm text-fg-soft">No public financial data found.</p>
            ) : (
              <ul className="text-sm text-fg space-y-0.5">
                {report.finance.own.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </div>
          {report.finance.competitors.map((comp, i) => (
            <div key={i}>
              <p className="text-xs font-semibold uppercase text-fg-soft mb-1">{comp.name}</p>
              {!comp.found ? (
                <p className="text-sm text-fg-soft">No public financial data found.</p>
              ) : (
                <ul className="text-sm text-fg space-y-0.5">
                  {comp.findings.map((f, j) => (
                    <li key={j}>{f}</li>
                  ))}
                </ul>
              )}
              {comp.comparison && (
                <p className="text-sm badge-accent mt-1">{comp.comparison}</p>
              )}
            </div>
          ))}
        </div>
        {report.finance.unit_economics_notes.length > 0 && (
          <div className="pt-3 mt-3 border-t divider">
            <p className="text-xs font-semibold uppercase text-fg-soft mb-1">
              Unit Economics Notes
            </p>
            <ul className="text-sm text-fg space-y-0.5">
              {report.finance.unit_economics_notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
