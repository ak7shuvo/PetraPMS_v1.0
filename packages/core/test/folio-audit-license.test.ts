import { describe, it, expect } from "vitest";
import { folioBalance, routeCharge, agingBucket, agingReport, canCloseFolio, paymentsByMethod } from "../src/folio";
import { cancellationPenalty, noShowPenalty, arrivalMoment } from "../src/cancellation";
import { planNightAudit, auditOverdue, type AuditStay } from "../src/nightAudit";
import { PERMISSIONS, PERMISSION_CODES, DEFAULT_ROLES, homeFor } from "../src/permissions";
import { generateKeyPair, signLicense, verifyLicense, evaluateLicense, expiryThreshold, fingerprintFrom, LicenseError, type LicensePayload, transferRequestCode, parseTransferRequest } from "../src/license";

describe("folio", () => {
  it("computes balances ignoring voids and netting refunds", () => {
    const b = folioBalance(
      [{ total: 12650, amount: 10000, serviceCharge: 1000, vat: 1650 }, { total: 5000, voidedAt: new Date() }],
      [{ type: "DEPOSIT", amount: 5000, method: "CASH" }, { type: "PAYMENT", amount: 10000, method: "BKASH" }, { type: "REFUND", amount: 2350, method: "CASH" }, { type: "PAYMENT", amount: 999, voidedAt: "x" }],
    );
    expect(b).toMatchObject({ charges: 12650, net: 10000, vat: 1650, payments: 12650, refunds: 2350, balance: 0 });
    expect(canCloseFolio(b).ok).toBe(true);
    expect(canCloseFolio({ ...b, balance: 1 }).ok).toBe(false);
    expect(paymentsByMethod([{ type: "PAYMENT", amount: 100, method: "CASH" }, { type: "REFUND", amount: 30, method: "CASH" }])).toEqual({ CASH: 70 });
  });
  it("routes charges to split folios", () => {
    const folios = [
      { id: "main", type: "GUEST", status: "OPEN", parentFolioId: null, routing: [] },
      { id: "co", type: "COMPANY", status: "OPEN", parentFolioId: "main", routing: ["ROOM"] },
      { id: "all", type: "GUEST", status: "OPEN", parentFolioId: "main", routing: ["*"] },
      { id: "closed", type: "GUEST", status: "SETTLED", parentFolioId: "main", routing: ["FNB"] },
    ];
    expect(routeCharge("main", folios, "ROOM")).toBe("co");
    expect(routeCharge("main", folios, "FNB")).toBe("all");
    expect(routeCharge("main", folios.slice(0, 2), "FNB")).toBe("main");
  });
  it("buckets city ledger aging", () => {
    expect(agingBucket("2026-10-10", "2026-10-03")).toBe("CURRENT");
    expect(agingBucket("2026-09-01", "2026-10-03")).toBe("D31_60");
    expect(agingBucket("2026-01-01", "2026-10-03")).toBe("D90_PLUS");
    const r = agingReport([{ companyId: "A", balance: 100, dueDate: "2026-10-01" }, { companyId: "A", balance: 50, dueDate: "2026-11-01" }], "2026-10-03");
    expect(r.get("A")).toMatchObject({ D1_30: 100, CURRENT: 50, total: 150 });
  });
});

describe("cancellation", () => {
  const policy = { freeUntilHours: 24, penaltyType: "FIRST_NIGHT", penaltyValue: 0, noShowType: "FULL" };
  const arr = arrivalMoment("2026-10-10", "14:00");
  it("computes arrival moment in Dhaka time", () => {
    expect(new Date(arr).toISOString()).toBe("2026-10-10T08:00:00.000Z");
  });
  it("is free before the window and charges inside it", () => {
    expect(cancellationPenalty(policy, arr, arr - 48 * 3600e3, [500, 600])).toMatchObject({ free: true, penalty: 0 });
    expect(cancellationPenalty(policy, arr, arr - 2 * 3600e3, [500, 600])).toMatchObject({ free: false, penalty: 500 });
    expect(cancellationPenalty({ ...policy, penaltyType: "PERCENT", penaltyValue: 5000 }, arr, arr, [500, 600]).penalty).toBe(550);
    expect(noShowPenalty(policy, [500, 600])).toBe(1100);
    expect(noShowPenalty(null, [500, 600])).toBe(500);
  });
});

describe("night audit", () => {
  const stay = (o: Partial<AuditStay>): AuditStay => ({ id: "x", reservationId: "r", confirmationNo: "RES", guestName: "G", roomNumber: "101", arrivalDate: "2026-10-02", departureDate: "2026-10-05", status: "CHECKED_IN", nightlyRates: [{ date: "2026-10-03", amount: 5000 }], ...o });
  it("plans room charges idempotently, no-shows and overdue departures", () => {
    const stays = [stay({ id: "a" }), stay({ id: "b" }), stay({ id: "c", departureDate: "2026-10-03" }), stay({ id: "d", status: "RESERVED", arrivalDate: "2026-10-02" }), stay({ id: "e", status: "RESERVED", arrivalDate: "2026-10-03" }), stay({ id: "f", status: "CHECKED_OUT" })];
    const plan = planNightAudit("2026-10-03", stays, new Set(["b|2026-10-03"]), { requireDeparturesResolved: true });
    expect(plan.roomCharges).toEqual([{ stayId: "a", roomNumber: "101", amount: 5000, date: "2026-10-03" }]);
    expect(plan.overdueDepartures.map((s) => s.id)).toEqual(["c"]);
    expect(plan.noShows.map((s) => s.id)).toEqual(["d"]);
    expect(plan.pendingArrivals.map((s) => s.id)).toEqual(["e"]);
    expect(plan.blocking).toHaveLength(1);
    expect(plan.nextBusinessDate).toBe("2026-10-04");
  });
  it("detects an overdue audit", () => {
    expect(auditOverdue("2026-10-03", "2026-10-03", "23:00")).toBe(false);
    expect(auditOverdue("2026-10-03", "2026-10-04", "01:00")).toBe(false);
    expect(auditOverdue("2026-10-03", "2026-10-04", "02:30")).toBe(true);
    expect(auditOverdue("2026-10-03", "2026-10-06", "00:00")).toBe(true);
  });
});

describe("permissions", () => {
  it("has unique codes and roles only reference known permissions", () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSIONS.length);
    expect(DEFAULT_ROLES).toHaveLength(9);
    for (const r of DEFAULT_ROLES) for (const p of r.permissions) expect(PERMISSION_CODES).toContain(p);
    expect(DEFAULT_ROLES[0].permissions).toHaveLength(PERMISSION_CODES.length);
    expect(homeFor(DEFAULT_ROLES.find((r) => r.code === "HOUSEKEEPER")!.permissions)).toBe("/housekeeping");
  });
});

describe("license", () => {
  const keys = generateKeyPair();
  const payload: LicensePayload = { v: 1, id: "L-1", customer: "Hotel Petra Ltd", hotel: "Hotel Petra", edition: "STANDARD", maxRooms: 60, maxTerminals: 5, modules: ["core", "housekeeping"], issuedAt: "2026-10-01", expiresAt: "2027-10-01", supportUntil: "2027-10-01", fingerprint: "ABCDE-12345" };
  it("signs and verifies; rejects tampering and wrong keys", () => {
    const key = signLicense(payload, keys.privateKeyPem);
    expect(verifyLicense(key, keys.publicKeyPem)).toEqual(payload);
    const [a, b, c] = key.split(".");
    const tampered = Buffer.from(JSON.stringify({ ...payload, maxRooms: 999 })).toString("base64url");
    expect(() => verifyLicense(`${a}.${tampered}.${c}`, keys.publicKeyPem)).toThrow(LicenseError);
    expect(() => verifyLicense(key, generateKeyPair().publicKeyPem)).toThrow(/signature/);
    expect(() => verifyLicense("garbage", keys.publicKeyPem)).toThrow(/Not a PetraPMS/);
    expect(verifyLicense(`${a}.${b}\n.${c}`, keys.publicKeyPem).id).toBe("L-1");
  });
  it("evaluates trial, active, expiry, fingerprint, rooms and clock rollback", () => {
    const base = { trialStart: "2026-10-01", lastSeen: null, fingerprint: "ABCDE-12345", roomCount: 40 };
    expect(evaluateLicense({ ...base, payload: null, today: "2026-10-03" })).toMatchObject({ mode: "TRIAL", daysLeft: 12 });
    expect(evaluateLicense({ ...base, payload: null, today: "2026-10-15" })).toMatchObject({ mode: "READ_ONLY", reason: "TRIAL_ENDED" });
    expect(evaluateLicense({ ...base, payload, today: "2026-10-03" })).toMatchObject({ mode: "ACTIVE", readOnly: false });
    expect(evaluateLicense({ ...base, payload, today: "2027-09-25" }).warnings[0]).toMatch(/6 days/);
    expect(evaluateLicense({ ...base, payload, today: "2027-10-02" })).toMatchObject({ mode: "READ_ONLY", reason: "EXPIRED" });
    expect(evaluateLicense({ ...base, payload, fingerprint: "OTHER", today: "2026-10-03" })).toMatchObject({ reason: "FINGERPRINT" });
    expect(evaluateLicense({ ...base, payload, roomCount: 61, today: "2026-10-03" })).toMatchObject({ reason: "ROOMS" });
    expect(evaluateLicense({ ...base, payload, lastSeen: "2026-10-10", today: "2026-10-03" })).toMatchObject({ reason: "CLOCK" });
    expect(evaluateLicense({ ...base, payload: { ...payload, expiresAt: null }, today: "2030-01-01" })).toMatchObject({ mode: "ACTIVE", daysLeft: null });
    expect([expiryThreshold(45), expiryThreshold(20), expiryThreshold(5), expiryThreshold(0), expiryThreshold(null)]).toEqual([null, 30, 7, 1, null]);
  });
  it("fingerprints and transfer codes round-trip", () => {
    expect(fingerprintFrom(["a", "b"])).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}-[0-9A-F]{5}-[0-9A-F]{5}$/);
    expect(parseTransferRequest(transferRequestCode("L-1", "A", "B"))).toMatchObject({ licenseId: "L-1", oldFp: "A", newFp: "B" });
  });
});
