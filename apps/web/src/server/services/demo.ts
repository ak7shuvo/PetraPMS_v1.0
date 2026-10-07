// Demo data for sales demos and training: realistic Bangladeshi hotel activity around the current business date
// (history with invoices, in-house guests with folios, today's arrivals/departures, future bookings, a group,
// cancellations, housekeeping, maintenance, lost & found). Every row is flagged isDemo so "Clear demo data"
// removes exactly what was added and never touches real data.
import { addDays, eachNight, toNightlyRates } from "@petra/core";
import type { Db, Tx } from "../db";
import { audit, nextNumber, type AuditActor } from "../common";
import { ApiError } from "../errors";
import { lockedTx } from "../lock";
import { getBusinessDate } from "../common";
import { hashSecret } from "../auth";
import { quoteStay } from "./pricing";
import { addPayment, openFolio, postCharge } from "./folio";
import { createReservation } from "./reservations";
import { publish } from "../events";

const FIRST = ["Rahim", "Karim", "Ayesha", "Fatema", "Tanvir", "Nusrat", "Sabbir", "Farhana", "Imran", "Sumaiya", "Arif", "Mitu", "Shakil", "Jannat", "Mahmud", "Rumana", "Hasan", "Tania", "Rafiq", "Sharmin", "Anisur", "Moushumi", "Zahid", "Lima", "Kamal", "Nasrin", "Faisal", "Rupa", "Sohel", "Puja"];
const LAST = ["Ahmed", "Hossain", "Rahman", "Islam", "Chowdhury", "Khan", "Uddin", "Akter", "Begum", "Sarkar", "Talukder", "Mia", "Das", "Roy", "Siddiqui", "Bhuiyan", "Molla", "Sheikh"];
const FOREIGN = [
  { firstName: "John", lastName: "Miller", nationality: "GB", passportNumber: "533812907", visaNumber: "BD-V-772310", visaType: "Business", arrivalFrom: "London", purposeOfVisit: "Business" },
  { firstName: "Hiroshi", lastName: "Tanaka", nationality: "JP", passportNumber: "TK4471239", visaNumber: "BD-V-772311", visaType: "Business", arrivalFrom: "Tokyo", purposeOfVisit: "Garment buying" },
  { firstName: "Priya", lastName: "Sharma", nationality: "IN", passportNumber: "Z4410982", visaNumber: "BD-V-772312", visaType: "Tourist", arrivalFrom: "Kolkata", purposeOfVisit: "Tourism" },
  { firstName: "Li", lastName: "Wei", nationality: "CN", passportNumber: "E88123456", visaNumber: "BD-V-772313", visaType: "Work", arrivalFrom: "Guangzhou", purposeOfVisit: "Project work" },
];
const CITIES = ["Dhaka", "Chattogram", "Sylhet", "Khulna", "Rajshahi", "Cox's Bazar", "Barishal", "Rangpur", "Cumilla", "Gazipur"];

/** Deterministic PRNG so demo data is the same on every install (easier training material). */
function rng(seed = 20261003) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

export async function hasDemoData(db: Db | Tx) {
  return (await db.guest.count({ where: { isDemo: true } })) > 0 || (await db.reservation.count({ where: { isDemo: true } })) > 0;
}

export async function loadDemoData(db: Db, actor: AuditActor) {
  if (await hasDemoData(db)) throw new ApiError(409, "DEMO_EXISTS", "Demo data is already loaded. Clear it first.");
  const bd = await getBusinessDate(db);
  const r = rng();
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const A: AuditActor = { ...actor, businessDate: bd };
  const who = { me: null, actor: A, businessDate: bd, isDemo: true, system: true };

  // ── masters ────────────────────────────────────────────────────────────────
  const base = await lockedTx(db, async (tx) => {
    let types = await tx.roomType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
    if (!types.length) {
      const defs = [
        { code: "STD", name: "Standard", nameBn: "স্ট্যান্ডার্ড", baseRate: 4500_00, bedType: "DOUBLE" },
        { code: "DLX", name: "Deluxe", nameBn: "ডিলাক্স", baseRate: 6500_00, bedType: "QUEEN" },
        { code: "STE", name: "Suite", nameBn: "স্যুইট", baseRate: 12000_00, bedType: "KING" },
      ];
      for (const [i, d] of defs.entries()) await tx.roomType.create({ data: { ...d, sortOrder: i, extraBedRate: 1000_00, isDemo: true } });
      types = await tx.roomType.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
      let n = 0;
      for (const floor of [1, 2, 3]) for (let k = 1; k <= 8; k++) await tx.room.create({ data: { number: `${floor}${String(k).padStart(2, "0")}`, floor: String(floor), roomTypeId: types[Math.min(types.length - 1, Math.floor(n++ / 10))].id, isDemo: true } });
    }
    for (const [code, name, nameBn] of [
      ["AC", "Air conditioning", "এয়ার কন্ডিশনার"],
      ["WIFI", "Free Wi-Fi", "ফ্রি ওয়াই-ফাই"],
      ["TV", "Smart TV", "স্মার্ট টিভি"],
      ["HW", "Hot water", "গরম পানি"],
      ["MINI", "Minibar", "মিনিবার"],
    ]) {
      if (!(await tx.amenity.findUnique({ where: { code } }))) await tx.amenity.create({ data: { code, name, nameBn } });
    }
    const bb = (await tx.ratePlan.findUnique({ where: { code: "BB" } })) ?? (await tx.ratePlan.create({ data: { code: "BB", name: "Bed & Breakfast", nameBn: "রুম ও নাস্তা", type: "PACKAGE", mealPlan: "BB", mealPricePerAdult: 450_00, mealPricePerChild: 250_00, cancellationPolicyId: (await tx.cancellationPolicy.findUnique({ where: { code: "FLEX24" } }))?.id ?? null, isDemo: true } }));
    const corp = (await tx.ratePlan.findUnique({ where: { code: "CORP" } })) ?? (await tx.ratePlan.create({ data: { code: "CORP", name: "Corporate", nameBn: "কর্পোরেট", type: "CORPORATE", mealPlan: "BB", mealPricePerAdult: 0, adjustmentType: "PERCENT", adjustmentValue: -1500, cancellationPolicyId: (await tx.cancellationPolicy.findUnique({ where: { code: "FLEX24" } }))?.id ?? null, isDemo: true } }));
    const ota = (await tx.ratePlan.findUnique({ where: { code: "OTA" } })) ?? (await tx.ratePlan.create({ data: { code: "OTA", name: "Online travel agency", type: "OTA", mealPlan: "RO", adjustmentType: "PERCENT", adjustmentValue: 500, cancellationPolicyId: (await tx.cancellationPolicy.findUnique({ where: { code: "NONREF" } }))?.id ?? null, isDemo: true } }));
    const rack = await tx.ratePlan.findFirst({ where: { type: "RACK" } });
    await tx.rateSeason.create({ data: { name: "Winter peak (Cox's Bazar season)", startDate: addDays(bd, 20), endDate: addDays(bd, 80), adjustmentType: "PERCENT", value: 2000, isDemo: true } });
    await tx.rateSeason.create({ data: { name: "Weekend uplift", startDate: bd, endDate: addDays(bd, 365), adjustmentType: "PERCENT", value: 1000, daysOfWeek: "[4,5]", priority: 1, isDemo: true } });
    const companies = [];
    for (const [name, contact, limit] of [
      ["Grameen Textiles Ltd.", "Mr. Habib", 300_000_00],
      ["Padma Pharmaceuticals", "Ms. Shirin", 200_000_00],
      ["Delta Engineering Consultants", "Mr. Alam", 150_000_00],
    ] as const) {
      const code = await nextNumber(tx, "company", bd);
      companies.push(await tx.company.create({ data: { code, name, contactPerson: contact, phone: "+8801711" + String(Math.floor(r() * 900000) + 100000), email: `accounts@${name.split(" ")[0].toLowerCase()}.com.bd`, address: `${pick(["Gulshan", "Motijheel", "Agrabad", "Uttara", "Banani"])}, ${pick(CITIES)}`, bin: String(Math.floor(r() * 9e12) + 1e12), creditLimit: limit, paymentTermsDays: 30, ratePlanId: corp.id, isDemo: true } }));
    }
    // guests
    const guests = [];
    for (let i = 0; i < 36; i++) {
      const firstName = FIRST[i % FIRST.length];
      const lastName = pick(LAST);
      const code = await nextNumber(tx, "guest", bd);
      guests.push(
        await tx.guest.create({
          data: {
            code,
            firstName,
            lastName,
            fullName: `${firstName} ${lastName}`,
            title: i % 3 === 2 ? "Ms" : "Mr",
            phone: `+88017${String(10000000 + Math.floor(r() * 89999999))}`,
            email: i % 2 ? `${firstName.toLowerCase()}.${lastName.toLowerCase()}@example.com` : "",
            gender: i % 3 === 2 ? "F" : "M",
            nationality: "BD",
            idType: "NID",
            idNumber: String(Math.floor(r() * 9e9) + 1e9),
            city: pick(CITIES),
            address: `House ${Math.floor(r() * 90) + 1}, Road ${Math.floor(r() * 20) + 1}, ${pick(CITIES)}`,
            vip: i % 11 === 0 ? 1 : 0,
            companyId: i % 7 === 0 ? companies[i % companies.length].id : null,
            preferences: i % 5 === 0 ? "High floor, extra pillows" : "",
            isDemo: true,
          },
        }),
      );
    }
    for (const f of FOREIGN) {
      const code = await nextNumber(tx, "guest", bd);
      guests.push(await tx.guest.create({ data: { code, ...f, fullName: `${f.firstName} ${f.lastName}`, passportExpiry: addDays(bd, 900), visaExpiry: addDays(bd, 60), arrivalDateBd: addDays(bd, -2), portOfEntry: "Hazrat Shahjalal Intl. Airport", country: f.nationality, idType: "PASSPORT", idNumber: f.passportNumber, phone: "", email: `${f.firstName.toLowerCase()}@example.org`, isDemo: true } }));
    }
    const blacklisted = guests[guests.length - FOREIGN.length - 1];
    await tx.guest.update({ where: { id: blacklisted.id }, data: { blacklisted: true, blacklistReason: "Damaged room property (demo)" } });
    return { types, plans: { bb, corp, ota, rack }, companies, guests: guests.filter((g) => g.id !== blacklisted.id) };
  });

  const rooms = await db.room.findMany({ where: { active: true }, orderBy: { number: "asc" } });
  const roomsByType = new Map<string, typeof rooms>();
  for (const rm of rooms) roomsByType.set(rm.roomTypeId, [...(roomsByType.get(rm.roomTypeId) ?? []), rm]);
  let g = 0;
  const nextGuest = () => base.guests[g++ % base.guests.length];
  const used = new Set<string>();
  const takeRoom = (pred: (rm: (typeof rooms)[number]) => boolean = () => true) => {
    const rm = rooms.find((x) => !used.has(x.id) && pred(x));
    if (rm) used.add(rm.id);
    return rm ?? null;
  };

  // ── history (checked out) and in-house stays: written directly with past dates ─────────────────────
  await lockedTx(db, async (tx) => {
    const histories = Math.min(14, Math.floor(rooms.length * 0.6));
    for (let i = 0; i < histories; i++) {
      const rm = rooms[i % rooms.length];
      const nights = 1 + Math.floor(r() * 3);
      const dep = addDays(bd, -1 - Math.floor(r() * 20));
      const arr = addDays(dep, -nights);
      const guest = nextGuest();
      await pastStay(tx, { roomId: rm.id, roomTypeId: rm.roomTypeId, roomNumber: rm.number, arrival: arr, departure: dep, guestId: guest.id, guestName: guest.fullName, companyId: i % 6 === 0 ? base.companies[0].id : null, ratePlanId: i % 3 === 0 ? base.plans.bb.id : (base.plans.rack?.id ?? null), status: "CHECKED_OUT", A, extras: i % 2 === 0, method: pick(["CASH", "CARD", "BKASH", "NAGAD"]) });
    }
    // in-house guests (about 45% occupancy tonight)
    const inHouse = Math.max(3, Math.floor(rooms.length * 0.45));
    for (let i = 0; i < inHouse; i++) {
      const rm = takeRoom();
      if (!rm) break;
      const dueOut = i < 3; // first three are due out today
      const arr = addDays(bd, dueOut ? -1 - Math.floor(r() * 2) : -Math.floor(r() * 3));
      const dep = dueOut ? bd : addDays(bd, 1 + Math.floor(r() * 4));
      const guest = i === 1 ? base.guests[base.guests.length - 1] : nextGuest(); // one foreign in-house guest
      await pastStay(tx, { roomId: rm.id, roomTypeId: rm.roomTypeId, roomNumber: rm.number, arrival: arr, departure: dep, guestId: guest.id, guestName: guest.fullName, companyId: i % 5 === 0 ? base.companies[1].id : null, ratePlanId: i % 2 ? base.plans.bb.id : (base.plans.rack?.id ?? null), status: "CHECKED_IN", A, extras: i % 3 === 0, method: pick(["CASH", "BKASH", "CARD"]) });
    }
    // rooms to clean
    const dirty = rooms.filter((x) => !used.has(x.id)).slice(0, 3);
    for (const d of dirty) {
      await tx.room.update({ where: { id: d.id }, data: { hkStatus: "DIRTY" } });
      await tx.housekeepingTask.create({ data: { roomId: d.id, businessDate: bd, type: "CHECKOUT_CLEAN", priority: 1, isDemo: true } });
    }
  });

  // ── today's arrivals and future bookings through the normal booking service (availability enforced) ───
  const typeIds = base.types.map((t) => t.id);
  const book = async (offset: number, nights: number, typeIdx: number, extra: Partial<Parameters<typeof createReservation>[1]> = {}, roomsCount = 1) => {
    const arrival = addDays(bd, offset);
    const typeId = typeIds[typeIdx % typeIds.length];
    try {
      return await createReservation(
        db,
        {
          guestId: nextGuest().id,
          status: "CONFIRMED",
          source: pick(["PHONE", "WALK_IN", "OTA", "WEBSITE", "CORPORATE"] as const),
          sourceRef: "",
          agentName: "",
          arrival,
          departure: addDays(arrival, nights),
          rooms: Array.from({ length: roomsCount }, () => ({ roomTypeId: typeId, adults: 2, children: 0, extraBeds: 0, discountBp: 0, ratePlanId: base.plans.bb.id })),
          isGroup: roomsCount > 1,
          groupName: "",
          eta: offset === 0 ? pick(["13:00", "15:30", "18:00", "21:00"]) : "",
          specialRequests: "",
          notes: "",
          depositRequired: 0,
          paymentTerms: "GUEST",
          autoAssign: offset <= 1,
          ...extra,
        },
        who,
      );
    } catch {
      return null; // full on that date: skip (demo must never fail on small hotels)
    }
  };
  for (let i = 0; i < Math.max(2, Math.floor(rooms.length * 0.15)); i++) await book(0, 1 + (i % 3), i);
  for (let i = 0; i < Math.max(4, Math.floor(rooms.length * 0.4)); i++) await book(1 + Math.floor(r() * 25), 1 + Math.floor(r() * 4), i);
  await book(3, 2, 0, { isGroup: true, groupName: "Padma Pharma sales conference", companyId: base.companies[1].id, ratePlanId: base.plans.corp.id, source: "CORPORATE", paymentTerms: "COMPANY" } as never, Math.min(5, Math.max(2, Math.floor(rooms.length / 8))));
  const dep = await book(5, 3, 1, { deposit: { method: "BKASH", amount: 3000_00, reference: "BK8F3K29QX" }, depositRequired: 3000_00 });
  void dep;
  const cancelled = await book(7, 2, 0);
  if (cancelled) {
    await db.reservationRoom.updateMany({ where: { reservationId: cancelled.id }, data: { status: "CANCELLED", roomId: null } });
    await db.reservation.update({ where: { id: cancelled.id }, data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: "Change of plans (demo)" } });
  }
  await book(10, 2, 2, { status: "TENTATIVE" });

  // ── housekeeping, maintenance, lost & found, linen, shift notes ───────────────────────────────────────
  await lockedTx(db, async (tx) => {
    const inHouseRooms = await tx.reservationRoom.findMany({ where: { status: "CHECKED_IN", roomId: { not: null } }, select: { roomId: true } });
    for (const s of inHouseRooms.slice(0, 6)) await tx.housekeepingTask.create({ data: { roomId: s.roomId!, businessDate: bd, type: "STAYOVER", isDemo: true } });
    const free = rooms.filter((x) => !used.has(x.id));
    const ticketRoom = free[free.length - 1] ?? rooms[rooms.length - 1];
    const tickets = [
      { title: "AC not cooling", category: "AC", priority: "HIGH", roomId: ticketRoom.id, hours: 8 },
      { title: "Bathroom tap leaking", category: "PLUMBING", priority: "MEDIUM", roomId: rooms[0].id, hours: 24 },
      { title: "Lobby Wi-Fi access point offline", category: "IT", priority: "LOW", roomId: null, hours: 72, area: "Lobby" },
    ];
    for (const t of tickets) {
      const number = await nextNumber(tx, "maintenance", bd);
      await tx.maintenanceTicket.create({ data: { number, title: t.title, category: t.category, priority: t.priority, roomId: t.roomId, area: t.area ?? "", slaDueAt: new Date(Date.now() + t.hours * 3600_000), isDemo: true, createdById: A.userId ?? null } });
    }
    await tx.roomBlock.create({ data: { roomId: ticketRoom.id, type: "MAINTENANCE", startDate: bd, endDate: addDays(bd, 2), reason: "AC repair (demo)", isDemo: true } });
    await tx.preventiveSchedule.create({ data: { title: "Generator service", area: "Generator room", category: "ELECTRICAL", intervalDays: 30, nextDueDate: addDays(bd, 4), isDemo: true } });
    await tx.preventiveSchedule.create({ data: { title: "AC filter cleaning", category: "AC", intervalDays: 90, nextDueDate: addDays(bd, 12), isDemo: true } });
    for (const [code, name, par] of [
      ["BS-K", "Bed sheet (king)", 120],
      ["BS-D", "Bed sheet (double)", 160],
      ["TW-B", "Bath towel", 220],
      ["TW-H", "Hand towel", 220],
      ["PC", "Pillow cover", 300],
    ] as const) {
      if (!(await tx.linenItem.findUnique({ where: { code } }))) await tx.linenItem.create({ data: { code, name, par, inStore: Math.floor(par * 0.5), inUse: Math.floor(par * 0.35), inLaundry: Math.floor(par * 0.12), damaged: 3, isDemo: true } });
    }
    const itemNo = await nextNumber(tx, "lostfound", bd);
    await tx.lostFound.create({ data: { itemNo, roomId: rooms[1]?.id ?? null, description: "Black leather wallet", foundBy: "Housekeeping", isDemo: true } });
    await tx.shiftNote.create({ data: { businessDate: bd, shift: "MORNING", text: "Group from Padma Pharma arriving in 3 days – prepare welcome drinks. Room AC repair ongoing.", authorName: "Demo", acknowledgedBy: "[]" } });
    // demo staff accounts (one per main role) for role-switching demos; removed with Clear demo data
    const pw = await hashSecret("Demo@1234");
    const pin = await hashSecret("7391");
    for (const [username, fullName, roleCode] of [
      ["demo.gm", "Demo General Manager", "GM"],
      ["demo.fd", "Demo Receptionist", "RECEPTIONIST"],
      ["demo.hk", "Demo Housekeeper", "HOUSEKEEPER"],
      ["demo.acc", "Demo Accountant", "ACCOUNTANT"],
    ]) {
      const role = await tx.role.findUnique({ where: { code: roleCode } });
      if (role && !(await tx.user.findUnique({ where: { username } }))) await tx.user.create({ data: { username, fullName, roleId: role.id, passwordHash: pw, pinHash: pin, isDemo: true } });
    }
    await audit(tx, A, "demo.loaded", "System", "demo");
  });
  publish("system", "demoLoaded");
  return { ok: true };
}

interface PastStay {
  roomId: string;
  roomTypeId: string;
  roomNumber: string;
  arrival: string;
  departure: string;
  guestId: string;
  guestName: string;
  companyId: string | null;
  ratePlanId: string | null;
  status: "CHECKED_IN" | "CHECKED_OUT";
  A: AuditActor;
  extras: boolean;
  method: string;
}

/** Writes a historical / in-house stay with folio charges for nights up to the business date. */
async function pastStay(tx: Tx, p: PastStay) {
  const bd = p.A.businessDate!;
  const q = await quoteStay(tx, { roomTypeId: p.roomTypeId, ratePlanId: p.ratePlanId, arrival: p.arrival, departure: p.departure, adults: 2, children: 0 });
  const confirmationNo = await nextNumber(tx, "reservation", p.arrival < bd ? p.arrival : bd);
  const res = await tx.reservation.create({ data: { confirmationNo, status: p.status, source: "PHONE", guestId: p.guestId, companyId: p.companyId, arrivalDate: p.arrival, departureDate: p.departure, adults: 2, ratePlanId: p.ratePlanId, isDemo: true, createdById: p.A.userId ?? null } });
  const stay = await tx.reservationRoom.create({ data: { reservationId: res.id, roomTypeId: p.roomTypeId, roomId: p.roomId, arrivalDate: p.arrival, departureDate: p.departure, adults: 2, ratePlanId: p.ratePlanId, nightlyRates: JSON.stringify(toNightlyRates(q)), status: p.status, checkedInAt: new Date(Date.parse(p.arrival + "T08:00:00Z")), checkedOutAt: p.status === "CHECKED_OUT" ? new Date(Date.parse(p.departure + "T06:00:00Z")) : null, isDemo: true } });
  const f = await openFolio(tx, { name: p.guestName, reservationId: res.id, reservationRoomId: stay.id, guestId: p.guestId, companyId: p.companyId, isDemo: true }, p.A, bd);
  for (const n of q.nights) {
    if (n.date >= bd) break; // tonight's room charge is posted by the night audit
    await postCharge(tx, { folioId: f.id, chargeCode: "ROOM", amount: n.amount, description: `Room ${p.roomNumber} – ${n.date}`, businessDate: n.date, source: "NIGHT_AUDIT", sourceRef: `room:${stay.id}:${n.date}`, reservationRoomId: stay.id, roomNumber: p.roomNumber, route: false, isDemo: true }, p.A);
  }
  if (p.extras) {
    const day = p.arrival < bd ? p.arrival : bd;
    await postCharge(tx, { folioId: f.id, chargeCode: "REST", amount: 1450_00, description: "Restaurant – dinner", businessDate: day, source: "POS", sourceRef: `demo-pos-${stay.id}`, roomNumber: p.roomNumber, route: false, isDemo: true }, p.A);
    await postCharge(tx, { folioId: f.id, chargeCode: "LNDRY", amount: 380_00, description: "Laundry", businessDate: day, roomNumber: p.roomNumber, route: false, isDemo: true }, p.A);
  }
  const charges = await tx.folioCharge.findMany({ where: { folioId: f.id } });
  const total = charges.reduce((a, c) => a + c.total, 0);
  if (p.status === "CHECKED_OUT") {
    if (total > 0) await addPayment(tx, { folioId: f.id, type: "PAYMENT", method: p.method, amount: total, reference: p.method === "CASH" ? "" : `DEMO${Math.floor(Math.random() * 1e6)}`, businessDate: p.departure, isDemo: true }, p.A);
    await tx.folio.update({ where: { id: f.id }, data: { status: "SETTLED", closedAt: new Date() } });
    await tx.guest.update({ where: { id: p.guestId }, data: { totalStays: { increment: 1 }, totalNights: { increment: eachNight(p.arrival, p.departure).length }, totalSpend: { increment: total }, lastStayAt: p.departure } });
  } else if (total > 0) {
    await addPayment(tx, { folioId: f.id, type: "DEPOSIT", method: p.method, amount: Math.round(total / 2 / 100) * 100, reference: p.method === "CASH" ? "" : `DEMO${Math.floor(Math.random() * 1e6)}`, businessDate: p.arrival < bd ? p.arrival : bd, isDemo: true }, p.A);
  }
}

/** Removes every demo row (children first). Real data is never touched. */
export async function clearDemoData(db: Db, actor: AuditActor) {
  await lockedTx(db, async (tx) => {
    const demoFolios = (await tx.folio.findMany({ where: { OR: [{ isDemo: true }, { reservation: { isDemo: true } }] }, select: { id: true } })).map((f) => f.id);
    await tx.invoice.deleteMany({ where: { folioId: { in: demoFolios } } });
    await tx.payment.deleteMany({ where: { folioId: { in: demoFolios } } });
    await tx.folioCharge.deleteMany({ where: { folioId: { in: demoFolios } } });
    await tx.folio.deleteMany({ where: { id: { in: demoFolios } } });
    const demoRes = (await tx.reservation.findMany({ where: { isDemo: true }, select: { id: true } })).map((x) => x.id);
    await tx.roomMove.deleteMany({ where: { reservationRoom: { reservationId: { in: demoRes } } } });
    await tx.reservationRoom.deleteMany({ where: { reservationId: { in: demoRes } } });
    await tx.reservation.deleteMany({ where: { id: { in: demoRes } } });
    const dirtied = (await tx.housekeepingTask.findMany({ where: { isDemo: true, type: "CHECKOUT_CLEAN", status: { in: ["PENDING", "IN_PROGRESS"] } }, select: { roomId: true } })).map((t) => t.roomId);
    await tx.room.updateMany({ where: { id: { in: dirtied }, assignments: { none: { status: "CHECKED_IN" } } }, data: { hkStatus: "CLEAN" } });
    await tx.housekeepingTask.deleteMany({ where: { isDemo: true } });
    await tx.maintenanceTicket.deleteMany({ where: { isDemo: true } });
    await tx.preventiveSchedule.deleteMany({ where: { isDemo: true } });
    await tx.roomBlock.deleteMany({ where: { isDemo: true } });
    await tx.lostFound.deleteMany({ where: { isDemo: true } });
    await tx.linenItem.deleteMany({ where: { isDemo: true } });
    await tx.rateSeason.deleteMany({ where: { isDemo: true } });
    // guests/companies referenced by real reservations are kept (un-flagged) instead of deleted
    const keepGuests = (await tx.reservation.findMany({ where: { guest: { isDemo: true } }, select: { guestId: true } })).map((x) => x.guestId);
    await tx.guest.updateMany({ where: { id: { in: keepGuests } }, data: { isDemo: false } });
    await tx.guest.deleteMany({ where: { isDemo: true } });
    const keepCompanies = (await tx.reservation.findMany({ where: { company: { isDemo: true } }, select: { companyId: true } })).map((x) => x.companyId!).filter(Boolean);
    await tx.company.updateMany({ where: { id: { in: keepCompanies } }, data: { isDemo: false } });
    await tx.company.deleteMany({ where: { isDemo: true } });
    const usedPlans = (await tx.reservationRoom.findMany({ where: { ratePlanId: { not: null } }, select: { ratePlanId: true }, distinct: ["ratePlanId"] })).map((x) => x.ratePlanId!);
    await tx.ratePlan.deleteMany({ where: { isDemo: true, id: { notIn: usedPlans } } });
    const usedRooms = (await tx.reservationRoom.findMany({ where: { roomId: { not: null } }, select: { roomId: true }, distinct: ["roomId"] })).map((x) => x.roomId!);
    await tx.housekeepingTask.deleteMany({ where: { room: { isDemo: true } } });
    await tx.room.deleteMany({ where: { isDemo: true, id: { notIn: usedRooms } } });
    await tx.roomType.deleteMany({ where: { isDemo: true, rooms: { none: {} } } });
    const demoUsers = (await tx.user.findMany({ where: { isDemo: true }, select: { id: true } })).map((u) => u.id);
    await tx.userWindowSession.deleteMany({ where: { userId: { in: demoUsers } } });
    await tx.savedWorkspace.deleteMany({ where: { userId: { in: demoUsers } } });
    await tx.user.deleteMany({ where: { id: { in: demoUsers } } });
    await audit(tx, actor, "demo.cleared", "System", "demo");
  });
  publish("system", "demoCleared");
  return { ok: true };
}
