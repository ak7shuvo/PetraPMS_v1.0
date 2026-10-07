// POS integration API (PetraPOS or any restaurant/bar POS): look up in-house rooms and post room-charge checks
// to the guest folio. Authenticated with API keys (X-API-Key: ppk_…). Posting is idempotent per outlet+check
// number, so a POS that retries after a network error never double-charges.
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { folioBalance } from "@petra/core";
import { route } from "../api";
import { audit, parseJson } from "../common";
import { ApiError, notFound } from "../errors";
import { lockedTx } from "../lock";
import { publish } from "../events";
import { sha256 } from "../auth";
import { postCharge, primaryFolioForStay, voidCharge } from "../services/folio";
import { env } from "../env";
import { OPENAPI } from "../openapi";

const API = { auth: "apikey", module: "pos" } as const;

async function inHouseByRoom(db: Parameters<Parameters<typeof route>[3]>[0]["db"], number: string) {
  const s = await db.reservationRoom.findFirst({ where: { status: "CHECKED_IN", room: { number } }, include: { room: true, guest: true, reservation: { include: { guest: true } } } });
  if (!s) throw new ApiError(404, "ROOM_NOT_IN_HOUSE", `Room ${number} has no in-house guest`);
  return s;
}

route("GET", "/pos/v1/ping", API, async (ctx) => {
  const h = await ctx.db.hotel.findUnique({ where: { id: "hotel" } });
  return { hotel: h?.name ?? "", businessDate: ctx.businessDate, version: env().appVersion, key: ctx.apiKey?.name };
});

route("GET", "/pos/v1/rooms", API, async (ctx) => {
  const stays = await ctx.db.reservationRoom.findMany({ where: { status: "CHECKED_IN" }, include: { room: true, guest: true, reservation: { include: { guest: true } } }, orderBy: { room: { number: "asc" } } });
  return stays.map((s) => {
    const g = s.guest ?? s.reservation.guest;
    return { roomNumber: s.room?.number, guestName: g.fullName, lastName: g.lastName, departureDate: s.departureDate, allowCharges: !g.blacklisted, vip: g.vip };
  });
});

route("GET", "/pos/v1/rooms/:number", API, async (ctx) => {
  const s = await inHouseByRoom(ctx.db, ctx.params.number);
  const g = s.guest ?? s.reservation.guest;
  return { roomNumber: s.room?.number, guestName: g.fullName, lastName: g.lastName, departureDate: s.departureDate, allowCharges: !g.blacklisted };
});

const chargeSchema = z.object({
  roomNumber: z.string().trim().min(1).max(10),
  /** optional verification: must match the in-house guest's last (or full) name, case-insensitive */
  guestName: z.string().trim().max(120).optional(),
  outlet: z.string().trim().min(1).max(40).default("RESTAURANT"),
  checkNumber: z.string().trim().min(1).max(60),
  chargeCode: z.string().trim().max(20).default("REST"),
  amount: z.number().int().min(1).max(10_000_000_00),
  taxInclusive: z.boolean().default(false),
  description: z.string().trim().max(200).default(""),
  covers: z.number().int().min(0).max(500).optional(),
  items: z.array(z.object({ name: z.string().max(120), quantity: z.number().min(0), amount: z.number().int() })).max(200).optional(),
});

route("POST", "/pos/v1/charges", API, async (ctx) => {
  const b = await ctx.body(chargeSchema);
  const ref = `pos:${b.outlet.toUpperCase()}:${b.checkNumber}`;
  const res = await lockedTx(
    ctx.db,
    async (tx) => {
      const prior = await tx.folioCharge.findFirst({ where: { sourceRef: ref, voidedAt: null }, include: { folio: { select: { number: true } } } });
      if (prior) return { duplicate: true, chargeId: prior.id, folio: prior.folio.number, total: prior.total };
      const s = await tx.reservationRoom.findFirst({ where: { status: "CHECKED_IN", room: { number: b.roomNumber } }, include: { room: true, guest: true, reservation: { include: { guest: true } } } });
      if (!s) throw new ApiError(404, "ROOM_NOT_IN_HOUSE", `Room ${b.roomNumber} has no in-house guest`);
      const g = s.guest ?? s.reservation.guest;
      if (g.blacklisted) throw new ApiError(403, "CHARGES_BLOCKED", "Room charges are not allowed for this guest; take payment at the outlet");
      if (b.guestName) {
        const want = b.guestName.toLowerCase();
        if (![g.lastName, g.fullName, g.firstName].some((x) => x && x.toLowerCase() === want)) throw new ApiError(409, "NAME_MISMATCH", "Guest name does not match the room");
      }
      const folio = await primaryFolioForStay(tx, s.id, ctx.actor, ctx.businessDate);
      const itemsText = b.items?.length ? ` (${b.items.map((i) => `${i.quantity}× ${i.name}`).join(", ").slice(0, 150)})` : "";
      const ch = await postCharge(tx, { folioId: folio.id, chargeCode: b.chargeCode.toUpperCase(), amount: b.amount, description: `${b.description || b.outlet} #${b.checkNumber}${itemsText}`.slice(0, 200), businessDate: ctx.businessDate, source: "POS", sourceRef: ref, reservationRoomId: s.id, roomNumber: s.room?.number ?? "", taxMode: b.taxInclusive ? "INCLUSIVE" : "EXCLUSIVE" }, ctx.actor);
      return { duplicate: false, chargeId: ch.id, folio: folio.number, net: ch.amount, serviceCharge: ch.serviceCharge, vat: ch.vat, total: ch.total, folioId: ch.folioId };
    },
    "folio",
  );
  if (!res.duplicate) publish("folios", "pos", (res as { folioId?: string }).folioId);
  return res;
});

route("POST", "/pos/v1/charges/void", API, async (ctx) => {
  const b = await ctx.body(z.object({ outlet: z.string().trim().min(1).max(40).default("RESTAURANT"), checkNumber: z.string().trim().min(1).max(60), reason: z.string().trim().min(3).max(200) }));
  const ref = `pos:${b.outlet.toUpperCase()}:${b.checkNumber}`;
  const ch = await ctx.db.folioCharge.findFirst({ where: { sourceRef: ref, voidedAt: null } });
  if (!ch) throw notFound("Charge");
  if (ch.businessDate !== ctx.businessDate) throw new ApiError(409, "PAST_DATE", "Charges from a closed business date cannot be voided from the POS; ask the front office for an adjustment");
  await lockedTx(ctx.db, (tx) => voidCharge(tx, ch.id, `POS: ${b.reason}`, ctx.actor), "folio");
  publish("folios", "posVoid", ch.folioId);
  return { ok: true };
});

route("GET", "/pos/v1/openapi.json", { auth: "public", beforeSetup: true, allowReadOnly: true }, async () => OPENAPI);

// ── API key management & log (staff) ────────────────────────────────────────
route("GET", "/pos/keys", { perm: "pos.manage", module: "pos", allowReadOnly: true }, async (ctx) => (await ctx.db.apiKey.findMany({ orderBy: { createdAt: "desc" } })).map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, active: k.active, lastUsedAt: k.lastUsedAt, createdAt: k.createdAt, scopes: parseJson(k.scopes, []) })));

route("POST", "/pos/keys", { perm: "pos.manage", module: "pos" }, async (ctx) => {
  const b = await ctx.body(z.object({ name: z.string().trim().min(2).max(60) }));
  const key = `ppk_${randomBytes(24).toString("base64url")}`;
  const row = await ctx.db.apiKey.create({ data: { name: b.name, prefix: key.slice(0, 12), keyHash: sha256(key), createdById: ctx.user?.id } });
  await audit(ctx.db, ctx.actor, "pos.keyCreated", "ApiKey", row.id, { after: { name: b.name, prefix: row.prefix } });
  return { id: row.id, name: row.name, key, note: "Copy this key now. It is shown only once." };
});

route("DELETE", "/pos/keys/:id", { perm: "pos.manage" }, async (ctx) => {
  const k = await ctx.db.apiKey.update({ where: { id: ctx.params.id }, data: { active: false } });
  await audit(ctx.db, ctx.actor, "pos.keyRevoked", "ApiKey", k.id, { before: { name: k.name } });
  return { ok: true };
});

route("GET", "/pos/log", { perm: ["pos.view", "pos.manage"], allowReadOnly: true }, async (ctx) => {
  const rows = await ctx.db.folioCharge.findMany({ where: { source: "POS" }, orderBy: { createdAt: "desc" }, take: 300, include: { folio: { select: { number: true, name: true } } } });
  return rows.map((r) => ({ id: r.id, at: r.createdAt, businessDate: r.businessDate, ref: r.sourceRef, room: r.roomNumber, folio: r.folio.number, guest: r.folio.name, description: r.description, total: r.total, voided: !!r.voidedAt, voidReason: r.voidReason }));
});

/** Folio balance for the in-house guest (staff only, used by the POS simulator page). */
route("GET", "/pos/room-balance/:number", { perm: ["pos.view", "folio.view"], allowReadOnly: true }, async (ctx) => {
  const s = await inHouseByRoom(ctx.db, ctx.params.number);
  const folios = await ctx.db.folio.findMany({ where: { reservationRoomId: s.id }, include: { charges: true, payments: true } });
  return { room: ctx.params.number, balance: folios.reduce((a, f) => a + folioBalance(f.charges, f.payments).balance, 0) };
});
