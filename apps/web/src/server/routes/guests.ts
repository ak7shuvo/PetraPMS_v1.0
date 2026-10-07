// Guest CRM and companies (corporate accounts).
import { z } from "zod";
import { route, pageArgs } from "../api";
import { audit, nextNumber } from "../common";
import { lockedTx, tx } from "../lock";
import { publish } from "../events";
import { ApiError, notFound } from "../errors";
import { cleanGuest, createGuest, findDuplicates, mergeGuests } from "../services/guests";
import { readUpload } from "../services/files";
import { companySchema, guestSchema } from "@/shared/schemas";

route("GET", "/guests", { perm: ["guests.view", "reservations.create", "frontdesk.checkin"], allowReadOnly: true }, async (ctx) => {
  const { take, skip } = pageArgs(ctx.query);
  const q = (ctx.query.get("q") ?? "").trim();
  const where: Record<string, unknown> = { deletedAt: null };
  if (ctx.query.get("vip") === "1") where.vip = { gt: 0 };
  if (ctx.query.get("blacklisted") === "1") where.blacklisted = true;
  if (ctx.query.get("foreign") === "1") where.nationality = { not: "BD" };
  if (q) {
    const digits = q.replace(/\D/g, "");
    where.OR = [{ fullName: { contains: q } }, { code: { contains: q.toUpperCase() } }, { email: { contains: q.toLowerCase() } }, { idNumber: { contains: q } }, { passportNumber: { contains: q.toUpperCase() } }, ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-10) } }] : [])];
  }
  const [rows, total] = await Promise.all([
    ctx.db.guest.findMany({ where, take, skip, orderBy: ctx.query.get("sort") === "recent" ? { updatedAt: "desc" } : { fullName: "asc" }, include: { company: { select: { id: true, name: true } } } }),
    ctx.db.guest.count({ where }),
  ]);
  return { total, rows };
});

route("GET", "/guests/duplicates", { perm: ["guests.view", "reservations.create"], allowReadOnly: true }, async (ctx) =>
  findDuplicates(ctx.db, { phone: ctx.query.get("phone") ?? "", idNumber: ctx.query.get("idNumber") ?? "", passportNumber: ctx.query.get("passportNumber") ?? "", email: ctx.query.get("email") ?? "" }, ctx.query.get("exclude") ?? undefined),
);

route("GET", "/guests/:id", { perm: ["guests.view", "reservations.view", "frontdesk.checkin"], allowReadOnly: true }, async (ctx) => {
  const g = await ctx.db.guest.findUnique({ where: { id: ctx.params.id }, include: { company: { select: { id: true, name: true } } } });
  if (!g || g.deletedAt) throw notFound("Guest");
  const history = await ctx.db.reservation.findMany({ where: { guestId: g.id }, orderBy: { arrivalDate: "desc" }, take: 50, select: { id: true, confirmationNo: true, arrivalDate: true, departureDate: true, status: true, rooms: { select: { room: { select: { number: true } } } } } });
  return { ...g, history };
});

route("POST", "/guests", { perm: ["guests.edit", "reservations.create", "frontdesk.checkin"] }, async (ctx) => {
  const b = await ctx.body(guestSchema);
  const g = await tx(ctx.db, (t) => createGuest(t, b, ctx.actor, ctx.businessDate));
  publish("guests", "created", g.id, ctx.user?.id);
  return g;
});

route("PUT", "/guests/:id", { perm: ["guests.edit", "frontdesk.checkin"] }, async (ctx) => {
  const b = await ctx.body(guestSchema);
  const before = await ctx.db.guest.findUnique({ where: { id: ctx.params.id } });
  if (!before || before.deletedAt) throw notFound("Guest");
  const data = cleanGuest(b);
  const after = await ctx.db.guest.update({ where: { id: before.id }, data: { ...data, updatedById: ctx.user?.id } });
  await audit(ctx.db, ctx.actor, "guest.updated", "Guest", before.id, { before, after: data });
  publish("guests", "updated", before.id, ctx.user?.id);
  return after;
});

route("POST", "/guests/:id/blacklist", { perm: "guests.blacklist" }, async (ctx) => {
  const b = await ctx.body(z.object({ blacklisted: z.boolean(), reason: z.string().trim().max(300).default("") }));
  if (b.blacklisted && b.reason.length < 3) throw new ApiError(400, "VALIDATION", "Enter a reason for blacklisting");
  const g = await ctx.db.guest.update({ where: { id: ctx.params.id }, data: { blacklisted: b.blacklisted, blacklistReason: b.blacklisted ? b.reason : "" } });
  await audit(ctx.db, ctx.actor, b.blacklisted ? "guest.blacklisted" : "guest.unblacklisted", "Guest", g.id, { reason: b.reason });
  publish("guests", "updated", g.id, ctx.user?.id);
  return { ok: true };
});

route("POST", "/guests/:id/merge", { perm: "guests.merge" }, async (ctx) => {
  const b = await ctx.body(z.object({ fromId: z.string().min(1) }));
  await lockedTx(ctx.db, (t) => mergeGuests(t, ctx.params.id, b.fromId, ctx.actor), "folio");
  publish("guests", "merged", ctx.params.id, ctx.user?.id);
  return { ok: true };
});

route("DELETE", "/guests/:id", { perm: "guests.merge" }, async (ctx) => {
  const g = await ctx.db.guest.findUnique({ where: { id: ctx.params.id }, include: { _count: { select: { reservations: true } } } });
  if (!g || g.deletedAt) throw notFound("Guest");
  if (g._count.reservations) throw new ApiError(409, "IN_USE", "This guest has reservations; merge instead of deleting");
  await ctx.db.guest.update({ where: { id: g.id }, data: { deletedAt: new Date() } });
  await audit(ctx.db, ctx.actor, "guest.deleted", "Guest", g.id, { before: { code: g.code, fullName: g.fullName } });
  return { ok: true };
});

/** Authenticated access to uploaded guest documents and photos. */
route("GET", "/files/:name", { perm: ["guests.view", "frontdesk.checkin", "rooms.view", "maintenance.view", "maintenance.create", "maintenance.manage"], allowReadOnly: true }, async (ctx) => {
  // Guest identity documents/photos (id-*, photo-*) are personal data: only people who can see guests may read them.
  if (/^(id|photo)-/.test(ctx.params.name)) ctx.need("guests.view", "frontdesk.checkin");
  const f = readUpload(ctx.params.name);
  return new Response(new Uint8Array(f.data), { headers: { "content-type": f.type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
});

// ── companies ────────────────────────────────────────────────────────────────
route("GET", "/companies", { perm: ["guests.companies", "guests.view", "reservations.create", "ledger.view"], allowReadOnly: true }, async (ctx) => {
  const q = (ctx.query.get("q") ?? "").trim();
  const where: Record<string, unknown> = { deletedAt: null };
  if (q) where.OR = [{ name: { contains: q } }, { code: { contains: q.toUpperCase() } }];
  if (ctx.query.get("active") === "1") where.active = true;
  return ctx.db.company.findMany({ where, orderBy: { name: "asc" }, take: 500 });
});

route("GET", "/companies/:id", { perm: ["guests.companies", "ledger.view"], allowReadOnly: true }, async (ctx) => {
  const c = await ctx.db.company.findUnique({ where: { id: ctx.params.id } });
  if (!c || c.deletedAt) throw notFound("Company");
  return c;
});

route("POST", "/companies", { perm: "guests.companies" }, async (ctx) => {
  const b = await ctx.body(companySchema);
  const c = await tx(ctx.db, async (t) => {
    const code = b.code || (await nextNumber(t, "company", ctx.businessDate));
    const c = await t.company.create({ data: { ...b, code, ratePlanId: b.ratePlanId || null, createdById: ctx.user?.id } });
    await audit(t, ctx.actor, "company.created", "Company", c.id, { after: b });
    return c;
  });
  publish("guests", "company", c.id, ctx.user?.id);
  return c;
});

route("PUT", "/companies/:id", { perm: "guests.companies" }, async (ctx) => {
  const b = await ctx.body(companySchema);
  const before = await ctx.db.company.findUnique({ where: { id: ctx.params.id } });
  if (!before || before.deletedAt) throw notFound("Company");
  const after = await ctx.db.company.update({ where: { id: before.id }, data: { ...b, code: b.code || before.code, ratePlanId: b.ratePlanId || null, updatedById: ctx.user?.id } });
  await audit(ctx.db, ctx.actor, "company.updated", "Company", before.id, { before, after: b });
  publish("guests", "company", before.id, ctx.user?.id);
  return after;
});

route("DELETE", "/companies/:id", { perm: "guests.companies" }, async (ctx) => {
  const c = await ctx.db.company.findUnique({ where: { id: ctx.params.id }, include: { _count: { select: { reservations: true, folios: true } } } });
  if (!c || c.deletedAt) throw notFound("Company");
  if (c._count.folios) throw new ApiError(409, "IN_USE", "This company has folios; deactivate it instead");
  await ctx.db.company.update({ where: { id: c.id }, data: { deletedAt: new Date(), active: false } });
  await audit(ctx.db, ctx.actor, "company.deleted", "Company", c.id, { before: { code: c.code, name: c.name } });
  return { ok: true };
});
