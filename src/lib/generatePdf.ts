import { PDFDocument, StandardFonts, rgb, type PDFPage, type PDFFont } from "pdf-lib";
import type { DashboardReport } from "./types";

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const MARGIN = 50;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const LINE_HEIGHT_MULTIPLIER = 1.35;

// pdf-lib's StandardFonts use WinAnsi (~CP1252) encoding, which cannot
// represent characters outside Latin-1 — confirmed crashing the whole PDF
// (500 error) the first time real scraped data contained a ₹ symbol (a
// company's actual investor-relations page). Any web-sourced text can
// contain currency symbols, smart typography, or other non-Latin-1
// characters, so every string drawn to the PDF must go through this first.
const CHAR_REPLACEMENTS: Record<string, string> = {
  "₹": "Rs. ",
  "€": "EUR ",
  "£": "GBP ",
  "¥": "JPY ",
  "•": "-",
  "✓": "[check]",
  "✗": "[x]",
  "→": "->",
  "…": "...",
};

function sanitizeForPdf(text: string): string {
  let out = text;
  for (const [bad, good] of Object.entries(CHAR_REPLACEMENTS)) {
    out = out.split(bad).join(good);
  }
  // Catch-all: strip anything still outside Latin-1 (covers WinAnsi) rather
  // than let an unanticipated character crash generation again.
  return out.replace(/[^ -ÿ]/g, "");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = sanitizeForPdf(text).split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export async function generateDashboardPdf(
  companyName: string,
  report: DashboardReport
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = PAGE_HEIGHT - MARGIN;

  function newPageIfNeeded(needed: number) {
    if (y - needed < MARGIN) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      y = PAGE_HEIGHT - MARGIN;
    }
  }

  function forcePageBreak() {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    y = PAGE_HEIGHT - MARGIN;
  }

  // Vertical space for a line is always derived from THAT line's own font
  // size (reserved before drawing) — never from the previous line's size.
  // Mixing a small label's leftover gap with a much larger title's height is
  // exactly what caused an earlier title/label overlap bug.
  function drawText(
    text: string,
    {
      size = 11,
      f = font,
      color = rgb(0.1, 0.1, 0.15),
      extraGapAfter = 4,
      indent = 0,
    }: {
      size?: number;
      f?: PDFFont;
      color?: ReturnType<typeof rgb>;
      extraGapAfter?: number;
      indent?: number;
    } = {}
  ) {
    const lineHeight = size * LINE_HEIGHT_MULTIPLIER;
    const lines = wrapText(text, f, size, CONTENT_WIDTH - indent);
    for (const line of lines) {
      newPageIfNeeded(lineHeight);
      y -= lineHeight;
      page.drawText(line, { x: MARGIN + indent, y, size, font: f, color });
    }
    y -= extraGapAfter;
  }

  function sectionHeading(text: string, pageNum?: number) {
    if (pageNum !== undefined) forcePageBreak();
    else newPageIfNeeded(30);
    y -= 4;
    drawText(text, { size: 17, f: bold, extraGapAfter: 4 });
    drawDivider(page, y + 6);
    y -= 8;
  }

  function subHeading(text: string) {
    newPageIfNeeded(26);
    y -= 8;
    drawText(text, { size: 12.5, f: bold, extraGapAfter: 4 });
  }

  function drawDivider(p: PDFPage, yPos: number) {
    p.drawLine({
      start: { x: MARGIN, y: yPos },
      end: { x: PAGE_WIDTH - MARGIN, y: yPos },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });
  }

  // ===== Page 1: Title + Metrics + Highs =====
  drawText("VOICE-OF-CUSTOMER DASHBOARD REPORT", {
    size: 9,
    color: rgb(0.4, 0.4, 0.45),
    extraGapAfter: 6,
  });
  drawText(companyName, { size: 22, f: bold, extraGapAfter: 10 });
  drawDivider(page, y + 4);
  y -= 6;

  if (report.summary) {
    subHeading("Answer");
    drawText(report.summary, { color: rgb(0.2, 0.2, 0.25) });
  }

  const m = report.metrics;
  if (m.total_reviews < 10) {
    subHeading("A note on data volume");
    drawText(
      `Only ${m.total_reviews} review(s) were found for this company. That is too few to trust any percentage or score below at face value — a single complaint can show up as "100%". Treat this report as a rough first read, not a verdict, until more review data is available.`,
      { color: rgb(0.55, 0.4, 0.05) }
    );
  }

  subHeading("Metrics");
  drawText(`Total reviews analyzed: ${m.total_reviews}`);
  drawText(`Issues found: ${m.issue_count}`);
  drawText(`At-risk issues: ${m.at_risk_issue_count}`);
  if (m.top_issue_title) {
    drawText(`Top issue: ${m.top_issue_title} (${m.top_issue_pct}% of reviews)`);
  }

  subHeading("What's High (Working)");
  if (report.highs.length === 0) {
    drawText("No clear positive signal found in the data.", { color: rgb(0.5, 0.5, 0.5) });
  } else {
    for (const h of report.highs) drawText(`• ${h.label} — ${h.detail}`);
  }

  // ===== Page 2: Porter's Five Forces + GTM =====
  sectionHeading("Porter's Five Forces", 2);
  const forces = report.porters_five_forces;
  drawText(`Rivalry: ${forces.rivalry}`);
  drawText(`Threat of New Entrants: ${forces.threat_of_new_entrants}`);
  drawText(`Threat of Substitutes: ${forces.threat_of_substitutes}`);
  drawText(`Buyer Power: ${forces.buyer_power}`);
  drawText(`Supplier Power: ${forces.supplier_power}`);

  subHeading("Go-To-Market Position (STP + POD/POP)");
  drawText(`Segment: ${report.gtm.segment}`);
  drawText(`Target: ${report.gtm.target}`);
  drawText(`Position: ${report.gtm.position}`);

  subHeading("Points of Difference");
  if (report.gtm.points_of_difference.length === 0) {
    drawText("None identified from available competitor data.", { color: rgb(0.5, 0.5, 0.5) });
  } else {
    for (const p of report.gtm.points_of_difference) drawText(`• ${p}`);
  }

  subHeading("Points of Parity");
  if (report.gtm.points_of_parity.length === 0) {
    drawText("None identified from available competitor data.", { color: rgb(0.5, 0.5, 0.5) });
  } else {
    for (const p of report.gtm.points_of_parity) drawText(`• ${p}`);
  }

  if (report.gtm.ansoff) {
    subHeading("Growth Direction (Ansoff Matrix)");
    if (report.gtm.ansoff.quadrant) {
      drawText(report.gtm.ansoff.quadrant.replace(/_/g, " "), { f: bold, extraGapAfter: 2 });
      drawText(report.gtm.ansoff.rationale, { size: 10, color: rgb(0.4, 0.4, 0.45) });
    } else {
      drawText(report.gtm.ansoff.rationale, { color: rgb(0.5, 0.5, 0.5) });
    }
  }

  if (report.gtm.product_life_cycle) {
    subHeading("Lifecycle Stage (Product Life Cycle)");
    if (report.gtm.product_life_cycle.stage) {
      drawText(report.gtm.product_life_cycle.stage, { f: bold, extraGapAfter: 2 });
      drawText(report.gtm.product_life_cycle.rationale, { size: 10, color: rgb(0.4, 0.4, 0.45) });
    } else {
      drawText(report.gtm.product_life_cycle.rationale, { color: rgb(0.5, 0.5, 0.5) });
    }
  }

  // ===== Page 2.5: Brand Diagnosis, Campaign, Personas =====
  if (report.brand) {
    subHeading("Brand Diagnosis — Node Word & Weakest Layer (CBBE)");
    if (report.brand.node_word) {
      drawText(`Node word: "${report.brand.node_word}"`, { f: bold, extraGapAfter: 2 });
      drawText(report.brand.node_word_evidence, { size: 10, color: rgb(0.4, 0.4, 0.45) });
    } else {
      drawText("No clear brand association found.", { color: rgb(0.5, 0.5, 0.5) });
      drawText(report.brand.node_word_evidence, { size: 10, color: rgb(0.4, 0.4, 0.45) });
    }
    drawText(`Weakest layer: ${report.brand.weakest_cbbe_layer}`, { f: bold, extraGapAfter: 2 });
    drawText(report.brand.weakest_cbbe_layer_evidence, { size: 10, color: rgb(0.4, 0.4, 0.45) });

    if (report.brand.archetype || report.brand.posture || report.brand.asset_valuator) {
      subHeading("Brand Archetype, Posture & Asset Valuator");
      if (report.brand.archetype?.name) {
        drawText(`Archetype: ${report.brand.archetype.name}`, { f: bold, extraGapAfter: 2 });
        drawText(report.brand.archetype.rationale, { size: 10, color: rgb(0.4, 0.4, 0.45) });
      } else if (report.brand.archetype) {
        drawText("Archetype: insufficient data", { color: rgb(0.5, 0.5, 0.5) });
      }
      if (report.brand.posture?.stance) {
        drawText(`Posture: ${report.brand.posture.stance}`, { f: bold, extraGapAfter: 2 });
        drawText(report.brand.posture.rationale, { size: 10, color: rgb(0.4, 0.4, 0.45) });
      } else if (report.brand.posture) {
        drawText("Posture: insufficient data", { color: rgb(0.5, 0.5, 0.5) });
      }
      if (report.brand.asset_valuator?.quadrant) {
        drawText(
          `Brand Asset Valuator: ${report.brand.asset_valuator.quadrant.replace(/_/g, " ")} (vitality ${report.brand.asset_valuator.vitality}/10, stature ${report.brand.asset_valuator.stature}/10)`,
          { f: bold, extraGapAfter: 2 }
        );
        drawText(report.brand.asset_valuator.rationale, { size: 10, color: rgb(0.4, 0.4, 0.45) });
      } else if (report.brand.asset_valuator) {
        drawText("Brand Asset Valuator: insufficient data", { color: rgb(0.5, 0.5, 0.5) });
      }
    }

    subHeading("Campaign Angle — Enemy / Stand / Mantra");
    if (report.brand.campaign) {
      drawText(`Enemy: ${report.brand.campaign.enemy}`);
      drawText(`Stand: ${report.brand.campaign.stand}`);
      drawText(`Mantra: "${report.brand.campaign.mantra}"`, { f: bold });
    } else {
      drawText("No customer pain point in the data clearly justifies a campaign angle yet.", {
        color: rgb(0.5, 0.5, 0.5),
      });
    }

    if (report.brand.kapferer_prism && Object.values(report.brand.kapferer_prism).some((v) => v)) {
      subHeading("Brand Identity Prism (Kapferer)");
      const facets: [string, string | null][] = [
        ["Physique", report.brand.kapferer_prism.physique],
        ["Personality", report.brand.kapferer_prism.personality],
        ["Relationship", report.brand.kapferer_prism.relationship],
        ["Culture", report.brand.kapferer_prism.culture],
        ["Reflection", report.brand.kapferer_prism.reflection],
        ["Self-Image", report.brand.kapferer_prism.self_image],
      ];
      for (const [label, value] of facets) {
        drawText(`${label}: ${value ?? "Not enough evidence in the data."}`, {
          size: 10,
          color: value ? rgb(0.15, 0.15, 0.2) : rgb(0.5, 0.5, 0.5),
          extraGapAfter: 2,
        });
      }
    }

    if (report.brand.personas.length > 0) {
      subHeading("Customer Personas (from review evidence)");
      for (const p of report.brand.personas) {
        drawText(p.name, { f: bold, extraGapAfter: 2 });
        drawText(p.context, { size: 10, color: rgb(0.4, 0.4, 0.45), extraGapAfter: 2 });
        drawText(`Goals: ${p.goals}`, { size: 10 });
        drawText(`Pain points: ${p.pain_points}`, { size: 10, extraGapAfter: 6 });
      }
    }
  }

  // ===== Page 3: Issues & Solutions =====
  sectionHeading("Issues & Solutions", 3);
  drawText(
    "At most 3-4 issues, ranked by review volume and at-risk severity. Each is named directly, backed by evidence, and paired with a costed, sequenced fix — not an abstract theme score.",
    { size: 10, color: rgb(0.4, 0.4, 0.45), extraGapAfter: 8 }
  );
  report.issues.forEach((issue, idx) => {
    newPageIfNeeded(60);
    const tags = [
      issue.priority.toUpperCase(),
      issue.at_risk ? "AT RISK" : null,
      `${issue.pct_of_reviews}% of reviews`,
    ]
      .filter(Boolean)
      .join(" · ");
    drawText(`${idx + 1}. ${issue.title}`, { size: 13, f: bold, extraGapAfter: 2 });
    drawText(tags, { size: 9.5, color: rgb(0.6, 0.4, 0.05), extraGapAfter: 6 });

    drawText("What's broken (evidence):", { size: 10, f: bold, extraGapAfter: 2 });
    for (const e of issue.evidence) {
      drawText(`• ${e}`, { size: 10, color: rgb(0.4, 0.4, 0.45), extraGapAfter: 2 });
    }

    drawText("The fix:", { size: 10, f: bold, extraGapAfter: 2 });
    issue.fix.forEach((step, i) => {
      drawText(`${i + 1}. ${step}`, { size: 10, extraGapAfter: 2 });
    });

    if (issue.frameworks_applied?.length > 0) {
      drawText("Frameworks applied:", { size: 10, f: bold, extraGapAfter: 2 });
      for (const fw of issue.frameworks_applied) {
        drawText(`• ${fw}`, { size: 10, color: rgb(0.4, 0.4, 0.45), extraGapAfter: 2 });
      }
    }

    drawText(`Cost: ${issue.cost}`, { size: 10, color: rgb(0.3, 0.3, 0.5), extraGapAfter: 2 });
    drawText(`Estimated impact: ${issue.impact}`, {
      size: 10,
      color: rgb(0.3, 0.3, 0.5),
      extraGapAfter: 2,
    });
    drawText(`Track: ${issue.metric_to_track}`, {
      size: 10,
      color: rgb(0.25, 0.2, 0.55),
      extraGapAfter: 12,
    });
  });

  // ===== Page 4: Finance =====
  sectionHeading("Finance", 4);
  subHeading(`${companyName} — Public Financial Findings`);
  if (!report.finance.own.found) {
    drawText("No public financial data found.", { color: rgb(0.5, 0.5, 0.5) });
  } else {
    for (const f of report.finance.own.findings) drawText(`• ${f}`);
  }

  for (const comp of report.finance.competitors) {
    subHeading(`${comp.name} — Financial Findings`);
    if (!comp.found) {
      drawText("No public financial data found for this competitor.", {
        color: rgb(0.5, 0.5, 0.5),
      });
    } else {
      for (const f of comp.findings) drawText(`• ${f}`);
    }
    if (comp.comparison) {
      drawText(`Comparison: ${comp.comparison}`, { size: 10, color: rgb(0.3, 0.3, 0.5) });
    }
  }

  subHeading("Estimated Revenue at Risk (modeled — Guesstimate framework)");
  if (!report.finance.revenue_at_risk.applicable || !report.finance.revenue_at_risk.estimate) {
    drawText("Not applicable — no real revenue figure was found to model against.", {
      color: rgb(0.5, 0.5, 0.5),
    });
  } else {
    drawText(report.finance.revenue_at_risk.estimate, { f: bold, extraGapAfter: 4 });
    for (const a of report.finance.revenue_at_risk.assumptions) {
      drawText(`• ${a}`, { size: 10, color: rgb(0.4, 0.4, 0.45) });
    }
  }

  subHeading("Unit Economics Notes");
  if (report.finance.unit_economics_notes.length === 0) {
    drawText("Not enough public data to apply unit-economics reasoning.", {
      color: rgb(0.5, 0.5, 0.5),
    });
  } else {
    for (const n of report.finance.unit_economics_notes) drawText(`• ${n}`);
  }

  return pdf.save();
}
