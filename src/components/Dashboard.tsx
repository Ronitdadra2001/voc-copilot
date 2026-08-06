"use client";

import { useEffect, useState } from "react";
import type { DashboardReport } from "@/lib/types";
import DashboardCharts from "@/components/DashboardCharts";

// Status palette from the dataviz skill (validated, fixed — never themed):
// good/warning/serious/critical. Distinct from the categorical chart slots
// so a status color never impersonates a data series.
const STATUS = {
  critical: "#d03b3b",
  warning: "#fab219",
  good: "#0ca30c",
};

const PRIORITY_COLOR: Record<DashboardReport["roadmap"][number]["priority"], string> = {
  now: "bg-red-50 text-red-700 border border-red-200",
  near: "bg-amber-50 text-amber-700 border border-amber-200",
  far: "bg-slate-100 text-slate-700 border border-slate-200",
};

const KANO_LABEL: Record<DashboardReport["lows"][number]["kano"], string> = {
  "must-be": "Must-Be",
  performance: "Performance",
  delighter: "Delighter",
};

const KANO_COLOR: Record<DashboardReport["lows"][number]["kano"], string> = {
  "must-be": "bg-red-50 text-red-700",
  performance: "bg-blue-50 text-blue-700",
  delighter: "bg-slate-100 text-slate-600",
};

const KANO_TOOLTIP: Record<DashboardReport["lows"][number]["kano"], string> = {
  "must-be": "Must-Be: a baseline expectation, not a bonus feature — its absence causes major dissatisfaction (e.g. crashes, failed refunds). Fix these first, always.",
  performance: "Performance: satisfaction scales with how well this works (e.g. speed, support responsiveness) — more improvement here keeps paying off.",
  delighter: "Delighter: absence isn't usually noticed, but presence creates outsized goodwill — lower priority than Must-Be issues.",
};

function StatTile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value}</p>
    </div>
  );
}

function InfoTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-label="How these numbers were calculated"
        onClick={() => setOpen((v) => !v)}
        onBlur={() => setOpen(false)}
        className="h-5 w-5 rounded-full bg-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-300 flex items-center justify-center"
      >
        i
      </button>
      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-72 bg-slate-900 text-slate-100 text-xs rounded-md p-3 shadow-lg z-10">
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
    <div className={`bg-white border border-slate-200 rounded-lg p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
        {info && <InfoTooltip text={info} />}
      </div>
      {children}
    </div>
  );
}

function SkeletonBlock({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded-md bg-slate-200 ${className}`} />;
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
          <div key={i} className="bg-white border border-slate-200 rounded-lg p-4">
            <SkeletonBlock className="h-3 w-20 mb-2" />
            <SkeletonBlock className="h-7 w-12" />
          </div>
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-lg p-4 space-y-3">
          <SkeletonBlock className="h-3 w-40" />
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-5/6" />
          <SkeletonBlock className="h-4 w-2/3" />
        </div>
      ))}
      <p className="text-sm text-slate-500 text-center">
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
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-6 text-red-600">
        {error}
      </div>
    );
  }
  if (!data) return null;

  const { report } = data;
  const maxPct = Math.max(1, ...report.lows.map((l) => l.pct));
  // Below this, every percentage/RICE score on the page is an artifact of a
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
        <h2 className="text-xl font-bold text-slate-900">{data.companyName} — Dashboard</h2>
        <a
          href={`/api/report/${analysisId}/pdf`}
          className="rounded-md bg-slate-900 text-white px-4 py-2 text-sm font-semibold hover:bg-slate-800"
        >
          Download Full PDF
        </a>
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
        <div className="bg-slate-900 text-slate-100 rounded-lg p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-1">
            Answer
          </p>
          <p className="text-sm leading-relaxed">{report.summary}</p>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatTile label="Reviews Analyzed" value={report.metrics.total_reviews} />
        <StatTile label="Themes Found" value={report.metrics.theme_count} />
        <StatTile label="At-Risk Themes" value={report.metrics.at_risk_theme_count} />
        <StatTile
          label="Top Issue"
          value={report.metrics.top_theme_title ? `${report.metrics.top_theme_pct}%` : "—"}
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
        <SectionCard title="Lows — What They're Getting Wrong">
          <div className="space-y-2.5">
            {report.lows.map((low, i) => (
              <div key={i}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-medium text-slate-900 flex items-center gap-2">
                    <span title={low.detail} className="cursor-help underline decoration-dotted decoration-slate-400 underline-offset-2">
                      {low.label}
                    </span>
                    <span
                      title={KANO_TOOLTIP[low.kano]}
                      className={`cursor-help text-[10px] font-semibold px-1.5 py-0.5 rounded ${KANO_COLOR[low.kano]}`}
                    >
                      {KANO_LABEL[low.kano]}
                    </span>
                    {low.at_risk && (
                      <span
                        title={`Customers used explicit exit language for this issue: ${low.detail}`}
                        className="cursor-help text-[10px] font-semibold px-1.5 py-0.5 rounded text-white"
                        style={{ backgroundColor: STATUS.critical }}
                      >
                        AT RISK
                      </span>
                    )}
                  </span>
                  <span className="text-slate-600">{low.pct}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(low.pct / maxPct) * 100}%`,
                      backgroundColor: low.at_risk ? STATUS.critical : "#94a3b8",
                    }}
                  />
                </div>
                <p className="text-xs text-slate-600 mt-1">{low.detail}</p>
              </div>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Highs — What's Working">
          {report.highs.length === 0 ? (
            <p className="text-sm text-slate-500">No clear positive signal found in the data.</p>
          ) : (
            <ul className="space-y-1.5">
              {report.highs.map((h, i) => (
                <li key={i} className="text-sm text-slate-800">
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
            <div className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm text-slate-800">
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

        <SectionCard title="GTM — STP & Positioning" className={hasForces ? "" : "xl:col-span-2"}>
          <div className="text-sm text-slate-800 space-y-1 mb-3">
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
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">
                Points of Difference
              </p>
              {report.gtm.points_of_difference.length === 0 ? (
                <p className="text-sm text-slate-500">None identified from available data.</p>
              ) : (
                <ul className="text-sm text-slate-800 list-disc list-inside space-y-0.5">
                  {report.gtm.points_of_difference.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">
                Points of Parity
              </p>
              {report.gtm.points_of_parity.length === 0 ? (
                <p className="text-sm text-slate-500">None identified from available data.</p>
              ) : (
                <ul className="text-sm text-slate-800 list-disc list-inside space-y-0.5">
                  {report.gtm.points_of_parity.map((p, i) => (
                    <li key={i}>{p}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </SectionCard>
      </div>

      {report.brand && (
        <div className="grid xl:grid-cols-2 gap-4">
          <SectionCard title="Brand Diagnosis (CBBE)">
            <div className="space-y-3 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">
                  Node word — the one thing this brand owns in customers&apos; minds
                </p>
                {report.brand.node_word ? (
                  <p className="text-slate-900">
                    <span className="font-semibold text-indigo-700">
                      &quot;{report.brand.node_word}&quot;
                    </span>{" "}
                    — {report.brand.node_word_evidence}
                  </p>
                ) : (
                  <p className="text-slate-500">
                    No clear association found. {report.brand.node_word_evidence}
                  </p>
                )}
              </div>
              <div>
                <p className="text-xs font-semibold uppercase text-slate-500 mb-1">
                  Weakest brand layer
                </p>
                <p className="text-slate-900">
                  <span className="font-semibold capitalize">
                    {report.brand.weakest_cbbe_layer}
                  </span>{" "}
                  — {report.brand.weakest_cbbe_layer_evidence}
                </p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Campaign Angle (Enemy — Stand — Mantra)">
            {report.brand.campaign ? (
              <div className="space-y-2 text-sm">
                <p>
                  <span className="text-xs font-semibold uppercase text-slate-500">Enemy: </span>
                  <span className="text-slate-900">{report.brand.campaign.enemy}</span>
                </p>
                <p>
                  <span className="text-xs font-semibold uppercase text-slate-500">Stand: </span>
                  <span className="text-slate-900">{report.brand.campaign.stand}</span>
                </p>
                <p className="pt-1 border-t border-slate-100">
                  <span className="text-xs font-semibold uppercase text-slate-500">Mantra: </span>
                  <span className="text-slate-900 font-semibold italic">
                    &quot;{report.brand.campaign.mantra}&quot;
                  </span>
                </p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">
                No customer pain point in the data clearly justifies a campaign angle yet.
              </p>
            )}
          </SectionCard>
        </div>
      )}

      {report.brand?.personas && report.brand.personas.length > 0 && (
        <SectionCard title="Customer Personas (from review evidence)">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {report.brand.personas.map((p, i) => (
              <div key={i} className="border border-slate-200 rounded-lg p-3">
                <p className="font-semibold text-slate-900 mb-1">{p.name}</p>
                <p className="text-xs text-slate-500 mb-2">{p.context}</p>
                <p className="text-xs text-slate-700 mb-1">
                  <span className="font-semibold">Goals: </span>
                  {p.goals}
                </p>
                <p className="text-xs text-slate-700">
                  <span className="font-semibold">Pain points: </span>
                  {p.pain_points}
                </p>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      <SectionCard
        title="Product Roadmap — RICE Prioritization"
        info="RICE = (Reach × Impact × Confidence) ÷ Effort. Reach: how many customers/reviews this touches (1-10). Impact: how much it moves the needle if fixed (1-3 = low, 4-7 = medium, 8-10 = high). Confidence: how sure the model is, based on how directly the review evidence supports it (as a % expressed 0-1, e.g. 0.8 = 80%). Effort: rough person-weeks to ship (1-10). Higher score = higher priority. All four inputs are derived by the LLM from the actual themes and quote evidence found for this company — not invented independently of the review data."
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-slate-500 border-b border-slate-200">
                <th className="pb-2 pr-2">Action</th>
                <th className="pb-2 px-2 text-right">Reach</th>
                <th className="pb-2 px-2 text-right">Impact</th>
                <th className="pb-2 px-2 text-right">Conf.</th>
                <th className="pb-2 px-2 text-right">Effort</th>
                <th className="pb-2 pl-2 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {report.product_roadmap.map((item, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="py-2 pr-2 text-slate-900 font-medium">{item.action}</td>
                  <td className="py-2 px-2 text-right text-slate-700">{item.reach}</td>
                  <td className="py-2 px-2 text-right text-slate-700">{item.impact}</td>
                  <td className="py-2 px-2 text-right text-slate-700">{item.confidence}</td>
                  <td className="py-2 px-2 text-right text-slate-700">{item.effort}</td>
                  <td className="py-2 pl-2 text-right font-semibold text-slate-900">
                    {item.score}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 space-y-3">
          {report.product_roadmap.map((item, i) => (
            <div key={i} className="border border-slate-200 rounded-md p-3">
              <p className="text-sm font-semibold text-slate-900 mb-1.5">{item.action}</p>
              <ol className="text-sm text-slate-700 list-decimal list-inside space-y-0.5 mb-2">
                {item.how_to_implement.map((step, j) => (
                  <li key={j}>{step}</li>
                ))}
              </ol>
              <p className="text-xs text-indigo-700">
                <span className="font-semibold">Track: </span>
                {item.metric_to_track}
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Finance">
        <div className="grid xl:grid-cols-2 gap-x-6 gap-y-3">
          <div>
            <p className="text-xs font-semibold uppercase text-slate-500 mb-1">
              {data.companyName}
            </p>
            {!report.finance.own.found ? (
              <p className="text-sm text-slate-500">No public financial data found.</p>
            ) : (
              <ul className="text-sm text-slate-800 space-y-0.5">
                {report.finance.own.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </div>
          {report.finance.competitors.map((comp, i) => (
            <div key={i}>
              <p className="text-xs font-semibold uppercase text-slate-500 mb-1">{comp.name}</p>
              {!comp.found ? (
                <p className="text-sm text-slate-500">No public financial data found.</p>
              ) : (
                <ul className="text-sm text-slate-800 space-y-0.5">
                  {comp.findings.map((f, j) => (
                    <li key={j}>{f}</li>
                  ))}
                </ul>
              )}
              {comp.comparison && (
                <p className="text-sm text-indigo-700 mt-1">{comp.comparison}</p>
              )}
            </div>
          ))}
        </div>
        {report.finance.unit_economics_notes.length > 0 && (
          <div className="pt-3 mt-3 border-t border-slate-100">
            <p className="text-xs font-semibold uppercase text-slate-500 mb-1">
              Unit Economics Notes
            </p>
            <ul className="text-sm text-slate-800 space-y-0.5">
              {report.finance.unit_economics_notes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </SectionCard>

      <SectionCard title="Roadmap Summary (Impact–Effort: Now / Near / Far)">
        <div className="grid lg:grid-cols-3 gap-2">
          {report.roadmap.map((item, i) => (
            <div key={i} className="border border-slate-200 rounded-md p-3">
              <div className="flex items-center gap-2 mb-1">
                <span
                  className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PRIORITY_COLOR[item.priority]}`}
                >
                  {item.priority.toUpperCase()}
                </span>
                <h4 className="font-medium text-slate-900">{item.action}</h4>
              </div>
              <p className="text-sm text-slate-600">{item.rationale}</p>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  );
}
