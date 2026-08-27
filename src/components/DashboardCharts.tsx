"use client";

import {
  Cell,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ScatterChart,
  Scatter,
  ReferenceArea,
  ReferenceLine,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import type { DashboardReport } from "@/lib/types";

// Fixed-order categorical palette + sequential blue, validated via the
// dataviz skill's validate_palette.js (light mode): worst adjacent CVD ΔE
// 24.2, well clear of the >=12 target. Order is the CVD-safety mechanism —
// never re-sort or cycle these per-render.
const CATEGORICAL = [
  "#2a78d6", // blue
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
  "#e87ba4", // magenta
  "#eb6834", // orange
];
const MUTED_TEXT = "#52514e";
const GRIDLINE = "#e1e0d9";

function IssueShareChart({ issues }: { issues: DashboardReport["issues"] }) {
  // NOT a pie chart. Each issue's pct is "% of reviews that mention this
  // issue" — issues are not mutually exclusive (one review can mention
  // several), so the values do not sum to 100 and cannot be pie slices.
  // Forcing them into a pie produced degenerate equal-value slices (e.g. two
  // issues both at 100%), which is both mathematically misleading (a pie
  // implies parts of one whole) and — confirmed in practice — crashed
  // Recharts' label-collision layout into an infinite re-render loop
  // ("Maximum update depth exceeded") on exactly that kind of degenerate
  // data. A plain horizontal bar has no such assumption and cannot crash.
  const data = [...issues]
    .sort((a, b) => b.pct_of_reviews - a.pct_of_reviews)
    .map((i) => ({ name: i.title, value: i.pct_of_reviews }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(180, data.length * 40)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 32, left: 8, bottom: 8 }}>
        <CartesianGrid stroke={GRIDLINE} horizontal={false} />
        <XAxis
          type="number"
          domain={[0, 100]}
          tick={{ fill: MUTED_TEXT, fontSize: 11 }}
          tickFormatter={(v) => `${v}%`}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={140}
          tick={{ fill: MUTED_TEXT, fontSize: 11 }}
          tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 22)}…` : v)}
        />
        <Tooltip formatter={(value) => `${value}% of reviews mention this`} />
        <Bar dataKey="value" name="% of reviews" radius={[0, 4, 4, 0]} maxBarSize={26}>
          {data.map((_, i) => (
            <Cell key={i} fill={CATEGORICAL[i % CATEGORICAL.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const PRIORITY_ORDER = ["now", "near", "far"] as const;
const PRIORITY_LABELS: Record<(typeof PRIORITY_ORDER)[number], string> = {
  now: "Now (0–30 days)",
  near: "Near (31–60 days)",
  far: "Far (61–90 days)",
};
const PRIORITY_COLORS: Record<(typeof PRIORITY_ORDER)[number], string> = {
  now: "#e34948",
  near: "#eda100",
  far: "#94a3b8",
};

function RoadmapSequenceChart({ issues }: { issues: DashboardReport["issues"] }) {
  // Deliberately different data from the issue-share chart: this counts WHEN
  // each fix is sequenced (the 90-day Now/Near/Far gate), not how big the
  // underlying complaint is. Answers "how much is front-loaded vs deferred,"
  // which the share chart can't show.
  const data = PRIORITY_ORDER.map((p) => ({
    name: PRIORITY_LABELS[p],
    count: issues.filter((i) => i.priority === p).length,
    key: p,
  })).filter((d) => d.count > 0);

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 24 }}>
        <CartesianGrid stroke={GRIDLINE} vertical={false} />
        <XAxis
          dataKey="name"
          tick={{ fill: MUTED_TEXT, fontSize: 11 }}
          angle={-10}
          textAnchor="end"
          height={44}
        />
        <YAxis allowDecimals={false} tick={{ fill: MUTED_TEXT, fontSize: 11 }} />
        <Tooltip formatter={(value) => `${value} issue(s)`} />
        <Bar dataKey="count" name="Issues" radius={[4, 4, 0, 0]} maxBarSize={70}>
          {data.map((d, i) => (
            <Cell key={i} fill={PRIORITY_COLORS[d.key]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const BAV_QUADRANT_FILL = "#f4f3ee"; // one flat neutral tint — the point color carries the meaning, not the background
const BAV_MIDPOINT = 5.5;

/** Brand Asset Valuator — vitality (differentiation x relevance) plotted
 * against stature (esteem x knowledge). A single point in one of four
 * quadrants; renders null rather than a misleading chart when the pass
 * couldn't honestly score either axis. */
export function AssetValuatorChart({
  assetValuator,
}: {
  assetValuator: DashboardReport["brand"]["asset_valuator"];
}) {
  if (assetValuator.vitality == null || assetValuator.stature == null) return null;
  const point = [{ x: assetValuator.vitality, y: assetValuator.stature }];

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
        <ReferenceArea x1={0} x2={BAV_MIDPOINT} y1={BAV_MIDPOINT} y2={10} fill={BAV_QUADRANT_FILL} fillOpacity={0.5} />
        <ReferenceArea x1={BAV_MIDPOINT} x2={10} y1={BAV_MIDPOINT} y2={10} fill={BAV_QUADRANT_FILL} fillOpacity={0.9} />
        <ReferenceArea x1={0} x2={BAV_MIDPOINT} y1={0} y2={BAV_MIDPOINT} fill={BAV_QUADRANT_FILL} fillOpacity={0.15} />
        <ReferenceArea x1={BAV_MIDPOINT} x2={10} y1={0} y2={BAV_MIDPOINT} fill={BAV_QUADRANT_FILL} fillOpacity={0.3} />
        <ReferenceLine x={BAV_MIDPOINT} stroke={GRIDLINE} />
        <ReferenceLine y={BAV_MIDPOINT} stroke={GRIDLINE} />
        <XAxis
          type="number"
          dataKey="x"
          name="Vitality"
          domain={[0, 10]}
          ticks={[0, 2.5, 5, 7.5, 10]}
          tick={{ fill: MUTED_TEXT, fontSize: 11 }}
          label={{ value: "Vitality (differentiation × relevance)", position: "insideBottom", offset: -4, fontSize: 11, fill: MUTED_TEXT }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Stature"
          domain={[0, 10]}
          ticks={[0, 2.5, 5, 7.5, 10]}
          tick={{ fill: MUTED_TEXT, fontSize: 11 }}
          label={{ value: "Stature (esteem × knowledge)", angle: -90, position: "insideLeft", fontSize: 11, fill: MUTED_TEXT }}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          formatter={(value, name) => [`${value}/10`, name]}
        />
        <Scatter
          data={point}
          fill={CATEGORICAL[0]}
          shape={(props: { cx?: number; cy?: number }) => (
            <circle cx={props.cx} cy={props.cy} r={8} fill={CATEGORICAL[0]} stroke="#fff" strokeWidth={2} />
          )}
        />
      </ScatterChart>
    </ResponsiveContainer>
  );
}

const FORCE_LABELS: Record<keyof DashboardReport["porters_five_forces_intensity"], string> = {
  rivalry: "Rivalry",
  threat_of_new_entrants: "New Entrants",
  threat_of_substitutes: "Substitutes",
  buyer_power: "Buyer Power",
  supplier_power: "Supplier Power",
};

/** Porter's Five Forces as a radar — renders null rather than a flat/empty
 * pentagon when fewer than 3 forces have an honest 1-5 score (a radar with
 * 0-2 real points isn't a shape worth showing). */
export function PortersRadarChart({
  intensity,
}: {
  intensity: DashboardReport["porters_five_forces_intensity"];
}) {
  const data = (Object.keys(FORCE_LABELS) as (keyof typeof FORCE_LABELS)[])
    .map((key) => ({ force: FORCE_LABELS[key], value: intensity[key] }))
    .filter((d): d is { force: string; value: number } => d.value != null);
  if (data.length < 3) return null;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <RadarChart data={data} margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
        <PolarGrid stroke={GRIDLINE} />
        <PolarAngleAxis dataKey="force" tick={{ fill: MUTED_TEXT, fontSize: 11 }} />
        <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={{ fill: MUTED_TEXT, fontSize: 10 }} />
        <Tooltip formatter={(value) => [`${value}/5`, "Intensity"]} />
        <Radar dataKey="value" stroke={CATEGORICAL[5]} fill={CATEGORICAL[5]} fillOpacity={0.35} />
      </RadarChart>
    </ResponsiveContainer>
  );
}

export default function DashboardCharts({ report }: { report: DashboardReport }) {
  // Per the skill: don't show a chart the data can't support. A bar chart
  // needs at least 2 categories to say anything a stat tile doesn't already.
  const showCharts = report.issues.length >= 2;
  if (!showCharts) return null;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <div className="card p-4">
        <h3
          title="% of reviews that mention each issue. Issues aren't mutually exclusive — one review can mention several — so these don't sum to 100%."
          className="cursor-help text-sm font-semibold uppercase tracking-wide text-fg-soft mb-2"
        >
          Complaint Share by Issue
        </h3>
        <IssueShareChart issues={report.issues} />
      </div>
      <div className="card p-4">
        <h3
          title="When each fix is scheduled in the 90-day plan — not how big the issue is, just when it's tackled."
          className="cursor-help text-sm font-semibold uppercase tracking-wide text-fg-soft mb-2"
        >
          Roadmap Sequencing
        </h3>
        <RoadmapSequenceChart issues={report.issues} />
      </div>
    </div>
  );
}
