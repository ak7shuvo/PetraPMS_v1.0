import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { en } from "@/messages/en";
import { bn } from "@/messages/bn";

function flatten(o: Record<string, unknown>, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object") Object.assign(out, flatten(v as Record<string, unknown>, key));
    else out[key] = String(v);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "server" ? [] : sourceFiles(p);
    return /\.(tsx?|ts)$/.test(d.name) ? [p] : [];
  });
}

const EN = flatten(en);
const BN = flatten(bn);
const files = sourceFiles(path.resolve(__dirname, "../src"));
const code = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");

describe("translations", () => {
  it("every key used in the UI exists in English", () => {
    const used = new Set([...code.matchAll(/\bt\("([a-zA-Z0-9_.]+)"/g)].map((m) => m[1]));
    for (const m of code.matchAll(/key: "(nav\.[a-zA-Z]+)"/g)) used.add(m[1]);
    const missing = [...used].filter((k) => !(k in EN));
    expect(missing).toEqual([]);
  });

  it("dynamic key prefixes exist", () => {
    const prefixes = new Set([...code.matchAll(/\bt\(`([a-zA-Z0-9_.]+)\.\$\{/g)].map((m) => m[1]));
    const missing = [...prefixes].filter((p) => !Object.keys(EN).some((k) => k.startsWith(p + ".")));
    expect(missing).toEqual([]);
  });

  it("Bangla has exactly the same keys as English", () => {
    const missingInBn = Object.keys(EN).filter((k) => !(k in BN));
    const extraInBn = Object.keys(BN).filter((k) => !(k in EN));
    expect({ missingInBn, extraInBn }).toEqual({ missingInBn: [], extraInBn: [] });
  });

  it("placeholders match between languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    const bad = Object.keys(EN).filter((k) => k in BN && ph(EN[k]) !== ph(BN[k]));
    expect(bad).toEqual([]);
  });

  it("Bangla strings are actually translated (not copied English)", () => {
    const same = Object.keys(EN).filter((k) => BN[k] === EN[k] && /[a-z]{4,}/i.test(EN[k]) && !/^(OK|SMS|Email|WhatsApp|OTA|VIP|PIN|BIN|ADR|RevPAR|POS|API|CSV|XLSX|PDF|IT)/.test(EN[k]));
    expect(same.length, same.slice(0, 20).join(", ")).toBeLessThan(15);
  });
});
