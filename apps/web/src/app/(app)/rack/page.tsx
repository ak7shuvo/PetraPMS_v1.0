"use client";
// Room Rack: live floor grid colored by room status, with quick actions per room.
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, BedDouble, Crown, LogIn, LogOut, Sparkles, UserPlus } from "lucide-react";
import { addDays } from "@petra/core";
import { get, patch, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { Badge, Button, Input, Menu, PageHeader, Select, cn, errorToast, toast } from "@/components/ui";
import { CheckInDialog, CheckOutDialog, MoveDialog, type StayRef } from "@/components/fd/dialogs";
import { useTitle } from "@/components/shell/auth-screens";
import { BlockDialog, RACK_COLORS } from "@/components/fd/block-dialog";

interface RackRoom {
  id: string;
  number: string;
  floor: string;
  roomType: { code: string; name: string };
  hkStatus: string;
  version: number;
  features: string;
  status: "VACANT_CLEAN" | "VACANT_DIRTY" | "OCCUPIED" | "RESERVED" | "OUT_OF_ORDER" | "MAINTENANCE";
  block: { id: string; type: string; reason: string; endDate: string } | null;
  stay: { id: string; reservationId: string; confirmationNo: string; guestName: string; vip: number; arrivalDate: string; departureDate: string; status: string; adults: number; children: number; groupName: string } | null;
  departingToday: boolean;
  arrivingToday: boolean;
}


export default function RackPage() {
  const t = useT();
  const f = useFmt();
  const router = useRouter();
  const qc = useQueryClient();
  const { businessDate, can } = useSession();
  useTitle(t("nav.rack"));
  const [date, setDate] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [typeFilter, setTypeFilter] = useState("");
  const [ci, setCi] = useState<StayRef | null>(null);
  const [co, setCo] = useState<StayRef | null>(null);
  const [mv, setMv] = useState<StayRef | null>(null);
  const [block, setBlock] = useState<RackRoom | null>(null);
  const d = date || businessDate;
  const q = useQuery({ queryKey: ["rack", d], queryFn: () => get<{ rooms: RackRoom[]; counts: Record<string, number> }>(`/rack?date=${d}`), refetchInterval: 60_000 });
  const rooms = useMemo(() => (q.data?.rooms ?? []).filter((r) => (!filter || r.status === filter) && (!typeFilter || r.roomType.code === typeFilter)), [q.data, filter, typeFilter]);
  const floors = useMemo(() => [...new Set(rooms.map((r) => r.floor))], [rooms]);
  const types = useMemo(() => [...new Set((q.data?.rooms ?? []).map((r) => r.roomType.code))], [q.data]);
  const ref = (r: RackRoom): StayRef | null => (r.stay ? { id: r.stay.id, version: 0, reservationId: r.stay.reservationId, arrivalDate: r.stay.arrivalDate, departureDate: r.stay.departureDate, roomId: r.id, roomNumber: r.number, guestName: r.stay.guestName } : null);
  const setHk = async (r: RackRoom, hkStatus: string) => {
    try {
      await patch(`/rooms/${r.id}/hk-status`, { hkStatus });
      void qc.invalidateQueries({ queryKey: ["rack"] });
    } catch (e) {
      errorToast(e);
    }
  };

  return (
    <div>
      <PageHeader
        title={t("nav.rack")}
        sub={f.date(d, "DD MMM YYYY")}
        actions={
          <>
            <Input type="date" value={d} onChange={(e) => setDate(e.target.value)} className="w-40" />
            <Button size="sm" onClick={() => setDate(addDays(d, -1))}>
              ←
            </Button>
            <Button size="sm" onClick={() => setDate("")}>
              {t("common.today")}
            </Button>
            <Button size="sm" onClick={() => setDate(addDays(d, 1))}>
              →
            </Button>
            <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-32">
              <option value="">{t("rooms.allTypes")}</option>
              {types.map((x) => (
                <option key={x}>{x}</option>
              ))}
            </Select>
          </>
        }
      />
      <div className="flex flex-wrap gap-2 mb-4">
        {(Object.keys(RACK_COLORS) as RackRoom["status"][]).map((s) => (
          <button key={s} onClick={() => setFilter(filter === s ? "" : s)} className={cn("flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-xs", filter === s ? "border-fg bg-surface" : "border-line bg-surface/60")}>
            <span className="size-3 rounded-sm" style={{ background: RACK_COLORS[s] }} />
            {t(`status.${s}`)} <b className="num">{f.num(q.data?.counts[s] ?? 0)}</b>
          </button>
        ))}
      </div>
      {floors.map((fl) => (
        <div key={fl} className="mb-5">
          <h3 className="text-xs font-semibold text-muted mb-2">
            {t("setup.floor")} {fl}
          </h3>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
            {rooms
              .filter((r) => r.floor === fl)
              .map((r) => (
                <Menu
                  key={r.id}
                  trigger={
                    <button className="text-left rounded-md bg-surface border border-line overflow-hidden hover:shadow-md transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]">
                      <div className="h-1.5" style={{ background: RACK_COLORS[r.status] }} />
                      <div className="p-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-lg font-bold">{r.number}</span>
                          <span className="text-[11px] text-muted">{r.roomType.code}</span>
                        </div>
                        <div className="text-[11px] mt-0.5" style={{ color: RACK_COLORS[r.status] }}>
                          {t(`status.${r.status}`)}
                          {r.status === "OCCUPIED" && r.hkStatus === "DIRTY" ? ` · ${t("status.DIRTY")}` : ""}
                        </div>
                        <div className="text-xs mt-1 h-8 leading-tight">
                          {r.stay ? (
                            <>
                              <span className="font-semibold truncate flex items-center gap-1">
                                {r.stay.vip ? <Crown className="size-3 text-[var(--st-vacant-dirty)]" /> : null}
                                {r.stay.guestName}
                              </span>
                              <span className="text-muted">
                                {f.short(r.stay.arrivalDate)}–{f.short(r.stay.departureDate)}
                              </span>
                            </>
                          ) : r.block ? (
                            <span className="text-muted line-clamp-2">{r.block.reason}</span>
                          ) : (
                            <span className="text-muted">{r.features}</span>
                          )}
                        </div>
                        <div className="flex gap-1 mt-1 min-h-4">
                          {r.departingToday ? <Badge tone="amber">{t("fd.dueOut")}</Badge> : null}
                          {r.arrivingToday ? <Badge tone="blue">{t("fd.arrival")}</Badge> : null}
                        </div>
                      </div>
                    </button>
                  }
                  items={[
                    r.stay ? { label: t("res.open"), icon: <BedDouble className="size-4" />, onSelect: () => router.push(`/reservations/${r.stay!.reservationId}`) } : null,
                    r.stay?.status === "RESERVED" && can("frontdesk.checkin") ? { label: t("fd.checkIn"), icon: <LogIn className="size-4" />, onSelect: () => setCi(ref(r)) } : null,
                    r.stay?.status === "CHECKED_IN" && can("frontdesk.checkout") ? { label: t("fd.checkOut"), icon: <LogOut className="size-4" />, onSelect: () => setCo(ref(r)) } : null,
                    r.stay?.status === "CHECKED_IN" && can("rooms.move") ? { label: t("fd.move"), onSelect: () => setMv(ref(r)) } : null,
                    !r.stay && !r.block && can("reservations.create") ? { label: t("res.bookThisRoom"), icon: <UserPlus className="size-4" />, onSelect: () => router.push(`/reservations/new?roomId=${r.id}&arrival=${d}`) } : null,
                    "sep",
                    can("housekeeping.update", "housekeeping.assign", "rooms.manage") ? { label: t("hk.markClean"), icon: <Sparkles className="size-4" />, onSelect: () => void setHk(r, "CLEAN") } : null,
                    can("housekeeping.update", "housekeeping.assign", "rooms.manage") ? { label: t("hk.markDirty"), onSelect: () => void setHk(r, "DIRTY") } : null,
                    can("housekeeping.assign") ? { label: t("hk.markInspected"), onSelect: () => void setHk(r, "INSPECTED") } : null,
                    "sep",
                    !r.block && can("rooms.block") ? { label: t("rooms.block"), icon: <Ban className="size-4" />, onSelect: () => setBlock(r) } : null,
                    r.block && can("rooms.block")
                      ? {
                          label: t("rooms.release"),
                          onSelect: () =>
                            void post(`/blocks/${r.block!.id}/release`)
                              .then(() => (toast.success(t("common.saved")), qc.invalidateQueries({ queryKey: ["rack"] })))
                              .catch(errorToast),
                        }
                      : null,
                  ]}
                />
              ))}
          </div>
        </div>
      ))}
      {q.data && !rooms.length ? <p className="text-sm text-muted">{t("common.noData")}</p> : null}
      <CheckInDialog stay={ci} open={!!ci} onOpenChange={(o) => !o && setCi(null)} />
      <CheckOutDialog stay={co} open={!!co} onOpenChange={(o) => !o && setCo(null)} />
      <MoveDialog stay={mv} open={!!mv} onOpenChange={(o) => !o && setMv(null)} />
      <BlockDialog room={block} businessDate={businessDate} onClose={() => setBlock(null)} />
    </div>
  );
}

