// Cancellation / no-show penalty calculation.
import { applyBp, type Poisha } from "./money";

export interface CancellationPolicyDef {
  freeUntilHours: number;
  penaltyType: "NONE" | "FIRST_NIGHT" | "PERCENT" | "FULL" | string;
  penaltyValue: number; // bp for PERCENT
  noShowType: "NONE" | "FIRST_NIGHT" | "PERCENT" | "FULL" | string;
}

function penalty(type: string, value: number, nightly: Poisha[]): Poisha {
  const total = nightly.reduce((a, n) => a + n, 0);
  switch (type) {
    case "FIRST_NIGHT":
      return nightly[0] ?? 0;
    case "PERCENT":
      return applyBp(total, value);
    case "FULL":
      return total;
    default:
      return 0;
  }
}

/**
 * @param arrivalAt check-in moment (arrival date + hotel check-in time) in ms
 * @param now      cancellation moment in ms
 * @param nightly  pre-tax nightly amounts of the stay
 */
export function cancellationPenalty(policy: CancellationPolicyDef | null, arrivalAt: number, now: number, nightly: Poisha[]): { free: boolean; hoursBefore: number; penalty: Poisha } {
  const hoursBefore = Math.floor((arrivalAt - now) / 3_600_000);
  if (!policy) return { free: true, hoursBefore, penalty: 0 };
  if (hoursBefore >= policy.freeUntilHours) return { free: true, hoursBefore, penalty: 0 };
  const p = penalty(policy.penaltyType, policy.penaltyValue, nightly);
  return { free: p === 0, hoursBefore, penalty: p };
}

export function noShowPenalty(policy: CancellationPolicyDef | null, nightly: Poisha[]): Poisha {
  if (!policy) return nightly[0] ?? 0;
  return penalty(policy.noShowType, policy.penaltyValue, nightly);
}

/** Epoch ms of arrival date at "HH:MM" in a fixed UTC offset (Bangladesh is UTC+6, no DST). */
export function arrivalMoment(arrivalDate: string, checkInTime = "14:00", utcOffsetMinutes = 360): number {
  const [h, m] = checkInTime.split(":").map(Number);
  return Date.parse(`${arrivalDate}T00:00:00Z`) + ((h || 0) * 60 + (m || 0) - utcOffsetMinutes) * 60_000;
}
