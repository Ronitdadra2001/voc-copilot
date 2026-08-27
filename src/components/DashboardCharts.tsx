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

// Every color below is a CSS custom property (defined in globals.css, light
// + dark pairs) rather than plain hex — the previous version hardcoded
// light-mode-only hex with no dark variant at all, which is exactly why it
// read as washed-out gray blocks with barely-visible text against this app's
// dark background. Re-validated as a set via the dataviz skill's
// validate_palette.js — never re-order or swap a single slot without
// re-running it. Recharts renders these as inline SVG in the same document,
// so var(...) resolves and repaints automatically on theme change, same as
// every other themed color in this app.
const CATEGORICAL = [
  "var(--chart-series-1)", // blue
  "var(--chart-series-3)", // aqua
  "var(--chart-series-4)", // yellow
  "var(--chart-series-6)", // green
  "var(--chart-series-7)", // violet
  "var(--chart-series-8)", // red
  "var(--chart-series-5)", // magenta
  "var(--chart-series-2)", // orange
];
const TEXT_MUTED = "var(--chart-muted)";
const GRIDLINE = "var(--chart-grid)";
const STATUS = {
  good: "var(--chart-status-good)",
  warning: "var(--chart-status-warning)",
  serious: "var(--chart-status-serious)",
  critical: "var(--chart-status-critical)",
};

// Every axis tick / legend / reference label shares this — otherwise Recharts'
// SVG <text> falls back to the browser's default sans instead of the app's
// self-hosted Fira Sans, which is exactly why the chart in the screenshot
// read as visually disconnected from the rest of the dashboard.
const TICK_STYLE = { fill: TEXT_MUTED, fontSize: 12, fontFamily: "var(--font-sans)" };

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
        <XAxis type="number" domain={[0, 100]} tick={TICK_STYLE} tickFormatter={(v) => `${v}%`} />
        <YAxis
          type="category"
          dataKey="name"
          width={140}
          tick={TICK_STYLE}
          tickFormatter={(v: string) => (v.length > 22 ? `${v.slice(0, 22)}…` : v)}
        />
        <Tooltip
          contentStyle={{
            background: "var(--chart-surface)",
            border: `1px solid ${GRIDLINE}`,
            borderRadius: 6,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--chart-text-primary)",
          }}
          formatter={(value) => `${value}% of reviews mention this`}
        />
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
  now: STATUS.critical,
  near: STATUS.warning,
  far: TEXT_MUTED,
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
        <XAxis dataKey="name" tick={TICK_STYLE} angle={-10} textAnchor="end" height={44} />
        <YAxis allowDecimals={false} tick={TICK_STYLE} />
        <Tooltip
          contentStyle={{
            background: "var(--chart-surface)",
            border: `1px solid ${GRIDLINE}`,
            borderRadius: 6,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--chart-text-primary)",
          }}
          formatter={(value) => `${value} issue(s)`}
        />
        <Bar dataKey="count" name="Issues" radius={[4, 4, 0, 0]} maxBarSize={70}>
          {data.map((d, i) => (
            <Cell key={i} fill={PRIORITY_COLORS[d.key]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const BAV_MIDPOINT = 5.5;

// Each Brand Asset Valuator quadrant is a qualitative STATE about the brand,
// not a data series — status colors are the right tool for that (see the
// dataviz skill: status roles are reserved for exactly this and read
// correctly without a legend, unlike a categorical hue). Ranked by real
// business risk, not just "top-right is good": Leadership is the goal
// (good). Niche/Unrealized already has real differentiation, just not yet
// recognized — a normal early stage, not a danger sign (warning, i.e.
// "watch this," not "fix this"). New/Unfocused is weak on both axes but has
// little built up to lose (serious). Declining/Eroded is the one genuine red
// alert — an established brand actively bleeding the differentiation that
// got it there (critical).
const BAV_QUADRANTS = [
  {
    key: "leadership",
    label: "Leadership",
    x: [BAV_MIDPOINT, 10] as const,
    y: [BAV_MIDPOINT, 10] as const,
    color: STATUS.good,
    labelPos: "insideTopRight" as const,
  },
  {
    key: "niche_unrealized_potential",
    label: "Niche / Unrealized Potential",
    x: [0, BAV_MIDPOINT] as const,
    y: [BAV_MIDPOINT, 10] as const,
    color: STATUS.warning,
    labelPos: "insideTopLeft" as const,
  },
  {
    key: "new_unfocused_commodity",
    label: "New / Unfocused / Commodity",
    x: [0, BAV_MIDPOINT] as const,
    y: [0, BAV_MIDPOINT] as const,
    color: STATUS.serious,
    labelPos: "insideBottomLeft" as const,
  },
  {
    key: "declining_eroded",
    label: "Declining / Eroded",
    x: [BAV_MIDPOINT, 10] as const,
    y: [0, BAV_MIDPOINT] as const,
    color: STATUS.critical,
    labelPos: "insideBottomRight" as const,
  },
];

/** Brand Asset Valuator — vitality (differentiation x relevance) plotted
 * against stature (esteem x knowledge). A single point in one of four
 * quadrants; renders null rather than a misleading chart when the pass
 * couldn't honestly score either axis. Each quadrant is labeled directly on
 * the chart (not just in the text block below it) and tinted by what it
 * actually means for the brand, not by position alone. */
export function AssetValuatorChart({
  assetValuator,
}: {
  assetValuator: DashboardReport["brand"]["asset_valuator"];
}) {
  if (assetValuator.vitality == null || assetValuator.stature == null) return null;
  const point = [{ x: assetValuator.vitality, y: assetValuator.stature }];
  const activeQuadrant = BAV_QUADRANTS.find((q) => q.key === assetValuator.quadrant);
  const pointColor = activeQuadrant?.color ?? "var(--chart-series-1)";
  const labelStyle = { fontSize: 11, fontFamily: "var(--font-sans)", fontWeight: 600 };

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ScatterChart margin={{ top: 8, right: 16, left: 0, bottom: 20 }}>
        {BAV_QUADRANTS.map((q) => (
          <ReferenceArea
            key={q.key}
            x1={q.x[0]}
            x2={q.x[1]}
            y1={q.y[0]}
            y2={q.y[1]}
            fill={q.color}
            fillOpacity={q.key === assetValuator.quadrant ? 0.22 : 0.09}
            stroke="none"
            label={{ value: q.label, position: q.labelPos, fill: q.color, ...labelStyle }}
          />
        ))}
        <ReferenceLine x={BAV_MIDPOINT} stroke={GRIDLINE} />
        <ReferenceLine y={BAV_MIDPOINT} stroke={GRIDLINE} />
        <XAxis
          type="number"
          dataKey="x"
          name="Vitality"
          domain={[0, 10]}
          ticks={[0, 2.5, 5, 7.5, 10]}
          tick={TICK_STYLE}
          label={{
            value: "Vitality (differentiation × relevance)",
            position: "insideBottom",
            offset: -8,
            ...TICK_STYLE,
          }}
        />
        <YAxis
          type="number"
          dataKey="y"
          name="Stature"
          domain={[0, 10]}
          ticks={[0, 2.5, 5, 7.5, 10]}
          tick={TICK_STYLE}
          label={{
            value: "Stature (esteem × knowledge)",
            angle: -90,
            position: "insideLeft",
            ...TICK_STYLE,
          }}
        />
        <Tooltip
          cursor={{ strokeDasharray: "3 3", stroke: GRIDLINE }}
          contentStyle={{
            background: "var(--chart-surface)",
            border: `1px solid ${GRIDLINE}`,
            borderRadius: 6,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--chart-text-primary)",
          }}
          formatter={(value, name) => [`${value}/10`, name]}
        />
        <Scatter
          data={point}
          fill={pointColor}
          shape={(props: { cx?: number; cy?: number }) => (
            <circle cx={props.cx} cy={props.cy} r={9} fill={pointColor} stroke="var(--chart-surface)" strokeWidth={3} />
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
    <ResponsiveContainer width="100%" height={280}>
      <RadarChart data={data} margin={{ top: 8, right: 24, left: 24, bottom: 8 }}>
        <PolarGrid stroke={GRIDLINE} />
        <PolarAngleAxis dataKey="force" tick={TICK_STYLE} />
        <PolarRadiusAxis domain={[0, 5]} tickCount={6} tick={{ ...TICK_STYLE, fontSize: 10 }} axisLine={false} />
        <Tooltip
          contentStyle={{
            background: "var(--chart-surface)",
            border: `1px solid ${GRIDLINE}`,
            borderRadius: 6,
            fontFamily: "var(--font-sans)",
            fontSize: 12,
            color: "var(--chart-text-primary)",
          }}
          formatter={(value) => [`${value}/5`, "Intensity"]}
        />
        <Radar
          dataKey="value"
          stroke="var(--chart-series-1)"
          fill="var(--chart-series-1)"
          fillOpacity={0.3}
          strokeWidth={2}
        />
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
