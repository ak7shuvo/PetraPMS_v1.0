// Shared PDF building blocks (@react-pdf/renderer, rendered on the server — works offline, no browser needed).
// Fonts: JetBrains Mono (brand), Hind Siliguri for Bangla text and the ৳ sign, Noto Sans Bengali as last-resort fallback.
// Why Hind Siliguri: the PDF engine ignores glyph position offsets, and Noto Sans Bengali builds conjuncts such as ন্ট / ন্ড from
// several offset glyphs, which printed garbled. Hind Siliguri maps every conjunct to a single glyph (verified in test/print.test.ts).
import fs from "node:fs";
import path from "node:path";
import React from "react";
import { Font, StyleSheet, Text, View, Image } from "@react-pdf/renderer";
import { formatMoney, toBanglaDigits } from "@petra/core";

let registered = false;

export function fontsDir(): string {
  const candidates = [process.env.PETRA_ASSETS_DIR && path.join(process.env.PETRA_ASSETS_DIR, "fonts"), path.join(process.cwd(), "assets", "fonts"), path.join(process.cwd(), "apps", "web", "assets", "fonts")].filter(Boolean) as string[];
  const hit = candidates.find((d) => fs.existsSync(path.join(d, "jetbrains-mono-latin-400-normal.woff")));
  if (!hit) throw new Error(`PDF fonts not found (looked in ${candidates.join(", ")})`);
  return hit;
}

export function registerFonts() {
  if (registered) return;
  const d = fontsDir();
  Font.register({ family: "JetBrains Mono", fonts: [{ src: path.join(d, "jetbrains-mono-latin-400-normal.woff") }, { src: path.join(d, "jetbrains-mono-latin-700-normal.woff"), fontWeight: 700 }] });
  Font.register({ family: "Hind Siliguri", fonts: [{ src: path.join(d, "hind-siliguri-bengali-400-normal.woff") }, { src: path.join(d, "hind-siliguri-bengali-700-normal.woff"), fontWeight: 700 }] });
  Font.register({ family: "Noto Sans Bengali", fonts: [{ src: path.join(d, "noto-sans-bengali-bengali-400-normal.woff") }, { src: path.join(d, "noto-sans-bengali-bengali-700-normal.woff"), fontWeight: 700 }] });
  Font.registerHyphenationCallback((w) => [w]);
  registered = true;
}

export const RED = "#C8102E";
export const INK = "#1A1A1A";
export const MUTED = "#6B6B6B";
export const BORDER = "#E4DCCB";
export const CREAM = "#F6F1E7";

export const FONT = ["JetBrains Mono", "Hind Siliguri", "Noto Sans Bengali"] as unknown as string;

export const s = StyleSheet.create({
  page: { fontFamily: FONT, fontSize: 8.5, color: INK, padding: 28, paddingBottom: 40 },
  row: { flexDirection: "row" },
  h1: { fontSize: 14, fontWeight: 700 },
  h2: { fontSize: 10.5, fontWeight: 700, marginBottom: 4 },
  muted: { color: MUTED },
  small: { fontSize: 7.5 },
  bold: { fontWeight: 700 },
  right: { textAlign: "right" },
  center: { textAlign: "center" },
  rule: { borderBottomWidth: 1, borderBottomColor: INK, marginVertical: 6 },
  thinRule: { borderBottomWidth: 0.5, borderBottomColor: BORDER, marginVertical: 4 },
  th: { fontWeight: 700, backgroundColor: "#111111", color: "#FFFFFF", paddingVertical: 3, paddingHorizontal: 3 },
  td: { paddingVertical: 2.5, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: BORDER },
  footer: { position: "absolute", bottom: 16, left: 28, right: 28, fontSize: 7, color: MUTED, flexDirection: "row", justifyContent: "space-between" },
  box: { borderWidth: 0.75, borderColor: INK, padding: 6 },
  label: { fontSize: 7, color: MUTED, marginBottom: 1 },
});

export interface Locale {
  bn: boolean;
  grouping: "lakh" | "intl";
}

export const money = (p: number | null | undefined, l: Locale = { bn: false, grouping: "lakh" }, symbol = false) => formatMoney(p ?? 0, { grouping: l.grouping, banglaDigits: l.bn, symbol });
export const num = (n: number | string, l: Locale) => (l.bn ? toBanglaDigits(String(n)) : String(n));

export interface HotelInfo {
  name: string;
  legalName?: string;
  address?: string;
  city?: string;
  phone?: string;
  email?: string;
  website?: string;
  bin?: string;
  logo?: string;
}

export function HotelHeader({ hotel, title, right }: { hotel: HotelInfo; title?: string; right?: React.ReactNode }) {
  return (
    <View style={{ ...s.row, justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
      <View style={{ ...s.row, alignItems: "center", maxWidth: "65%" }}>
        {hotel.logo && /^data:image\/(png|jpe?g);base64,/.test(hotel.logo) ? <Image src={hotel.logo} style={{ width: 42, height: 42, marginRight: 8, objectFit: "contain" }} /> : <View style={{ width: 6, height: 38, backgroundColor: RED, marginRight: 8 }} />}
        <View>
          <Text style={s.h1}>{hotel.name}</Text>
          {hotel.legalName ? <Text style={s.muted}>{hotel.legalName}</Text> : null}
          <Text style={s.muted}>{[hotel.address, hotel.city].filter(Boolean).join(", ")}</Text>
          <Text style={s.muted}>{[hotel.phone, hotel.email, hotel.website].filter(Boolean).join("  ·  ")}</Text>
          {hotel.bin ? <Text style={s.muted}>BIN: {hotel.bin}</Text> : null}
        </View>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        {title ? <Text style={{ ...s.h1, color: RED }}>{title}</Text> : null}
        {right}
      </View>
    </View>
  );
}

export function Footer({ left }: { left: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>{left}</Text>
      <Text render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
    </View>
  );
}

export function Field({ label, value, width }: { label: string; value?: string | null; width?: string | number }) {
  return (
    <View style={{ width: width ?? "50%", paddingRight: 6, marginBottom: 5 }}>
      <Text style={s.label}>{label}</Text>
      <Text style={{ borderBottomWidth: 0.5, borderBottomColor: BORDER, minHeight: 11 }}>{value || " "}</Text>
    </View>
  );
}
