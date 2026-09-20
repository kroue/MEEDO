/**
 * lib/reports/reportsPdf.ts
 *
 * The Reports & Analytics page as a downloadable PDF — any one of its three
 * reports, or all of them together.
 *
 * Drawn directly with jsPDF rather than by screenshotting the page: the text
 * stays selectable and sharp at any zoom, long tables split across pages with
 * their headings repeated, and the file is kilobytes rather than megabytes of
 * images. jsPDF is imported only when a PDF is actually requested, so it adds
 * nothing to the page's own load.
 *
 * Amounts are written "PHP 1,234.50". The PDF's built-in fonts have no peso
 * sign, and embedding a whole font for one glyph would multiply the file size.
 */

import type { jsPDF as JsPdf } from "jspdf";
import type { UserOptions, autoTable as AutoTableFn } from "jspdf-autotable";

type AutoTable = typeof AutoTableFn;
type Rgb = [number, number, number];

export type ReportSection = "collections" | "consumption" | "delinquency";

export const ALL_REPORT_SECTIONS: ReportSection[] = ["collections", "consumption", "delinquency"];

export const REPORT_SECTION_TITLES: Record<ReportSection, string> = {
  collections: "Collection Summary",
  consumption: "Consumption Analysis",
  delinquency: "Delinquency Report",
};

/** Everything the PDF shows — the same figures the Reports page has already computed. */
export interface ReportsPdfData {
  collectionSummary: { category: string; accounts: number; billed: number; collected: number }[];
  /** One row per month, oldest first: `month` plus the water charged for each tier name. */
  monthlyCollections: Record<string, number | string>[];
  tiers: string[];
  tierColors: Record<string, string>;
  consumptionBrackets: { bracket: string; count: number; percentage: number }[];
  totalAccounts: number;
  delinquentAccounts: {
    name: string;
    meterNumber: string;
    barangay: string;
    tier: string;
    balance: number;
    overdueDays: number | null;
    disconnectionEligible: boolean;
  }[];
  delinquencySummary: { count: number; rate: number; outstanding: number; disconnectionEligible: number };
}

export interface PdfImage {
  dataUrl: string;
  width: number;
  height: number;
}

export interface ReportsPdfOptions {
  generatedAt: Date;
  generatedBy: string;
  /** Letterhead logo; left out when it couldn't be loaded. */
  logo?: PdfImage | null;
}

// ── Layout (A4 portrait, millimetres) ────────────────────────────────────────

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_SPACE = 18;
/** The monthly chart stays readable up to about a year; the table lists every month. */
const CHART_MONTHS = 12;

const INK: Rgb = [15, 23, 42];
const MUTED: Rgb = [100, 116, 139];
const FAINT: Rgb = [148, 163, 184];
const BORDER: Rgb = [226, 232, 240];
const TILE: Rgb = [248, 250, 252];
const FOOT_FILL: Rgb = [241, 245, 249];
const BRAND: Rgb = [2, 132, 199];
const BAR: Rgb = [59, 130, 246];
const RED: Rgb = [220, 38, 38];
const AMBER: Rgb = [217, 119, 6];
const GREEN: Rgb = [5, 150, 105];
const WHITE: Rgb = [255, 255, 255];
const FALLBACK_TIER_COLOR = "#94a3b8";

const ORGANIZATION = "South Wao Water System";
const ADDRESS_LINE = "Wao, Lanao del Sur • Tel: 0985 762 5456";

// ── Formatting ───────────────────────────────────────────────────────────────

export function formatPdfPeso(value: number): string {
  return `PHP ${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function percentOf(part: number, whole: number): string {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "0.0%";
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

function amountIn(row: Record<string, number | string>, tier: string): number {
  return Number(row[tier] ?? 0) || 0;
}

/**
 * Locale dates can contain narrow no-break spaces ("10:42 AM"), which the
 * built-in fonts can't draw — they'd print as a stray symbol.
 */
function plainSpaces(text: string): string {
  return text.replace(/[  ]/g, " ");
}

function hexToRgb(hex: string): Rgb {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = parseInt((match ? match[1] : FALLBACK_TIER_COLOR.slice(1)), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * An axis maximum split into four gridlines whose labels are all round
 * figures: the quarter step is rounded up to a tidy number first, so the axis
 * reads 750 / 1.5k / 2.25k / 3k rather than 625 / 1.3k / 1.9k / 2.5k.
 */
function niceAxisMax(value: number): number {
  const quarter = value > 0 ? value / 4 : 0.25;
  const magnitude = 10 ** Math.floor(Math.log10(quarter));
  const step = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 7.5, 8, 10].find((s) => s * magnitude >= quarter) ?? 10;
  return step * magnitude * 4;
}

function compactAmount(value: number): string {
  const trim = (n: number) => String(Number(n.toFixed(2)));
  if (value >= 1_000_000) return `${trim(value / 1_000_000)}M`;
  if (value >= 1000) return `${trim(value / 1000)}k`;
  return trim(value);
}

export function reportsPdfFileName(sections: ReportSection[], date: Date): string {
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
  const chosen = ALL_REPORT_SECTIONS.filter((s) => sections.includes(s));
  const name =
    chosen.length === 0 || chosen.length === ALL_REPORT_SECTIONS.length
      ? "Reports"
      : chosen.map((s) => REPORT_SECTION_TITLES[s].replace(/\s+/g, "-")).join("_");
  return `MEEDO-${name}-${stamp}.pdf`;
}

// ── Browser helpers ──────────────────────────────────────────────────────────

/**
 * Loads an image and re-encodes it small enough for a letterhead, so a large
 * source logo doesn't bloat every PDF. Resolves to null rather than failing —
 * a missing logo is no reason to withhold a report.
 */
export async function loadPdfImage(src: string, maxSide = 200): Promise<PdfImage | null> {
  if (typeof window === "undefined") return null;
  try {
    const image = new Image();
    image.src = src;
    await image.decode();
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  } catch {
    return null;
  }
}

// ── Drawing ──────────────────────────────────────────────────────────────────

interface TextStyle {
  size: number;
  color?: Rgb;
  bold?: boolean;
  align?: "left" | "right" | "center";
}

/** A cursor down the page, plus the few drawing primitives the reports share. */
class PdfWriter {
  y = MARGIN;

  constructor(
    readonly doc: JsPdf,
    private readonly autoTable: AutoTable
  ) {}

  newPage() {
    this.doc.addPage();
    this.y = MARGIN + 4;
  }

  /** Moves to a new page when less than `height` mm remain above the footer. */
  ensureSpace(height: number) {
    if (this.y + height > PAGE_H - FOOTER_SPACE) this.newPage();
  }

  text(value: string | string[], x: number, y: number, style: TextStyle) {
    this.doc.setFont("helvetica", style.bold ? "bold" : "normal");
    this.doc.setFontSize(style.size);
    this.doc.setTextColor(...(style.color ?? INK));
    this.doc.text(value, x, y, { align: style.align ?? "left" });
  }

  paragraph(value: string, style: TextStyle) {
    this.doc.setFont("helvetica", style.bold ? "bold" : "normal");
    this.doc.setFontSize(style.size);
    const lines: string[] = this.doc.splitTextToSize(value, CONTENT_W);
    const lineHeight = style.size * 0.42;
    this.ensureSpace(lines.length * lineHeight);
    this.text(lines, MARGIN, this.y, style);
    this.y += lines.length * lineHeight;
  }

  letterhead(title: string, options: ReportsPdfOptions) {
    const top = MARGIN;
    let textX = MARGIN;

    if (options.logo) {
      const height = 17;
      const width = (height * options.logo.width) / options.logo.height;
      try {
        this.doc.addImage(options.logo.dataUrl, "PNG", MARGIN, top, width, height);
        textX = MARGIN + width + 4;
      } catch {
        // An unreadable logo shouldn't cost anyone their report.
      }
    }

    this.text(ORGANIZATION.toUpperCase(), textX, top + 7, { size: 13, bold: true });
    this.text(ADDRESS_LINE, textX, top + 12.5, { size: 8.5, color: MUTED });

    const right = PAGE_W - MARGIN;
    const stamp = plainSpaces(
      options.generatedAt.toLocaleString("en-PH", { dateStyle: "medium", timeStyle: "short" })
    );
    this.text(title, right, top + 7, { size: 12, bold: true, color: BRAND, align: "right" });
    this.text(`Generated ${stamp}`, right, top + 12.5, { size: 8, color: MUTED, align: "right" });
    if (options.generatedBy) {
      this.text(`by ${plainSpaces(options.generatedBy)}`, right, top + 16.5, { size: 8, color: MUTED, align: "right" });
    }

    this.doc.setDrawColor(...INK);
    this.doc.setLineWidth(0.5);
    this.doc.line(MARGIN, top + 21, right, top + 21);
    this.text(
      "Covers active accounts only. Accounts still awaiting approval are not included.",
      MARGIN,
      top + 26,
      { size: 7.5, color: FAINT }
    );
    this.y = top + 35;
  }

  sectionHeading(title: string, description: string) {
    this.ensureSpace(30);
    this.doc.setFillColor(...BRAND);
    this.doc.rect(MARGIN, this.y - 4.3, 1.2, 5.6, "F");
    this.text(title, MARGIN + 3.5, this.y, { size: 13, bold: true });
    this.y += 5.5;
    this.paragraph(description, { size: 8.5, color: MUTED });
    this.y += 4;
  }

  subheading(title: string) {
    this.ensureSpace(16);
    this.text(title, MARGIN, this.y, { size: 10, bold: true });
    this.y += 3;
  }

  note(value: string) {
    this.y += 2;
    this.paragraph(value, { size: 8, color: MUTED });
    this.y += 5;
  }

  tiles(items: { label: string; value: string; hint?: string; color?: Rgb }[]) {
    const gap = 4;
    const height = 19;
    const width = (CONTENT_W - gap * (items.length - 1)) / items.length;
    this.ensureSpace(height + 8);

    items.forEach((item, i) => {
      const x = MARGIN + i * (width + gap);
      this.doc.setFillColor(...TILE);
      this.doc.setDrawColor(...BORDER);
      this.doc.setLineWidth(0.25);
      this.doc.roundedRect(x, this.y, width, height, 1.5, 1.5, "FD");

      this.text(item.label.toUpperCase(), x + 3.5, this.y + 5.5, { size: 6.5, bold: true, color: MUTED });

      // Shrink a long figure to fit its tile rather than let it spill over.
      let size = 12;
      this.doc.setFont("helvetica", "bold");
      this.doc.setFontSize(size);
      while (size > 7 && this.doc.getTextWidth(item.value) > width - 7) {
        size -= 0.5;
        this.doc.setFontSize(size);
      }
      this.text(item.value, x + 3.5, this.y + 12, { size, bold: true, color: item.color ?? INK });

      if (item.hint) this.text(item.hint, x + 3.5, this.y + 16.3, { size: 6.5, color: FAINT });
    });

    this.y += height + 9;
  }

  table(options: UserOptions) {
    this.autoTable(this.doc, {
      theme: "grid",
      startY: this.y,
      margin: { left: MARGIN, right: MARGIN, top: MARGIN + 4, bottom: FOOTER_SPACE },
      styles: {
        font: "helvetica",
        fontSize: 8.5,
        cellPadding: 2,
        textColor: INK,
        lineColor: BORDER,
        lineWidth: 0.2,
        valign: "middle",
      },
      headStyles: { fillColor: INK, textColor: WHITE, fontStyle: "bold", fontSize: 8 },
      footStyles: { fillColor: FOOT_FILL, textColor: INK, fontStyle: "bold" },
      alternateRowStyles: { fillColor: TILE },
      showFoot: "lastPage",
      ...options,
    });
    const finalY = (this.doc as unknown as { lastAutoTable?: { finalY?: number } }).lastAutoTable?.finalY;
    this.y = (typeof finalY === "number" ? finalY : this.y) + 10;
  }

  stackedBarChart(
    rows: { label: string; segments: { value: number; color: Rgb }[] }[],
    legend: { label: string; color: Rgb }[]
  ) {
    const height = 62;
    const axisWidth = 14;
    const labelSpace = 7;
    this.ensureSpace(height + 14);

    const top = this.y + 2;
    const plotX = MARGIN + axisWidth;
    const plotW = CONTENT_W - axisWidth;
    const plotH = height - labelSpace;
    const baseline = top + plotH;
    const max = niceAxisMax(Math.max(0, ...rows.map((r) => sum(r.segments.map((s) => s.value)))));

    this.doc.setLineWidth(0.2);
    for (let i = 0; i <= 4; i++) {
      const gridY = baseline - (plotH * i) / 4;
      this.doc.setDrawColor(...BORDER);
      this.doc.line(plotX, gridY, PAGE_W - MARGIN, gridY);
      this.text(compactAmount((max * i) / 4), plotX - 2, gridY + 1, { size: 6.5, color: FAINT, align: "right" });
    }

    const slot = plotW / Math.max(rows.length, 1);
    const barWidth = Math.min(slot * 0.62, 13);
    rows.forEach((row, i) => {
      const x = plotX + slot * i + (slot - barWidth) / 2;
      let cursor = baseline;
      row.segments.forEach((segment) => {
        if (segment.value <= 0) return;
        const h = (plotH * segment.value) / max;
        cursor -= h;
        this.doc.setFillColor(...segment.color);
        this.doc.rect(x, cursor, barWidth, h, "F");
      });
      this.text(row.label, x + barWidth / 2, baseline + 4.5, { size: 6.5, color: MUTED, align: "center" });
    });

    let legendX = plotX;
    const legendY = top + height + 2;
    legend.forEach((item) => {
      this.doc.setFillColor(...item.color);
      this.doc.rect(legendX, legendY - 2.4, 2.6, 2.6, "F");
      this.text(item.label, legendX + 4, legendY, { size: 7.5, color: MUTED });
      legendX += 4 + this.doc.getTextWidth(item.label) + 7;
    });

    this.y = legendY + 8;
  }

  horizontalBars(rows: { label: string; value: number; share: number }[]) {
    const rowHeight = 8;
    const labelWidth = 24;
    const valueWidth = 28;
    const trackWidth = CONTENT_W - labelWidth - valueWidth;
    this.ensureSpace(rows.length * rowHeight + 6);
    this.y += 4;

    rows.forEach((row) => {
      const trackX = MARGIN + labelWidth;
      this.text(row.label, MARGIN, this.y + 1.2, { size: 8 });
      this.doc.setFillColor(...BORDER);
      this.doc.roundedRect(trackX, this.y - 2, trackWidth, 4, 2, 2, "F");
      const width = (trackWidth * Math.max(0, Math.min(row.share, 100))) / 100;
      if (row.value > 0) {
        this.doc.setFillColor(...BAR);
        this.doc.roundedRect(trackX, this.y - 2, Math.max(width, 4), 4, 2, 2, "F");
      }
      this.text(`${formatCount(row.value)}  (${row.share}%)`, PAGE_W - MARGIN, this.y + 1.2, {
        size: 8,
        bold: true,
        align: "right",
      });
      this.y += rowHeight;
    });

    this.y += 5;
  }

  footers(title: string) {
    const total = this.doc.getNumberOfPages();
    for (let page = 1; page <= total; page++) {
      this.doc.setPage(page);
      this.doc.setDrawColor(...BORDER);
      this.doc.setLineWidth(0.25);
      this.doc.line(MARGIN, PAGE_H - 12, PAGE_W - MARGIN, PAGE_H - 12);
      this.text(`${ORGANIZATION} • ${title}`, MARGIN, PAGE_H - 7.5, { size: 7, color: FAINT });
      this.text(`Page ${page} of ${total}`, PAGE_W - MARGIN, PAGE_H - 7.5, { size: 7, color: FAINT, align: "right" });
    }
  }
}

// ── The three reports ────────────────────────────────────────────────────────

function drawCollections(pdf: PdfWriter, data: ReportsPdfData) {
  const totals = {
    accounts: sum(data.collectionSummary.map((r) => r.accounts)),
    billed: sum(data.collectionSummary.map((r) => r.billed)),
    collected: sum(data.collectionSummary.map((r) => r.collected)),
  };
  const rate = totals.billed > 0 ? (totals.collected / totals.billed) * 100 : 0;

  pdf.sectionHeading(
    REPORT_SECTION_TITLES.collections,
    "Water billed and collected, by classification and by month. Billed amounts count only the water " +
      "charged each month, not balances rolled forward from earlier months, which would otherwise be " +
      "counted again every month they stay unpaid."
  );
  pdf.tiles([
    { label: "Accounts", value: formatCount(totals.accounts) },
    { label: "Water billed", value: formatPdfPeso(totals.billed) },
    { label: "Collected", value: formatPdfPeso(totals.collected), color: GREEN },
    { label: "Collection rate", value: `${rate.toFixed(1)}%`, color: rate >= 90 ? GREEN : AMBER },
  ]);

  pdf.subheading("Collection Performance by Tier");
  if (data.collectionSummary.length === 0) {
    pdf.note("No accounts yet.");
  } else {
    pdf.table({
      head: [["Category", "Accounts", "Billed", "Collected", "Collection Rate"]],
      body: data.collectionSummary.map((r) => [
        r.category,
        formatCount(r.accounts),
        formatPdfPeso(r.billed),
        formatPdfPeso(r.collected),
        percentOf(r.collected, r.billed),
      ]),
      foot: [["Total", formatCount(totals.accounts), formatPdfPeso(totals.billed), formatPdfPeso(totals.collected), `${rate.toFixed(1)}%`]],
      didParseCell: (hook) => {
        if (hook.column.index >= 1) hook.cell.styles.halign = "right";
        if (hook.section !== "body") return;
        if (hook.column.index === 3) hook.cell.styles.textColor = GREEN;
        if (hook.column.index === 4) {
          const row = data.collectionSummary[hook.row.index];
          const rowRate = row && row.billed > 0 ? (row.collected / row.billed) * 100 : 0;
          hook.cell.styles.textColor = rowRate >= 90 ? GREEN : AMBER;
          hook.cell.styles.fontStyle = "bold";
        }
      },
    });
  }

  pdf.subheading("Monthly Water Sales by Tier");
  const months = data.monthlyCollections;
  if (months.length === 0) {
    pdf.note("No billing history yet.");
    return;
  }

  const colors = data.tiers.map((t) => hexToRgb(data.tierColors[t] ?? FALLBACK_TIER_COLOR));
  pdf.stackedBarChart(
    months.slice(-CHART_MONTHS).map((row) => ({
      label: String(row.month),
      segments: data.tiers.map((tier, i) => ({ value: amountIn(row, tier), color: colors[i] })),
    })),
    data.tiers.map((tier, i) => ({ label: tier, color: colors[i] }))
  );
  if (months.length > CHART_MONTHS) {
    pdf.note(`The chart shows the latest ${CHART_MONTHS} months; the table lists all ${months.length}.`);
  }

  const tierTotals = data.tiers.map((tier) => sum(months.map((row) => amountIn(row, tier))));
  pdf.table({
    head: [["Month", ...data.tiers, "Total"]],
    body: months.map((row) => {
      const values = data.tiers.map((tier) => amountIn(row, tier));
      return [String(row.month), ...values.map(formatPdfPeso), formatPdfPeso(sum(values))];
    }),
    foot: [["Total", ...tierTotals.map(formatPdfPeso), formatPdfPeso(sum(tierTotals))]],
    didParseCell: (hook) => {
      if (hook.column.index >= 1) hook.cell.styles.halign = "right";
    },
  });
}

function drawConsumption(pdf: PdfWriter, data: ReportsPdfData) {
  const brackets = data.consumptionBrackets;
  const withReading = sum(brackets.map((b) => b.count));
  const mostCommon = brackets.reduce<(typeof brackets)[number] | null>(
    (best, b) => (b.count > (best?.count ?? 0) ? b : best),
    null
  );

  pdf.sectionHeading(
    REPORT_SECTION_TITLES.consumption,
    "Accounts grouped by their most recent month's water consumption."
  );
  pdf.tiles([
    { label: "Total accounts", value: formatCount(data.totalAccounts) },
    {
      label: "With a reading",
      value: formatCount(withReading),
      hint: `${percentOf(withReading, data.totalAccounts)} of accounts`,
    },
    {
      label: "Most common",
      value: mostCommon ? mostCommon.bracket : "None yet",
      hint: mostCommon ? `${formatCount(mostCommon.count)} accounts` : undefined,
    },
  ]);

  pdf.subheading("Consumption Distribution");
  if (withReading === 0) {
    pdf.note("No readings yet.");
    return;
  }
  pdf.horizontalBars(brackets.map((b) => ({ label: b.bracket, value: b.count, share: b.percentage })));

  pdf.subheading("Consumption Bracket Breakdown");
  pdf.table({
    head: [["Consumption", "Accounts", "Share"]],
    body: brackets.map((b) => [b.bracket, formatCount(b.count), `${b.percentage}%`]),
    foot: [["Total", formatCount(withReading), "100%"]],
    didParseCell: (hook) => {
      if (hook.column.index >= 1) hook.cell.styles.halign = "right";
    },
  });
}

function drawDelinquency(pdf: PdfWriter, data: ReportsPdfData) {
  const summary = data.delinquencySummary;

  pdf.sectionHeading(
    REPORT_SECTION_TITLES.delinquency,
    "Accounts with an unpaid balance, largest balance first. Accounts 20+ days overdue are eligible for disconnection."
  );
  pdf.tiles([
    {
      label: "Delinquent accounts",
      value: formatCount(summary.count),
      hint: `${summary.rate.toFixed(1)}% of all accounts`,
      color: AMBER,
    },
    { label: "Outstanding balance", value: formatPdfPeso(summary.outstanding), hint: "total unpaid amount", color: RED },
    { label: "Disconnection eligible", value: formatCount(summary.disconnectionEligible), hint: "20+ days overdue" },
  ]);

  pdf.subheading("Delinquent Accounts");
  const accounts = data.delinquentAccounts;
  if (accounts.length === 0) {
    pdf.note("No delinquent accounts.");
    return;
  }

  pdf.table({
    head: [["#", "Concessionaire", "Meter No.", "Barangay", "Tier", "Outstanding", "Days Overdue"]],
    body: accounts.map((a, i) => [
      String(i + 1),
      a.name || "Unnamed account",
      a.meterNumber || "-",
      a.barangay || "-",
      a.tier,
      formatPdfPeso(a.balance),
      a.overdueDays === null ? "Unknown" : `${a.overdueDays}${a.disconnectionEligible ? " • eligible" : ""}`,
    ]),
    foot: [["", `${formatCount(accounts.length)} accounts`, "", "", "", formatPdfPeso(summary.outstanding), ""]],
    columnStyles: {
      0: { cellWidth: 9 },
      1: { cellWidth: 44 },
      5: { cellWidth: 28 },
      6: { cellWidth: 25 },
    },
    didParseCell: (hook) => {
      const i = hook.column.index;
      if (i === 0 || i >= 5) hook.cell.styles.halign = "right";
      if (hook.section !== "body") return;
      if (i === 5) {
        hook.cell.styles.textColor = RED;
        hook.cell.styles.fontStyle = "bold";
      }
      if (i === 6 && accounts[hook.row.index]?.disconnectionEligible) {
        hook.cell.styles.textColor = RED;
        hook.cell.styles.fontStyle = "bold";
      }
    },
  });
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function createReportsPdf(
  sections: ReportSection[],
  data: ReportsPdfData,
  options: ReportsPdfOptions
): Promise<JsPdf> {
  const chosen = ALL_REPORT_SECTIONS.filter((s) => sections.includes(s));
  if (chosen.length === 0) throw new Error("Choose at least one report to include.");

  const [{ jsPDF }, { autoTable }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);

  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
  const title = chosen.length === 1 ? REPORT_SECTION_TITLES[chosen[0]] : "Reports & Analytics";
  doc.setProperties({ title: `${title} - ${ORGANIZATION}`, subject: title, author: ORGANIZATION, creator: "MEEDO Admin Console" });

  const pdf = new PdfWriter(doc, autoTable);
  pdf.letterhead(title, options);

  chosen.forEach((section, index) => {
    // Each report starts on its own page, so any one can be printed alone.
    if (index > 0) pdf.newPage();
    if (section === "collections") drawCollections(pdf, data);
    else if (section === "consumption") drawConsumption(pdf, data);
    else drawDelinquency(pdf, data);
  });

  pdf.footers(title);
  return doc;
}
