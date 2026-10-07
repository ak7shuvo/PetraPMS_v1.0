// Folio engine: opening folios, posting charges with taxes and routing, payments, refunds, voids, transfers.
// All functions take a transaction client; callers wrap them in lockedTx(db, fn, "folio") (or "inventory" when
// the same transaction also changes room inventory) so balances are always consistent.
import { computeTax, folioBalance, routeCharge, type TaxMode, type TaxRuleDef } from "@petra/core";
import type { Db, Tx } from "../db";
import { audit, nextNumber, parseJson, type AuditActor } from "../common";
import { ApiError, notFound } from "../errors";
import { getSection } from "../settings";

export async function loadTaxRules(db: Db | Tx): Promise<TaxRuleDef[]> {
  const rows = await db.taxRule.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return rows.map((r) => ({ code: r.code, name: r.name, rateBp: r.rateBp, base: r.base as TaxRuleDef["base"], appliesTo: parseJson<string[]>(r.appliesTo, ["*"]), sortOrder: r.sortOrder, active: r.active }));
}

export interface OpenFolioInput {
  type?: "GUEST" | "MASTER" | "COMPANY" | "WALK_IN";
  name: string;
  reservationId?: string | null;
  reservationRoomId?: string | null;
  guestId?: string | null;
  companyId?: string | null;
  parentFolioId?: string | null;
  routing?: string[];
  isDemo?: boolean;
}

export async function openFolio(tx: Tx, input: OpenFolioInput, actor: AuditActor, businessDate: string) {
  const number = await nextNumber(tx, "folio", businessDate);
  const f = await tx.folio.create({
    data: {
      number,
      type: input.type ?? "GUEST",
      name: input.name,
      reservationId: input.reservationId ?? null,
      reservationRoomId: input.reservationRoomId ?? null,
      guestId: input.guestId ?? null,
      companyId: input.companyId ?? null,
      parentFolioId: input.parentFolioId ?? null,
      routing: JSON.stringify(input.routing ?? []),
      createdById: actor.userId ?? null,
      isDemo: input.isDemo ?? false,
    },
  });
  await audit(tx, actor, "folio.opened", "Folio", f.id, { after: { number, name: input.name, type: f.type } });
  return f;
}

/** The primary (non-split) folio of a stay, created on demand. */
export async function primaryFolioForStay(tx: Tx, reservationRoomId: string, actor: AuditActor, businessDate: string) {
  const existing = await tx.folio.findFirst({ where: { reservationRoomId, parentFolioId: null, status: { not: "CLOSED" } }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  const rr = await tx.reservationRoom.findUnique({ where: { id: reservationRoomId }, include: { reservation: { include: { guest: true } }, guest: true } });
  if (!rr) throw notFound("Stay");
  const guest = rr.guest ?? rr.reservation.guest;
  return openFolio(tx, { name: guest.fullName, reservationId: rr.reservationId, reservationRoomId, guestId: guest.id, companyId: rr.reservation.companyId, isDemo: rr.isDemo }, actor, businessDate);
}

/** Reservation-level folio for deposits taken before check-in (when no stay has a folio yet). */
export async function reservationFolio(tx: Tx, reservationId: string, actor: AuditActor, businessDate: string) {
  const res = await tx.reservation.findUnique({ where: { id: reservationId }, include: { guest: true, rooms: { orderBy: { createdAt: "asc" } } } });
  if (!res) throw notFound("Reservation");
  const existing = await tx.folio.findFirst({ where: { reservationId, parentFolioId: null, status: { not: "CLOSED" } }, orderBy: { createdAt: "asc" } });
  if (existing) return existing;
  const first = res.rooms.find((r) => r.status !== "CANCELLED") ?? res.rooms[0];
  return openFolio(tx, { name: res.guest.fullName, reservationId, reservationRoomId: first?.id ?? null, guestId: res.guestId, companyId: res.companyId, isDemo: res.isDemo }, actor, businessDate);
}

export interface PostChargeInput {
  folioId: string;
  chargeCode: string; // code, e.g. ROOM
  amount: number; // unit amount in poisha (net when EXCLUSIVE, gross when INCLUSIVE); may be negative for allowances
  quantity?: number;
  description?: string;
  source?: string;
  sourceRef?: string;
  reservationRoomId?: string | null;
  roomNumber?: string;
  businessDate: string;
  isAdjustment?: boolean;
  reason?: string;
  approvedById?: string | null;
  /** apply routing rules of split folios (default true) */
  route?: boolean;
  taxMode?: TaxMode;
  isDemo?: boolean;
}

export async function postCharge(tx: Tx, input: PostChargeInput, actor: AuditActor) {
  const code = await tx.chargeCode.findUnique({ where: { code: input.chargeCode } });
  if (!code || !code.active) throw new ApiError(400, "UNKNOWN_CHARGE_CODE", `Unknown charge code ${input.chargeCode}`);
  let folio = await tx.folio.findUnique({ where: { id: input.folioId } });
  if (!folio) throw notFound("Folio");
  if (input.route !== false) {
    // route to a split folio when one claims this category
    const family = await tx.folio.findMany({ where: { OR: [{ id: folio.id }, { parentFolioId: folio.id }] } });
    const target = routeCharge(
      folio.id,
      family.map((f) => ({ id: f.id, type: f.type, status: f.status, parentFolioId: f.parentFolioId, routing: parseJson<string[]>(f.routing, []) })),
      code.category,
    );
    if (target !== folio.id) folio = family.find((f) => f.id === target)!;
  }
  if (folio.status !== "OPEN") throw new ApiError(409, "FOLIO_CLOSED", `Folio ${folio.number} is ${folio.status.toLowerCase()}; reopen it to post charges`);
  const qty = input.quantity ?? 1;
  const gross = input.amount * qty;
  const rules = await loadTaxRules(tx);
  const mode = input.taxMode ?? (await getSection(tx, "billing")).taxMode;
  const t = computeTax(gross, { rules, mode, category: code.category, taxable: code.taxable });
  const charge = await tx.folioCharge.create({
    data: {
      folioId: folio.id,
      businessDate: input.businessDate,
      chargeCodeId: code.id,
      category: code.category,
      description: input.description || code.name,
      quantity: qty,
      unitAmount: input.amount,
      amount: t.net,
      serviceCharge: t.serviceCharge,
      vat: t.vat,
      otherTax: t.otherTax,
      total: t.total,
      taxDetail: JSON.stringify(t.lines),
      taxMode: mode,
      source: input.source ?? "MANUAL",
      sourceRef: input.sourceRef ?? "",
      reservationRoomId: input.reservationRoomId ?? folio.reservationRoomId,
      roomNumber: input.roomNumber ?? "",
      isAdjustment: input.isAdjustment ?? false,
      reason: input.reason ?? "",
      approvedById: input.approvedById ?? null,
      createdById: actor.userId ?? null,
      isDemo: input.isDemo ?? false,
    },
  });
  await tx.folio.update({ where: { id: folio.id }, data: { version: { increment: 1 } } });
  if (input.source !== "NIGHT_AUDIT") await audit(tx, actor, input.isAdjustment ? "folio.adjustment" : "folio.charge", "FolioCharge", charge.id, { after: { folio: folio.number, code: code.code, total: charge.total, description: charge.description }, reason: input.reason });
  return charge;
}

export interface PaymentInput {
  folioId: string;
  type: "PAYMENT" | "REFUND" | "DEPOSIT";
  method: string;
  amount: number;
  reference?: string;
  notes?: string;
  currency?: string;
  foreignAmount?: number;
  businessDate: string;
  isDemo?: boolean;
}

export async function addPayment(tx: Tx, input: PaymentInput, actor: AuditActor) {
  if (input.amount <= 0) throw new ApiError(400, "BAD_AMOUNT", "Amount must be greater than zero");
  const folio = await tx.folio.findUnique({ where: { id: input.folioId }, include: { charges: true, payments: true } });
  if (!folio) throw notFound("Folio");
  if (folio.status === "CLOSED") throw new ApiError(409, "FOLIO_CLOSED", `Folio ${folio.number} is closed`);
  const method = await tx.paymentMethod.findUnique({ where: { code: input.method } });
  if (!method || !method.active) throw new ApiError(400, "UNKNOWN_METHOD", `Unknown payment method ${input.method}`);
  if (method.type === "CITY_LEDGER") throw new ApiError(400, "USE_TRANSFER", "Use 'Transfer to city ledger' to bill a company");
  if (input.type === "REFUND") {
    const b = folioBalance(folio.charges, folio.payments);
    if (input.amount > -b.balance) throw new ApiError(400, "REFUND_TOO_LARGE", `Refund cannot exceed the guest's credit (${(Math.max(0, -b.balance) / 100).toFixed(2)})`);
  }
  const receiptNo = await nextNumber(tx, "receipt", input.businessDate);
  const p = await tx.payment.create({
    data: {
      folioId: folio.id,
      businessDate: input.businessDate,
      type: input.type,
      method: method.code,
      amount: input.amount,
      currency: input.currency ?? "BDT",
      foreignAmount: input.foreignAmount ?? 0,
      reference: input.reference ?? "",
      notes: input.notes ?? "",
      receiptNo,
      createdById: actor.userId ?? null,
      isDemo: input.isDemo ?? false,
    },
  });
  await tx.folio.update({ where: { id: folio.id }, data: { version: { increment: 1 }, status: folio.status === "SETTLED" ? "OPEN" : folio.status } });
  await audit(tx, actor, `payment.${input.type.toLowerCase()}`, "Payment", p.id, { after: { folio: folio.number, method: method.code, amount: p.amount, receiptNo } });
  return p;
}

export async function folioWithBalance(db: Db | Tx, folioId: string) {
  const f = await db.folio.findUnique({
    where: { id: folioId },
    include: {
      charges: { orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }] },
      payments: { orderBy: { createdAt: "asc" } },
      invoices: { orderBy: { issuedAt: "desc" }, select: { id: true, number: true, total: true, issuedAt: true, voidedAt: true } },
      guest: { select: { id: true, fullName: true, phone: true, email: true, address: true, nationality: true } },
      company: { select: { id: true, name: true, address: true, bin: true, paymentTermsDays: true } },
      reservation: { select: { id: true, confirmationNo: true, arrivalDate: true, departureDate: true, status: true } },
      reservationRoom: { select: { id: true, room: { select: { number: true } }, arrivalDate: true, departureDate: true, status: true, adults: true, children: true } },
    },
  });
  if (!f) throw notFound("Folio");
  return { ...f, routing: parseJson<string[]>(f.routing, []), balance: folioBalance(f.charges, f.payments) };
}

/** Balance of every open folio of a stay (primary + splits). */
export async function stayBalance(db: Db | Tx, reservationRoomId: string) {
  const folios = await db.folio.findMany({ where: { reservationRoomId, cityLedger: false }, include: { charges: true, payments: true } });
  return folios.map((f) => ({ id: f.id, number: f.number, name: f.name, status: f.status, balance: folioBalance(f.charges, f.payments).balance }));
}

export async function voidCharge(tx: Tx, chargeId: string, reason: string, actor: AuditActor) {
  const c = await tx.folioCharge.findUnique({ where: { id: chargeId }, include: { folio: true } });
  if (!c) throw notFound("Charge");
  if (c.voidedAt) throw new ApiError(409, "ALREADY_VOID", "Charge is already void");
  if (c.folio.status === "CLOSED") throw new ApiError(409, "FOLIO_CLOSED", "Folio is closed");
  await tx.folioCharge.update({ where: { id: c.id }, data: { voidedAt: new Date(), voidedById: actor.userId ?? null, voidReason: reason } });
  await tx.folio.update({ where: { id: c.folioId }, data: { version: { increment: 1 } } });
  await audit(tx, actor, "folio.chargeVoided", "FolioCharge", c.id, { before: { total: c.total, description: c.description }, reason });
}

export async function voidPayment(tx: Tx, paymentId: string, reason: string, actor: AuditActor) {
  const p = await tx.payment.findUnique({ where: { id: paymentId }, include: { folio: true } });
  if (!p) throw notFound("Payment");
  if (p.voidedAt) throw new ApiError(409, "ALREADY_VOID", "Payment is already void");
  if (p.folio.status === "CLOSED") throw new ApiError(409, "FOLIO_CLOSED", "Folio is closed");
  await tx.payment.update({ where: { id: p.id }, data: { voidedAt: new Date(), voidedById: actor.userId ?? null, voidReason: reason } });
  await tx.folio.update({ where: { id: p.folioId }, data: { version: { increment: 1 } } });
  await audit(tx, actor, "payment.voided", "Payment", p.id, { before: { amount: p.amount, method: p.method, receiptNo: p.receiptNo }, reason });
}

/** Moves charges to another open folio (split billing). */
export async function transferCharges(tx: Tx, chargeIds: string[], toFolioId: string, actor: AuditActor) {
  const to = await tx.folio.findUnique({ where: { id: toFolioId } });
  if (!to || to.status !== "OPEN") throw new ApiError(409, "FOLIO_CLOSED", "Target folio is not open");
  const charges = await tx.folioCharge.findMany({ where: { id: { in: chargeIds } }, include: { folio: true } });
  if (charges.length !== chargeIds.length) throw notFound("Charge");
  for (const c of charges) {
    if (c.folio.status === "CLOSED") throw new ApiError(409, "FOLIO_CLOSED", `Folio ${c.folio.number} is closed`);
    await tx.folioCharge.update({ where: { id: c.id }, data: { folioId: to.id, transferredFrom: c.folioId } });
  }
  const touched = [...new Set([...charges.map((c) => c.folioId), to.id])];
  await tx.folio.updateMany({ where: { id: { in: touched } }, data: { version: { increment: 1 } } });
  await audit(tx, actor, "folio.transfer", "Folio", to.id, { after: { charges: charges.map((c) => c.id), to: to.number } });
}

/**
 * Transfers the folio's balance to the company's city ledger: the folio becomes a city-ledger receivable with a
 * due date by the company's payment terms. Credit limit is enforced.
 */
export async function transferToCityLedger(tx: Tx, folioId: string, companyId: string, actor: AuditActor, businessDate: string) {
  const f = await tx.folio.findUnique({ where: { id: folioId }, include: { charges: true, payments: true } });
  if (!f) throw notFound("Folio");
  const c = await tx.company.findUnique({ where: { id: companyId } });
  if (!c || !c.active || !c.cityLedger) throw new ApiError(400, "NO_CREDIT", "This company has no city ledger account");
  const bal = folioBalance(f.charges, f.payments).balance;
  if (bal <= 0) throw new ApiError(400, "NOTHING_DUE", "There is no balance to transfer");
  if (c.creditLimit > 0) {
    const open = await tx.folio.findMany({ where: { companyId, cityLedger: true, status: { not: "CLOSED" } }, include: { charges: true, payments: true } });
    const exposure = open.reduce((a, x) => a + folioBalance(x.charges, x.payments).balance, 0);
    if (exposure + bal > c.creditLimit) throw new ApiError(409, "CREDIT_LIMIT", `Credit limit exceeded for ${c.name}: outstanding ${(exposure / 100).toFixed(2)}, limit ${(c.creditLimit / 100).toFixed(2)}`);
  }
  const { addDays } = await import("@petra/core");
  await tx.folio.update({ where: { id: f.id }, data: { cityLedger: true, companyId, dueDate: addDays(businessDate, c.paymentTermsDays), status: "SETTLED", version: { increment: 1 } } });
  await audit(tx, actor, "folio.cityLedger", "Folio", f.id, { after: { company: c.name, amount: bal } });
  return bal;
}
