// Table exporters shared by reports and data exports: CSV (UTF-8 with BOM so Excel shows Bangla correctly),
// XLSX (typed cells, number formats) and PDF (see pdf/). Values that could be read as spreadsheet formulas are
// neutralised (CSV/formula injection).
import { formatDate, formatMoney, formatBp, toDecimalString } from "@petra/core";
import type { Column, ColType, ReportResult } from "./reports";

export function safeCell(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s;
}

const typeOf = (col: Column, row: Record<string, unknown>): ColType => (row._type && col.type === "number" ? (row._type as ColType) : col.type);

export function plainValue(v: unknown, t: ColType): string {
  if (v === null || v === undefined || v === "") return "";
  switch (t) {
    case "money":
      return toDecimalString(Number(v));
    case "percent":
      return (Number(v) / 100).toFixed(1);
    case "datetime":
      return v instanceof Date ? v.toISOString().replace("T", " ").slice(0, 16) : String(v);
    default:
      return String(v);
  }
}

export function displayValue(v: unknown, t: ColType, opts: { grouping?: "lakh" | "intl"; banglaDigits?: boolean } = {}): string {
  if (v === null || v === undefined || v === "") return "";
  switch (t) {
    case "money":
      return formatMoney(Number(v), { grouping: opts.grouping ?? "lakh", banglaDigits: opts.banglaDigits, symbol: false });
    case "percent":
      return formatBp(Number(v));
    case "date":
      return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? formatDate(String(v), "DD MMM YYYY") : String(v);
    case "datetime": {
      const d = v instanceof Date ? v : new Date(String(v));
      return isNaN(d.getTime()) ? String(v) : d.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
    case "number":
      return typeof v === "number" ? v.toLocaleString("en-IN") : String(v);
    default:
      return String(v);
  }
}

export function toCsv(r: Pick<ReportResult, "columns" | "rows" | "totals">): Buffer {
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [r.columns.map((c) => esc(c.label)).join(",")];
  for (const row of [...r.rows, ...(r.totals ? [r.totals] : [])]) lines.push(r.columns.map((c) => esc(safeCell(plainValue(row[c.key], typeOf(c, row))))).join(","));
  return Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
}

export async function toXlsx(r: ReportResult, meta: { hotel: string }): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "PetraPMS";
  wb.created = new Date();
  const ws = wb.addWorksheet(r.title.slice(0, 31).replace(/[\\/?*[\]:]/g, " "));
  ws.addRow([meta.hotel]).font = { bold: true, size: 13 };
  ws.addRow([`${r.title}${r.subtitle ? " · " + r.subtitle : ""}`]).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(r.columns.map((c) => c.label));
  head.font = { bold: true, color: { argb: "FFFFFFFF" } };
  head.eachCell((cell) => (cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF111111" } }));
  const write = (row: Record<string, unknown>, bold = false) => {
    const x = ws.addRow(
      r.columns.map((c) => {
        const t = typeOf(c, row);
        const v = row[c.key];
        if (v === null || v === undefined || v === "") return null;
        if (t === "money") return Number(v) / 100;
        if (t === "percent") return Number(v) / 10000;
        if (t === "number") return typeof v === "number" ? v : safeCell(v);
        if (t === "datetime") return v instanceof Date ? v : new Date(String(v));
        return safeCell(v);
      }),
    );
    r.columns.forEach((c, i) => {
      const t = typeOf(c, row);
      const cell = x.getCell(i + 1);
      if (t === "money") cell.numFmt = "#,##0.00";
      if (t === "percent") cell.numFmt = "0.0%";
      if (t === "datetime") cell.numFmt = "dd-mmm-yyyy hh:mm";
    });
    if (bold) x.font = { bold: true };
  };
  for (const row of r.rows) write(row);
  if (r.totals) write(r.totals, true);
  if (r.summary?.length) {
    ws.addRow([]);
    for (const s of r.summary) ws.addRow([s.label, s.type === "money" ? Number(s.value) / 100 : s.value]);
  }
  r.columns.forEach((c, i) => (ws.getColumn(i + 1).width = Math.min(40, Math.max(10, c.label.length + 4, ...r.rows.slice(0, 200).map((row) => String(row[c.key] ?? "").length + 2)))));
  ws.views = [{ state: "frozen", ySplit: 4 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
