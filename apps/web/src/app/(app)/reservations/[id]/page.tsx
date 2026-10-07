"use client";
import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, Edit3, LogIn, LogOut, Mail, MoreHorizontal, Plus, Printer, RotateCcw, UserX } from "lucide-react";
import { addDays } from "@petra/core";
import { ApiClientError, get, openPdf, patch, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fromPoisha, toPoisha, useFmt, useT } from "@/lib/i18n";
import { useRatePlans, useRoomTypes, useRooms, type Guest } from "@/lib/queries";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, Input, Menu, Modal, MoneyInput, PageHeader, Select, Skeleton, StatusBadge, Textarea, errorToast, toast, useConfirm, useWithApproval } from "@/components/ui";
import { CheckInDialog, CheckOutDialog, ExtendDialog, MoveDialog, type StayRef } from "@/components/fd/dialogs";
import { useTitle } from "@/components/shell/auth-screens";

interface Stay {
  id: string;
  version: number;
  status: string;
  roomTypeId: string;
  roomId: string | null;
  room: { id: string; number: string; hkStatus: string } | null;
  roomType: { id: string; code: string; name: string };
  guest: { id: string; fullName: string } | null;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  extraBeds: number;
  ratePlanId: string | null;
  discountBp: number;
  rateOverride: boolean;
  nightlyRates: { date: string; amount: number }[];
  total: number;
  nights: number;
}
interface Res {
  id: string;
  confirmationNo: string;
  status: string;
  source: string;
  sourceRef: string;
  agentName: string;
  guest: Guest;
  company: { id: string; code: string; name: string } | null;
  isGroup: boolean;
  groupName: string;
  arrivalDate: string;
  departureDate: string;
  eta: string;
  specialRequests: string;
  notes: string;
  depositRequired: number;
  paymentTerms: string;
  cancellationPolicy: { name?: string; freeUntilHours?: number };
  cancelReason: string;
  cancellationFee: number;
  version: number;
  createdAt: string;
  rooms: Stay[];
  folios: { id: string; number: string; name: string; status: string; type: string; balance: number; charges: number; reservationRoomId: string | null }[];
  deposits: number;
  roomTotal: number;
}

export default function ReservationDetail() {
  const t = useT();
  const f = useFmt();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const withApproval = useWithApproval();
  const { can, businessDate } = useSession();
  const q = useQuery({ queryKey: ["reservation", id], queryFn: () => get<Res>(`/reservations/${id}`) });
  const r = q.data;
  useTitle(r?.confirmationNo ?? t("nav.reservations"));
  const [ci, setCi] = useState<StayRef | null>(null);
  const [co, setCo] = useState<StayRef | null>(null);
  const [mv, setMv] = useState<StayRef | null>(null);
  const [ex, setEx] = useState<StayRef | null>(null);
  const [edit, setEdit] = useState<Stay | null>(null);
  const [editHeader, setEditHeader] = useState(false);
  const [cancel, setCancel] = useState(false);
  const [addRoom, setAddRoom] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["reservation", id] });
    void qc.invalidateQueries({ queryKey: ["reservations"] });
  };
  if (!r) return <Skeleton className="h-64" />;
  const ref = (s: Stay): StayRef => ({ id: s.id, version: s.version, reservationId: r.id, arrivalDate: s.arrivalDate, departureDate: s.departureDate, roomId: s.room?.id ?? null, roomNumber: s.room?.number ?? null, guestName: s.guest?.fullName ?? r.guest.fullName });
  const live = r.rooms.filter((s) => !["CANCELLED", "NO_SHOW"].includes(s.status));
  const closed = ["CANCELLED", "NO_SHOW", "CHECKED_OUT"].includes(r.status);
  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      errorToast(e);
      refresh();
    }
  };

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <button onClick={() => router.back()} className="text-muted hover:text-fg" aria-label={t("common.back")}>
              <ArrowLeft className="size-5" />
            </button>
            {r.confirmationNo} <StatusBadge status={r.status} />
          </span>
        }
        sub={`${t(`source.${r.source}`)}${r.sourceRef ? ` · ${r.sourceRef}` : ""} · ${t("res.bookedOn")} ${f.dateTime(r.createdAt)}`}
        actions={
          <>
            <Button icon={<Printer className="size-4" />} onClick={() => void openPdf(`/reservations/${r.id}/confirmation/pdf`).catch(errorToast)}>
              {t("res.printConfirmation")}
            </Button>
            <Menu
              trigger={
                <Button icon={<MoreHorizontal className="size-4" />}>{t("common.more")}</Button>
              }
              items={[
                can("reservations.edit") && !closed ? { label: t("res.editDetails"), icon: <Edit3 className="size-4" />, onSelect: () => setEditHeader(true) } : null,
                can("reservations.edit") && !closed ? { label: t("res.addRoom"), icon: <Plus className="size-4" />, onSelect: () => setAddRoom(true) } : null,
                r.status === "WAITLIST" && can("reservations.edit") ? { label: t("res.confirmWaitlist"), onSelect: () => void act(() => post(`/reservations/${r.id}/confirm-waitlist`), t("common.saved")) } : null,
                r.status === "TENTATIVE" && can("reservations.edit") ? { label: t("res.markConfirmed"), onSelect: () => void act(() => patch(`/reservations/${r.id}`, { version: r.version, status: "CONFIRMED" }), t("common.saved")) } : null,
                { label: t("res.resendConfirmation"), icon: <Mail className="size-4" />, onSelect: () => void act(() => post(`/reservations/${r.id}/resend-confirmation`), t("res.queued")) },
                "sep",
                can("reservations.cancel") && live.some((s) => ["RESERVED", "WAITLIST"].includes(s.status)) ? { label: t("res.cancel"), icon: <Ban className="size-4" />, danger: true, onSelect: () => setCancel(true) } : null,
                can("reservations.cancel") && r.arrivalDate <= businessDate && live.some((s) => s.status === "RESERVED")
                  ? {
                      label: t("res.noShow"),
                      icon: <UserX className="size-4" />,
                      danger: true,
                      onSelect: async () => {
                        const c = await confirm({ title: t("res.noShow"), message: t("res.noShowConfirm"), danger: true });
                        if (c.ok) void act(() => post(`/reservations/${r.id}/no-show`, { postPenalty: true }), t("common.saved"));
                      },
                    }
                  : null,
                ["CANCELLED", "NO_SHOW"].includes(r.status) && can("reservations.cancel") ? { label: t("res.reinstate"), icon: <RotateCcw className="size-4" />, onSelect: () => void act(() => post(`/reservations/${r.id}/reinstate`), t("common.saved")) } : null,
              ]}
            />
          </>
        }
      />
      <div className="grid xl:grid-cols-[1fr_340px] gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("res.rooms")} sub={`${f.date(r.arrivalDate)} → ${f.date(r.departureDate)}`} />
            <DataTable
              rows={r.rooms}
              rowKey={(s) => s.id}
              rowClass={(s) => (["CANCELLED", "NO_SHOW"].includes(s.status) ? "opacity-50" : "")}
              cols={[
                { key: "room", header: t("res.room"), cell: (s) => (s.room ? <b>{s.room.number}</b> : <span className="text-muted text-xs">{t("res.unassigned")}</span>) },
                { key: "type", header: t("common.type"), cell: (s) => s.roomType.name },
                { key: "d", header: t("res.dates"), cell: (s) => <span className="whitespace-nowrap text-xs">{f.short(s.arrivalDate)} → {f.short(s.departureDate)} ({s.nights})</span> },
                { key: "pax", header: t("res.pax"), cell: (s) => `${s.adults}${s.children ? `+${s.children}` : ""}${s.extraBeds ? ` +${s.extraBeds}EB` : ""}` },
                { key: "rate", header: t("res.roomTotal"), align: "right", cell: (s) => <span title={s.nightlyRates.map((n) => `${n.date}: ${f.money(n.amount)}`).join("\n")}>{f.money(s.total)}{s.rateOverride ? " *" : ""}{s.discountBp ? <span className="block text-[10px] text-muted">-{f.pct(s.discountBp)}</span> : null}</span> },
                { key: "st", header: t("common.status"), cell: (s) => <StatusBadge status={s.status} /> },
                {
                  key: "a",
                  header: "",
                  align: "right",
                  cell: (s) => (
                    <div className="flex justify-end gap-1">
                      {s.status === "RESERVED" && can("frontdesk.checkin") && s.arrivalDate <= businessDate ? (
                        <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => setCi(ref(s))}>
                          {t("fd.checkIn")}
                        </Button>
                      ) : null}
                      {s.status === "CHECKED_IN" && can("frontdesk.checkout") ? (
                        <Button size="sm" variant={s.departureDate <= businessDate ? "primary" : "secondary"} icon={<LogOut className="size-3.5" />} onClick={() => setCo(ref(s))}>
                          {t("fd.checkOut")}
                        </Button>
                      ) : null}
                      <Menu
                        trigger={
                          <Button size="sm" variant="ghost" aria-label={t("common.more")}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        }
                        items={[
                          ["RESERVED", "WAITLIST"].includes(s.status) && can("reservations.edit") ? { label: t("res.editStay"), onSelect: () => setEdit(s) } : null,
                          s.status === "CHECKED_IN" && can("reservations.edit") ? { label: t("fd.changeDeparture"), onSelect: () => setEx(ref(s)) } : null,
                          s.status === "CHECKED_IN" && can("rooms.move") ? { label: t("fd.move"), onSelect: () => setMv(ref(s)) } : null,
                          { label: t("fd.printRegCard"), icon: <Printer className="size-4" />, onSelect: () => void openPdf(`/stays/${s.id}/registration-card/pdf`).catch(errorToast) },
                          ["RESERVED", "WAITLIST"].includes(s.status) && live.length > 1 && can("reservations.cancel")
                            ? {
                                label: t("res.cancelRoom"),
                                danger: true,
                                onSelect: async () => {
                                  const c = await confirm({ title: t("res.cancelRoom"), reason: true, danger: true });
                                  if (c.ok) void act(() => withApproval((approval) => post(`/reservations/${r.id}/cancel`, { version: r.version, reason: c.reason, stayIds: [s.id], approval })), t("common.saved"));
                                },
                              }
                            : null,
                        ]}
                      />
                    </div>
                  ),
                },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title={t("nav.folios")} sub={`${t("res.deposits")}: ${f.money(r.deposits)}${r.depositRequired ? ` / ${f.money(r.depositRequired)}` : ""}`} />
            <DataTable
              rows={r.folios}
              rowKey={(x) => x.id}
              onRowClick={(x) => router.push(`/folios/${x.id}`)}
              empty={<p className="text-sm text-muted p-4">{t("res.noFolios")}</p>}
              cols={[
                { key: "n", header: t("folio.number"), cell: (x) => <b>{x.number}</b> },
                { key: "name", header: t("common.name"), cell: (x) => x.name },
                { key: "st", header: t("common.status"), cell: (x) => <StatusBadge status={x.status} /> },
                { key: "c", header: t("folio.charges"), cell: (x) => f.money(x.charges), align: "right" },
                { key: "b", header: t("folio.balance"), cell: (x) => <span className={x.balance > 0 ? "text-accent font-semibold" : ""}>{f.money(x.balance)}</span>, align: "right" },
              ]}
            />
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader title={t("res.guest")} actions={<Link href={`/guests/${r.guest.id}`} className="text-xs underline">{t("common.open")}</Link>} />
            <div className="p-4 text-sm space-y-1">
              <p className="font-semibold text-base">
                {r.guest.fullName} {r.guest.vip ? <Badge tone="amber">VIP {r.guest.vip}</Badge> : null}
              </p>
              <p className="text-muted">{[r.guest.phone, r.guest.email].filter(Boolean).join(" · ") || "—"}</p>
              <p className="text-muted">
                {r.guest.nationality} · {r.guest.idType ? `${t(`idType.${r.guest.idType}`)} ${r.guest.idNumber}` : t("guest.noId")}
              </p>
              {r.guest.preferences ? <p className="text-st-res text-xs">{r.guest.preferences}</p> : null}
              {r.company ? <p className="pt-2">🏢 {r.company.name} · {r.paymentTerms === "COMPANY" ? t("res.companyPays") : t("res.guestPays")}</p> : null}
            </div>
          </Card>
          <Card>
            <CardHeader title={t("res.details")} />
            <div className="p-4 text-sm space-y-2">
              <Info label={t("res.roomTotal")} value={f.money(r.roomTotal)} />
              <Info label={t("res.eta")} value={r.eta || "—"} />
              {r.groupName ? <Info label={t("res.groupName")} value={r.groupName} /> : null}
              <Info label={t("res.policy")} value={r.cancellationPolicy?.name ?? t("res.noPolicy")} />
              {r.specialRequests ? <Info label={t("res.specialRequests")} value={r.specialRequests} /> : null}
              {r.notes ? <Info label={t("res.internalNotes")} value={r.notes} /> : null}
              {r.cancelReason ? <Info label={t("res.cancelReason")} value={`${r.cancelReason}${r.cancellationFee ? ` (${f.money(r.cancellationFee)})` : ""}`} /> : null}
            </div>
          </Card>
        </div>
      </div>
      <CheckInDialog stay={ci} open={!!ci} onOpenChange={(o) => !o && setCi(null)} />
      <CheckOutDialog stay={co} open={!!co} onOpenChange={(o) => !o && setCo(null)} />
      <MoveDialog stay={mv} open={!!mv} onOpenChange={(o) => !o && setMv(null)} />
      <ExtendDialog stay={ex} open={!!ex} onOpenChange={(o) => !o && setEx(null)} />
      <EditStayDialog stay={edit} onClose={() => (setEdit(null), refresh())} />
      <HeaderDialog res={editHeader ? r : null} onClose={() => (setEditHeader(false), refresh())} />
      <CancelDialog res={cancel ? r : null} onClose={() => (setCancel(false), refresh())} />
      <AddRoomDialog res={addRoom ? r : null} onClose={() => (setAddRoom(false), refresh())} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="whitespace-pre-wrap">{value}</p>
    </div>
  );
}

function EditStayDialog({ stay, onClose }: { stay: Stay | null; onClose: () => void }) {
  const t = useT();
  const types = useRoomTypes();
  const plans = useRatePlans();
  const rooms = useRooms();
  const withApproval = useWithApproval();
  const { can } = useSession();
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const cur = stay ? { arrival: stay.arrivalDate, departure: stay.departureDate, roomTypeId: stay.roomTypeId, roomId: stay.roomId ?? "", adults: String(stay.adults), children: String(stay.children), extraBeds: String(stay.extraBeds), ratePlanId: stay.ratePlanId ?? "", discount: String(stay.discountBp / 100), overrideRate: "", reprice: "" } : null;
  const val = { ...cur, ...v } as Record<string, string>;
  return (
    <Modal
      open={!!stay}
      onOpenChange={(o) => !o && (setV({}), onClose())}
      title={t("res.editStay")}
      size="md"
      footer={
        <>
          <Button onClick={() => (setV({}), onClose())}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              if (!stay) return;
              setBusy(true);
              try {
                const body: Record<string, unknown> = { version: stay.version, keepRates: val.reprice !== "1" };
                if (val.arrival !== stay.arrivalDate) body.arrival = val.arrival;
                if (val.departure !== stay.departureDate) body.departure = val.departure;
                if (val.roomTypeId !== stay.roomTypeId) body.roomTypeId = val.roomTypeId;
                if ((val.roomId || null) !== stay.roomId) body.roomId = val.roomId || null;
                if (Number(val.adults) !== stay.adults) body.adults = Number(val.adults);
                if (Number(val.children) !== stay.children) body.children = Number(val.children);
                if (Number(val.extraBeds) !== stay.extraBeds) body.extraBeds = Number(val.extraBeds);
                if ((val.ratePlanId || null) !== stay.ratePlanId) body.ratePlanId = val.ratePlanId || null;
                if (Math.round(Number(val.discount) * 100) !== stay.discountBp) body.discountBp = Math.round(Number(val.discount) * 100);
                if (toPoisha(val.overrideRate) !== null) body.overrideRate = toPoisha(val.overrideRate);
                await withApproval((approval) => patch(`/stays/${stay.id}`, { ...body, approval }));
                toast.success(t("common.saved"));
                setV({});
                onClose();
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      {stay ? (
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("res.arrival")}>
            <Input type="date" value={val.arrival} onChange={(e) => setV({ ...v, arrival: e.target.value })} />
          </Field>
          <Field label={t("res.departure")}>
            <Input type="date" value={val.departure} min={addDays(val.arrival, 1)} onChange={(e) => setV({ ...v, departure: e.target.value })} />
          </Field>
          <Field label={t("common.type")}>
            <Select value={val.roomTypeId} onChange={(e) => setV({ ...v, roomTypeId: e.target.value, roomId: "" })}>
              {types.data?.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("res.room")}>
            <Select value={val.roomId} onChange={(e) => setV({ ...v, roomId: e.target.value })}>
              <option value="">{t("res.unassigned")}</option>
              {rooms.data?.filter((x) => x.active && x.roomTypeId === val.roomTypeId).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.number}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("res.adults")}>
            <Input inputMode="numeric" value={val.adults} onChange={(e) => setV({ ...v, adults: e.target.value })} />
          </Field>
          <Field label={t("res.children")}>
            <Input inputMode="numeric" value={val.children} onChange={(e) => setV({ ...v, children: e.target.value })} />
          </Field>
          <Field label={t("res.extraBeds")}>
            <Input inputMode="numeric" value={val.extraBeds} onChange={(e) => setV({ ...v, extraBeds: e.target.value })} />
          </Field>
          <Field label={t("res.ratePlan")}>
            <Select value={val.ratePlanId} onChange={(e) => setV({ ...v, ratePlanId: e.target.value })}>
              <option value="">{t("res.baseRate")}</option>
              {plans.data?.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Field>
          {can("rates.discount", "rates.discount_approve") ? (
            <Field label={t("res.discountPct")}>
              <Input inputMode="decimal" value={val.discount} onChange={(e) => setV({ ...v, discount: e.target.value })} />
            </Field>
          ) : null}
          {can("rates.override") ? (
            <Field label={t("res.overrideRate")}>
              <MoneyInput value={val.overrideRate} onChange={(x) => setV({ ...v, overrideRate: x })} />
            </Field>
          ) : null}
          <Checkbox className="col-span-2" checked={val.reprice === "1"} onChange={(e) => setV({ ...v, reprice: e.target.checked ? "1" : "" })} label={t("res.repriceAll")} />
        </div>
      ) : null}
    </Modal>
  );
}

function HeaderDialog({ res, onClose }: { res: Res | null; onClose: () => void }) {
  const t = useT();
  const [v, setV] = useState<Partial<Res>>({});
  const [busy, setBusy] = useState(false);
  if (!res) return null;
  const val = { ...res, ...v };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("res.editDetails")}
      size="md"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await patch(`/reservations/${res.id}`, { version: res.version, eta: val.eta, specialRequests: val.specialRequests, notes: val.notes, sourceRef: val.sourceRef, groupName: val.groupName, depositRequired: val.depositRequired, paymentTerms: val.paymentTerms });
                toast.success(t("common.saved"));
                onClose();
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("res.eta")}>
          <Input type="time" value={val.eta} onChange={(e) => setV({ ...v, eta: e.target.value })} />
        </Field>
        <Field label={t("res.sourceRef")}>
          <Input value={val.sourceRef} onChange={(e) => setV({ ...v, sourceRef: e.target.value })} />
        </Field>
        <Field label={t("res.groupName")}>
          <Input value={val.groupName} onChange={(e) => setV({ ...v, groupName: e.target.value })} />
        </Field>
        <Field label={t("res.depositRequired")}>
          <MoneyInput value={fromPoisha(val.depositRequired)} onChange={(x) => setV({ ...v, depositRequired: toPoisha(x) ?? 0 })} />
        </Field>
        {res.company ? (
          <Field label={t("res.paymentTerms")}>
            <Select value={val.paymentTerms} onChange={(e) => setV({ ...v, paymentTerms: e.target.value })}>
              <option value="GUEST">{t("res.guestPays")}</option>
              <option value="COMPANY">{t("res.companyPays")}</option>
            </Select>
          </Field>
        ) : null}
        <Field label={t("res.specialRequests")} className="col-span-2">
          <Textarea value={val.specialRequests} onChange={(e) => setV({ ...v, specialRequests: e.target.value })} />
        </Field>
        <Field label={t("res.internalNotes")} className="col-span-2">
          <Textarea value={val.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function CancelDialog({ res, onClose }: { res: Res | null; onClose: () => void }) {
  const t = useT();
  const f = useFmt();
  const withApproval = useWithApproval();
  const { can } = useSession();
  const [reason, setReason] = useState("");
  const [waive, setWaive] = useState(false);
  const [busy, setBusy] = useState(false);
  const prev = useQuery({ queryKey: ["cancel-preview", res?.id], enabled: !!res, queryFn: () => get<{ penalty: number; hoursBefore: number; policy: { name?: string } | null }>(`/reservations/${res!.id}/cancel-preview`) });
  if (!res) return null;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("res.cancelTitle", { no: res.confirmationNo })}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t("common.back")}</Button>
          <Button
            variant="danger"
            loading={busy}
            disabled={reason.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await withApproval((approval) => post<{ fee: number }>(`/reservations/${res.id}/cancel`, { version: res.version, reason, waivePenalty: waive, approval }));
                toast.success(r.fee ? t("res.cancelledFee", { fee: f.money(r.fee) }) : t("res.cancelled"));
                onClose();
              } catch (e) {
                if (!(e instanceof ApiClientError && e.code === "CANCELLED")) errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("res.cancel")}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        {prev.data ? (
          <div className="rounded-md border border-line p-3">
            <p>
              {t("res.policy")}: <b>{prev.data.policy?.name ?? t("res.noPolicy")}</b>
            </p>
            <p>{t("res.hoursBefore", { n: prev.data.hoursBefore })}</p>
            <p className={prev.data.penalty ? "text-accent font-semibold" : ""}>
              {t("res.penalty")}: {f.money(prev.data.penalty)}
            </p>
          </div>
        ) : null}
        {prev.data?.penalty ? <Checkbox checked={waive} onChange={(e) => setWaive(e.target.checked)} label={can("reservations.waive_penalty") ? t("res.waive") : t("res.waiveApproval")} /> : null}
        <Field label={t("common.reason")} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
        </Field>
      </div>
    </Modal>
  );
}

function AddRoomDialog({ res, onClose }: { res: Res | null; onClose: () => void }) {
  const t = useT();
  const types = useRoomTypes();
  const plans = useRatePlans();
  const [v, setV] = useState({ roomTypeId: "", ratePlanId: "", adults: "2", children: "0" });
  const [busy, setBusy] = useState(false);
  if (!res) return null;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={t("res.addRoom")}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!v.roomTypeId}
            onClick={async () => {
              setBusy(true);
              try {
                await post(`/reservations/${res.id}/stays`, { roomTypeId: v.roomTypeId, ratePlanId: v.ratePlanId || null, adults: Number(v.adults) || 1, children: Number(v.children) || 0, arrival: res.arrivalDate, departure: res.departureDate });
                toast.success(t("common.saved"));
                onClose();
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("common.add")}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Field label={t("common.type")} className="col-span-2">
          <Select value={v.roomTypeId} onChange={(e) => setV({ ...v, roomTypeId: e.target.value })}>
            <option value="">—</option>
            {types.data?.filter((x) => x.active).map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("res.ratePlan")} className="col-span-2">
          <Select value={v.ratePlanId} onChange={(e) => setV({ ...v, ratePlanId: e.target.value })}>
            <option value="">{t("res.baseRate")}</option>
            {plans.data?.filter((p) => p.active).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("res.adults")}>
          <Input value={v.adults} onChange={(e) => setV({ ...v, adults: e.target.value })} />
        </Field>
        <Field label={t("res.children")}>
          <Input value={v.children} onChange={(e) => setV({ ...v, children: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
