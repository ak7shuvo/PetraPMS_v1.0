// Shared server helpers: business date, document sequences, audit log, JSON fields.
import { calendarToday, formatSequence, sequenceKey } from "@petra/core";
import type { Db, Tx } from "./db";

/** Current hotel business date (independent of the calendar). Created on first use. */
export async function getBusinessDate(db: Db | Tx): Promise<string> {
  const open = await db.businessDate.findFirst({ where: { status: "OPEN" }, orderBy: { date: "desc" } });
  if (open) return open.date;
  const hotel = await db.hotel.findUnique({ where: { id: "hotel" } });
  const today = calendarToday(hotel?.timezone || "Asia/Dhaka");
  const created = await db.businessDate.upsert({ where: { date: today }, create: { date: today }, update: { status: "OPEN", closedAt: null } });
  return created.date;
}

/** Next number of a named sequence. Must run inside the transaction that uses the number. */
export async function nextNumber(db: Tx | Db, name: string, businessDate: string): Promise<string> {
  const key = sequenceKey(name, businessDate);
  const row = await db.sequence.upsert({ where: { name: key }, create: { name: key, value: 1 }, update: { value: { increment: 1 } } });
  return formatSequence(name, row.value, businessDate);
}

export interface AuditActor {
  userId?: string | null;
  username?: string;
  ip?: string;
  terminalId?: string;
  businessDate?: string;
}

const strip = (v: unknown): unknown => {
  if (v === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(v, (k, val) => (/(password|pin|token|secret|keyHash|tokenHash)/i.test(k) ? "[redacted]" : typeof val === "string" && val.startsWith("data:") && val.length > 200 ? "[image]" : val)),
  );
};

export async function audit(db: Db | Tx, actor: AuditActor, action: string, entity = "", entityId = "", opts: { before?: unknown; after?: unknown; reason?: string } = {}) {
  await db.auditLog.create({
    data: {
      userId: actor.userId ?? null,
      username: actor.username ?? "system",
      ip: actor.ip ?? "",
      terminalId: actor.terminalId ?? "",
      businessDate: actor.businessDate ?? "",
      action,
      entity,
      entityId,
      before: opts.before === undefined ? null : JSON.stringify(strip(opts.before)),
      after: opts.after === undefined ? null : JSON.stringify(strip(opts.after)),
      reason: opts.reason ?? "",
    },
  });
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Only the fields that changed (for compact before/after audit entries). */
export function diff<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const k of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k];
      a[k] = after[k];
    }
  }
  return { before: b, after: a };
}
