// Reports (JSON + PDF/CSV/XLSX export) and printable documents (invoice, pro-forma, registration card,
// booking confirmation, payment receipt). PDFs are generated on the server so printing works offline and the
// desktop app can print silently.
import { z } from "zod";
import { amountInWords, folioBalance, nightsBetween, parseFlexibleDate } from "@petra/core";
import { route, type Ctx } from "../api";
import { audit, parseJson } from "../common";
import { ApiError, forbidden, notFound } from "../errors";
import { getSection } from "../settings";
import { REPORTS, reportById } from "../services/reports";
import { toCsv, toXlsx } from "../services/export";
import { buildInvoiceSnapshot, invoiceDocument } from "../services/invoice";
import { readUpload } from "../services/files";
import type { HotelInfo, Locale } from "../pdf/common";

async function locale(ctx: Ctx): Promise<Locale> {
  const loc = await getSection(ctx.db, "locale");
  const pdfLang = ctx.query.get("lang");
  return { bn: pdfLang ? pdfLang === "bn" : !!ctx.user?.banglaDigits, grouping: loc.grouping };
}

async function hotelInfo(ctx: Ctx): Promise<HotelInfo & { checkInTime: string; checkOutTime: string }> {
  const h = await ctx.db.hotel.findUnique({ where: { id: "hotel" } });
  return { name: h?.name ?? "", legalName: h?.legalName, address: h?.address, city: h?.city, phone: h?.phone, email: h?.email, website: h?.website, bin: h?.bin, logo: h?.logo, checkInTime: h?.checkInTime ?? "14:00", checkOutTime: h?.checkOutTime ?? "12:00" };
}

const pdf = (buf: Buffer, name: string, inline = true) => new Response(new Uint8Array(buf), { headers: { "content-type": "application/pdf", "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`, "cache-control": "no-store" } });
const fileName = (s: string) => s.replace(/[^\w.-]+/g, "_");

function rangeOf(ctx: Ctx) {
  const qf = parseFlexibleDate(ctx.query.get("from"));
  const qt = parseFlexibleDate(ctx.query.get("to"));
  const from = qf ?? qt ?? ctx.businessDate;
  const to = qt ?? from;
  if (to < from) throw new ApiError(400, "VALIDATION", "'To' date must be on or after 'from'");
  return { from, to, businessDate: ctx.businessDate };
}

route("GET", "/reports", { perm: ["reports.view", "reports.financial"], allowReadOnly: true }, async (ctx) =>
  REPORTS.filter((r) => ctx.can(r.perm)).map((r) => ({ id: r.id, title: r.title, titleBn: r.titleBn, group: r.group, range: r.range })),
);

route("GET", "/reports/:id", { perm: ["reports.view", "reports.financial"], module: "reports", allowReadOnly: true }, async (ctx) => {
  const def = reportById(ctx.params.id);
  if (!def) throw notFound("Report");
  if (!ctx.can(def.perm)) throw forbidden(def.perm);
  return def.run(ctx.db, rangeOf(ctx));
});

route("GET", "/reports/:id/export", { perm: "reports.export", module: "reports", allowReadOnly: true }, async (ctx) => {
  const def = reportById(ctx.params.id);
  if (!def) throw notFound("Report");
  if (!ctx.can(def.perm)) throw forbidden(def.perm);
  const p = rangeOf(ctx);
  const r = await def.run(ctx.db, p);
  const format = ctx.query.get("format") ?? "pdf";
  const base = fileName(`${def.id}_${p.from}${def.range && p.to !== p.from ? "_" + p.to : ""}`);
  const hotel = await hotelInfo(ctx);
  await audit(ctx.db, ctx.actor, "report.exported", "Report", def.id, { after: { format, from: p.from, to: p.to, rows: r.rows.length } });
  if (format === "csv") return new Response(new Uint8Array(toCsv(r)), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"` } });
  if (format === "xlsx") return new Response(new Uint8Array(await toXlsx(r, { hotel: hotel.name })), { headers: { "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "content-disposition": `attachment; filename="${base}.xlsx"` } });
  const { renderReportPdf } = await import("../pdf/documents");
  return pdf(await renderReportPdf(r, hotel, ctx.user?.fullName ?? "", await locale(ctx)), `${base}.pdf`, ctx.query.get("download") !== "1");
});

route("GET", "/invoices/:id/pdf", { perm: ["folio.view", "folio.invoice"], allowReadOnly: true }, async (ctx) => {
  const inv = await invoiceDocument(ctx.db, ctx.params.id);
  const { renderInvoicePdf } = await import("../pdf/documents");
  return pdf(await renderInvoicePdf(inv, ctx.query.get("format") === "80mm" ? "80mm" : "A4", await locale(ctx)), `${fileName(inv.number ?? "invoice")}.pdf`);
});

route("GET", "/print/test", { allowReadOnly: true }, async (ctx) => {
  const { renderTestPage } = await import("../pdf/documents");
      // eslint-disable-next-line no-control-regex
  const printer = (ctx.query.get("printer") ?? "").replace(/[\u0000-\u001f]/g, "").slice(0, 120);
  return pdf(await renderTestPage(await hotelInfo(ctx), ctx.query.get("format") === "80mm" ? "80mm" : "A4", printer, await locale(ctx)), "printer-test.pdf");
});

route("GET", "/folios/:id/proforma/pdf", { perm: "folio.view", allowReadOnly: true }, async (ctx) => {
  const snap = await buildInvoiceSnapshot(ctx.db, ctx.params.id, {});
  snap.businessDate = ctx.businessDate;
  const { renderInvoicePdf } = await import("../pdf/documents");
  return pdf(await renderInvoicePdf(snap, ctx.query.get("format") === "80mm" ? "80mm" : "A4", await locale(ctx)), `proforma_${fileName(snap.folio.number)}.pdf`);
});

function uploadDataUrl(name: string) {
  if (!name) return "";
  try {
    const f = readUpload(name);
    if (!/^image\/(png|jpeg)$/.test(f.type)) return ""; // react-pdf renders PNG/JPEG
    return `data:${f.type};base64,${f.data.toString("base64")}`;
  } catch {
    return "";
  }
}

route("GET", "/stays/:id/registration-card/pdf", { perm: ["frontdesk.checkin", "reservations.view"], allowReadOnly: true }, async (ctx) => {
  const s = await ctx.db.reservationRoom.findUnique({ where: { id: ctx.params.id }, include: { reservation: { include: { guest: true, company: true } }, guest: true, room: true, roomType: true } });
  if (!s) throw notFound("Stay");
  const g = s.guest ?? s.reservation.guest;
  const plan = s.ratePlanId ? await ctx.db.ratePlan.findUnique({ where: { id: s.ratePlanId }, select: { name: true } }) : null;
  const nightly = parseJson<{ date: string; amount: number }[]>(s.nightlyRates, []);
  const hotel = await hotelInfo(ctx);
  const fd = await ctx.db.setting.findUnique({ where: { key: "regcard" } });
  const guest: Record<string, string> = {};
  for (const [k, v] of Object.entries(g)) guest[k] = typeof v === "string" ? v : v == null ? "" : String(v);
  guest.idImage = uploadDataUrl(g.idImage);
  guest.photo = uploadDataUrl(g.photo);
  const { renderRegistrationCard } = await import("../pdf/documents");
  return pdf(
    await renderRegistrationCard(
      { hotel, confirmationNo: s.reservation.confirmationNo, room: s.room?.number ?? "—", roomType: s.roomType.name, arrival: s.arrivalDate, departure: s.departureDate, adults: s.adults, children: s.children, rate: nightly[0]?.amount ?? 0, ratePlan: plan?.name ?? "", guest, company: s.reservation.company?.name ?? "", terms: fd ? parseJson<{ terms?: string }>(fd.value, {}).terms ?? "" : "", checkInTime: hotel.checkInTime, checkOutTime: hotel.checkOutTime },
      await locale(ctx),
    ),
    `regcard_${fileName(s.reservation.confirmationNo)}.pdf`,
  );
});

route("GET", "/reservations/:id/confirmation/pdf", { perm: "reservations.view", allowReadOnly: true }, async (ctx) => {
  const r = await ctx.db.reservation.findUnique({ where: { id: ctx.params.id }, include: { guest: true, company: true, rooms: { include: { roomType: true, room: true } }, folios: { include: { payments: true } } } });
  if (!r) throw notFound("Reservation");
  const plans = new Map((await ctx.db.ratePlan.findMany({ select: { id: true, name: true } })).map((p) => [p.id, p.name]));
  const pol = parseJson<{ name?: string; freeUntilHours?: number; penaltyType?: string; noShowType?: string }>(r.cancellationPolicy, {});
  const policy = pol.name ? `${pol.name}: free cancellation until ${pol.freeUntilHours} hours before arrival; after that ${String(pol.penaltyType).replace("_", " ").toLowerCase()} is charged. No-show: ${String(pol.noShowType).replace("_", " ").toLowerCase()}.` : "";
  const live = r.rooms.filter((s) => !["CANCELLED", "NO_SHOW"].includes(s.status));
  const rooms = live.map((s) => ({ type: s.roomType.name, room: s.room?.number ?? "", adults: s.adults, children: s.children, nights: nightsBetween(s.arrivalDate, s.departureDate), total: parseJson<{ amount: number }[]>(s.nightlyRates, []).reduce((a, n) => a + n.amount, 0), ratePlan: s.ratePlanId ? (plans.get(s.ratePlanId) ?? "") : "" }));
  const deposits = r.folios.flatMap((f) => f.payments).filter((p) => !p.voidedAt && p.type === "DEPOSIT").reduce((a, p) => a + p.amount, 0);
  const { renderConfirmation } = await import("../pdf/documents");
  return pdf(
    await renderConfirmation({ hotel: await hotelInfo(ctx), confirmationNo: r.confirmationNo, status: r.status, guest: { fullName: r.guest.fullName, phone: r.guest.phone, email: r.guest.email }, company: r.company?.name ?? "", arrival: r.arrivalDate, departure: r.departureDate, rooms, total: rooms.reduce((a, x) => a + x.total, 0), deposits, depositRequired: r.depositRequired, policy, specialRequests: r.specialRequests, createdAt: r.createdAt.toISOString() }, await locale(ctx)),
    `confirmation_${fileName(r.confirmationNo)}.pdf`,
  );
});

route("GET", "/payments/:id/receipt/pdf", { perm: ["folio.view", "folio.payment"], allowReadOnly: true }, async (ctx) => {
  const p = await ctx.db.payment.findUnique({ where: { id: ctx.params.id }, include: { folio: { include: { charges: true, payments: true, reservationRoom: { include: { room: true } } } } } });
  if (!p) throw notFound("Payment");
  const cashier = p.createdById ? await ctx.db.user.findUnique({ where: { id: p.createdById }, select: { fullName: true } }) : null;
  const method = await ctx.db.paymentMethod.findUnique({ where: { code: p.method } });
  const { renderReceipt } = await import("../pdf/documents");
  return pdf(
    await renderReceipt({ hotel: await hotelInfo(ctx), receiptNo: p.receiptNo, date: p.businessDate, type: p.type, method: method?.name ?? p.method, reference: p.reference, amount: p.amount, folio: p.folio.number, name: p.folio.name, room: p.folio.reservationRoom?.room?.number ?? "", cashier: cashier?.fullName ?? "", balance: folioBalance(p.folio.charges, p.folio.payments).balance, amountInWords: amountInWords(p.amount) }, await locale(ctx)),
    `receipt_${fileName(p.receiptNo)}.pdf`,
  );
});

/** Registration-card terms text (editable in Settings → Front desk). */
route("PUT", "/settings-regcard", { perm: "settings.manage" }, async (ctx) => {
  const b = await ctx.body(z.object({ terms: z.string().max(4000) }));
  await ctx.db.setting.upsert({ where: { key: "regcard" }, create: { key: "regcard", value: JSON.stringify(b) }, update: { value: JSON.stringify(b) } });
  return { ok: true };
});
