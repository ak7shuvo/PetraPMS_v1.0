// Housekeeping: task creation, daily task generation, status transitions keeping Room.hkStatus in sync.
import type { Db, Tx } from "../db";
import { audit, type AuditActor } from "../common";
import { ApiError, notFound } from "../errors";
import { getSection } from "../settings";

export const HK_TASK_TYPES = ["CHECKOUT_CLEAN", "STAYOVER", "DEEP_CLEAN", "TURNDOWN", "INSPECTION", "CUSTOM"] as const;
export const HK_TASK_STATUSES = ["PENDING", "IN_PROGRESS", "DONE", "INSPECTED", "SKIPPED"] as const;

export async function createHkTask(tx: Tx | Db, t: { roomId: string; type: string; priority?: number; businessDate: string; notes?: string; assignedToId?: string | null; isDemo?: boolean }, actor: AuditActor) {
  // one open task per room & type per day
  const existing = await tx.housekeepingTask.findFirst({ where: { roomId: t.roomId, type: t.type, businessDate: t.businessDate, status: { in: ["PENDING", "IN_PROGRESS"] } } });
  if (existing) return existing;
  const task = await tx.housekeepingTask.create({ data: { roomId: t.roomId, type: t.type, priority: t.priority ?? 2, businessDate: t.businessDate, notes: t.notes ?? "", assignedToId: t.assignedToId ?? null, createdById: actor.userId ?? null, isDemo: t.isDemo ?? false } });
  return task;
}

/** Generates the day's stayover tasks for occupied rooms (run by night audit and on demand). */
export async function generateDailyTasks(tx: Tx | Db, businessDate: string, actor: AuditActor) {
  const s = await getSection(tx, "housekeeping");
  let created = 0;
  if (s.stayoverDaily) {
    const inHouse = await tx.reservationRoom.findMany({ where: { status: "CHECKED_IN", roomId: { not: null }, departureDate: { gt: businessDate } }, select: { roomId: true } });
    for (const r of inHouse) {
      const before = await tx.housekeepingTask.count({ where: { roomId: r.roomId!, businessDate, type: "STAYOVER" } });
      if (!before) {
        await createHkTask(tx, { roomId: r.roomId!, type: "STAYOVER", priority: 2, businessDate }, actor);
        created++;
      }
    }
  }
  // dirty rooms with no open task get a cleaning task
  const dirty = await tx.room.findMany({ where: { active: true, hkStatus: "DIRTY" }, select: { id: true } });
  for (const r of dirty) {
    const open = await tx.housekeepingTask.count({ where: { roomId: r.id, status: { in: ["PENDING", "IN_PROGRESS"] } } });
    if (!open) {
      await createHkTask(tx, { roomId: r.id, type: "CHECKOUT_CLEAN", priority: 1, businessDate }, actor);
      created++;
    }
  }
  return created;
}

/**
 * Task status transition. Room status follows:
 *   IN_PROGRESS → room IN_PROGRESS; DONE → room CLEAN (or stays CLEAN-awaiting-inspection when inspection is
 *   required: room CLEAN, task DONE); INSPECTED → room INSPECTED.
 */
export async function setTaskStatus(tx: Tx, taskId: string, status: (typeof HK_TASK_STATUSES)[number], actor: AuditActor, opts: { version?: number; notes?: string; isSupervisor: boolean }) {
  const t = await tx.housekeepingTask.findUnique({ where: { id: taskId }, include: { room: true } });
  if (!t) throw notFound("Task");
  if (opts.version !== undefined && t.version !== opts.version) throw new ApiError(409, "VERSION_CONFLICT", "This task was changed by someone else. Reload and try again.", { current: t });
  if (!opts.isSupervisor && t.assignedToId && t.assignedToId !== actor.userId) throw new ApiError(403, "NOT_YOUR_TASK", "This task is assigned to another housekeeper");
  if ((status === "INSPECTED" || status === "SKIPPED") && !opts.isSupervisor) throw new ApiError(403, "FORBIDDEN", "Only a supervisor can inspect or skip tasks", { permission: "housekeeping.assign" });
  if (status === "INSPECTED" && t.status !== "DONE") throw new ApiError(409, "NOT_DONE", "Only finished tasks can be inspected");
  const now = new Date();
  const data: Record<string, unknown> = { status, version: { increment: 1 }, notes: opts.notes ?? t.notes };
  if (status === "IN_PROGRESS") data.startedAt = t.startedAt ?? now;
  if (status === "DONE") {
    data.completedAt = now;
    const started = t.startedAt ?? now;
    data.minutes = Math.max(1, Math.round((now.getTime() - started.getTime()) / 60000));
  }
  if (status === "INSPECTED") {
    data.inspectedAt = now;
    data.inspectedById = actor.userId ?? null;
  }
  if (status === "PENDING") Object.assign(data, { startedAt: null, completedAt: null });
  const after = await tx.housekeepingTask.update({ where: { id: t.id }, data });
  const roomStatus: Record<string, string | null> = { IN_PROGRESS: "IN_PROGRESS", DONE: "CLEAN", INSPECTED: "INSPECTED", PENDING: t.type === "STAYOVER" || t.type === "TURNDOWN" ? null : "DIRTY", SKIPPED: null };
  const next = roomStatus[status];
  if (next && ["CHECKOUT_CLEAN", "STAYOVER", "DEEP_CLEAN", "INSPECTION", "CUSTOM"].includes(t.type)) await tx.room.update({ where: { id: t.roomId }, data: { hkStatus: next, version: { increment: 1 } } });
  await audit(tx, actor, "housekeeping.task", "HousekeepingTask", t.id, { before: { status: t.status }, after: { status, room: t.room.number } });
  return after;
}
