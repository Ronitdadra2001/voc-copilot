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
const SEQUENTIAL_BLUE = "#2a78d6";
const MUTED_TEXT = "#52514e";
const GRIDLINE = "#e1e0d9";

function ThemeSharePie({ lows }: { lows: DashboardReport["lows"] }) {
  // NOT a pie chart. Each theme's pct is "% of reviews that mention this
  // theme" — themes are not mutually exclusive (one review can mention
  // several), so the values do not sum to 100 and cannot be pie slices.
  // Forcing them into a pie produced degenerate equal-value slices (e.g. two
  // themes both at 100%), which is both mathematically misleading (a pie
  // implies parts of one whole) and — confirmed in practice — crashed
  // Recharts' label-collision layout into an infinite re-render loop
  // ("Maximum update depth exceeded") on exactly that kind of degenerate
  // data. A plain horizontal bar has no such assumption and cannot crash.
  const data = [...lows]
    .sort((a, b) => b.pct - a.pct)
    .map((l) => ({ name: l.label, value: l.pct }));

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

function RoadmapSequenceChart({ roadmap }: { roadmap: DashboardReport["roadmap"] }) {
  // Deliberately different data from the theme-share/RICE charts: this counts
  // WHEN each fix is sequenced (the 90-day Now/Near/Far gate), not how big or
  // how urgent the underlying complaint is. Answers "how much is front-loaded
  // vs deferred," which the other charts can't show.
  const data = PRIORITY_ORDER.map((p) => ({
    name: PRIORITY_LABELS[p],
    count: roadmap.filter((r) => r.priority === p).length,
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
        <Tooltip formatter={(value) => `${value} action item(s)`} />
        <Bar dataKey="count" name="Roadmap items" radius={[4, 4, 0, 0]} maxBarSize={70}>
          {data.map((d, i) => (
            <Cell key={i} fill={PRIORITY_COLORS[d.key]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const KANO_ORDER = ["must-be", "performance", "delighter"] as const;
const KANO_LABELS: Record<(typeof KANO_ORDER)[number], string> = {
  "must-be": "Must-Be",
  performance: "Performance",
  delighter: "Delighter",
};
const KANO_COLORS: Record<(typeof KANO_ORDER)[number], string> = {
  "must-be": "#e34948",
  performance: "#2a78d6",
  delighter: "#1baf7a",
};

function KanoDistributionChart({ lows }: { lows: DashboardReport["lows"] }) {
  const data = KANO_ORDER.map((k) => ({
    name: KANO_LABELS[k],
    count: lows.filter((l) => l.kano === k).length,
    key: k,
  })).filter((d) => d.count > 0);

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid stroke={GRIDLINE} horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fill: MUTED_TEXT, fontSize: 11 }} />
        <YAxis
          type="category"
          dataKey="name"
          width={90}
          tick={{ fill: MUTED_TEXT, fontSize: 12 }}
        />
        <Tooltip formatter={(value) => `${value} theme(s)`} />
        <Bar dataKey="count" name="Themes" radius={[0, 4, 4, 0]} maxBarSize={28}>
          {data.map((d, i) => (
            <Cell key={i} fill={KANO_COLORS[d.key]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

function RiceScoreChart({ roadmap }: { roadmap: DashboardReport["product_roadmap"] }) {
  const data = [...roadmap]
    .sort((a, b) => b.score - a.score)
    .map((r) => ({ name: r.action, score: r.score }));

  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 8 }}>
        <CartesianGrid stroke={GRIDLINE} horizontal={false} />
        <XAxis type="number" tick={{ fill: MUTED_TEXT, fontSize: 11 }} />
        <YAxis
          type="category"
          dataKey="name"
          width={160}
          tick={{ fill: MUTED_TEXT, fontSize: 11 }}
          tickFormatter={(v: string) => (v.length > 26 ? `${v.slice(0, 26)}…` : v)}
        />
        <Tooltip />
        <Bar dataKey="score" name="RICE Score" fill={SEQUENTIAL_BLUE} radius={[0, 4, 4, 0]} maxBarSize={22} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function DashboardCharts({ report }: { report: DashboardReport }) {
  // Per the skill: don't show a chart the data can't support. A pie/Pareto
  // needs at least 2 categories to say anything a stat tile doesn't already.
  const showThemeCharts = report.lows.length >= 2;
  const showRice = report.product_roadmap.length >= 2;

  if (!showThemeCharts && !showRice) return null;

  return (
    <div className="grid lg:grid-cols-2 gap-4">
      {showThemeCharts && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3
            title="% of reviews that mention each theme. Themes aren't mutually exclusive — one review can mention several — so these don't sum to 100%."
            className="cursor-help text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2"
          >
            Complaint Share by Theme
          </h3>
          <ThemeSharePie lows={report.lows} />
        </div>
      )}
      {showThemeCharts && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3
            title="How severe is each issue? Must-Be = baseline expectation whose absence causes real damage. Performance = more fixing = more satisfaction. Delighter = nice but not urgent."
            className="cursor-help text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2"
          >
            Issue Severity — Kano Distribution
          </h3>
          <KanoDistributionChart lows={report.lows} />
        </div>
      )}
      {showRice && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3
            title="RICE = (Reach × Impact × Confidence) ÷ Effort — ranks fixes by expected payoff per unit of work, not just complaint volume."
            className="cursor-help text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2"
          >
            RICE Score Ranking
          </h3>
          <RiceScoreChart roadmap={report.product_roadmap} />
        </div>
      )}
      {report.roadmap.length >= 2 && (
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <h3
            title="When each fix is scheduled in the 90-day plan — not how big the issue is, just when it's tackled."
            className="cursor-help text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2"
          >
            Roadmap Sequencing
          </h3>
          <RoadmapSequenceChart roadmap={report.roadmap} />
        </div>
      )}
    </div>
  );
}
