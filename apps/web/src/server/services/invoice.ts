// Invoices: a numbered, immutable snapshot of a folio (lines, taxes, hotel and bill-to details at issue time),
// laid out like the NBR Mushak-6.3 tax invoice (seller BIN, buyer BIN, per-line VAT/SD) when that layout is chosen.
import { amountInWords, folioBalance, formatDate } from "@petra/core";
import type { Db, Tx } from "../db";
import { audit, nextNumber, parseJson, type AuditActor } from "../common";
import { ApiError, notFound } from "../errors";
import { getSection } from "../settings";

export interface InvoiceLine {
  date: string;
  code: string;
  description: string;
  room: string;
  quantity: number;
  unitAmount: number;
  net: number;
  serviceCharge: number;
  vat: number;
  otherTax: number;
  total: number;
}

export interface InvoiceSnapshot {
  number: string | null;
  issuedAt: string;
  businessDate: string;
  hotel: { name: string; legalName: string; address: string; city: string; phone: string; email: string; website: string; bin: string; tradeLicense: string; logo: string; usdRate: number; showUsd: boolean };
  billTo: { name: string; address: string; bin: string; phone: string; email: string };
  stay: { confirmationNo: string; room: string; arrival: string; departure: string; adults: number; children: number } | null;
  folio: { id: string; number: string; name: string };
  lines: InvoiceLine[];
  taxes: { code: string; name: string; rateBp: number; amount: number }[];
  payments: { date: string; method: string; type: string; amount: number; receiptNo: string; reference: string }[];
  totals: { net: number; serviceCharge: number; vat: number; otherTax: number; total: number; paid: number; balance: number };
  amountInWords: string;
  layout: "STANDARD" | "MUSHAK";
  footer: string;
  showQr: boolean;
  qrText: string;
  taxMode: string;
}

export async function buildInvoiceSnapshot(db: Db | Tx, folioId: string, billTo: { billToName?: string; billToAddress?: string; billToBin?: string }): Promise<InvoiceSnapshot> {
  const f = await db.folio.findUnique({
    where: { id: folioId },
    include: {
      charges: { where: { voidedAt: null }, orderBy: [{ businessDate: "asc" }, { createdAt: "asc" }], include: { chargeCode: { select: { code: true } } } },
      payments: { where: { voidedAt: null }, orderBy: { createdAt: "asc" } },
      guest: true,
      company: true,
      reservation: { select: { confirmationNo: true } },
      reservationRoom: { include: { room: { select: { number: true } } } },
    },
  });
  if (!f) throw notFound("Folio");
  const hotel = await db.hotel.findUnique({ where: { id: "hotel" } });
  const billing = await getSection(db, "billing");
  const bal = folioBalance(f.charges, f.payments);
  const taxMap = new Map<string, { code: string; name: string; rateBp: number; amount: number }>();
  for (const c of f.charges) {
    for (const t of parseJson<{ code: string; name: string; rateBp: number; amount: number }[]>(c.taxDetail, [])) {
      const k = `${t.code}|${t.rateBp}`;
      const cur = taxMap.get(k) ?? { ...t, amount: 0 };
      cur.amount += t.amount;
      taxMap.set(k, cur);
    }
  }
  const company = f.cityLedger || f.type === "COMPANY" ? f.company : null;
  const name = billTo.billToName || company?.name || f.name;
  const snapshot: InvoiceSnapshot = {
    number: null,
    issuedAt: new Date().toISOString(),
    businessDate: "",
    hotel: { name: hotel?.name ?? "", legalName: hotel?.legalName ?? "", address: hotel?.address ?? "", city: hotel?.city ?? "", phone: hotel?.phone ?? "", email: hotel?.email ?? "", website: hotel?.website ?? "", bin: hotel?.bin ?? "", tradeLicense: hotel?.tradeLicense ?? "", logo: hotel?.logo ?? "", usdRate: hotel?.usdRate ?? 0, showUsd: billing.showUsd || !!hotel?.showUsd },
    billTo: { name, address: billTo.billToAddress ?? company?.address ?? f.guest?.address ?? "", bin: billTo.billToBin ?? company?.bin ?? "", phone: f.guest?.phone ?? company?.phone ?? "", email: f.guest?.email ?? company?.email ?? "" },
    stay: f.reservationRoom ? { confirmationNo: f.reservation?.confirmationNo ?? "", room: f.reservationRoom.room?.number ?? "", arrival: f.reservationRoom.arrivalDate, departure: f.reservationRoom.departureDate, adults: f.reservationRoom.adults, children: f.reservationRoom.children } : null,
    folio: { id: f.id, number: f.number, name: f.name },
    lines: f.charges.map((c) => ({ date: c.businessDate, code: c.chargeCode.code, description: c.description, room: c.roomNumber, quantity: c.quantity, unitAmount: c.unitAmount, net: c.amount, serviceCharge: c.serviceCharge, vat: c.vat, otherTax: c.otherTax, total: c.total })),
    taxes: [...taxMap.values()].filter((t) => t.amount !== 0),
    payments: f.payments.map((p) => ({ date: p.businessDate, method: p.method, type: p.type, amount: p.type === "REFUND" ? -p.amount : p.amount, receiptNo: p.receiptNo, reference: p.reference })),
    totals: { net: bal.net, serviceCharge: bal.serviceCharge, vat: bal.vat, otherTax: bal.otherTax, total: bal.charges, paid: bal.payments, balance: bal.balance },
    amountInWords: amountInWords(Math.abs(bal.charges)),
    layout: billing.invoiceLayout,
    footer: billing.invoiceFooter,
    showQr: billing.showQr,
    qrText: "",
    taxMode: billing.taxMode,
  };
  return snapshot;
}

export function qrTextFor(s: InvoiceSnapshot) {
  // compact, human-readable verification payload (no secrets)
  return [`INV:${s.number ?? "PROFORMA"}`, `BIN:${s.hotel.bin}`, `DATE:${s.businessDate}`, `TOTAL:${(s.totals.total / 100).toFixed(2)}`, `VAT:${(s.totals.vat / 100).toFixed(2)}`, `HOTEL:${s.hotel.name}`].join("|");
}

export async function issueInvoice(tx: Tx, folioId: string, billTo: { billToName?: string; billToAddress?: string; billToBin?: string }, actor: AuditActor, businessDate: string) {
  const snap = await buildInvoiceSnapshot(tx, folioId, billTo);
  if (!snap.lines.length) throw new ApiError(409, "EMPTY_FOLIO", "The folio has no charges to invoice");
  const number = await nextNumber(tx, "invoice", businessDate);
  snap.number = number;
  snap.businessDate = businessDate;
  snap.qrText = qrTextFor(snap);
  const inv = await tx.invoice.create({
    data: {
      number,
      folioId,
      businessDate,
      billToName: snap.billTo.name,
      billToAddress: snap.billTo.address,
      billToBin: snap.billTo.bin,
      subtotal: snap.totals.net,
      serviceCharge: snap.totals.serviceCharge,
      vat: snap.totals.vat,
      otherTax: snap.totals.otherTax,
      total: snap.totals.total,
      paid: snap.totals.paid,
      balance: snap.totals.balance,
      snapshot: JSON.stringify(snap),
      createdById: actor.userId ?? null,
    },
  });
  await audit(tx, actor, "invoice.issued", "Invoice", inv.id, { after: { number, folio: snap.folio.number, total: inv.total } });
  return { id: inv.id, number, total: inv.total };
}

export async function invoiceDocument(db: Db | Tx, invoiceId: string) {
  const inv = await db.invoice.findUnique({ where: { id: invoiceId } });
  if (!inv) throw notFound("Invoice");
  const snap = parseJson<InvoiceSnapshot | null>(inv.snapshot, null);
  if (!snap) throw new ApiError(500, "CORRUPT", "Invoice snapshot is unreadable");
  return { ...snap, id: inv.id, voidedAt: inv.voidedAt, voidReason: inv.voidReason, issuedDate: formatDate(inv.businessDate, "DD MMM YYYY") };
}
