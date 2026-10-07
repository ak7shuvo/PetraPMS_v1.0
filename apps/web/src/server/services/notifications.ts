// Guest / staff notifications over pluggable providers (generic HTTP SMS gateway, HTTP email relay, WhatsApp
// HTTP API). Messages are queued in the Notification table inside the business transaction and delivered by the
// background scheduler with retries, so a down gateway never blocks a check-in.
import type { Db, Tx } from "../db";
import { getSection, type Settings } from "../settings";
import { formatDate, formatMoney } from "@petra/core";
import { log } from "../log";

export type Channel = "SMS" | "EMAIL" | "WHATSAPP";

export interface Template {
  subject: { en: string; bn: string };
  body: { en: string; bn: string };
}

/** Built-in EN/BN templates. Placeholders: {{name}}, {{hotel}}, {{conf}}, {{arrival}}, {{departure}}, {{amount}}, {{room}}, {{phone}} */
export const TEMPLATES: Record<string, Template> = {
  RESERVATION_CONFIRMED: {
    subject: { en: "Booking confirmed – {{conf}}", bn: "বুকিং নিশ্চিত – {{conf}}" },
    body: {
      en: "Dear {{name}}, your booking {{conf}} at {{hotel}} is confirmed for {{arrival}} to {{departure}}. Total {{amount}}. Call {{phone}} for help.",
      bn: "প্রিয় {{name}}, {{hotel}}-এ আপনার বুকিং {{conf}} নিশ্চিত হয়েছে ({{arrival}} থেকে {{departure}})। মোট {{amount}}। সহায়তার জন্য {{phone}}।",
    },
  },
  CHECKED_IN: {
    subject: { en: "Welcome to {{hotel}}", bn: "{{hotel}}-এ স্বাগতম" },
    body: { en: "Welcome {{name}}! You are in room {{room}}. Wishing you a pleasant stay at {{hotel}}.", bn: "স্বাগতম {{name}}! আপনার রুম {{room}}। {{hotel}}-এ আপনার অবস্থান আনন্দময় হোক।" },
  },
  CHECKED_OUT: {
    subject: { en: "Thank you for staying at {{hotel}}", bn: "{{hotel}}-এ থাকার জন্য ধন্যবাদ" },
    body: { en: "Thank you {{name}} for staying with us. We hope to welcome you again soon. – {{hotel}}", bn: "ধন্যবাদ {{name}}, আমাদের সাথে থাকার জন্য। আবার দেখা হবে। – {{hotel}}" },
  },
  LICENSE_EXPIRY: {
    subject: { en: "PetraPMS license expires in {{days}} day(s)", bn: "PetraPMS লাইসেন্সের মেয়াদ {{days}} দিন বাকি" },
    body: { en: "Your PetraPMS license for {{hotel}} expires on {{date}}. Please renew to avoid read-only mode.", bn: "{{hotel}}-এর PetraPMS লাইসেন্সের মেয়াদ {{date}} তারিখে শেষ হবে। রিড-অনলি মোড এড়াতে নবায়ন করুন।" },
  },
  TEST: { subject: { en: "PetraPMS test message", bn: "PetraPMS পরীক্ষামূলক বার্তা" }, body: { en: "This is a test message from {{hotel}}.", bn: "এটি {{hotel}} থেকে একটি পরীক্ষামূলক বার্তা।" } },
};

export function render(tpl: string, vars: Record<string, string>, json = false) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => {
    const v = vars[k] ?? "";
    return json ? JSON.stringify(v).slice(1, -1) : v;
  });
}

export async function queueNotification(db: Db | Tx, n: { channel: Channel; to: string; templateCode: string; locale: "en" | "bn"; vars: Record<string, string>; entity?: string; entityId?: string }) {
  const t = TEMPLATES[n.templateCode];
  if (!t || !n.to) return null;
  return db.notification.create({ data: { channel: n.channel, to: n.to, templateCode: n.templateCode, locale: n.locale, subject: render(t.subject[n.locale], n.vars), body: render(t.body[n.locale], n.vars), entity: n.entity ?? "", entityId: n.entityId ?? "" } });
}

/** Queues the configured channels for a reservation event (CONFIRMED / CHECKED_IN / CHECKED_OUT). */
export async function queueEventNotification(db: Db | Tx, event: "RESERVATION_CONFIRMED" | "CHECKED_IN" | "CHECKED_OUT", reservationId: string) {
  const s = await getSection(db, "notifications");
  const ev = s.events[event];
  if (!ev) return;
  const wants = { SMS: ev.sms && s.smsEnabled, EMAIL: ev.email && s.emailEnabled, WHATSAPP: ev.whatsapp && s.whatsappEnabled };
  if (!wants.SMS && !wants.EMAIL && !wants.WHATSAPP) return;
  const res = await db.reservation.findUnique({ where: { id: reservationId }, include: { guest: true, rooms: { include: { room: true } } } });
  if (!res || res.isDemo) return;
  const hotel = await db.hotel.findUnique({ where: { id: "hotel" } });
  const loc = await getSection(db, "locale");
  const total = res.rooms.filter((r) => !["CANCELLED", "NO_SHOW"].includes(r.status)).reduce((a, r) => a + (JSON.parse(r.nightlyRates) as { amount: number }[]).reduce((b, n) => b + n.amount, 0), 0);
  const locale = (loc.defaultLocale ?? "en") as "en" | "bn";
  const vars = {
    name: res.guest.fullName,
    hotel: hotel?.name ?? "",
    conf: res.confirmationNo,
    arrival: formatDate(res.arrivalDate, "DD MMM YYYY"),
    departure: formatDate(res.departureDate, "DD MMM YYYY"),
    amount: formatMoney(total, { grouping: loc.grouping, banglaDigits: locale === "bn" }),
    room: res.rooms.map((r) => r.room?.number).filter(Boolean).join(", "),
    phone: hotel?.phone ?? "",
  };
  if (wants.SMS && res.guest.phone) await queueNotification(db, { channel: "SMS", to: res.guest.phone, templateCode: event, locale, vars, entity: "Reservation", entityId: res.id });
  if (wants.WHATSAPP && res.guest.phone) await queueNotification(db, { channel: "WHATSAPP", to: res.guest.phone, templateCode: event, locale, vars, entity: "Reservation", entityId: res.id });
  if (wants.EMAIL && res.guest.email) await queueNotification(db, { channel: "EMAIL", to: res.guest.email, templateCode: event, locale, vars, entity: "Reservation", entityId: res.id });
}

function parseHeaders(s: string): Record<string, string> {
  try {
    const h = JSON.parse(s || "{}");
    return typeof h === "object" && h ? (h as Record<string, string>) : {};
  } catch {
    return {};
  }
}

/** Provider interface: one implementation (generic HTTP) configured per channel in Settings → Notifications. */
export async function deliver(settings: Settings["notifications"], n: { channel: string; to: string; subject: string; body: string }, fetchImpl: typeof fetch = fetch): Promise<void> {
  const vars = { to: n.to, message: n.body, subject: n.subject, sender: settings.sms.senderId, from: settings.email.from };
  let url = "";
  let method: "GET" | "POST" = "POST";
  let headers: Record<string, string> = {};
  let body: string | undefined;
  if (n.channel === "SMS") {
    if (!settings.smsEnabled || !settings.sms.url) throw new Error("SMS gateway is not configured");
    method = settings.sms.method;
    headers = parseHeaders(settings.sms.headers);
    if (method === "GET") url = render(settings.sms.url, Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, encodeURIComponent(v)])));
    else {
      url = settings.sms.url;
      body = render(settings.sms.bodyTemplate, vars, true);
    }
  } else if (n.channel === "EMAIL") {
    if (!settings.emailEnabled || !settings.email.url) throw new Error("Email relay is not configured");
    url = settings.email.url;
    headers = parseHeaders(settings.email.headers);
    body = render(settings.email.bodyTemplate, vars, true);
  } else if (n.channel === "WHATSAPP") {
    if (!settings.whatsappEnabled || !settings.whatsapp.url) throw new Error("WhatsApp provider is not configured");
    url = settings.whatsapp.url;
    headers = parseHeaders(settings.whatsapp.headers);
    body = render(settings.whatsapp.bodyTemplate, vars, true);
  } else throw new Error(`Unknown channel ${n.channel}`);
  if (!/^https?:\/\//i.test(url)) throw new Error("Provider URL must start with http:// or https://");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetchImpl(url, { method, headers, body, signal: ctl.signal });
    if (!r.ok) throw new Error(`Provider answered HTTP ${r.status}`);
  } finally {
    clearTimeout(timer);
  }
}

/** Sends due queued notifications (called by the scheduler every minute). Exponential backoff, 5 attempts. */
export async function processQueue(db: Db, limit = 20, fetchImpl: typeof fetch = fetch) {
  const s = await getSection(db, "notifications");
  const due = await db.notification.findMany({ where: { status: "QUEUED", sendAfter: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0;
  for (const n of due) {
    try {
      await deliver(s, n, fetchImpl);
      await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, lastError: "" } });
      sent++;
    } catch (e) {
      const attempts = n.attempts + 1;
      const msg = (e as Error).message.slice(0, 300);
      await db.notification.update({ where: { id: n.id }, data: { attempts, lastError: msg, status: attempts >= 5 ? "FAILED" : "QUEUED", sendAfter: new Date(Date.now() + Math.min(60, 2 ** attempts) * 60_000) } });
      log("warn", "notify", `${n.channel} to ${n.to.replace(/.(?=.{3})/g, "*")} failed: ${msg}`);
    }
  }
  return { sent, attempted: due.length };
}
