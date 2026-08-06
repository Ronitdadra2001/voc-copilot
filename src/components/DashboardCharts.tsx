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
