// Night audit planning. Pure function: given the state at the end of a business date, returns what the audit
// must do. The server executes the plan in one transaction and then advances the business date.
import { addDays, type ISODate } from "./dates";
import { rateForNight } from "./rates";
import type { Poisha } from "./money";

export interface AuditStay {
  id: string; // reservation room id
  reservationId: string;
  confirmationNo: string;
  guestName: string;
  roomNumber: string | null;
  arrivalDate: ISODate;
  departureDate: ISODate;
  status: string; // RESERVED | CHECKED_IN | CHECKED_OUT | CANCELLED | NO_SHOW
  nightlyRates: { date: string; amount: Poisha }[];
}

export interface AuditPlan {
  businessDate: ISODate;
  nextBusinessDate: ISODate;
  roomCharges: { stayId: string; roomNumber: string; amount: Poisha; date: ISODate }[];
  noShows: AuditStay[];
  overdueDepartures: AuditStay[];
  pendingArrivals: AuditStay[];
  blocking: string[]; // reasons the audit cannot proceed
}

/**
 * @param postedRoomNights set of "stayId|date" that already have a room charge (idempotency: re-running the
 *        audit after a crash never double posts)
 * @param requireDeparturesResolved when true, in-house guests past their departure block the audit
 */
export function planNightAudit(businessDate: ISODate, stays: AuditStay[], postedRoomNights: Set<string>, opts: { requireDeparturesResolved?: boolean } = {}): AuditPlan {
  const roomCharges: AuditPlan["roomCharges"] = [];
  const noShows: AuditStay[] = [];
  const overdue: AuditStay[] = [];
  const pending: AuditStay[] = [];
  for (const s of stays) {
    if (s.status === "CHECKED_IN") {
      if (s.departureDate <= businessDate) {
        overdue.push(s);
        continue;
      }
      if (s.arrivalDate <= businessDate && !postedRoomNights.has(`${s.id}|${businessDate}`)) {
        roomCharges.push({ stayId: s.id, roomNumber: s.roomNumber ?? "", amount: rateForNight(s.nightlyRates, businessDate), date: businessDate });
      }
    } else if (s.status === "RESERVED") {
      if (s.arrivalDate < businessDate) noShows.push(s);
      else if (s.arrivalDate === businessDate) pending.push(s);
    }
  }
  const blocking: string[] = [];
  if (opts.requireDeparturesResolved && overdue.length) blocking.push(`${overdue.length} guest(s) are past their departure date: check out or extend the stay`);
  return { businessDate, nextBusinessDate: addDays(businessDate, 1), roomCharges, noShows, overdueDepartures: overdue, pendingArrivals: pending, blocking };
}

/** Is the night audit overdue? (calendar date moved past the business date and audit time has passed) */
export function auditOverdue(businessDate: ISODate, calendarToday: ISODate, nowHHMM: string, auditTime = "02:00"): boolean {
  if (calendarToday > addDays(businessDate, 1)) return true;
  return calendarToday === addDays(businessDate, 1) && nowHHMM >= auditTime;
}
