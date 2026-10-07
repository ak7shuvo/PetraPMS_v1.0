// Folio & billing API: folio views, charges, adjustments (with approval), payments, refunds, voids, split
// folios and routing, transfers, city ledger, invoices.
import { z } from "zod";
import { folioBalance, agingReport, agingBucket } from "@petra/core";
import { route, pageArgs, type Ctx } from "../api";
import { audit, parseJson } from "../common";
import { lockedTx } from "../lock";
import { publish } from "../events";
import { ApiError, notFound } from "../errors";
import { approveWith } from "../auth";
import { addPayment, folioWithBalance, openFolio, postCharge, transferCharges, transferToCityLedger, voidCharge, voidPayment } from "../services/folio";
import { issueInvoice, invoiceDocument } from "../services/invoice";
import { approvalSchema } from "../services/reservations";
import { zSignedMoney } from "@/shared/schemas";

const done = (ctx: Ctx, folioId: string, action: string) => publish("folios", action, folioId, ctx.user?.id);

route("GET", "/folios", { perm: ["folio.view", "ledger.view"], allowReadOnly: true }, async (ctx) => {
  const { take, skip } = pageArgs(ctx.query);
  const where: Record<string, unknown> = {};
  const status = ctx.query.get("status");
  if (status) where.status = { in: status.split(",") };
  if (ctx.query.get("cityLedger") === "1") where.cityLedger = true;
  if (ctx.query.get("type")) where.type = ctx.query.get("type");
  if (ctx.query.get("reservationId")) where.reservationId = ctx.query.get("reservationId");
  if (ctx.query.get("companyId")) where.companyId = ctx.query.get("companyId");
  const q = (ctx.query.get("q") ?? "").trim();
  if (q) where.OR = [{ number: { contains: q.toUpperCase() } }, { name: { contains: q } }, { reservation: { confirmationNo: { contains: q.toUpperCase() } } }];
  const rows = await ctx.db.folio.findMany({ where, take, skip, orderBy: { openedAt: "desc" }, include: { charges: { select: { total: true, voidedAt: true } }, payments: { select: { amount: true, type: true, voidedAt: true } }, reservationRoom: { select: { room: { select: { number: true } } } }, company: { select: { name: true } } } });
  const total = await ctx.db.folio.count({ where });
  return { total, rows: rows.map(({ charges, payments, ...f }) => ({ ...f, routing: parseJson(f.routing, []), room: f.reservationRoom?.room?.number ?? "", balance: folioBalance(charges, payments).balance })) };
});

route("GET", "/folios/:id", { perm: "folio.view", allowReadOnly: true }, async (ctx) => {
  const f = await folioWithBalance(ctx.db, ctx.params.id);
  const family = await ctx.db.folio.findMany({ where: { OR: [{ parentFolioId: f.parentFolioId ?? f.id }, { id: f.parentFolioId ?? f.id }] }, select: { id: true, number: true, name: true, status: true, parentFolioId: true, routing: true } });
  return { ...f, family: family.map((x) => ({ ...x, routing: parseJson(x.routing, []) })) };
});

/** Non-resident / house folio (walk-in restaurant guest, event, paid-outs). */
route("POST", "/folios", { perm: "folio.charge" }, async (ctx) => {
  const b = await ctx.body(z.object({ name: z.string().trim().min(1).max(120), type: z.enum(["WALK_IN", "COMPANY", "MASTER"]).default("WALK_IN"), companyId: z.string().nullable().optional(), guestId: z.string().nullable().optional() }));
  const f = await lockedTx(ctx.db, (tx) => openFolio(tx, b, ctx.actor, ctx.businessDate), "folio");
  done(ctx, f.id, "opened");
  return f;
});

/** Split folio: a child folio receiving routed charge categories (e.g. ROOM to company, extras to guest). */
route("POST", "/folios/:id/split", { perm: "folio.transfer" }, async (ctx) => {
  const b = await ctx.body(z.object({ name: z.string().trim().min(1).max(120), routing: z.array(z.string()).default([]), companyId: z.string().nullable().optional() }));
  const f = await lockedTx(
    ctx.db,
    async (tx) => {
      const parent = await tx.folio.findUnique({ where: { id: ctx.params.id } });
      if (!parent) throw notFound("Folio");
      if (parent.parentFolioId) throw new ApiError(400, "NESTED", "Split from the main folio");
      return openFolio(tx, { name: b.name, type: b.companyId ? "COMPANY" : "GUEST", reservationId: parent.reservationId, reservationRoomId: parent.reservationRoomId, guestId: parent.guestId, companyId: b.companyId ?? parent.companyId, parentFolioId: parent.id, routing: b.routing }, ctx.actor, ctx.businessDate);
    },
    "folio",
  );
  done(ctx, f.id, "split");
  return f;
});

route("PUT", "/folios/:id/routing", { perm: "folio.transfer" }, async (ctx) => {
  const b = await ctx.body(z.object({ routing: z.array(z.string()), name: z.string().trim().min(1).max(120).optional() }));
  const f = await ctx.db.folio.update({ where: { id: ctx.params.id }, data: { routing: JSON.stringify(b.routing), ...(b.name ? { name: b.name } : {}), version: { increment: 1 } } });
  await audit(ctx.db, ctx.actor, "folio.routing", "Folio", f.id, { after: b });
  done(ctx, f.id, "routing");
  return { ok: true };
});

const chargeSchema = z.object({
  chargeCode: z.string().min(1),
  amount: zSignedMoney,
  quantity: z.number().int().min(1).max(999).default(1),
  description: z.string().trim().max(200).default(""),
  reason: z.string().trim().max(300).default(""),
  approval: approvalSchema,
});

route("POST", "/folios/:id/charges", { perm: "folio.charge" }, async (ctx) => {
  const b = await ctx.body(chargeSchema);
  const code = await ctx.db.chargeCode.findUnique({ where: { code: b.chargeCode } });
  if (!code) throw new ApiError(400, "UNKNOWN_CHARGE_CODE", "Unknown charge code");
  const isAdj = b.amount < 0 || code.category === "ADJUSTMENT";
  let approver: string | null = null;
  if (isAdj) {
    if (b.reason.length < 3) throw new ApiError(400, "VALIDATION", "Enter a reason for the adjustment");
    approver = await approveWith(ctx.db, b.approval, "folio.adjust", ctx.me());
  }
  const c = await lockedTx(
    ctx.db,
    async (tx) => {
      const f = await tx.folio.findUnique({ where: { id: ctx.params.id }, include: { reservationRoom: { include: { room: true } } } });
      if (!f) throw notFound("Folio");
      return postCharge(tx, { folioId: f.id, chargeCode: b.chargeCode, amount: b.amount, quantity: b.quantity, description: b.description, businessDate: ctx.businessDate, roomNumber: f.reservationRoom?.room?.number ?? "", isAdjustment: isAdj, reason: b.reason, approvedById: approver }, ctx.actor);
    },
    "folio",
  );
  done(ctx, c.folioId, "charge");
  return c;
});

route("POST", "/folios/:id/payments", { perm: "folio.payment" }, async (ctx) => {
  const b = await ctx.body(
    z.object({
      type: z.enum(["PAYMENT", "DEPOSIT", "REFUND"]).default("PAYMENT"),
      method: z.string().min(1),
      amount: z.number().int().min(1).max(100_000_000_00),
      reference: z.string().trim().max(80).default(""),
      notes: z.string().trim().max(300).default(""),
      currency: z.enum(["BDT", "USD"]).default("BDT"),
      foreignAmount: z.number().int().min(0).default(0),
      approval: approvalSchema,
    }),
  );
  if (b.type === "REFUND") await approveWith(ctx.db, b.approval, "folio.refund", ctx.me());
  const method = await ctx.db.paymentMethod.findUnique({ where: { code: b.method } });
  if (method && ["CARD", "MOBILE", "BANK"].includes(method.type) && !b.reference && b.type !== "REFUND") throw new ApiError(400, "VALIDATION", `Enter the ${method.type === "MOBILE" ? "transaction ID" : "reference / slip number"} for ${method.name}`);
  const p = await lockedTx(ctx.db, (tx) => addPayment(tx, { folioId: ctx.params.id, ...b, businessDate: ctx.businessDate }, ctx.actor), "folio");
  done(ctx, p.folioId, "payment");
  return p;
});

route("POST", "/charges/:id/void", { perm: "folio.void" }, async (ctx) => {
  const b = await ctx.body(z.object({ reason: z.string().trim().min(3, "Enter a reason").max(300) }));
  const c = await ctx.db.folioCharge.findUnique({ where: { id: ctx.params.id } });
  if (!c) throw notFound("Charge");
  if (c.businessDate !== ctx.businessDate) ctx.need("folio.adjust"); // past-day charges: post an adjustment instead unless allowed
  await lockedTx(ctx.db, (tx) => voidCharge(tx, c.id, b.reason, ctx.actor), "folio");
  done(ctx, c.folioId, "void");
  return { ok: true };
});

route("POST", "/payments/:id/void", { perm: "folio.void" }, async (ctx) => {
  const b = await ctx.body(z.object({ reason: z.string().trim().min(3, "Enter a reason").max(300) }));
  const p = await ctx.db.payment.findUnique({ where: { id: ctx.params.id } });
  if (!p) throw notFound("Payment");
  await lockedTx(ctx.db, (tx) => voidPayment(tx, p.id, b.reason, ctx.actor), "folio");
  done(ctx, p.folioId, "void");
  return { ok: true };
});

route("POST", "/folios/:id/transfer", { perm: "folio.transfer" }, async (ctx) => {
  const b = await ctx.body(z.object({ chargeIds: z.array(z.string()).min(1).max(500), toFolioId: z.string().min(1) }));
  await lockedTx(ctx.db, (tx) => transferCharges(tx, b.chargeIds, b.toFolioId, ctx.actor), "folio");
  done(ctx, ctx.params.id, "transfer");
  return { ok: true };
});

route("POST", "/folios/:id/city-ledger", { perm: ["frontdesk.checkout_balance", "ledger.manage"], module: "cityledger" }, async (ctx) => {
  const b = await ctx.body(z.object({ companyId: z.string().min(1) }));
  const amount = await lockedTx(ctx.db, (tx) => transferToCityLedger(tx, ctx.params.id, b.companyId, ctx.actor, ctx.businessDate), "folio");
  done(ctx, ctx.params.id, "cityLedger");
  return { amount };
});

route("POST", "/folios/:id/settle", { perm: "folio.payment" }, async (ctx) => {
  const f = await folioWithBalance(ctx.db, ctx.params.id);
  if (f.balance.balance !== 0) throw new ApiError(409, "BALANCE_DUE", `Balance must be zero to settle (current ${(f.balance.balance / 100).toFixed(2)})`);
  await ctx.db.folio.update({ where: { id: f.id }, data: { status: "SETTLED", closedAt: new Date(), version: { increment: 1 } } });
  await audit(ctx.db, ctx.actor, "folio.settled", "Folio", f.id);
  done(ctx, f.id, "settled");
  return { ok: true };
});

route("POST", "/folios/:id/reopen", { perm: "folio.reopen" }, async (ctx) => {
  const b = await ctx.body(z.object({ reason: z.string().trim().min(3).max(300) }));
  const f = await ctx.db.folio.findUnique({ where: { id: ctx.params.id } });
  if (!f) throw notFound("Folio");
  if (f.status === "OPEN") throw new ApiError(409, "ALREADY_OPEN", "Folio is already open");
  await ctx.db.folio.update({ where: { id: f.id }, data: { status: "OPEN", closedAt: null, version: { increment: 1 } } });
  await audit(ctx.db, ctx.actor, "folio.reopened", "Folio", f.id, { before: { status: f.status }, reason: b.reason });
  done(ctx, f.id, "reopened");
  return { ok: true };
});

// ── invoices ────────────────────────────────────────────────────────────────
route("POST", "/folios/:id/invoices", { perm: "folio.invoice" }, async (ctx) => {
  const b = await ctx.body(z.object({ billToName: z.string().trim().max(160).optional(), billToAddress: z.string().trim().max(300).optional(), billToBin: z.string().trim().max(30).optional() }));
  const inv = await lockedTx(ctx.db, (tx) => issueInvoice(tx, ctx.params.id, b, ctx.actor, ctx.businessDate), "folio");
  done(ctx, ctx.params.id, "invoice");
  return inv;
});

route("GET", "/invoices/:id", { perm: ["folio.view", "folio.invoice"], allowReadOnly: true }, async (ctx) => invoiceDocument(ctx.db, ctx.params.id));

/** Pro-forma (preview) of a folio without issuing a number. */
route("GET", "/folios/:id/proforma", { perm: "folio.view", allowReadOnly: true }, async (ctx) => {
  const { buildInvoiceSnapshot } = await import("../services/invoice");
  return buildInvoiceSnapshot(ctx.db, ctx.params.id, {});
});

route("POST", "/invoices/:id/void", { perm: "folio.void" }, async (ctx) => {
  const b = await ctx.body(z.object({ reason: z.string().trim().min(3).max(300) }));
  const inv = await ctx.db.invoice.findUnique({ where: { id: ctx.params.id } });
  if (!inv) throw notFound("Invoice");
  if (inv.voidedAt) throw new ApiError(409, "ALREADY_VOID", "Invoice already void");
  await ctx.db.invoice.update({ where: { id: inv.id }, data: { voidedAt: new Date(), voidReason: b.reason } });
  await audit(ctx.db, ctx.actor, "invoice.voided", "Invoice", inv.id, { reason: b.reason, before: { number: inv.number, total: inv.total } });
  return { ok: true };
});

// ── city ledger ─────────────────────────────────────────────────────────────
route("GET", "/ledger", { perm: "ledger.view", module: "cityledger", allowReadOnly: true }, async (ctx) => {
  const asOf = ctx.query.get("asOf") ?? ctx.businessDate;
  const folios = await ctx.db.folio.findMany({ where: { cityLedger: true, status: { not: "CLOSED" } }, include: { charges: { select: { total: true, voidedAt: true } }, payments: { select: { amount: true, type: true, voidedAt: true } }, company: { select: { id: true, name: true, code: true, creditLimit: true } } } });
  const items = folios.map((f) => ({ id: f.id, number: f.number, name: f.name, companyId: f.companyId ?? "", company: f.company, dueDate: f.dueDate || asOf, balance: folioBalance(f.charges, f.payments).balance, openedAt: f.openedAt }));
  const open = items.filter((i) => i.balance !== 0);
  const aging = agingReport(open.map((i) => ({ companyId: i.companyId, balance: i.balance, dueDate: i.dueDate })), asOf);
  return { asOf, items: open.map((i) => ({ ...i, bucket: agingBucket(i.dueDate, asOf) })), aging };
});

/** Company payment against city-ledger folios (oldest first unless specific folios are given). */
route("POST", "/ledger/payments", { perm: "ledger.manage", module: "cityledger" }, async (ctx) => {
  const b = await ctx.body(z.object({ companyId: z.string().min(1), method: z.string().min(1), amount: z.number().int().min(1), reference: z.string().trim().max(80).default(""), folioIds: z.array(z.string()).optional() }));
  const res = await lockedTx(
    ctx.db,
    async (tx) => {
      const folios = await tx.folio.findMany({ where: { cityLedger: true, companyId: b.companyId, status: { not: "CLOSED" }, ...(b.folioIds ? { id: { in: b.folioIds } } : {}) }, include: { charges: true, payments: true }, orderBy: [{ dueDate: "asc" }, { openedAt: "asc" }] });
      let left = b.amount;
      const applied: { folio: string; amount: number }[] = [];
      for (const f of folios) {
        if (left <= 0) break;
        const bal = folioBalance(f.charges, f.payments).balance;
        if (bal <= 0) continue;
        const amt = Math.min(bal, left);
        await tx.folio.update({ where: { id: f.id }, data: { status: "OPEN" } });
        await addPayment(tx, { folioId: f.id, type: "PAYMENT", method: b.method, amount: amt, reference: b.reference, notes: "City ledger payment", businessDate: ctx.businessDate }, ctx.actor);
        if (bal - amt === 0) await tx.folio.update({ where: { id: f.id }, data: { status: "CLOSED", closedAt: new Date() } });
        else await tx.folio.update({ where: { id: f.id }, data: { status: "SETTLED" } });
        applied.push({ folio: f.number, amount: amt });
        left -= amt;
      }
      if (left > 0) throw new ApiError(400, "OVERPAYMENT", `Payment exceeds the outstanding balance by ${(left / 100).toFixed(2)}`);
      return applied;
    },
    "folio",
  );
  publish("folios", "ledgerPayment", b.companyId, ctx.user?.id);
  return { applied: res };
});
