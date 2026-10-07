import { describe, it, expect } from "vitest";
import { parseMoney, formatMoney, amountInWords, allocate, applyBp, divRound, toBanglaDigits, MoneyError, toDecimalString } from "../src/money";
import { nightsBetween, eachNight, parseFlexibleDate, overlaps, addDays, dayOfWeek, calendarToday, formatDate, clockNow } from "../src/dates";
import { computeTax, DEFAULT_TAX_RULES, sumTax } from "../src/tax";
import { normalizePhone, formatPhone } from "../src/phone";
import { formatSequence, sequenceKey, randomToken, tempPassword } from "../src/ids";

describe("money", () => {
  it("parses many input styles into poisha", () => {
    expect(parseMoney("1,25,000.50")).toBe(12500050);
    expect(parseMoney("৳ 1,250")).toBe(125000);
    expect(parseMoney("Tk. 99.9")).toBe(9990);
    expect(parseMoney("BDT500")).toBe(50000);
    expect(parseMoney("১২৫০")).toBe(125000);
    expect(parseMoney(12.34)).toBe(1234);
    expect(parseMoney("-10")).toBe(-1000);
    expect(parseMoney("5.500")).toBe(550);
    expect(() => parseMoney("1.234")).toThrow(MoneyError);
    expect(() => parseMoney("abc")).toThrow(MoneyError);
    expect(() => parseMoney("")).toThrow(MoneyError);
  });
  it("formats with lakh/crore grouping and Bangla digits", () => {
    expect(formatMoney(1234567890)).toBe("৳1,23,45,678.90");
    expect(formatMoney(1234567890, { grouping: "intl" })).toBe("৳12,345,678.90");
    expect(formatMoney(-50000, { symbol: false, decimals: false })).toBe("-500");
    expect(formatMoney(125000, { banglaDigits: true })).toBe("৳১,২৫০.০০");
    expect(toBanglaDigits("2026")).toBe("২০২৬");
    expect(toDecimalString(-1205)).toBe("-12.05");
  });
  it("rounds half-up exactly and allocates without losing poisha", () => {
    expect(divRound(5, 2)).toBe(3);
    expect(divRound(-5, 2)).toBe(-3);
    expect(applyBp(333, 1500)).toBe(50);
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
  });
  it("writes amounts in words", () => {
    expect(amountInWords(125050)).toBe("One Thousand Two Hundred Fifty Taka and Fifty Poisha Only");
    expect(amountInWords(1234567800)).toBe("One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Taka Only");
  });
});

describe("dates", () => {
  it("counts nights and handles month/year boundaries", () => {
    expect(nightsBetween("2026-12-30", "2027-01-02")).toBe(3);
    expect(eachNight("2026-02-27", "2026-03-01")).toEqual(["2026-02-27", "2026-02-28"]);
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(dayOfWeek("2026-10-02")).toBe(5); // Friday
  });
  it("uses half-open overlap", () => {
    expect(overlaps("2026-10-01", "2026-10-03", "2026-10-03", "2026-10-05")).toBe(false);
    expect(overlaps("2026-10-01", "2026-10-04", "2026-10-03", "2026-10-05")).toBe(true);
  });
  it("parses flexible import dates", () => {
    expect(parseFlexibleDate("2026-10-03")).toBe("2026-10-03");
    expect(parseFlexibleDate("3/10/2026")).toBe("2026-10-03");
    expect(parseFlexibleDate("03.10.2026")).toBe("2026-10-03");
    expect(parseFlexibleDate("31/02/2026")).toBeNull();
    expect(parseFlexibleDate(46298)).toBe("2026-10-03");
    expect(parseFlexibleDate("2026-1-5T10:00")).toBe("2026-01-05");
  });
  it("computes the Dhaka calendar day and clock", () => {
    expect(calendarToday("Asia/Dhaka", new Date("2026-10-02T19:00:00Z"))).toBe("2026-10-03");
    expect(clockNow("Asia/Dhaka", new Date("2026-10-02T19:05:00Z"))).toBe("01:05");
    expect(formatDate("2026-10-03", "DD MMM YYYY")).toBe("03 Oct 2026");
  });
});

describe("tax", () => {
  const opts = { rules: DEFAULT_TAX_RULES, category: "ROOM" } as const;
  it("exclusive: SC 10% on net, VAT 15% on net+SC", () => {
    const r = computeTax(1000000, { ...opts, mode: "EXCLUSIVE" });
    expect(r.serviceCharge).toBe(100000);
    expect(r.vat).toBe(165000);
    expect(r.total).toBe(1265000);
  });
  it("inclusive: backs out net so that parts sum exactly to gross", () => {
    for (const gross of [1265000, 100, 999999, 1, 350000, 12345, -12650]) {
      const r = computeTax(gross, { ...opts, mode: "INCLUSIVE" });
      expect(r.net + r.serviceCharge + r.vat).toBe(gross);
      expect(r.total).toBe(gross);
    }
    expect(computeTax(1265000, { ...opts, mode: "INCLUSIVE" }).net).toBe(1000000);
  });
  it("skips non-taxable categories and inactive rules", () => {
    expect(computeTax(5000, { ...opts, category: "DEPOSIT", mode: "EXCLUSIVE" }).total).toBe(5000);
    expect(computeTax(5000, { ...opts, mode: "EXCLUSIVE", taxable: false }).vat).toBe(0);
    const rules = DEFAULT_TAX_RULES.map((r) => (r.code === "SC" ? { ...r, active: false } : r));
    expect(computeTax(10000, { rules, category: "ROOM", mode: "EXCLUSIVE" }).total).toBe(11500);
  });
  it("handles negative adjustments and sums", () => {
    const r = computeTax(-10000, { ...opts, mode: "EXCLUSIVE" });
    expect(r.total).toBe(-12650);
    expect(sumTax([r, computeTax(10000, { ...opts, mode: "EXCLUSIVE" })]).total).toBe(0);
  });
});

describe("phone & ids", () => {
  it("normalises Bangladesh numbers to +880", () => {
    expect(normalizePhone("01712-345678")).toBe("+8801712345678");
    expect(normalizePhone("+880 1712 345678")).toBe("+8801712345678");
    expect(normalizePhone("8801712345678")).toBe("+8801712345678");
    expect(normalizePhone("০১৭১২৩৪৫৬৭৮")).toBe("+8801712345678");
    expect(normalizePhone("1712345678")).toBe("+8801712345678");
    expect(normalizePhone("02-9876543")).toBe("+88029876543");
    expect(normalizePhone("+44 20 7946 0958")).toBe("+442079460958");
    expect(normalizePhone("12")).toBeNull();
    expect(formatPhone("+8801712345678")).toBe("01712-345678");
  });
  it("formats document numbers", () => {
    expect(formatSequence("reservation", 42, "2026-10-03")).toBe("RES-2610-00042");
    expect(sequenceKey("reservation", "2026-10-03")).toBe("reservation:2610");
    expect(formatSequence("guest", 7, "2026-10-03")).toBe("G-000007");
    expect(randomToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tempPassword()).toMatch(/^[A-Za-z2-9]{10}$/);
  });
});
