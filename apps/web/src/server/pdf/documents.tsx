// PDF documents: reports (A4 portrait/landscape), invoices (A4 standard / Mushak-style, and 80 mm thermal),
// guest registration card, booking confirmation, payment receipt (80 mm).
import React from "react";
import QRCode from "qrcode";
import { Document, Page, Text, View, Image, renderToBuffer } from "@react-pdf/renderer";
import { formatDate, nightsBetween } from "@petra/core";
import type { ReportResult } from "../services/reports";
import type { InvoiceSnapshot } from "../services/invoice";
import { displayValue } from "../services/export";
import { BORDER, Field, Footer, HotelHeader, INK, MUTED, RED, money, registerFonts, s, type HotelInfo, type Locale } from "./common";

const THERMAL_WIDTH = 226; // 80 mm in points

function colFlex(type: string) {
  return type === "text" ? 2 : type === "datetime" ? 1.6 : 1;
}

export function ReportPdf({ r, hotel, generatedBy, l }: { r: ReportResult; hotel: HotelInfo; generatedBy: string; l: Locale }) {
  const landscape = r.columns.length > 7;
  const typeOf = (c: ReportResult["columns"][number], row: Record<string, unknown>) => (row._type && c.type === "number" ? (row._type as typeof c.type) : c.type);
  const cell = (row: Record<string, unknown>, c: ReportResult["columns"][number]) => {
    const t = typeOf(c, row);
    const v = displayValue(row[c.key], t, { grouping: l.grouping, banglaDigits: l.bn });
    return v.length > 160 ? v.slice(0, 157) + "…" : v;
  };
  return (
    <Document title={r.title} author="PetraPMS">
      <Page size="A4" orientation={landscape ? "landscape" : "portrait"} style={s.page}>
        <HotelHeader hotel={hotel} title={r.title} right={<Text style={s.muted}>{r.subtitle}</Text>} />
        <View style={s.row} fixed>
          {r.columns.map((c) => (
            <Text key={c.key} style={{ ...s.th, flex: colFlex(c.type), textAlign: ["money", "number", "percent"].includes(c.type) ? "right" : "left" }}>
              {l.bn && c.labelBn ? c.labelBn : c.label}
            </Text>
          ))}
        </View>
        {r.rows.map((row, i) => (
          <View key={i} style={{ ...s.row, backgroundColor: i % 2 ? "#FBF8F2" : "#FFFFFF" }} wrap={false}>
            {r.columns.map((c) => (
              <Text key={c.key} style={{ ...s.td, flex: colFlex(c.type), textAlign: ["money", "number", "percent"].includes(typeOf(c, row)) ? "right" : "left" }}>
                {cell(row, c)}
              </Text>
            ))}
          </View>
        ))}
        {!r.rows.length ? <Text style={{ ...s.muted, padding: 10, textAlign: "center" }}>No data for this period.</Text> : null}
        {r.totals ? (
          <View style={{ ...s.row, borderTopWidth: 1, borderTopColor: "#111111" }} wrap={false}>
            {r.columns.map((c) => (
              <Text key={c.key} style={{ ...s.td, ...s.bold, flex: colFlex(c.type), textAlign: ["money", "number", "percent"].includes(c.type) ? "right" : "left" }}>
                {cell(r.totals!, c)}
              </Text>
            ))}
          </View>
        ) : null}
        {r.summary?.length ? (
          <View style={{ marginTop: 10, flexDirection: "row", flexWrap: "wrap" }}>
            {r.summary.map((x, i) => (
              <View key={i} style={{ width: "33%", flexDirection: "row", justifyContent: "space-between", paddingRight: 10, paddingVertical: 2, borderBottomWidth: 0.5, borderBottomColor: BORDER }}>
                <Text style={s.muted}>{x.label}</Text>
                <Text style={s.bold}>{x.type ? displayValue(x.value, x.type, { grouping: l.grouping, banglaDigits: l.bn }) : String(x.value)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <Footer left={`Generated ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Dhaka" })} by ${generatedBy} · PetraPMS`} />
      </Page>
    </Document>
  );
}

async function qrDataUrl(text: string) {
  return QRCode.toDataURL(text, { margin: 0, width: 160, errorCorrectionLevel: "M" });
}

export function InvoicePdf({ inv, qr, l }: { inv: InvoiceSnapshot & { voidedAt?: Date | null; voidReason?: string }; qr: string | null; l: Locale }) {
  const mushak = inv.layout === "MUSHAK";
  const title = inv.number ? (mushak ? "TAX INVOICE (Mushak-6.3)" : "INVOICE") : "PRO-FORMA INVOICE";
  return (
    <Document title={`${title} ${inv.number ?? ""}`} author="PetraPMS">
      <Page size="A4" style={s.page}>
        <HotelHeader
          hotel={inv.hotel}
          title={title}
          right={
            <View style={{ alignItems: "flex-end" }}>
              <Text style={s.bold}>{inv.number ?? "—"}</Text>
              <Text style={s.muted}>Date: {formatDate(inv.businessDate || inv.issuedAt.slice(0, 10), "DD MMM YYYY")}</Text>
              <Text style={s.muted}>Folio: {inv.folio.number}</Text>
            </View>
          }
        />
        {inv.voidedAt ? <Text style={{ color: RED, fontSize: 16, fontWeight: 700, textAlign: "center", marginBottom: 6 }}>VOID — {inv.voidReason}</Text> : null}
        <View style={{ ...s.row, marginBottom: 8 }}>
          <View style={{ ...s.box, flex: 1, marginRight: 6 }}>
            <Text style={s.label}>{mushak ? "Buyer (name, address, BIN)" : "Bill to"}</Text>
            <Text style={s.bold}>{inv.billTo.name}</Text>
            {inv.billTo.address ? <Text>{inv.billTo.address}</Text> : null}
            {inv.billTo.bin ? <Text>BIN: {inv.billTo.bin}</Text> : null}
            {inv.billTo.phone ? <Text style={s.muted}>{inv.billTo.phone}</Text> : null}
          </View>
          {inv.stay ? (
            <View style={{ ...s.box, flex: 1 }}>
              <Text style={s.label}>Stay</Text>
              <Text>
                Room {inv.stay.room} · Conf. {inv.stay.confirmationNo}
              </Text>
              <Text>
                {formatDate(inv.stay.arrival, "DD MMM YYYY")} – {formatDate(inv.stay.departure, "DD MMM YYYY")} ({nightsBetween(inv.stay.arrival, inv.stay.departure)} night(s))
              </Text>
              <Text style={s.muted}>
                Guests: {inv.stay.adults} adult(s){inv.stay.children ? `, ${inv.stay.children} child(ren)` : ""}
              </Text>
            </View>
          ) : null}
        </View>
        <View style={s.row} fixed>
          <Text style={{ ...s.th, width: 52 }}>Date</Text>
          <Text style={{ ...s.th, flex: 3 }}>Description</Text>
          <Text style={{ ...s.th, width: 26, textAlign: "right" }}>Qty</Text>
          <Text style={{ ...s.th, width: 62, textAlign: "right" }}>Net</Text>
          <Text style={{ ...s.th, width: 52, textAlign: "right" }}>SC</Text>
          <Text style={{ ...s.th, width: 52, textAlign: "right" }}>VAT</Text>
          <Text style={{ ...s.th, width: 66, textAlign: "right" }}>Total</Text>
        </View>
        {inv.lines.map((x, i) => (
          <View key={i} style={s.row} wrap={false}>
            <Text style={{ ...s.td, width: 52 }}>{formatDate(x.date, "DD MMM")}</Text>
            <Text style={{ ...s.td, flex: 3 }}>{x.description}</Text>
            <Text style={{ ...s.td, width: 26, textAlign: "right" }}>{x.quantity}</Text>
            <Text style={{ ...s.td, width: 62, textAlign: "right" }}>{money(x.net, l)}</Text>
            <Text style={{ ...s.td, width: 52, textAlign: "right" }}>{money(x.serviceCharge, l)}</Text>
            <Text style={{ ...s.td, width: 52, textAlign: "right" }}>{money(x.vat, l)}</Text>
            <Text style={{ ...s.td, width: 66, textAlign: "right" }}>{money(x.total, l)}</Text>
          </View>
        ))}
        <View style={{ ...s.row, marginTop: 8 }} wrap={false}>
          <View style={{ flex: 1, paddingRight: 10 }}>
            {inv.taxes.map((t) => (
              <Text key={t.code + t.rateBp} style={s.muted}>
                {t.name} @ {(t.rateBp / 100).toFixed(t.rateBp % 100 ? 2 : 0)}%: {money(t.amount, l, true)}
              </Text>
            ))}
            <Text style={{ marginTop: 4 }}>In words: {inv.amountInWords}</Text>
            {inv.taxMode === "INCLUSIVE" ? <Text style={s.muted}>Prices include VAT and service charge.</Text> : null}
            {qr && inv.showQr ? <Image src={qr} style={{ width: 70, height: 70, marginTop: 8 }} /> : null}
          </View>
          <View style={{ width: 220 }}>
            {[
              ["Subtotal (net)", inv.totals.net],
              ["Service charge", inv.totals.serviceCharge],
              ["VAT", inv.totals.vat],
              ...(inv.totals.otherTax ? [["Other tax", inv.totals.otherTax] as [string, number]] : []),
            ].map(([k, v]) => (
              <View key={k as string} style={{ ...s.row, justifyContent: "space-between", paddingVertical: 1.5 }}>
                <Text>{k}</Text>
                <Text>{money(v as number, l, true)}</Text>
              </View>
            ))}
            <View style={{ ...s.row, justifyContent: "space-between", borderTopWidth: 1, paddingTop: 3, marginTop: 2 }}>
              <Text style={s.bold}>Total</Text>
              <Text style={s.bold}>{money(inv.totals.total, l, true)}</Text>
            </View>
            <View style={{ ...s.row, justifyContent: "space-between", paddingVertical: 1.5 }}>
              <Text>Paid</Text>
              <Text>{money(inv.totals.paid, l, true)}</Text>
            </View>
            <View style={{ ...s.row, justifyContent: "space-between", paddingVertical: 2, backgroundColor: "#F6F1E7" }}>
              <Text style={s.bold}>{inv.totals.balance >= 0 ? "Balance due" : "Credit"}</Text>
              <Text style={{ ...s.bold, color: inv.totals.balance > 0 ? RED : "#111111" }}>{money(Math.abs(inv.totals.balance), l, true)}</Text>
            </View>
            {inv.hotel.showUsd && inv.hotel.usdRate > 0 ? <Text style={{ ...s.muted, textAlign: "right", marginTop: 2 }}>~ USD {(inv.totals.total / inv.hotel.usdRate).toFixed(2)} @ {(inv.hotel.usdRate / 100).toFixed(2)}</Text> : null}
          </View>
        </View>
        {inv.payments.length ? (
          <View style={{ marginTop: 10 }} wrap={false}>
            <Text style={s.h2}>Payments</Text>
            {inv.payments.map((p, i) => (
              <View key={i} style={{ ...s.row, justifyContent: "space-between" }}>
                <Text>
                  {formatDate(p.date, "DD MMM")} · {p.method} {p.type !== "PAYMENT" ? `(${p.type.toLowerCase()})` : ""} · {p.receiptNo} {p.reference ? `· ${p.reference}` : ""}
                </Text>
                <Text>{money(p.amount, l, true)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        <View style={{ ...s.row, marginTop: 30, justifyContent: "space-between" }} wrap={false}>
          <View style={{ width: 180, borderTopWidth: 0.75, paddingTop: 3 }}>
            <Text style={s.muted}>Guest signature</Text>
          </View>
          <View style={{ width: 180, borderTopWidth: 0.75, paddingTop: 3 }}>
            <Text style={s.muted}>{mushak ? "Authorised person (name, designation, signature)" : "Cashier"}</Text>
          </View>
        </View>
        <Text style={{ ...s.muted, marginTop: 10, textAlign: "center" }}>{inv.footer}</Text>
        <Footer left={`${inv.hotel.name} · ${inv.number ?? "Pro-forma"}`} />
      </Page>
    </Document>
  );
}

/**
 * Page height for an 80 mm roll. The height is estimated from the content (wrapped text counts per line, with a safety margin)
 * so a long guest/hotel name or item description can never spill onto a second page and cut the receipt in two.
 */
export function thermalHeight(texts: string[], fixedRows: number, extra = 0): number {
  const perLine = 34; // conservative: Bangla glyphs are wider than Latin ones
  const rows = texts.reduce((n, t) => n + Math.max(1, Math.ceil((t ?? "").length / perLine)), 0) + fixedRows;
  return Math.ceil((24 + rows * 10.5 + extra) * 1.06);
}

/** 80 mm thermal invoice / receipt: single column, auto height. */
export function ThermalPdf({ inv, qr, l }: { inv: InvoiceSnapshot; qr: string | null; l: Locale }) {
  const height = thermalHeight(
    [inv.hotel.name, [inv.hotel.address, inv.hotel.city].filter(Boolean).join(", "), inv.hotel.phone ?? "", inv.hotel.bin ?? "", inv.billTo.name, inv.stay ? inv.stay.room + " 00 XXX–00 XXX" : "", inv.footer ?? "", ...inv.lines.map((x) => x.description)],
    13 + inv.lines.length + inv.payments.length,
    36 + (qr && inv.showQr ? 90 : 0),
  );
  const line = (a: string, b: string, bold = false) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
      <Text style={bold ? s.bold : {}}>{a}</Text>
      <Text style={bold ? s.bold : {}}>{b}</Text>
    </View>
  );
  return (
    <Document title={inv.number ?? "Pro-forma"}>
      <Page size={[THERMAL_WIDTH, height]} style={{ ...s.page, padding: 10, fontSize: 7.5 }}>
        <Text style={{ ...s.bold, fontSize: 10, textAlign: "center" }}>{inv.hotel.name}</Text>
        <Text style={{ ...s.center, color: MUTED }}>{[inv.hotel.address, inv.hotel.city].filter(Boolean).join(", ")}</Text>
        {inv.hotel.phone ? <Text style={{ ...s.center, color: MUTED }}>{inv.hotel.phone}</Text> : null}
        {inv.hotel.bin ? <Text style={{ ...s.center, color: MUTED }}>BIN {inv.hotel.bin}</Text> : null}
        <View style={s.rule} />
        {line(inv.number ? "INVOICE" : "PRO-FORMA", inv.number ?? "")}
        {line("Date", formatDate(inv.businessDate || inv.issuedAt.slice(0, 10), "DD MMM YYYY"))}
        {line("Guest", inv.billTo.name)}
        {inv.stay ? line("Room", `${inv.stay.room} (${formatDate(inv.stay.arrival, "DD MMM")}–${formatDate(inv.stay.departure, "DD MMM")})`) : null}
        <View style={s.rule} />
        {inv.lines.map((x, i) => (
          <View key={i} style={{ marginBottom: 2 }}>
            <Text>{x.description}</Text>
            {line(`  ${x.quantity} × ${money(x.unitAmount, l)}`, money(x.total, l))}
          </View>
        ))}
        <View style={s.rule} />
        {line("Net", money(inv.totals.net, l))}
        {line("Service charge", money(inv.totals.serviceCharge, l))}
        {line("VAT", money(inv.totals.vat, l))}
        {line("TOTAL", money(inv.totals.total, l, true), true)}
        {inv.payments.map((p, i) => (
          <View key={i}>{line(`${p.method} ${p.receiptNo}`, money(p.amount, l))}</View>
        ))}
        {line(inv.totals.balance >= 0 ? "BALANCE" : "CREDIT", money(Math.abs(inv.totals.balance), l, true), true)}
        {qr && inv.showQr ? <Image src={qr} style={{ width: 70, height: 70, alignSelf: "center", marginTop: 8 }} /> : null}
        <Text style={{ ...s.center, marginTop: 6, color: MUTED }}>{inv.footer}</Text>
      </Page>
    </Document>
  );
}

export interface RegCardData {
  hotel: HotelInfo;
  confirmationNo: string;
  room: string;
  roomType: string;
  arrival: string;
  departure: string;
  adults: number;
  children: number;
  rate: number;
  ratePlan: string;
  guest: Record<string, string>;
  company: string;
  terms: string;
  checkInTime: string;
  checkOutTime: string;
}

export function RegistrationCardPdf({ d, l }: { d: RegCardData; l: Locale }) {
  const g = d.guest;
  const foreign = g.nationality && g.nationality !== "BD";
  return (
    <Document title={`Registration card ${d.confirmationNo}`}>
      <Page size="A4" style={s.page}>
        <HotelHeader hotel={d.hotel} title="GUEST REGISTRATION CARD" right={<Text style={s.muted}>অতিথি নিবন্ধন কার্ড</Text>} />
        <View style={{ ...s.row, flexWrap: "wrap" }}>
          <Field label="Confirmation no" value={d.confirmationNo} width="25%" />
          <Field label="Room / type" value={`${d.room} · ${d.roomType}`} width="25%" />
          <Field label="Arrival" value={formatDate(d.arrival, "DD MMM YYYY")} width="25%" />
          <Field label="Departure" value={formatDate(d.departure, "DD MMM YYYY")} width="25%" />
          <Field label="Adults / children" value={`${d.adults} / ${d.children}`} width="25%" />
          <Field label="Rate plan" value={d.ratePlan} width="25%" />
          <Field label="Room rate (per night, excl. taxes)" value={money(d.rate, l, true)} width="25%" />
          <Field label="Company" value={d.company} width="25%" />
        </View>
        <Text style={{ ...s.h2, marginTop: 6 }}>Guest details / অতিথির তথ্য</Text>
        <View style={{ ...s.row, flexWrap: "wrap" }}>
          <Field label="Full name / পূর্ণ নাম" value={g.fullName} width="50%" />
          <Field label="Phone / ফোন" value={g.phone} width="25%" />
          <Field label="Email" value={g.email} width="25%" />
          <Field label="Nationality / জাতীয়তা" value={g.nationality} width="25%" />
          <Field label="Date of birth / জন্ম তারিখ" value={g.dateOfBirth} width="25%" />
          <Field label="Gender / লিঙ্গ" value={g.gender} width="25%" />
          <Field label="Occupation / পেশা" value={g.occupation} width="25%" />
          <Field label="ID type / পরিচয়পত্রের ধরন" value={g.idType} width="25%" />
          <Field label="ID number / পরিচয়পত্র নম্বর" value={g.idNumber} width="25%" />
          <Field label="Address / ঠিকানা" value={[g.address, g.city].filter(Boolean).join(", ")} width="50%" />
          <Field label="Arriving from / কোথা থেকে" value={g.arrivalFrom} width="25%" />
          <Field label="Going to / গন্তব্য" value="" width="25%" />
          <Field label="Purpose of visit / আগমনের উদ্দেশ্য" value={g.purposeOfVisit} width="50%" />
        </View>
        {foreign ? (
          <>
            <Text style={{ ...s.h2, marginTop: 6 }}>Foreign national (for police / SB report)</Text>
            <View style={{ ...s.row, flexWrap: "wrap" }}>
              <Field label="Passport no" value={g.passportNumber} width="25%" />
              <Field label="Passport expiry" value={g.passportExpiry} width="25%" />
              <Field label="Place of issue" value={g.passportIssuedAt} width="25%" />
              <Field label="Visa no / type" value={[g.visaNumber, g.visaType].filter(Boolean).join(" / ")} width="25%" />
              <Field label="Visa expiry" value={g.visaExpiry} width="25%" />
              <Field label="Arrival in Bangladesh" value={g.arrivalDateBd} width="25%" />
              <Field label="Port of entry" value={g.portOfEntry} width="50%" />
            </View>
          </>
        ) : null}
        <View style={{ ...s.row, marginTop: 8 }}>
          {g.idImage ? <Image src={g.idImage} style={{ width: 180, height: 115, objectFit: "contain", borderWidth: 0.5, borderColor: BORDER, marginRight: 8 }} /> : null}
          {g.photo ? <Image src={g.photo} style={{ width: 90, height: 115, objectFit: "cover", borderWidth: 0.5, borderColor: BORDER }} /> : null}
        </View>
        <Text style={{ ...s.h2, marginTop: 8 }}>Terms / শর্তাবলী</Text>
        <Text style={{ ...s.small, lineHeight: 1.4 }}>
          {d.terms ||
            `Check-in ${d.checkInTime}, check-out ${d.checkOutTime}. Room rates are subject to applicable VAT and service charge. The guest is responsible for all charges incurred during the stay. The hotel is not responsible for valuables not deposited at the front desk. Smoking is not permitted in rooms. Visitors must register at the front desk. By signing, I confirm the information above is correct.`}
        </Text>
        <View style={{ ...s.row, marginTop: 34, justifyContent: "space-between" }}>
          <View style={{ width: 200, borderTopWidth: 0.75, paddingTop: 3 }}>
            <Text style={s.muted}>Guest signature / অতিথির স্বাক্ষর</Text>
          </View>
          <View style={{ width: 200, borderTopWidth: 0.75, paddingTop: 3 }}>
            <Text style={s.muted}>Front desk / ফ্রন্ট ডেস্ক</Text>
          </View>
        </View>
        <Footer left={`${d.hotel.name} · Registration card ${d.confirmationNo}`} />
      </Page>
    </Document>
  );
}

export interface ConfirmationData {
  hotel: HotelInfo & { checkInTime: string; checkOutTime: string };
  confirmationNo: string;
  status: string;
  guest: { fullName: string; phone: string; email: string };
  company: string;
  arrival: string;
  departure: string;
  rooms: { type: string; room: string; adults: number; children: number; nights: number; total: number; ratePlan: string }[];
  total: number;
  deposits: number;
  depositRequired: number;
  policy: string;
  specialRequests: string;
  createdAt: string;
}

export function ConfirmationPdf({ d, l }: { d: ConfirmationData; l: Locale }) {
  return (
    <Document title={`Booking ${d.confirmationNo}`}>
      <Page size="A4" style={s.page}>
        <HotelHeader hotel={d.hotel} title={d.status === "TENTATIVE" ? "PROVISIONAL BOOKING" : "BOOKING CONFIRMATION"} right={<Text style={s.bold}>{d.confirmationNo}</Text>} />
        <Text style={{ marginBottom: 8 }}>Dear {d.guest.fullName}, thank you for choosing {d.hotel.name}. We are pleased to {d.status === "TENTATIVE" ? "hold" : "confirm"} your reservation:</Text>
        <View style={{ ...s.row, flexWrap: "wrap" }}>
          <Field label="Arrival" value={`${formatDate(d.arrival, "DD MMM YYYY")} (check-in from ${d.hotel.checkInTime})`} />
          <Field label="Departure" value={`${formatDate(d.departure, "DD MMM YYYY")} (check-out by ${d.hotel.checkOutTime})`} />
          <Field label="Guest" value={[d.guest.fullName, d.guest.phone, d.guest.email].filter(Boolean).join(" · ")} />
          <Field label="Company" value={d.company} />
        </View>
        <View style={{ ...s.row, marginTop: 6 }}>
          {["Room type", "Room", "Guests", "Nights", "Rate plan", "Amount"].map((h, i) => (
            <Text key={h} style={{ ...s.th, flex: i === 0 || i === 4 ? 2 : 1, textAlign: i >= 3 && i !== 4 ? "right" : "left" }}>
              {h}
            </Text>
          ))}
        </View>
        {d.rooms.map((r, i) => (
          <View key={i} style={s.row}>
            <Text style={{ ...s.td, flex: 2 }}>{r.type}</Text>
            <Text style={{ ...s.td, flex: 1 }}>{r.room || "—"}</Text>
            <Text style={{ ...s.td, flex: 1 }}>
              {r.adults}A{r.children ? ` ${r.children}C` : ""}
            </Text>
            <Text style={{ ...s.td, flex: 1, textAlign: "right" }}>{r.nights}</Text>
            <Text style={{ ...s.td, flex: 2 }}>{r.ratePlan}</Text>
            <Text style={{ ...s.td, flex: 1, textAlign: "right" }}>{money(r.total, l)}</Text>
          </View>
        ))}
        <View style={{ alignSelf: "flex-end", width: 230, marginTop: 6 }}>
          <View style={{ ...s.row, justifyContent: "space-between" }}>
            <Text style={s.bold}>Room total (excl. taxes)</Text>
            <Text style={s.bold}>{money(d.total, l, true)}</Text>
          </View>
          {d.deposits ? (
            <View style={{ ...s.row, justifyContent: "space-between" }}>
              <Text>Deposit received</Text>
              <Text>{money(d.deposits, l, true)}</Text>
            </View>
          ) : null}
          {d.depositRequired > d.deposits ? (
            <View style={{ ...s.row, justifyContent: "space-between" }}>
              <Text style={{ color: RED }}>Deposit required</Text>
              <Text style={{ color: RED }}>{money(d.depositRequired - d.deposits, l, true)}</Text>
            </View>
          ) : null}
        </View>
        {d.specialRequests ? (
          <>
            <Text style={{ ...s.h2, marginTop: 10 }}>Special requests</Text>
            <Text>{d.specialRequests}</Text>
          </>
        ) : null}
        <Text style={{ ...s.h2, marginTop: 10 }}>Cancellation policy</Text>
        <Text>{d.policy || "Please contact the hotel for the cancellation policy of this booking."}</Text>
        <Text style={{ ...s.muted, marginTop: 10 }}>Rates are subject to applicable VAT and service charge. Please bring a valid photo ID (NID / passport) at check-in.</Text>
        <Footer left={`${d.hotel.name} · ${d.confirmationNo} · issued ${formatDate(d.createdAt.slice(0, 10), "DD MMM YYYY")}`} />
      </Page>
    </Document>
  );
}

export interface ReceiptData {
  hotel: HotelInfo;
  receiptNo: string;
  date: string;
  type: string;
  method: string;
  reference: string;
  amount: number;
  folio: string;
  name: string;
  room: string;
  cashier: string;
  balance: number;
  amountInWords: string;
}

export function ReceiptPdf({ d, l }: { d: ReceiptData; l: Locale }) {
  const line = (a: string, b: string, bold = false) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 1 }}>
      <Text style={bold ? s.bold : {}}>{a}</Text>
      <Text style={bold ? s.bold : {}}>{b}</Text>
    </View>
  );
  return (
    <Document title={d.receiptNo}>
      <Page size={[THERMAL_WIDTH, thermalHeight([d.hotel.name, [d.hotel.address, d.hotel.city].filter(Boolean).join(", "), d.name, d.amountInWords, d.reference ?? "", d.cashier], 14, 60)]} style={{ ...s.page, padding: 10, fontSize: 7.5 }}>
        <Text style={{ ...s.bold, fontSize: 10, textAlign: "center" }}>{d.hotel.name}</Text>
        <Text style={{ ...s.center, color: MUTED }}>{[d.hotel.address, d.hotel.city].filter(Boolean).join(", ")}</Text>
        <View style={s.rule} />
        <Text style={{ ...s.bold, textAlign: "center", marginBottom: 4 }}>{d.type === "REFUND" ? "REFUND VOUCHER" : d.type === "DEPOSIT" ? "ADVANCE RECEIPT" : "MONEY RECEIPT"}</Text>
        {line("Receipt", d.receiptNo)}
        {line("Date", formatDate(d.date, "DD MMM YYYY"))}
        {line("Folio", d.folio)}
        {line("Name", d.name)}
        {d.room ? line("Room", d.room) : null}
        <View style={s.rule} />
        {line("Method", d.method)}
        {d.reference ? line("Reference", d.reference) : null}
        {line("AMOUNT", money(d.amount, l, true), true)}
        <Text style={{ marginTop: 3 }}>{d.amountInWords}</Text>
        <View style={s.rule} />
        {line("Folio balance", money(d.balance, l, true))}
        {line("Cashier", d.cashier)}
        <View style={{ marginTop: 26, borderTopWidth: 0.5, paddingTop: 2 }}>
          <Text style={s.muted}>Signature</Text>
        </View>
      </Page>
    </Document>
  );
}

// ── render helpers ───────────────────────────────────────────────────────────
export async function renderReportPdf(r: ReportResult, hotel: HotelInfo, generatedBy: string, l: Locale) {
  registerFonts();
  return renderToBuffer(<ReportPdf r={r} hotel={hotel} generatedBy={generatedBy} l={l} />);
}

export async function renderInvoicePdf(inv: InvoiceSnapshot & { voidedAt?: Date | null; voidReason?: string }, format: "A4" | "80mm", l: Locale) {
  registerFonts();
  const qr = inv.showQr ? await qrDataUrl(inv.qrText || `PROFORMA|${inv.folio.number}|${inv.totals.total}`) : null;
  return renderToBuffer(format === "80mm" ? <ThermalPdf inv={inv} qr={qr} l={l} /> : <InvoicePdf inv={inv} qr={qr} l={l} />);
}

export async function renderRegistrationCard(d: RegCardData, l: Locale) {
  registerFonts();
  return renderToBuffer(<RegistrationCardPdf d={d} l={l} />);
}

export async function renderConfirmation(d: ConfirmationData, l: Locale) {
  registerFonts();
  return renderToBuffer(<ConfirmationPdf d={d} l={l} />);
}

export async function renderReceipt(d: ReceiptData, l: Locale) {
  registerFonts();
  return renderToBuffer(<ReceiptPdf d={d} l={l} />);
}

/** Printer test page: proves paper size, margins, Latin + Bangla fonts and money formatting before real documents are printed. */
export function TestPagePdf({ hotel, format, printer, l, when }: { hotel: HotelInfo; format: "A4" | "80mm"; printer: string; l: Locale; when: string }) {
  const thermal = format === "80mm";
  const ruler = Array.from({ length: thermal ? 6 : 20 }, (_, i) => i);
  return (
    <Document title="PetraPMS printer test">
      <Page size={thermal ? [THERMAL_WIDTH, thermalHeight([hotel.name, printer, "বাংলা পরীক্ষা"], 22, 40)] : "A4"} style={{ ...s.page, padding: thermal ? 10 : 28, fontSize: thermal ? 7.5 : 9 }}>
        <View style={{ borderWidth: 1, borderColor: INK, padding: 6 }}>
          <Text style={{ ...s.bold, fontSize: thermal ? 10 : 14, textAlign: "center" }}>{hotel.name || "PetraPMS"}</Text>
          <Text style={{ ...s.center, color: MUTED }}>PetraPMS · Printer test page</Text>
          <View style={s.rule} />
          <Text>Paper: {thermal ? "80 mm thermal roll" : "A4"}</Text>
          <Text>Printer: {printer || "(system default)"}</Text>
          <Text>Printed: {when}</Text>
          <View style={s.rule} />
          <Text>ABCDEFGHIJKLMNOPQRSTUVWXYZ abcdefghijklmnopqrstuvwxyz 0123456789</Text>
          <Text>বাংলা পরীক্ষা: রুম ২০১, মোট {money(1250000, { ...l, bn: true }, true)}</Text>
          <Text>Total {money(1250000, { ...l, bn: false }, true)} · SC 10% · VAT 15%</Text>
          <View style={s.rule} />
          <Text style={s.muted}>Ruler (each tick = 1 cm). If the first and last ticks are cut off, set the printer margins to 0 / “actual size”.</Text>
          <View style={{ flexDirection: "row", marginTop: 4 }}>
            {ruler.map((i) => (
              <View key={i} style={{ width: 28.35, borderLeftWidth: 1, borderLeftColor: INK, height: 22 }}>
                <Text style={{ fontSize: 6, marginLeft: 2, marginTop: 10 }}>{i}</Text>
              </View>
            ))}
          </View>
        </View>
        <Text style={{ ...s.center, marginTop: 10, color: MUTED }}>— end of test —</Text>
      </Page>
    </Document>
  );
}

export async function renderTestPage(hotel: HotelInfo, format: "A4" | "80mm", printer: string, l: Locale) {
  registerFonts();
  return renderToBuffer(<TestPagePdf hotel={hotel} format={format} printer={printer} l={l} when={new Date().toISOString().slice(0, 16).replace("T", " ")} />);
}
