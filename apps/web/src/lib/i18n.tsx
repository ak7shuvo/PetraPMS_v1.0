"use client";
// Locale (EN / বাংলা) per window user, number formatting (Bangla digits, lakh grouping) and dates.
import React, { useCallback, useEffect, useMemo } from "react";
import { NextIntlClientProvider, useTranslations } from "next-intl";
import { formatDate, formatMoney, formatNumber, toBanglaDigits, type ISODate } from "@petra/core";
import { en } from "@/messages/en";
import { bn } from "@/messages/bn";
import { useSession } from "./session";

export type Locale = "en" | "bn";

export function useLocale(): Locale {
  const { user, status } = useSession();
  if (user) return user.locale;
  if (typeof window !== "undefined") {
    const l = localStorage.getItem("petra.locale");
    if (l === "en" || l === "bn") return l;
  }
  return status?.locale.defaultLocale ?? "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const messages = locale === "bn" ? bn : en;
  useEffect(() => {
    document.documentElement.lang = locale; // also lets non-React helpers (error toasts) pick the language
  }, [locale]);
  return (
    <NextIntlClientProvider locale={locale} messages={messages as unknown as Record<string, string>} timeZone="Asia/Dhaka" onError={() => undefined} getMessageFallback={({ key }) => key}>
      {children}
    </NextIntlClientProvider>
  );
}

/** Full-key translator, e.g. t("fd.checkIn"). */
export function useT() {
  return useTranslations();
}

export function useFmt() {
  const { user, status } = useSession();
  const bnDigits = !!user?.banglaDigits;
  const grouping = status?.locale.grouping ?? "lakh";
  const dateStyle = status?.locale.dateFormat ?? "DD/MM/YYYY";
  const d = useCallback((s: string) => (bnDigits ? toBanglaDigits(s) : s), [bnDigits]);
  return useMemo(
    () => ({
      money: (p: number | null | undefined, opts: { symbol?: boolean } = {}) => (p === null || p === undefined ? "—" : formatMoney(p, { grouping, banglaDigits: bnDigits, symbol: opts.symbol ?? true })),
      num: (n: number | null | undefined) => (n === null || n === undefined ? "—" : formatNumber(n, { grouping, banglaDigits: bnDigits })),
      pct: (bp: number | null | undefined) => (bp === null || bp === undefined ? "—" : d(`${(bp / 100).toFixed(1)}%`)),
      date: (s: ISODate | null | undefined, style?: Parameters<typeof formatDate>[1]) => (s ? d(formatDate(s, style ?? dateStyle)) : "—"),
      short: (s: ISODate | null | undefined) => (s ? d(formatDate(s, "DD MMM")) : "—"),
      dateTime: (v: string | Date | null | undefined) => {
        if (!v) return "—";
        const x = typeof v === "string" ? new Date(v) : v;
        return d(x.toLocaleString("en-GB", { timeZone: "Asia/Dhaka", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }));
      },
      time: (v: string | Date | null | undefined) => (v ? d(new Date(v).toLocaleTimeString("en-GB", { timeZone: "Asia/Dhaka", hour: "2-digit", minute: "2-digit" })) : "—"),
      digits: d,
      grouping,
    }),
    [grouping, bnDigits, dateStyle, d],
  );
}

/** Taka text field value → poisha (accepts Bangla digits, commas, ৳). Returns null when empty/invalid. */
export function toPoisha(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v)
    .replace(/[০-৯]/g, (c) => String("০১২৩৪৫৬৭৮৯".indexOf(c)))
    .replace(/[৳,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null;
  const [i, f = ""] = s.replace("-", "").split(".");
  const p = Number(i) * 100 + Number((f + "00").slice(0, 2));
  return s.startsWith("-") ? -p : p;
}
export const fromPoisha = (p: number | null | undefined) => (p === null || p === undefined ? "" : (p / 100).toFixed(2));
