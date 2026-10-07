// Report registry. Each report returns a typed table (columns + rows + totals) that the UI renders and that the
// exporters turn into PDF, CSV or XLSX — one definition, every format.
import { addDays, agingBucket, eachDay, folioBalance, monthStart, nightsBetween } from "@petra/core";
import type { Db } from "../db";
import { parseJson } from "../common";
import { dayStats } from "./stats";

export type ColType = "text" | "money" | "number" | "date" | "percent" | "datetime";
export interface Column {
  key: string;
  label: string;
  labelBn?: string;
  type: ColType;
}
export interface ReportResult {
  title: string;
  subtitle: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  summary?: { label: string; value: string | number; type?: ColType }[];
}
export interface ReportParams {
  from: string;
  to: string;
  businessDate: string;
}
export interface ReportDef {
  id: string;
  title: string;
  titleBn: string;
  group: "front" | "revenue" | "finance" | "operations" | "guests";
  perm: string;
  range: boolean;
  run(db: Db, p: ReportParams): Promise<ReportResult>;
}

const c = (key: string, label: string, type: ColType = "text", labelBn?: string): Column => ({ key, label, type, labelBn });
const sum = (rows: Record<string, unknown>[], key: string) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
const MAX_DAYS = 400;
const clampRange = (p: ReportParams) => (nightsBetween(p.from, p.to) > MAX_DAYS ? { ...p, from: addDays(p.to, -MAX_DAYS) } : p);

export const REPORTS: ReportDef[] = [
  {
    id: "manager",
    title: "Daily manager report",
    titleBn: "দৈনিক ম্যানেজার রিপোর্ট",
    group: "revenue",
    perm: "reports.financial",
    range: false,
    async run(db, p) {
      const d = p.to;
      const day = await dayStats(db, d);
      const mtdDays = eachDay(monthStart(d), d);
      const ytdFrom = d.slice(0, 4) + "-01-01";
      const agg = async (days: string[]) => {
        const all = await Promise.all(days.map((x) => dayStats(db, x)));
        const sold = all.reduce((a, s) => a + s.sold, 0);
        const avail = all.reduce((a, s) => a + s.available, 0);
        const room = all.reduce((a, s) => a + s.roomRevenue, 0);
        return { sold, avail, room, other: all.reduce((a, s) => a + s.otherRevenue, 0), occ: avail ? Math.round((sold * 10000) / avail) : 0, adr: sold ? Math.round(room / sold) : 0, revpar: avail ? Math.round(room / avail) : 0 };
      };
      const mtd = await agg(mtdDays);
      const ytdDays = eachDay(ytdFrom, d);
      const ytd = ytdDays.length <= 366 ? await agg(ytdDays) : mtd;
      const row = (label: string, k: keyof typeof mtd, type: ColType, today: number) => ({ metric: label, today, mtd: mtd[k], ytd: ytd[k], _type: type });
      return {
        title: "Daily manager report",
        subtitle: d,
        columns: [c("metric", "Metric", "text", "বিবরণ"), c("today", "Today", "number", "আজ"), c("mtd", "Month to date", "number", "মাসের শুরু থেকে"), c("ytd", "Year to date", "number", "বছরের শুরু থেকে")],
        rows: [
          row("Rooms available", "avail", "number", day.available),
          row("Rooms sold", "sold", "number", day.sold),
          row("Occupancy %", "occ", "percent", day.occupancyBp),
          row("ADR", "adr", "money", day.adr),
          row("RevPAR", "revpar", "money", day.revpar),
          row("Room revenue", "room", "money", day.roomRevenue),
          row("Other revenue", "other", "money", day.otherRevenue),
        ],
        summary: [
          { label: "Arrivals", value: day.arrivals },
          { label: "Departures", value: day.departures },
          { label: "No-shows", value: day.noShows },
          { label: "Cancellations", value: day.cancellations },
          { label: "Guests in house", value: day.guestsInHouse },
          { label: "Out of order", value: day.outOfOrder },
          { label: "Service charge", value: day.serviceCharge, type: "money" },
          { label: "VAT", value: day.vat, type: "money" },
          ...Object.entries(day.payments).map(([k, v]) => ({ label: `Payments – ${k}`, value: v, type: "money" as ColType })),
        ],
      };
    },
  },
  {
    id: "occupancy",
    title: "Occupancy & revenue by day",
    titleBn: "দৈনিক অকুপেন্সি ও আয়",
    group: "revenue",
    perm: "reports.financial",
    range: true,
    async run(db, p0) {
      const p = clampRange(p0);
      const rows = [];
      for (const d of eachDay(p.from, p.to)) {
        const s = await dayStats(db, d, { forecast: d >= p.businessDate });
        rows.push({ date: d, available: s.available, sold: s.sold, occupancy: s.occupancyBp, roomRevenue: s.roomRevenue, otherRevenue: s.otherRevenue, adr: s.adr, revpar: s.revpar });
      }
      const sold = sum(rows, "sold");
      const avail = sum(rows, "available");
      const room = sum(rows, "roomRevenue");
      return {
        title: "Occupancy & revenue by day",
        subtitle: `${p.from} – ${p.to}`,
        columns: [c("date", "Date", "date", "তারিখ"), c("available", "Available", "number", "উপলব্ধ"), c("sold", "Sold", "number", "বিক্রিত"), c("occupancy", "Occ. %", "percent", "অকুপেন্সি"), c("roomRevenue", "Room revenue", "money", "রুম আয়"), c("otherRevenue", "Other revenue", "money", "অন্যান্য আয়"), c("adr", "ADR", "money"), c("revpar", "RevPAR", "money")],
        rows,
        totals: { date: "Total", available: avail, sold, occupancy: avail ? Math.round((sold * 10000) / avail) : 0, roomRevenue: room, otherRevenue: sum(rows, "otherRevenue"), adr: sold ? Math.round(room / sold) : 0, revpar: avail ? Math.round(room / avail) : 0 },
      };
    },
  },
  {
    id: "revenue-category",
    title: "Revenue by category",
    titleBn: "খাত অনুযায়ী আয়",
    group: "revenue",
    perm: "reports.financial",
    range: true,
    async run(db, p) {
      const charges = await db.folioCharge.findMany({ where: { businessDate: { gte: p.from, lte: p.to }, voidedAt: null }, select: { category: true, amount: true, serviceCharge: true, vat: true, otherTax: true, total: true } });
      const map = new Map<string, { category: string; count: number; net: number; serviceCharge: number; vat: number; otherTax: number; total: number }>();
      for (const ch of charges) {
        const m = map.get(ch.category) ?? { category: ch.category, count: 0, net: 0, serviceCharge: 0, vat: 0, otherTax: 0, total: 0 };
        m.count++;
        m.net += ch.amount;
        m.serviceCharge += ch.serviceCharge;
        m.vat += ch.vat;
        m.otherTax += ch.otherTax;
        m.total += ch.total;
        map.set(ch.category, m);
      }
      const rows = [...map.values()].sort((a, b) => b.net - a.net);
      return {
        title: "Revenue by category",
        subtitle: `${p.from} – ${p.to}`,
        columns: [c("category", "Category", "text", "খাত"), c("count", "Lines", "number"), c("net", "Net", "money", "নিট"), c("serviceCharge", "Service charge", "money", "সার্ভিস চার্জ"), c("vat", "VAT", "money", "ভ্যাট"), c("otherTax", "Other tax", "money"), c("total", "Gross", "money", "মোট")],
        rows,
        totals: { category: "Total", count: sum(rows, "count"), net: sum(rows, "net"), serviceCharge: sum(rows, "serviceCharge"), vat: sum(rows, "vat"), otherTax: sum(rows, "otherTax"), total: sum(rows, "total") },
      };
    },
  },
  {
    id: "tax",
    title: "VAT & service charge by day",
    titleBn: "দৈনিক ভ্যাট ও সার্ভিস চার্জ",
    group: "finance",
    perm: "reports.financial",
    range: true,
    async run(db, p) {
      const charges = await db.folioCharge.findMany({ where: { businessDate: { gte: p.from, lte: p.to }, voidedAt: null }, select: { businessDate: true, amount: true, serviceCharge: true, vat: true, total: true } });
      const byDay = new Map<string, { date: string; taxable: number; serviceCharge: number; vat: number; total: number }>();
      for (const ch of charges) {
        const d = byDay.get(ch.businessDate) ?? { date: ch.businessDate, taxable: 0, serviceCharge: 0, vat: 0, total: 0 };
        d.taxable += ch.amount;
        d.serviceCharge += ch.serviceCharge;
        d.vat += ch.vat;
        d.total += ch.total;
        byDay.set(ch.businessDate, d);
      }
      const rows = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
      const invoices = await db.invoice.count({ where: { businessDate: { gte: p.from, lte: p.to }, voidedAt: null } });
      return {
        title: "VAT & service charge by day",
        subtitle: `${p.from} – ${p.to}`,
        columns: [c("date", "Date", "date", "তারিখ"), c("taxable", "Net sales", "money", "নিট বিক্রি"), c("serviceCharge", "Service charge", "money", "সার্ভিস চার্জ"), c("vat", "VAT", "money", "ভ্যাট"), c("total", "Gross", "money", "মোট")],
        rows,
        totals: { date: "Total", taxable: sum(rows, "taxable"), serviceCharge: sum(rows, "serviceCharge"), vat: sum(rows, "vat"), total: sum(rows, "total") },
        summary: [{ label: "Invoices issued", value: invoices }],
      };
    },
  },
  {
    id: "payments",
    title: "Payments & cashier report",
    titleBn: "পেমেন্ট ও ক্যাশিয়ার রিপোর্ট",
    group: "finance",
    perm: "reports.financial",
    range: true,
    async run(db, p) {
      const pays = await db.payment.findMany({ where: { businessDate: { gte: p.from, lte: p.to } }, include: { folio: { select: { number: true, name: true } } }, orderBy: { createdAt: "asc" } });
      const users = new Map((await db.user.findMany({ select: { id: true, fullName: true } })).map((u) => [u.id, u.fullName]));
      const rows = pays.map((x) => ({ date: x.businessDate, time: x.createdAt, receiptNo: x.receiptNo, folio: x.folio.number, guest: x.folio.name, type: x.type, method: x.method, reference: x.reference, amount: x.voidedAt ? 0 : x.type === "REFUND" ? -x.amount : x.amount, cashier: users.get(x.createdById ?? "") ?? "", status: x.voidedAt ? `VOID: ${x.voidReason}` : "" }));
      const byMethod = new Map<string, number>();
      for (const r of rows) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + r.amount);
      return {
        title: "Payments & cashier report",
        subtitle: `${p.from} – ${p.to}`,
        columns: [c("date", "Date", "date", "তারিখ"), c("time", "Time", "datetime"), c("receiptNo", "Receipt", "text", "রসিদ"), c("folio", "Folio"), c("guest", "Name", "text", "নাম"), c("type", "Type"), c("method", "Method", "text", "মাধ্যম"), c("reference", "Reference"), c("amount", "Amount", "money", "পরিমাণ"), c("cashier", "Cashier", "text", "ক্যাশিয়ার"), c("status", "Status")],
        rows,
        totals: { date: "Total", amount: sum(rows, "amount") },
        summary: [...byMethod.entries()].map(([k, v]) => ({ label: k, value: v, type: "money" as ColType })),
      };
    },
  },
  {
    id: "arrivals",
    title: "Arrivals",
    titleBn: "আগমন তালিকা",
    group: "front",
    perm: "reports.view",
    range: true,
    async run(db, p) {
      const rows = await db.reservationRoom.findMany({ where: { arrivalDate: { gte: p.from, lte: p.to }, status: { in: ["RESERVED", "CHECKED_IN", "CHECKED_OUT"] } }, include: { reservation: { include: { guest: true, company: true } }, room: true, roomType: true }, orderBy: [{ arrivalDate: "asc" }] });
      return {
        title: "Arrivals",
        subtitle: `${p.from} – ${p.to}`,
        columns: [c("arrival", "Arrival", "date", "আগমন"), c("conf", "Conf. no"), c("guest", "Guest", "text", "অতিথি"), c("phone", "Phone"), c("company", "Company"), c("type", "Type"), c("room", "Room", "text", "রুম"), c("nights", "Nights", "number"), c("pax", "Pax", "number"), c("eta", "ETA"), c("status", "Status"), c("requests", "Requests")],
        rows: rows.map((s) => ({ arrival: s.arrivalDate, conf: s.reservation.confirmationNo, guest: s.reservation.guest.fullName, phone: s.reservation.guest.phone, company: s.reservation.company?.name ?? "", type: s.roomType.code, room: s.room?.number ?? "", nights: nightsBetween(s.arrivalDate, s.departureDate), pax: s.adults + s.children, eta: s.reservation.eta, status: s.status, requests: s.reservation.specialRequests })),
      };
    },
  },
  {
    id: "departures",
    title: "Departures",
    titleBn: "প্রস্থান তালিকা",
    group: "front",
    perm: "reports.view",
    range: true,
    async run(db, p) {
      const rows = await db.reservationRoom.findMany({ where: { departureDate: { gte: p.from, lte: p.to }, status: { in: ["CHECKED_IN", "CHECKED_OUT"] } }, include: { reservation: { include: { guest: true } }, room: true, folios: { include: { charges: true, payments: true } } }, orderBy: [{ departureDate: "asc" }] });
      return {
        title: "Departures",
        subtitle: `${p.from} – ${p.to}`,
        columns: [c("departure", "Departure", "date", "প্রস্থান"), c("conf", "Conf. no"), c("guest", "Guest", "text", "অতিথি"), c("room", "Room", "text", "রুম"), c("status", "Status"), c("balance", "Balance", "money", "বকেয়া")],
        rows: rows.map((s) => ({ departure: s.departureDate, conf: s.reservation.confirmationNo, guest: s.reservation.guest.fullName, room: s.room?.number ?? "", status: s.status, balance: s.folios.filter((f) => !f.cityLedger).reduce((a, f) => a + folioBalance(f.charges, f.payments).balance, 0) })),
      };
    },
  },
  {
    id: "inhouse",
    title: "In-house guests",
    titleBn: "অবস্থানরত অতিথি",
    group: "front",
    perm: "reports.view",
    range: false,
    async run(db, p) {
      const rows = await db.reservationRoom.findMany({ where: { status: "CHECKED_IN" }, include: { reservation: { include: { guest: true, company: true } }, guest: true, room: true, roomType: true, folios: { include: { charges: true, payments: true } } }, orderBy: { room: { number: "asc" } } });
      return {
        title: "In-house guests",
        subtitle: p.businessDate,
        columns: [c("room", "Room", "text", "রুম"), c("type", "Type"), c("guest", "Guest", "text", "অতিথি"), c("nationality", "Nat."), c("company", "Company"), c("arrival", "Arrival", "date"), c("departure", "Departure", "date"), c("pax", "Pax", "number"), c("rate", "Rate (tonight)", "money"), c("balance", "Balance", "money", "বকেয়া")],
        rows: rows.map((s) => {
          const g = s.guest ?? s.reservation.guest;
          const nightly = parseJson<{ date: string; amount: number }[]>(s.nightlyRates, []);
          return { room: s.room?.number ?? "", type: s.roomType.code, guest: g.fullName, nationality: g.nationality, company: s.reservation.company?.name ?? "", arrival: s.arrivalDate, departure: s.departureDate, pax: s.adults + s.children, rate: nightly.find((n) => n.date === p.businessDate)?.amount ?? nightly.at(-1)?.amount ?? 0, balance: s.folios.filter((f) => !f.cityLedger).reduce((a, f) => a + folioBalance(f.charges, f.payments).balance, 0) };
        }),
      };
    },
  },
  {
    id: "source",
    title: "Reservations by source",
    titleBn: "উৎস অনুযায়ী বুকিং",
    group: "revenue",
    perm: "reports.view",
    range: true,
    async run(db, p) {
      const res = await db.reservation.findMany({ where: { createdAt: { gte: new Date(p.from + "T00:00:00+06:00"), lt: new Date(addDays(p.to, 1) + "T00:00:00+06:00") } }, include: { rooms: true } });
      const m = new Map<string, { source: string; bookings: number; cancelled: number; roomNights: number; revenue: number }>();
      for (const r of res) {
        const x = m.get(r.source) ?? { source: r.source, bookings: 0, cancelled: 0, roomNights: 0, revenue: 0 };
        x.bookings++;
        if (["CANCELLED", "NO_SHOW"].includes(r.status)) x.cancelled++;
        for (const s of r.rooms.filter((s) => !["CANCELLED", "NO_SHOW", "WAITLIST"].includes(s.status))) {
          x.roomNights += nightsBetween(s.arrivalDate, s.departureDate);
          x.revenue += parseJson<{ amount: number }[]>(s.nightlyRates, []).reduce((a, n) => a + n.amount, 0);
        }
        m.set(r.source, x);
      }
      const rows = [...m.values()].sort((a, b) => b.revenue - a.revenue);
      return { title: "Reservations by source (booked in period)", subtitle: `${p.from} – ${p.to}`, columns: [c("source", "Source", "text", "উৎস"), c("bookings", "Bookings", "number"), c("cancelled", "Cancelled / no-show", "number"), c("roomNights", "Room nights", "number"), c("revenue", "Room revenue (booked)", "money")], rows, totals: { source: "Total", bookings: sum(rows, "bookings"), cancelled: sum(rows, "cancelled"), roomNights: sum(rows, "roomNights"), revenue: sum(rows, "revenue") } };
    },
  },
  {
    id: "roomtype",
    title: "Room type performance",
    titleBn: "রুম টাইপ পারফরম্যান্স",
    group: "revenue",
    perm: "reports.financial",
    range: true,
    async run(db, p) {
      const types = await db.roomType.findMany({ include: { _count: { select: { rooms: { where: { active: true } } } } }, orderBy: { sortOrder: "asc" } });
      const stays = await db.reservationRoom.findMany({ where: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, arrivalDate: { lte: p.to }, departureDate: { gt: p.from } }, select: { id: true, roomTypeId: true, arrivalDate: true, departureDate: true, room: { select: { roomTypeId: true } } } });
      const charges = await db.folioCharge.findMany({ where: { category: "ROOM", businessDate: { gte: p.from, lte: p.to }, voidedAt: null, reservationRoomId: { not: null } }, select: { amount: true, reservationRoomId: true } });
      const stayType = new Map(stays.map((s) => [s.id, s.room?.roomTypeId ?? s.roomTypeId]));
      const days = eachDay(p.from, p.to).length;
      const rows = types.map((t) => {
        const sold = stays.filter((s) => (s.room?.roomTypeId ?? s.roomTypeId) === t.id).reduce((a, s) => a + eachDay(s.arrivalDate > p.from ? s.arrivalDate : p.from, addDays(s.departureDate < addDays(p.to, 1) ? s.departureDate : addDays(p.to, 1), -1)).length, 0);
        const revenue = charges.filter((ch) => stayType.get(ch.reservationRoomId!) === t.id).reduce((a, ch) => a + ch.amount, 0);
        const avail = t._count.rooms * days;
        return { type: `${t.code} – ${t.name}`, rooms: t._count.rooms, available: avail, sold, occupancy: avail ? Math.round((sold * 10000) / avail) : 0, revenue, adr: sold ? Math.round(revenue / sold) : 0 };
      });
      return { title: "Room type performance", subtitle: `${p.from} – ${p.to}`, columns: [c("type", "Room type", "text", "রুম টাইপ"), c("rooms", "Rooms", "number"), c("available", "Room nights avail.", "number"), c("sold", "Sold", "number"), c("occupancy", "Occ. %", "percent"), c("revenue", "Room revenue", "money"), c("adr", "ADR", "money")], rows, totals: { type: "Total", rooms: sum(rows, "rooms"), available: sum(rows, "available"), sold: sum(rows, "sold"), revenue: sum(rows, "revenue") } };
    },
  },
  {
    id: "cancellations",
    title: "Cancellations & no-shows",
    titleBn: "বাতিল ও নো-শো",
    group: "front",
    perm: "reports.view",
    range: true,
    async run(db, p) {
      const res = await db.reservation.findMany({ where: { status: { in: ["CANCELLED", "NO_SHOW"] }, arrivalDate: { gte: p.from, lte: p.to } }, include: { guest: true }, orderBy: { arrivalDate: "asc" } });
      return { title: "Cancellations & no-shows (by arrival date)", subtitle: `${p.from} – ${p.to}`, columns: [c("arrival", "Arrival", "date"), c("conf", "Conf. no"), c("guest", "Guest"), c("status", "Status"), c("source", "Source"), c("reason", "Reason"), c("fee", "Fee charged", "money")], rows: res.map((r) => ({ arrival: r.arrivalDate, conf: r.confirmationNo, guest: r.guest.fullName, status: r.status, source: r.source, reason: r.cancelReason, fee: r.cancellationFee })), totals: { arrival: "Total", fee: res.reduce((a, r) => a + r.cancellationFee, 0) } };
    },
  },
  {
    id: "aging",
    title: "City ledger aging",
    titleBn: "সিটি লেজার এজিং",
    group: "finance",
    perm: "ledger.view",
    range: false,
    async run(db, p) {
      const folios = await db.folio.findMany({ where: { cityLedger: true, status: { not: "CLOSED" } }, include: { charges: true, payments: true, company: true } });
      const m = new Map<string, Record<string, number | string>>();
      for (const f of folios) {
        const bal = folioBalance(f.charges, f.payments).balance;
        if (!bal) continue;
        const k = f.company?.name ?? "—";
        const row = m.get(k) ?? { company: k, CURRENT: 0, D1_30: 0, D31_60: 0, D61_90: 0, D90_PLUS: 0, total: 0, limit: f.company?.creditLimit ?? 0 };
        const b = agingBucket(f.dueDate || p.businessDate, p.businessDate);
        row[b] = (row[b] as number) + bal;
        row.total = (row.total as number) + bal;
        m.set(k, row);
      }
      const rows = [...m.values()].sort((a, b) => (b.total as number) - (a.total as number));
      return { title: "City ledger aging", subtitle: `as of ${p.businessDate}`, columns: [c("company", "Company", "text", "প্রতিষ্ঠান"), c("CURRENT", "Not due", "money"), c("D1_30", "1–30 days", "money"), c("D31_60", "31–60", "money"), c("D61_90", "61–90", "money"), c("D90_PLUS", "90+", "money"), c("total", "Total", "money", "মোট"), c("limit", "Credit limit", "money")], rows, totals: { company: "Total", CURRENT: sum(rows, "CURRENT"), D1_30: sum(rows, "D1_30"), D31_60: sum(rows, "D31_60"), D61_90: sum(rows, "D61_90"), D90_PLUS: sum(rows, "D90_PLUS"), total: sum(rows, "total") } };
    },
  },
  {
    id: "police",
    title: "Foreign guest report (police / SB)",
    titleBn: "বিদেশি অতিথি রিপোর্ট (পুলিশ / এসবি)",
    group: "guests",
    perm: "frontdesk.police_export",
    range: true,
    async run(db, p) {
      const { policeReportRows } = await import("../routes/frontdesk");
      const rows = await policeReportRows(db, p.from, p.to);
      return { title: "Foreign guest report", subtitle: `${p.from} – ${p.to}`, columns: [c("guestName", "Name"), c("nationality", "Nationality"), c("passportNumber", "Passport no"), c("passportExpiry", "Passport expiry", "date"), c("visaNumber", "Visa no"), c("visaType", "Visa type"), c("visaExpiry", "Visa expiry", "date"), c("dateOfBirth", "Date of birth", "date"), c("occupation", "Occupation"), c("arrivalFrom", "Arrived from"), c("arrivalDateBd", "Arrival in BD", "date"), c("portOfEntry", "Port of entry"), c("purposeOfVisit", "Purpose"), c("room", "Room"), c("checkIn", "Check-in", "date"), c("checkOut", "Check-out", "date")], rows };
    },
  },
  {
    id: "guests",
    title: "Guest list",
    titleBn: "অতিথি তালিকা",
    group: "guests",
    perm: "guests.view",
    range: false,
    async run(db) {
      const rows = await db.guest.findMany({ where: { deletedAt: null }, orderBy: { fullName: "asc" }, include: { company: true } });
      return { title: "Guest list", subtitle: "", columns: [c("code", "Code"), c("name", "Name"), c("phone", "Phone"), c("email", "Email"), c("nationality", "Nat."), c("company", "Company"), c("vip", "VIP", "number"), c("stays", "Stays", "number"), c("nights", "Nights", "number"), c("spend", "Spend", "money"), c("last", "Last stay", "date")], rows: rows.map((g) => ({ code: g.code, name: g.fullName, phone: g.phone, email: g.email, nationality: g.nationality, company: g.company?.name ?? "", vip: g.vip, stays: g.totalStays, nights: g.totalNights, spend: g.totalSpend, last: g.lastStayAt })) };
    },
  },
  {
    id: "housekeeping",
    title: "Housekeeping productivity",
    titleBn: "হাউসকিপিং কর্মদক্ষতা",
    group: "operations",
    perm: "reports.view",
    range: true,
    async run(db, p) {
      const tasks = await db.housekeepingTask.findMany({ where: { businessDate: { gte: p.from, lte: p.to }, status: { in: ["DONE", "INSPECTED"] } }, include: { assignedTo: { select: { fullName: true } } } });
      const m = new Map<string, { staff: string; tasks: number; checkout: number; stayover: number; minutes: number; inspected: number }>();
      for (const t of tasks) {
        const k = t.assignedTo?.fullName ?? "(unassigned)";
        const x = m.get(k) ?? { staff: k, tasks: 0, checkout: 0, stayover: 0, minutes: 0, inspected: 0 };
        x.tasks++;
        if (t.type === "CHECKOUT_CLEAN") x.checkout++;
        if (t.type === "STAYOVER") x.stayover++;
        if (t.status === "INSPECTED") x.inspected++;
        x.minutes += t.minutes;
        m.set(k, x);
      }
      const rows = [...m.values()].map((x) => ({ ...x, avg: x.tasks ? Math.round(x.minutes / x.tasks) : 0 }));
      return { title: "Housekeeping productivity", subtitle: `${p.from} – ${p.to}`, columns: [c("staff", "Staff"), c("tasks", "Tasks done", "number"), c("checkout", "Departure cleans", "number"), c("stayover", "Stayovers", "number"), c("inspected", "Inspected", "number"), c("avg", "Avg minutes", "number")], rows };
    },
  },
  {
    id: "maintenance",
    title: "Maintenance SLA",
    titleBn: "রক্ষণাবেক্ষণ এসএলএ",
    group: "operations",
    perm: "reports.view",
    range: true,
    async run(db, p) {
      const rows = await db.maintenanceTicket.findMany({ where: { createdAt: { gte: new Date(p.from + "T00:00:00+06:00"), lt: new Date(addDays(p.to, 1) + "T00:00:00+06:00") } }, include: { room: true, assignedTo: true }, orderBy: { createdAt: "asc" } });
      const out = rows.map((t) => {
        const end = t.resolvedAt ?? t.closedAt;
        const met = end ? end <= t.slaDueAt : t.slaDueAt.getTime() > Date.now();
        return { number: t.number, created: t.createdAt, title: t.title, room: t.room?.number ?? t.area, category: t.category, priority: t.priority, status: t.status, assigned: t.assignedTo?.fullName ?? "", hours: end ? Math.round((end.getTime() - t.createdAt.getTime()) / 360_000) / 10 : null, sla: met ? "Met" : "Breached" };
      });
      const met = out.filter((x) => x.sla === "Met").length;
      return { title: "Maintenance SLA", subtitle: `${p.from} – ${p.to}`, columns: [c("number", "Ticket"), c("created", "Created", "datetime"), c("title", "Title"), c("room", "Room / area"), c("category", "Category"), c("priority", "Priority"), c("status", "Status"), c("assigned", "Assigned"), c("hours", "Hours to resolve", "number"), c("sla", "SLA")], rows: out, summary: [{ label: "SLA met", value: out.length ? `${Math.round((met * 100) / out.length)}%` : "—" }] };
    },
  },
  {
    id: "audit-trail",
    title: "Audit trail",
    titleBn: "অডিট ট্রেইল",
    group: "operations",
    perm: "audit.view",
    range: true,
    async run(db, p) {
      const rows = await db.auditLog.findMany({ where: { at: { gte: new Date(p.from + "T00:00:00+06:00"), lt: new Date(addDays(p.to, 1) + "T00:00:00+06:00") } }, orderBy: { at: "desc" }, take: 20000 });
      return { title: "Audit trail", subtitle: `${p.from} – ${p.to}`, columns: [c("at", "Time", "datetime"), c("user", "User"), c("action", "Action"), c("entity", "Entity"), c("entityId", "ID"), c("reason", "Reason"), c("ip", "IP / terminal"), c("before", "Before"), c("after", "After")], rows: rows.map((r) => ({ at: r.at, user: r.username, action: r.action, entity: r.entity, entityId: r.entityId, reason: r.reason, ip: [r.ip, r.terminalId].filter(Boolean).join(" / "), before: r.before ?? "", after: r.after ?? "" })) };
    },
  },
];

export const reportById = (id: string) => REPORTS.find((r) => r.id === id);
