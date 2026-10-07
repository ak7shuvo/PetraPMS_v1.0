// Data Import engine: parse CSV/XLSX → map columns → coerce & validate → dry run (executed inside a transaction
// that is rolled back, so the preview is exactly what a real run would do) → execute (all-or-nothing or skip
// invalid rows, CREATE / UPDATE / UPSERT) with progress, a pre-import backup and a 24-hour undo.
import Papa from "papaparse";
import { normalizePhone, parseFlexibleDate, parseMoney, tempPassword, fromBanglaDigits, addDays } from "@petra/core";
import type { Db, Tx } from "../db";
import { audit, nextNumber, type AuditActor } from "../common";
import { ApiError } from "../errors";
import { lockedTx } from "../lock";
import { hashSecret } from "../auth";
import { entityById, type EntityDef, type FieldDef } from "@/features/data-import/registry";
import { createReservationTx } from "./reservations";
import { addPayment, openFolio, postCharge, reservationFolio } from "./folio";
import { createBackup } from "./backup";
import { safeCell } from "./export";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 20_000;

export interface ParsedFile {
  headers: string[];
  rows: Record<string, string>[];
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { text?: string; result?: unknown; richText?: { text: string }[]; hyperlink?: string };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.result !== undefined) return cellText(o.result);
    if (o.text !== undefined) return String(o.text);
    return "";
  }
  return String(v);
}

export async function parseFile(name: string, data: Buffer): Promise<ParsedFile> {
  if (data.length > MAX_FILE_BYTES) throw new ApiError(413, "TOO_LARGE", "File is larger than 5 MB. Split it into smaller files.");
  const lower = name.toLowerCase();
  let headers: string[] = [];
  let rows: Record<string, string>[] = [];
  if (lower.endsWith(".xlsx")) {
    if (data.subarray(0, 2).toString() !== "PK") throw new ApiError(400, "BAD_FILE", "This is not a valid .xlsx file");
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(data as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new ApiError(400, "EMPTY", "The workbook has no sheets");
    // header row = first row with at least 2 non-empty cells (templates/exports may have title rows above)
    let headerRow = 1;
    for (let r = 1; r <= Math.min(ws.rowCount, 10); r++) {
      const vals = (ws.getRow(r).values as unknown[]).slice(1).map(cellText).filter((x) => x.trim());
      if (vals.length >= 2) {
        headerRow = r;
        break;
      }
    }
    const hr = ws.getRow(headerRow);
    const width = hr.cellCount;
    for (let c = 1; c <= width; c++) headers.push(cellText(hr.getCell(c).value).trim() || `Column ${c}`);
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const rec: Record<string, string> = {};
      let any = false;
      headers.forEach((h, i) => {
        const t = cellText(row.getCell(i + 1).value).trim();
        if (t) any = true;
        rec[h] = t;
      });
      if (any) rows.push(rec);
      if (rows.length > MAX_ROWS) throw new ApiError(413, "TOO_MANY_ROWS", `More than ${MAX_ROWS} rows. Split the file.`);
    }
  } else if (lower.endsWith(".csv") || lower.endsWith(".txt")) {
    let text = data.toString("utf8");
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    if (text.includes("�")) text = data.toString("latin1"); // not UTF-8 (old Excel "CSV" export)
    const res = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: "greedy", transformHeader: (h) => h.trim() });
    if (res.errors.length && !res.data.length) throw new ApiError(400, "BAD_FILE", `Could not read the CSV: ${res.errors[0].message}`);
    headers = (res.meta.fields ?? []).filter(Boolean);
    rows = res.data.map((r) => Object.fromEntries(headers.map((h) => [h, String(r[h] ?? "").trim()])));
    if (rows.length > MAX_ROWS) throw new ApiError(413, "TOO_MANY_ROWS", `More than ${MAX_ROWS} rows. Split the file.`);
  } else throw new ApiError(400, "BAD_FILE", "Upload a .csv or .xlsx file");
  if (!headers.length) throw new ApiError(400, "EMPTY", "The file has no header row");
  return { headers, rows };
}

export interface RowIssue {
  field: string;
  message: string;
}
export interface CoercedRow {
  index: number; // 1-based data row number (header excluded)
  data: Record<string, unknown>;
  errors: RowIssue[];
  warnings: RowIssue[];
}

/** Neutralises spreadsheet formulas in text cells (=, +, @, or - not followed by a number). */
export function sanitizeText(s: string): { value: string; changed: boolean } {
  let v = s.startsWith("'") ? s.slice(1) : s;
  let changed = false;
  while (/^[=+@\t\r]/.test(v) || (/^-/.test(v) && !/^-\d/.test(v))) {
    v = v.slice(1);
    changed = true;
  }
  return { value: v.trim(), changed };
}

function coerce(fd: FieldDef, raw: string): { value: unknown; error?: string; warning?: string } {
  // a leading apostrophe is how spreadsheets (and our own exports) protect values like +8801… or =…
  const s0 = fromBanglaDigits((raw ?? "").trim()).replace(/^'(?=[=+\-@])/, "");
  if (!s0) return fd.required ? { value: undefined, error: "Required" } : { value: undefined };
  switch (fd.type) {
    case "text": {
      const t = sanitizeText(s0);
      if (fd.max && t.value.length > fd.max) return { value: t.value, error: `Too long (max ${fd.max} characters)` };
      return { value: t.value, warning: t.changed ? "Formula characters removed" : undefined };
    }
    case "code": {
      const v = s0.replace(/^'/, "").trim();
      if (!/^[\w.-]+$/.test(v)) return { value: v, error: "Use letters, digits, '.', '-' or '_' only" };
      if (fd.max && v.length > fd.max) return { value: v, error: `Too long (max ${fd.max})` };
      return { value: fd.key === "username" ? v.toLowerCase() : v.toUpperCase() };
    }
    case "int": {
      const n = Number(s0.replace(/,/g, ""));
      if (!Number.isInteger(n)) return { value: s0, error: "Must be a whole number" };
      if (fd.min !== undefined && n < fd.min) return { value: n, error: `Must be at least ${fd.min}` };
      if (fd.max !== undefined && n > fd.max) return { value: n, error: `Must be at most ${fd.max}` };
      return { value: n };
    }
    case "money":
      try {
        return { value: parseMoney(s0, fd.label) };
      } catch (e) {
        return { value: s0, error: (e as Error).message };
      }
    case "percent": {
      const n = Number(s0.replace("%", ""));
      if (!Number.isFinite(n)) return { value: s0, error: "Must be a percentage" };
      return { value: Math.round(n * 100) };
    }
    case "bool": {
      const v = s0.toLowerCase();
      if (["yes", "y", "true", "1", "active", "হ্যাঁ", "হা"].includes(v)) return { value: true };
      if (["no", "n", "false", "0", "inactive", "না"].includes(v)) return { value: false };
      return { value: s0, error: "Use yes or no" };
    }
    case "date": {
      const d = parseFlexibleDate(s0);
      return d ? { value: d } : { value: s0, error: "Unrecognised date (use YYYY-MM-DD or DD/MM/YYYY)" };
    }
    case "time":
      return /^([01]\d|2[0-3]):[0-5]\d$/.test(s0) ? { value: s0 } : { value: s0, error: "Use HH:MM" };
    case "enum": {
      const v = s0.toUpperCase().replace(/[\s-]+/g, "_");
      const hit = fd.enum!.find((e) => e.toUpperCase() === v) ?? (fd.enum!.includes(s0) ? s0 : undefined);
      return hit !== undefined ? { value: hit } : { value: s0, error: `Must be one of: ${fd.enum!.filter(Boolean).join(", ")}` };
    }
    case "phone": {
      const p = normalizePhone(s0);
      return p ? { value: p } : { value: s0, error: "Invalid phone number" };
    }
    case "email":
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s0) ? { value: s0.toLowerCase() } : { value: s0, error: "Invalid email" };
    case "list":
      return { value: s0.split(/[;|,]/).map((x) => sanitizeText(x).value).filter(Boolean) };
  }
}

export function coerceRows(entity: EntityDef, mapping: Record<string, string>, rows: Record<string, string>[]): CoercedRow[] {
  return rows.map((raw, i) => {
    const data: Record<string, unknown> = {};
    const errors: RowIssue[] = [];
    const warnings: RowIssue[] = [];
    for (const fd of entity.fields) {
      const header = mapping[fd.key];
      const r = coerce(fd, header ? (raw[header] ?? "") : "");
      if (r.value !== undefined) data[fd.key] = r.value;
      if (r.error) errors.push({ field: fd.key, message: r.error });
      if (r.warning) warnings.push({ field: fd.key, message: r.warning });
    }
    return { index: i + 1, data, errors, warnings };
  });
}

// ── per-entity appliers ──────────────────────────────────────────────────────
type Strategy = "CREATE" | "UPDATE" | "UPSERT";
interface UndoOp {
  op: "create" | "update";
  model: string;
  id: string;
  before?: Record<string, unknown>;
}
interface ApplyCtx {
  tx: Tx;
  strategy: Strategy;
  actor: AuditActor;
  businessDate: string;
  batchId: string;
  undo: UndoOp[];
  output: Record<string, unknown>[];
  cache: Map<string, unknown>;
}

class RowError extends Error {}
const fail = (m: string): never => {
  throw new RowError(m);
};

async function idByCode(a: ApplyCtx, model: "roomType" | "ratePlan" | "company" | "cancellationPolicy" | "role" | "room", field: string, value: unknown, label: string): Promise<string | null> {
  if (value === undefined || value === null || value === "") return null;
  const key = `${model}:${value}`;
  if (a.cache.has(key)) return a.cache.get(key) as string;
  const repo = (a.tx as unknown as Record<string, { findFirst: (q: unknown) => Promise<{ id: string } | null> }>)[model];
  const row = await repo.findFirst({ where: { [field]: value } });
  if (!row) fail(`${label} "${value}" not found`);
  a.cache.set(key, row!.id);
  return row!.id;
}

/** Generic create/update by key for simple entities. */
async function upsertBy(a: ApplyCtx, model: string, keyField: string, keyValue: unknown, data: Record<string, unknown>) {
  const repo = (a.tx as unknown as Record<string, { findFirst: Function; create: Function; update: Function }>)[model];
  const existing = (await repo.findFirst({ where: { [keyField]: keyValue } })) as Record<string, unknown> | null;
  if (existing) {
    if (a.strategy === "CREATE") fail(`${keyField} "${keyValue}" already exists`);
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(data)) before[k] = existing[k];
    await repo.update({ where: { id: existing.id }, data });
    a.undo.push({ op: "update", model, id: existing.id as string, before });
    return { op: "updated" as const, id: existing.id as string };
  }
  if (a.strategy === "UPDATE") fail(`${keyField} "${keyValue}" does not exist`);
  const row = (await repo.create({ data: { ...data, importBatchId: a.batchId } })) as { id: string };
  a.undo.push({ op: "create", model, id: row.id });
  return { op: "created" as const, id: row.id };
}

const pick = (d: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter((k) => d[k] !== undefined).map((k) => [k, d[k]]));

const APPLIERS: Record<string, (a: ApplyCtx, d: Record<string, unknown>) => Promise<{ op: "created" | "updated"; id: string }>> = {
  async roomTypes(a, d) {
    const data = pick(d, ["code", "name", "nameBn", "bedType", "baseOccupancy", "maxAdults", "maxChildren", "maxOccupancy", "baseRate", "extraAdultRate", "extraChildRate", "extraBedRate", "description", "active"]);
    if (d.amenities) data.amenities = JSON.stringify(d.amenities);
    const occ = (d.maxOccupancy as number) ?? 3;
    if (d.baseOccupancy && occ < (d.baseOccupancy as number)) fail("Max occupancy must be at least the base occupancy");
    return upsertBy(a, "roomType", "code", d.code, data);
  },
  async rooms(a, d) {
    const roomTypeId = await idByCode(a, "roomType", "code", d.roomTypeCode, "Room type");
    const data = { ...pick(d, ["number", "floor", "features", "notes", "hkStatus", "active"]), roomTypeId };
    // license room limit is enforced by the caller after the run (counts active rooms)
    return upsertBy(a, "room", "number", d.number, data);
  },
  async ratePlans(a, d) {
    const data: Record<string, unknown> = pick(d, ["code", "name", "type", "mealPlan", "mealPricePerAdult", "mealPricePerChild", "adjustmentType", "minStay", "active"]);
    if (d.adjustmentValue !== undefined) {
      const raw = String(d.adjustmentValue);
      data.adjustmentValue = (d.adjustmentType ?? "NONE") === "AMOUNT" ? parseMoney(raw) : Math.round(Number(raw.replace("%", "")) * 100);
      if (!Number.isFinite(data.adjustmentValue as number)) fail("Adjustment must be a number");
    }
    if (d.weekendAdjustment !== undefined) data.weekendAdjustmentBp = Math.round(Number(String(d.weekendAdjustment).replace("%", "")) * 100) || 0;
    if (d.cancellationPolicyCode) data.cancellationPolicyId = await idByCode(a, "cancellationPolicy", "code", d.cancellationPolicyCode, "Cancellation policy");
    return upsertBy(a, "ratePlan", "code", d.code, data);
  },
  async rateSeasons(a, d) {
    if ((d.endDate as string) < (d.startDate as string)) fail("End date is before start date");
    const type = d.adjustmentType as string;
    const raw = String(d.value);
    const value = type === "PERCENT" ? Math.round(Number(raw.replace("%", "")) * 100) : parseMoney(raw);
    if (!Number.isFinite(value)) fail("Value must be a number");
    const days = (d.daysOfWeek as string[] | undefined)?.map(Number) ?? [0, 1, 2, 3, 4, 5, 6];
    if (days.some((x) => !Number.isInteger(x) || x < 0 || x > 6)) fail("Days must be numbers 0–6");
    const data = { name: d.name, startDate: d.startDate, endDate: d.endDate, adjustmentType: type, value, daysOfWeek: JSON.stringify(days), minStay: d.minStay ?? 0, priority: d.priority ?? 0, ratePlanId: await idByCode(a, "ratePlan", "code", d.ratePlanCode, "Rate plan"), roomTypeId: await idByCode(a, "roomType", "code", d.roomTypeCode, "Room type") };
    return upsertBy(a, "rateSeason", "name", d.name, data);
  },
  async companies(a, d) {
    const data: Record<string, unknown> = pick(d, ["code", "name", "contactPerson", "phone", "email", "address", "bin", "creditLimit", "paymentTermsDays", "active"]);
    if (d.discount !== undefined) data.discountBp = Math.round(Number(String(d.discount).replace("%", "")) * 100) || 0;
    if (d.ratePlanCode) data.ratePlanId = await idByCode(a, "ratePlan", "code", d.ratePlanCode, "Rate plan");
    return upsertBy(a, "company", "code", d.code, data);
  },
  async guests(a, d) {
    const data: Record<string, unknown> = pick(d, ["title", "firstName", "lastName", "phone", "email", "gender", "dateOfBirth", "nationality", "idType", "idNumber", "passportNumber", "passportExpiry", "visaNumber", "visaExpiry", "address", "city", "country", "occupation", "vip", "preferences", "notes", "marketingOptIn"]);
    data.fullName = [d.firstName, d.lastName].filter(Boolean).join(" ");
    if (d.companyCode) data.companyId = await idByCode(a, "company", "code", d.companyCode, "Company");
    const match = d.phone ? { phone: d.phone } : d.idNumber ? { idNumber: d.idNumber } : d.passportNumber ? { passportNumber: d.passportNumber } : null;
    const existing = match ? await a.tx.guest.findFirst({ where: { ...match, deletedAt: null } }) : null;
    if (existing) {
      if (a.strategy === "CREATE") fail(`A guest with this ${Object.keys(match!)[0]} already exists (${existing.code})`);
      const before = Object.fromEntries(Object.keys(data).map((k) => [k, (existing as Record<string, unknown>)[k]]));
      await a.tx.guest.update({ where: { id: existing.id }, data });
      a.undo.push({ op: "update", model: "guest", id: existing.id, before });
      return { op: "updated", id: existing.id };
    }
    if (a.strategy === "UPDATE") fail("No existing guest with this phone / ID");
    const code = await nextNumber(a.tx, "guest", a.businessDate);
    const g = await a.tx.guest.create({ data: { ...(data as { firstName: string; fullName: string }), code, importBatchId: a.batchId } });
    a.undo.push({ op: "create", model: "guest", id: g.id });
    return { op: "created", id: g.id };
  },
  async chargeCodes(a, d) {
    return upsertBy(a, "chargeCode", "code", d.code, pick(d, ["code", "name", "nameBn", "category", "defaultAmount", "taxable", "active"]));
  },
  async users(a, d) {
    const roleId = (await idByCode(a, "role", "code", d.roleCode, "Role"))!;
    const existing = await a.tx.user.findUnique({ where: { username: d.username as string } });
    const data = { ...pick(d, ["fullName", "phone", "email", "locale", "active"]), roleId };
    if (existing) {
      if (a.strategy === "CREATE") fail(`User ${d.username} already exists`);
      const role = await a.tx.role.findUnique({ where: { id: existing.roleId } });
      if (role?.code === "SUPER_ADMIN" && roleId !== existing.roleId) fail("Super Admin roles cannot be changed by import");
      const before = Object.fromEntries(Object.keys(data).map((k) => [k, (existing as Record<string, unknown>)[k]]));
      await a.tx.user.update({ where: { id: existing.id }, data });
      a.undo.push({ op: "update", model: "user", id: existing.id, before });
      return { op: "updated", id: existing.id };
    }
    if (a.strategy === "UPDATE") fail(`User ${d.username} does not exist`);
    const pw = tempPassword(10);
    const u = await a.tx.user.create({ data: { ...(data as { fullName: string; roleId: string }), username: d.username as string, passwordHash: await hashSecret(pw), mustChangePassword: true, importBatchId: a.batchId } });
    a.undo.push({ op: "create", model: "user", id: u.id });
    a.output.push({ username: u.username, temporaryPassword: pw });
    return { op: "created", id: u.id };
  },
  async reservations(a, d) {
    if ((d.departure as string) <= (d.arrival as string)) fail("Departure must be after arrival");
    if ((d.departure as string) <= a.businessDate) fail("Stay is in the past; only future or current bookings can be imported");
    const dup = await a.tx.reservation.findFirst({ where: { sourceRef: d.externalRef as string, importBatchId: { not: null } } });
    if (dup) fail(`Booking ${d.externalRef} was already imported (${dup.confirmationNo})`);
    const roomTypeId = (await idByCode(a, "roomType", "code", d.roomTypeCode, "Room type"))!;
    const roomId = await idByCode(a, "room", "number", d.roomNumber, "Room");
    const ratePlanId = await idByCode(a, "ratePlan", "code", d.ratePlanCode, "Rate plan");
    const companyId = await idByCode(a, "company", "code", d.companyCode, "Company");
    const [first, ...rest] = String(d.guestName).trim().split(/\s+/);
    let guestId: string | null = null;
    if (d.phone) guestId = (await a.tx.guest.findFirst({ where: { phone: d.phone as string, deletedAt: null } }))?.id ?? null;
    if (!guestId) {
      const code = await nextNumber(a.tx, "guest", a.businessDate);
      const g = await a.tx.guest.create({ data: { code, firstName: first, lastName: rest.join(" "), fullName: String(d.guestName).trim(), phone: (d.phone as string) ?? "", email: (d.email as string) ?? "", companyId, importBatchId: a.batchId } });
      a.undo.push({ op: "create", model: "guest", id: g.id });
      guestId = g.id;
    }
    const arrival = (d.arrival as string) < a.businessDate ? a.businessDate : (d.arrival as string);
    let res;
    try {
      res = await createReservationTx(
        a.tx,
        {
          guestId,
          companyId,
          status: "CONFIRMED",
          source: (d.source as "PHONE") ?? "PHONE",
          sourceRef: d.externalRef as string,
          agentName: "",
          arrival,
          departure: d.departure as string,
          rooms: [{ roomTypeId, roomId, adults: (d.adults as number) ?? 2, children: (d.children as number) ?? 0, extraBeds: 0, ratePlanId, overrideRate: (d.nightlyRate as number | undefined) ?? null, discountBp: 0 }],
          isGroup: false,
          groupName: "",
          eta: "",
          specialRequests: (d.notes as string) ?? "",
          notes: `Imported from ${d.externalRef}`,
          depositRequired: 0,
          paymentTerms: companyId ? "COMPANY" : "GUEST",
          autoAssign: false,
        },
        { me: null, actor: a.actor, businessDate: a.businessDate, importBatchId: a.batchId, system: true },
      );
    } catch (e) {
      fail((e as Error).message);
    }
    a.undo.push({ op: "create", model: "reservation", id: res!.id });
    if (d.deposit && (d.deposit as number) > 0) {
      const f = await reservationFolio(a.tx, res!.id, a.actor, a.businessDate);
      await addPayment(a.tx, { folioId: f.id, type: "DEPOSIT", method: (d.depositMethod as string) || "CASH", amount: d.deposit as number, reference: `Imported ${d.externalRef}`, businessDate: a.businessDate }, a.actor);
    }
    return { op: "created", id: res!.id };
  },
  async openingBalances(a, d) {
    const companyId = (await idByCode(a, "company", "code", d.companyCode, "Company"))!;
    const c = await a.tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const ref = String(d.reference);
    const dup = await a.tx.folioCharge.findFirst({ where: { sourceRef: `opening:${c.code}:${ref}` } });
    if (dup) fail(`Opening balance ${ref} for ${c.code} already imported`);
    const f = await openFolio(a.tx, { type: "COMPANY", name: `${c.name} – opening ${ref}`, companyId }, a.actor, a.businessDate);
    await postCharge(a.tx, { folioId: f.id, chargeCode: "OPEN", amount: d.amount as number, description: `Opening balance ${ref} (${d.invoiceDate})`, businessDate: a.businessDate, source: "IMPORT", sourceRef: `opening:${c.code}:${ref}`, route: false }, a.actor);
    await a.tx.folio.update({ where: { id: f.id }, data: { cityLedger: true, status: "SETTLED", dueDate: (d.dueDate as string) || addDays(d.invoiceDate as string, c.paymentTermsDays), importBatchId: a.batchId } });
    a.undo.push({ op: "create", model: "folio", id: f.id });
    return { op: "created", id: f.id };
  },
};

export interface RunResult {
  batchId: string | null;
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; field: string; message: string }[];
  warnings: { row: number; field: string; message: string }[];
  output: Record<string, unknown>[];
  backup: string | null;
}

class Rollback extends Error {
  constructor(public result: RunResult) {
    super("rollback");
  }
}

const progress = new Map<string, { processed: number; total: number; at: number }>();
export const importProgress = (jobId: string) => progress.get(jobId) ?? null;

export async function runImport(
  db: Db,
  opts: { entityId: string; mapping: Record<string, string>; rows: Record<string, string>[]; mode: "ALL_OR_NOTHING" | "SKIP_INVALID"; strategy: Strategy; dryRun: boolean; fileName: string; jobId?: string; actor: AuditActor; businessDate: string },
): Promise<RunResult> {
  const entity = entityById(opts.entityId);
  if (!entity) throw new ApiError(400, "UNKNOWN_ENTITY", "Unknown import type");
  if (entity.createOnly && opts.strategy !== "CREATE") throw new ApiError(400, "CREATE_ONLY", `${entity.label} can only be created by import`);
  if (opts.rows.length > MAX_ROWS) throw new ApiError(413, "TOO_MANY_ROWS", `More than ${MAX_ROWS} rows`);
  const missing = entity.fields.filter((f) => f.required && !opts.mapping[f.key]);
  if (missing.length) throw new ApiError(400, "MAPPING", `Map the required column(s): ${missing.map((m) => m.label).join(", ")}`);
  const coerced = coerceRows(entity, opts.mapping, opts.rows);
  const result: RunResult = { batchId: null, dryRun: opts.dryRun, total: coerced.length, created: 0, updated: 0, skipped: 0, errors: [], warnings: [], output: [], backup: null };
  for (const r of coerced) {
    for (const e of r.errors) result.errors.push({ row: r.index, ...e });
    for (const w of r.warnings) result.warnings.push({ row: r.index, ...w });
  }
  // duplicate keys inside the file
  const seen = new Map<string, number>();
  for (const r of coerced) {
    const k = r.data[entity.keyField];
    if (k === undefined || k === "") continue;
    const key = String(k).toLowerCase();
    if (seen.has(key)) {
      result.errors.push({ row: r.index, field: entity.keyField, message: `Duplicate of row ${seen.get(key)} in this file` });
      r.errors.push({ field: entity.keyField, message: "duplicate" });
    } else seen.set(key, r.index);
  }
  if (!opts.dryRun && opts.mode === "ALL_OR_NOTHING" && result.errors.length) return result;
  if (!opts.dryRun) {
    try {
      result.backup = (await createBackup(db, "PRE_IMPORT", opts.actor)).fileName;
    } catch {
      /* backup failure is shown in backup health; import proceeds (it is undoable) */
    }
  }
  const batch = opts.dryRun ? null : await db.importBatch.create({ data: { entity: entity.id, fileName: opts.fileName.slice(0, 200), mode: opts.mode, strategy: opts.strategy, status: "RUNNING", total: coerced.length, createdById: opts.actor.userId ?? null, expiresAt: new Date(Date.now() + 24 * 3600_000) } });
  const jobId = opts.jobId ?? "";
  if (jobId) progress.set(jobId, { processed: 0, total: coerced.length, at: Date.now() });
  try {
    await lockedTx(db, async (tx) => {
      const a: ApplyCtx = { tx, strategy: opts.strategy, actor: opts.actor, businessDate: opts.businessDate, batchId: batch?.id ?? "dry-run", undo: [], output: [], cache: new Map() };
      let n = 0;
      for (const r of coerced) {
        n++;
        if (jobId && n % 25 === 0) progress.set(jobId, { processed: n, total: coerced.length, at: Date.now() });
        if (r.errors.length) {
          result.skipped++;
          continue;
        }
        await tx.$executeRawUnsafe("SAVEPOINT petra_row");
        const undoLen = a.undo.length;
        try {
          const res = await APPLIERS[entity.id](a, r.data);
          await tx.$executeRawUnsafe("RELEASE SAVEPOINT petra_row");
          if (res.op === "created") result.created++;
          else result.updated++;
        } catch (e) {
          await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT petra_row");
          await tx.$executeRawUnsafe("RELEASE SAVEPOINT petra_row");
          a.undo.length = undoLen;
          const msg = e instanceof RowError ? e.message : e instanceof ApiError ? e.message : (e as { code?: string }).code === "P2002" ? "Duplicate value" : `Unexpected error: ${(e as Error).message}`;
          result.errors.push({ row: r.index, field: "", message: msg });
          result.skipped++;
        }
      }
      result.output = a.output;
      if (entity.id === "rooms") {
        const { getLicenseInfo } = await import("./license");
        const lic = await getLicenseInfo(tx);
        const count = await tx.room.count({ where: { active: true } });
        if (lic.maxRooms && count > lic.maxRooms) throw new ApiError(409, "ROOM_LIMIT", `Your license allows ${lic.maxRooms} rooms; this import would make ${count}`);
      }
      if (opts.dryRun || (opts.mode === "ALL_OR_NOTHING" && result.errors.length)) throw new Rollback(result);
      await tx.importBatch.update({ where: { id: batch!.id }, data: { status: "COMPLETED", created: result.created, updated: result.updated, skipped: result.skipped, undoData: JSON.stringify(a.undo) } });
      await audit(tx, opts.actor, "data.import", "ImportBatch", batch!.id, { after: { entity: entity.id, file: opts.fileName, created: result.created, updated: result.updated, skipped: result.skipped, mode: opts.mode, strategy: opts.strategy } });
    });
    result.batchId = batch?.id ?? null;
  } catch (e) {
    if (e instanceof Rollback) {
      if (batch) await db.importBatch.update({ where: { id: batch.id }, data: { status: "FAILED", skipped: result.total } });
      if (!opts.dryRun) {
        result.created = 0;
        result.updated = 0;
      }
      return result;
    }
    if (batch) await db.importBatch.update({ where: { id: batch.id }, data: { status: "FAILED" } }).catch(() => undefined);
    throw e;
  } finally {
    if (jobId) progress.set(jobId, { processed: coerced.length, total: coerced.length, at: Date.now() });
  }
  return result;
}

/** Reverts an import (within 24 hours): deletes created records and restores updated fields. */
export async function undoImport(db: Db, batchId: string, actor: AuditActor) {
  const b = await db.importBatch.findUnique({ where: { id: batchId } });
  if (!b) throw new ApiError(404, "NOT_FOUND", "Import not found");
  if (b.status !== "COMPLETED") throw new ApiError(409, "NOT_UNDOABLE", `This import is ${b.status.toLowerCase()}`);
  if (b.expiresAt < new Date()) throw new ApiError(409, "EXPIRED", "Imports can be undone only within 24 hours");
  const ops = JSON.parse(b.undoData) as UndoOp[];
  await lockedTx(db, async (tx) => {
    const t = tx as unknown as Record<string, { delete: Function; update: Function; findUnique: Function; deleteMany: Function }>;
    for (const op of [...ops].reverse()) {
      try {
        if (op.op === "update") await t[op.model].update({ where: { id: op.id }, data: op.before });
        else if (op.model === "reservation") {
          const stays = await tx.reservationRoom.findMany({ where: { reservationId: op.id } });
          if (stays.some((s) => ["CHECKED_IN", "CHECKED_OUT"].includes(s.status))) throw new ApiError(409, "IN_USE", "An imported reservation has already been checked in; it cannot be undone");
          const folios = (await tx.folio.findMany({ where: { reservationId: op.id }, select: { id: true } })).map((f) => f.id);
          await tx.payment.deleteMany({ where: { folioId: { in: folios } } });
          await tx.folioCharge.deleteMany({ where: { folioId: { in: folios } } });
          await tx.folio.deleteMany({ where: { id: { in: folios } } });
          await tx.reservationRoom.deleteMany({ where: { reservationId: op.id } });
          await tx.reservation.delete({ where: { id: op.id } });
        } else if (op.model === "folio") {
          const pays = await tx.payment.count({ where: { folioId: op.id } });
          if (pays) throw new ApiError(409, "IN_USE", "Payments were received against an imported opening balance; it cannot be undone");
          await tx.folioCharge.deleteMany({ where: { folioId: op.id } });
          await tx.folio.delete({ where: { id: op.id } });
        } else await t[op.model].delete({ where: { id: op.id } });
      } catch (e) {
        if (e instanceof ApiError) throw e;
        if ((e as { code?: string }).code === "P2025") continue; // already gone
        throw new ApiError(409, "IN_USE", `Cannot undo: a ${op.model} created by this import is now used by other records. Remove those first.`);
      }
    }
    await tx.importBatch.update({ where: { id: b.id }, data: { status: "UNDONE", undoneAt: new Date(), undoneById: actor.userId ?? null } });
    await audit(tx, actor, "data.importUndone", "ImportBatch", b.id, { after: { entity: b.entity, operations: ops.length } });
  });
  return { ok: true, reverted: ops.length };
}

/** Error report CSV for a run (row, field, message + the original values). */
export function errorCsv(result: RunResult, rows: Record<string, string>[]): Buffer {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const esc = (s: string) => (/[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [["Row", "Field", "Problem", ...headers].map(esc).join(",")];
  for (const e of result.errors) lines.push([String(e.row), e.field, e.message, ...headers.map((h) => safeCell(rows[e.row - 1]?.[h] ?? ""))].map(esc).join(","));
  return Buffer.from("﻿" + lines.join("\r\n") + "\r\n", "utf8");
}
