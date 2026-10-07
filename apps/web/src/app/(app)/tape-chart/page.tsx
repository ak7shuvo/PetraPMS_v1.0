"use client";
// Tape chart: rooms × nights. Drag a booking to move it in time or to another room, drag its right edge to
// change the departure, drag an unassigned booking onto a room to assign it. Every drop is validated by the
// server (availability, blocks, optimistic locking) — a conflicting change from another terminal is refused.
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Crown } from "lucide-react";
import { addDays, dayOfWeek, eachDay, nightsBetween } from "@petra/core";
import { get, patch } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { Button, Card, Input, PageHeader, Select, cn, errorToast, toast, useConfirm, useWithApproval } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface TRoom {
  id: string;
  number: string;
  floor: string;
  roomType: { id: string; code: string; name: string };
  hkStatus: string;
}
interface TStay {
  id: string;
  roomId: string;
  roomTypeId: string;
  reservationId: string;
  confirmationNo: string;
  guestName: string;
  vip: number;
  groupName: string;
  source: string;
  arrivalDate: string;
  departureDate: string;
  status: string;
  version: number;
}
interface TBlock {
  id: string;
  roomId: string;
  type: string;
  startDate: string;
  endDate: string;
  reason: string;
}
interface TUnassigned {
  id: string;
  roomTypeId: string;
  roomType: { code: string; name: string };
  reservationId: string;
  confirmationNo: string;
  guestName: string;
  groupName: string;
  arrivalDate: string;
  departureDate: string;
  version: number;
}
interface Tape {
  from: string;
  to: string;
  businessDate: string;
  rooms: TRoom[];
  stays: TStay[];
  blocks: TBlock[];
  unassigned: TUnassigned[];
  occupancy: { date: string; occupancyBp: number; sold: number; sellable: number }[];
}

const ROW = 34;
const LABEL = 132;
const BAR_COLOR: Record<string, string> = { RESERVED: "var(--st-reserved)", CHECKED_IN: "var(--st-occupied)", CHECKED_OUT: "#9b9488" };

type Drag = {
  kind: "move" | "resize" | "assign";
  stay: TStay | TUnassigned;
  startX: number;
  startY: number;
  dx: number;
  dy: number;
  origRow: number;
};

export default function TapeChartPage() {
  const t = useT();
  const f = useFmt();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const withApproval = useWithApproval();
  const { businessDate, can } = useSession();
  useTitle(t("nav.tapeChart"));
  const [from, setFrom] = useState("");
  const [days, setDays] = useState(21);
  const [W, setW] = useState(44);
  const [typeFilter, setTypeFilter] = useState("");
  const start = from || addDays(businessDate, -2);
  const q = useQuery({ queryKey: ["tape", start, days], queryFn: () => get<Tape>(`/tape-chart?from=${start}&days=${days}`) });
  const data = q.data;
  const rooms = useMemo(() => (data?.rooms ?? []).filter((r) => !typeFilter || r.roomType.id === typeFilter), [data, typeFilter]);
  const dates = useMemo(() => (data ? eachDay(data.from, data.to) : []), [data]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  const gridRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const editable = can("reservations.edit");

  const xOf = (d: string) => nightsBetween(start, d) * W;

  const commit = useCallback(
    async (dr: Drag) => {
      const dayShift = Math.round(dr.dx / W);
      const rowShift = Math.round(dr.dy / ROW);
      const s = dr.stay;
      let arrival = s.arrivalDate;
      let departure = s.departureDate;
      let roomId: string | undefined;
      if (dr.kind === "resize") departure = addDays(s.departureDate, dayShift);
      else if (dr.kind === "move") {
        if ((s as TStay).status !== "CHECKED_IN") {
          arrival = addDays(s.arrivalDate, dayShift);
          departure = addDays(s.departureDate, dayShift);
        }
        const target = rooms[dr.origRow + rowShift];
        if (target && target.id !== (s as TStay).roomId) roomId = target.id;
      } else if (dr.kind === "assign") {
        const rect = gridRef.current?.getBoundingClientRect();
        if (!rect) return;
        const row = Math.floor((dr.startY + dr.dy - rect.top - ROW) / ROW);
        const target = rooms[row];
        if (!target) return;
        roomId = target.id;
      }
      if (departure <= arrival) return;
      const unchanged = arrival === s.arrivalDate && departure === s.departureDate && !roomId;
      if (unchanged) return;
      if ((s as TStay).status === "CHECKED_IN" && roomId) {
        toast.info(t("tape.useMove"));
        return;
      }
      const target = roomId ? rooms.find((r) => r.id === roomId) : null;
      const msg = [
        arrival !== s.arrivalDate || departure !== s.departureDate ? `${f.date(s.arrivalDate)} – ${f.date(s.departureDate)}  →  ${f.date(arrival)} – ${f.date(departure)}` : null,
        target ? `${t("res.room")} → ${target.number} (${target.roomType.name})` : null,
      ]
        .filter(Boolean)
        .join("\n");
      const c = await confirm({ title: t("tape.confirmChange", { guest: s.guestName }), message: <pre className="whitespace-pre-wrap font-sans">{msg}</pre>, confirmLabel: t("common.save") });
      if (!c.ok) return;
      try {
        await withApproval((approval) => patch(`/stays/${s.id}`, { version: s.version, arrival, departure, ...(roomId ? { roomId } : {}), keepRates: true, approval }));
        toast.success(t("common.saved"));
      } catch (e) {
        errorToast(e);
      } finally {
        void qc.invalidateQueries({ queryKey: ["tape"] });
        void qc.invalidateQueries({ queryKey: ["rack"] });
      }
    },
    [W, rooms, confirm, withApproval, qc, t, f],
  );

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, dx: e.clientX - d.startX, dy: e.clientY - d.startY } : d));
    const up = () => {
      const d = dragRef.current;
      setDrag(null);
      const significant = !!d && (Math.abs(d.dx) > W / 2 || Math.abs(d.dy) > ROW / 2);
      moved.current = significant;
      setTimeout(() => (moved.current = false), 50);
      if (d && (significant || (d.kind === "assign" && Math.abs(d.dx) + Math.abs(d.dy) > 10))) void commit(d);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [drag, commit, W]);

  const begin = (e: React.PointerEvent, kind: Drag["kind"], stay: TStay | TUnassigned, row: number) => {
    if (!editable || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setDrag({ kind, stay, startX: e.clientX, startY: e.clientY, dx: 0, dy: 0, origRow: row });
  };

  const width = dates.length * W;

  return (
    <div>
      <PageHeader
        title={t("nav.tapeChart")}
        actions={
          <>
            <Button size="sm" icon={<ChevronLeft className="size-4" />} onClick={() => setFrom(addDays(start, -7))} />
            <Input type="date" value={start} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <Button size="sm" onClick={() => setFrom("")}>
              {t("common.today")}
            </Button>
            <Button size="sm" icon={<ChevronRight className="size-4" />} onClick={() => setFrom(addDays(start, 7))} />
            <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-28">
              {[14, 21, 31, 45, 62].map((n) => (
                <option key={n} value={n}>
                  {t("tape.days", { n })}
                </option>
              ))}
            </Select>
            <Select value={W} onChange={(e) => setW(Number(e.target.value))} className="w-24">
              <option value={32}>S</option>
              <option value={44}>M</option>
              <option value={64}>L</option>
            </Select>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-36">
              <option value="">{t("rooms.allTypes")}</option>
              {[...new Map((data?.rooms ?? []).map((r) => [r.roomType.id, r.roomType])).values()].map((rt) => (
                <option key={rt.id} value={rt.id}>
                  {rt.name}
                </option>
              ))}
            </Select>
          </>
        }
      />
      <div className="grid xl:grid-cols-[1fr_240px] gap-4">
        <Card className="overflow-auto max-h-[calc(100vh-170px)] relative select-none">
          <div ref={gridRef} style={{ width: LABEL + width }} className="relative">
            {/* header */}
            <div className="sticky top-0 z-20 flex bg-surface-2 border-b border-line" style={{ height: ROW + 14 }}>
              <div className="sticky left-0 z-30 bg-surface-2 border-r border-line text-xs text-muted px-2 flex items-end pb-1" style={{ width: LABEL, minWidth: LABEL }}>
                {t("res.room")}
              </div>
              {dates.map((d) => {
                const occ = data?.occupancy.find((o) => o.date === d);
                const we = [5, 6].includes(dayOfWeek(d));
                return (
                  <div key={d} className={cn("text-center border-r border-line/70 text-[10px] leading-tight pt-1", d === businessDate && "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]", we && "text-accent")} style={{ width: W, minWidth: W }}>
                    <div className="font-semibold">{f.digits(d.slice(8))}</div>
                    <div className="text-muted">{t(`dow.${dayOfWeek(d)}`)}</div>
                    <div className="text-muted num">{occ ? f.pct(occ.occupancyBp).replace(".0", "") : ""}</div>
                  </div>
                );
              })}
            </div>
            {/* rows */}
            {rooms.map((r, i) => (
              <div key={r.id} className="flex border-b border-line/60 relative" style={{ height: ROW }}>
                <div className="sticky left-0 z-10 bg-surface border-r border-line px-2 flex items-center gap-2 text-sm" style={{ width: LABEL, minWidth: LABEL }}>
                  <b>{r.number}</b>
                  <span className="text-[11px] text-muted truncate">{r.roomType.code}</span>
                  {r.hkStatus === "DIRTY" ? <span className="size-2 rounded-full bg-[var(--st-vacant-dirty)] ml-auto" title={t("status.DIRTY")} /> : null}
                </div>
                {dates.map((d) => (
                  <div
                    key={d}
                    onDoubleClick={() => can("reservations.create") && d >= businessDate && router.push(`/reservations/new?roomId=${r.id}&arrival=${d}`)}
                    className={cn("border-r border-line/40", d === businessDate && "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]", [5, 6].includes(dayOfWeek(d)) && "bg-surface-2/60")}
                    style={{ width: W, minWidth: W }}
                    title={t("tape.dblClick")}
                  />
                ))}
                {(data?.blocks ?? [])
                  .filter((b) => b.roomId === r.id)
                  .map((b) => (
                    <div
                      key={b.id}
                      className="absolute top-1 bottom-1 rounded text-[10px] text-white px-1.5 flex items-center overflow-hidden"
                      style={{ left: LABEL + Math.max(0, xOf(b.startDate)), width: Math.max(8, xOf(b.endDate) - Math.max(0, xOf(b.startDate))), background: `repeating-linear-gradient(45deg, ${b.type === "MAINTENANCE" ? "var(--st-maintenance)" : "var(--st-ooo)"} 0 6px, color-mix(in srgb, ${b.type === "MAINTENANCE" ? "var(--st-maintenance)" : "var(--st-ooo)"} 70%, white) 6px 12px)` }}
                      title={`${t(`blockType.${b.type}`)}: ${b.reason}`}
                    >
                      <span className="truncate">{b.reason}</span>
                    </div>
                  ))}
                {(data?.stays ?? [])
                  .filter((s) => s.roomId === r.id)
                  .map((s) => {
                    const dragging = drag && drag.stay.id === s.id;
                    const dayShift = dragging ? Math.round(drag.dx / W) : 0;
                    const rowShift = dragging && drag.kind === "move" ? Math.round(drag.dy / ROW) : 0;
                    const x0 = Math.max(0, xOf(s.arrivalDate));
                    const x1 = Math.min(width, xOf(s.departureDate));
                    const left = LABEL + x0 + (dragging && drag.kind === "move" && s.status !== "CHECKED_IN" ? dayShift * W : 0);
                    const w = Math.max(W * 0.6, x1 - x0 + (dragging && drag.kind === "resize" ? dayShift * W : 0)) - 3;
                    const canDrag = editable && s.status !== "CHECKED_OUT";
                    return (
                      <div
                        key={s.id}
                        onPointerDown={(e) => canDrag && begin(e, "move", s, i)}
                        onClick={() => !moved.current && router.push(`/reservations/${s.reservationId}`)}
                        className={cn("absolute top-1 bottom-1 rounded text-white text-[11px] flex items-center px-1.5 overflow-hidden shadow-sm", canDrag ? "cursor-grab active:cursor-grabbing" : "cursor-pointer", dragging && "opacity-80 ring-2 ring-[var(--petra-black)] z-20")}
                        style={{ left: left + 1, width: w, transform: rowShift ? `translateY(${rowShift * ROW}px)` : undefined, background: BAR_COLOR[s.status] ?? "var(--st-reserved)" }}
                        title={`${s.guestName} · ${s.confirmationNo}\n${f.date(s.arrivalDate)} – ${f.date(s.departureDate)}${s.groupName ? `\n${s.groupName}` : ""}`}
                      >
                        {s.vip ? <Crown className="size-3 mr-1 shrink-0" /> : null}
                        <span className="truncate">{s.guestName}</span>
                        {canDrag ? <span onPointerDown={(e) => begin(e, "resize", s, i)} className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/25" /> : null}
                      </div>
                    );
                  })}
              </div>
            ))}
            {drag?.kind === "assign" ? (
              <div className="fixed pointer-events-none z-50 rounded bg-[var(--st-reserved)] text-white text-xs px-2 py-1 shadow-lg" style={{ left: drag.startX + drag.dx + 8, top: drag.startY + drag.dy + 8 }}>
                {drag.stay.guestName}
              </div>
            ) : null}
          </div>
        </Card>
        <Card className="p-3 h-fit max-h-[calc(100vh-170px)] overflow-auto">
          <h3 className="text-sm font-semibold mb-1">{t("tape.unassigned")}</h3>
          <p className="text-xs text-muted mb-2">{t("tape.unassignedHelp")}</p>
          <div className="space-y-1.5">
            {data?.unassigned.map((u) => (
              <div key={u.id} onPointerDown={(e) => begin(e, "assign", u, -1)} className={cn("rounded border border-line px-2 py-1.5 text-xs bg-surface", editable && "cursor-grab hover:border-[var(--st-reserved)]")}>
                <div className="font-semibold truncate">{u.guestName}</div>
                <div className="text-muted">
                  {u.roomType.code} · {f.short(u.arrivalDate)}–{f.short(u.departureDate)}
                </div>
                <div className="text-muted">{u.confirmationNo}</div>
              </div>
            ))}
            {data && !data.unassigned.length ? <p className="text-xs text-muted">{t("tape.allAssigned")}</p> : null}
          </div>
          <div className="mt-4 space-y-1 text-[11px]">
            {Object.entries(BAR_COLOR).map(([k, c]) => (
              <div key={k} className="flex items-center gap-2">
                <span className="size-3 rounded-sm" style={{ background: c }} /> {t(`status.${k}`)}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
