"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck, Crown, Download, LogIn, LogOut, MoreHorizontal, Plus, Printer } from "lucide-react";
import { addDays } from "@petra/core";
import { download, get, openPdf, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { Badge, Button, Card, DataTable, Field, Input, Menu, Modal, PageHeader, StatusBadge, Tabs, Textarea, errorToast, toast, type Col } from "@/components/ui";
import { CheckInDialog, CheckOutDialog, ExtendDialog, MoveDialog, type StayRef } from "@/components/fd/dialogs";
import { ReservationForm } from "@/components/res/reservation-form";
import { useTitle } from "@/components/shell/auth-screens";

interface StayRow {
  id: string;
  version: number;
  status: string;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  room: { id: string; number: string; hkStatus: string } | null;
  roomType: { code: string; name: string };
  guest: { id: string; fullName: string; phone?: string; vip?: number; nationality?: string };
  reservation: { id: string; confirmationNo: string; eta: string; specialRequests: string; source: string; groupName: string; guest: { fullName: string; vip: number; nationality: string }; company: { name: string } | null };
}

const ref = (s: StayRow): StayRef => ({ id: s.id, version: s.version, reservationId: s.reservation.id, arrivalDate: s.arrivalDate, departureDate: s.departureDate, roomId: s.room?.id ?? null, roomNumber: s.room?.number ?? null, guestName: s.guest.fullName });

export default function FrontDeskPage() {
  const t = useT();
  const f = useFmt();
  const router = useRouter();
  const sp = useSearchParams();
  const { businessDate, can } = useSession();
  useTitle(t("nav.frontdesk"));
  const [tab, setTab] = useState(sp.get("tab") ?? "arrivals");
  const [walkIn, setWalkIn] = useState(sp.get("walkin") === "1");
  const [ci, setCi] = useState<StayRef | null>(null);
  const [co, setCo] = useState<StayRef | null>(null);
  const [mv, setMv] = useState<StayRef | null>(null);
  const [ex, setEx] = useState<StayRef | null>(null);
  const lists = useQuery({ queryKey: ["frontdesk", "lists", businessDate], queryFn: () => get<{ arrivals: StayRow[]; departures: StayRow[]; inHouse: StayRow[] }>("/frontdesk/lists") });

  const guestCell = (s: StayRow) => (
    <div className="min-w-0">
      <div className="font-semibold truncate flex items-center gap-1">
        {s.reservation.guest.vip ? <Crown className="size-3.5 text-[var(--st-vacant-dirty)]" /> : null}
        {s.guest.fullName}
        {s.reservation.guest.nationality && s.reservation.guest.nationality !== "BD" ? <Badge>{s.reservation.guest.nationality}</Badge> : null}
      </div>
      <div className="text-xs text-muted truncate">
        {s.reservation.confirmationNo}
        {s.reservation.company ? ` · ${s.reservation.company.name}` : ""}
        {s.reservation.groupName ? ` · ${s.reservation.groupName}` : ""}
      </div>
    </div>
  );
  const roomCell = (s: StayRow) =>
    s.room ? (
      <span className="flex items-center gap-1.5">
        <b>{s.room.number}</b> <span className="text-xs text-muted">{s.roomType.code}</span>
        {s.status === "RESERVED" && !["CLEAN", "INSPECTED"].includes(s.room.hkStatus) ? <StatusBadge status={s.room.hkStatus} /> : null}
      </span>
    ) : (
      <span className="text-xs text-muted">
        {s.roomType.code} · {t("res.unassigned")}
      </span>
    );
  const more = (s: StayRow) => (
    <Menu
      trigger={
        <Button size="sm" variant="ghost" aria-label={t("common.more")} onClick={(e) => e.stopPropagation()}>
          <MoreHorizontal className="size-4" />
        </Button>
      }
      items={[
        { label: t("res.open"), onSelect: () => router.push(`/reservations/${s.reservation.id}`) },
        s.status === "CHECKED_IN" && can("rooms.move") ? { label: t("fd.move"), onSelect: () => setMv(ref(s)) } : null,
        can("reservations.edit") ? { label: t("fd.changeDeparture"), onSelect: () => setEx(ref(s)) } : null,
        "sep",
        { label: t("fd.printRegCard"), icon: <Printer className="size-4" />, onSelect: () => void openPdf(`/stays/${s.id}/registration-card/pdf`).catch(errorToast) },
      ]}
    />
  );
  const base: Col<StayRow>[] = [
    { key: "guest", header: t("res.guest"), cell: guestCell, sort: (s) => s.guest.fullName },
    { key: "room", header: t("res.room"), cell: roomCell, sort: (s) => s.room?.number ?? "" },
    { key: "dates", header: t("res.dates"), cell: (s) => <span className="text-xs whitespace-nowrap">{f.short(s.arrivalDate)} → {f.short(s.departureDate)}</span>, sort: (s) => s.departureDate },
    { key: "pax", header: t("res.pax"), cell: (s) => `${s.adults}${s.children ? `+${s.children}` : ""}`, align: "center" },
  ];
  const arrivalsCols: Col<StayRow>[] = [
    ...base,
    { key: "eta", header: t("res.eta"), cell: (s) => s.reservation.eta || "—", sort: (s) => s.reservation.eta },
    { key: "req", header: t("res.specialRequests"), cell: (s) => <span className="text-xs text-muted line-clamp-2 max-w-48">{s.reservation.specialRequests}</span> },
    {
      key: "act",
      header: "",
      align: "right",
      cell: (s) => (
        <div className="flex justify-end gap-1">
          {s.status === "RESERVED" && can("frontdesk.checkin") ? (
            <Button size="sm" variant="primary" icon={<LogIn className="size-3.5" />} onClick={() => setCi(ref(s))}>
              {t("fd.checkIn")}
            </Button>
          ) : (
            <StatusBadge status={s.status} />
          )}
          {more(s)}
        </div>
      ),
    },
  ];
  const outCols: Col<StayRow>[] = [
    ...base,
    { key: "co", header: t("common.status"), cell: (s) => (s.departureDate < businessDate ? <Badge tone="red">{t("fd.overdue")}</Badge> : s.departureDate === businessDate ? <Badge tone="amber">{t("fd.dueOut")}</Badge> : <StatusBadge status={s.status} />) },
    {
      key: "act",
      header: "",
      align: "right",
      cell: (s) => (
        <div className="flex justify-end gap-1">
          {can("frontdesk.checkout") ? (
            <Button size="sm" variant={s.departureDate <= businessDate ? "primary" : "secondary"} icon={<LogOut className="size-3.5" />} onClick={() => setCo(ref(s))}>
              {t("fd.checkOut")}
            </Button>
          ) : null}
          {more(s)}
        </div>
      ),
    },
  ];
  const pendingArr = lists.data?.arrivals.filter((s) => s.status === "RESERVED").length ?? 0;

  return (
    <div>
      <PageHeader
        title={t("nav.frontdesk")}
        sub={f.date(businessDate, "DD MMM YYYY")}
        actions={
          can("frontdesk.checkin") ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setWalkIn(true)}>
              {t("fd.walkIn")}
            </Button>
          ) : null
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => (setTab(v), router.replace(`/frontdesk?tab=${v}`))}
        tabs={[
          {
            value: "arrivals",
            label: `${t("fd.arrivals")} (${pendingArr}/${lists.data?.arrivals.length ?? 0})`,
            content: (
              <Card>
                <DataTable rows={lists.data?.arrivals} cols={arrivalsCols} rowKey={(s) => s.id} loading={lists.isLoading} onRowClick={(s) => router.push(`/reservations/${s.reservation.id}`)} />
              </Card>
            ),
          },
          {
            value: "departures",
            label: `${t("fd.departures")} (${lists.data?.departures.length ?? 0})`,
            content: (
              <Card>
                <DataTable rows={lists.data?.departures} cols={outCols} rowKey={(s) => s.id} loading={lists.isLoading} onRowClick={(s) => router.push(`/reservations/${s.reservation.id}`)} />
              </Card>
            ),
          },
          {
            value: "inhouse",
            label: `${t("fd.inHouse")} (${lists.data?.inHouse.length ?? 0})`,
            content: (
              <Card>
                <DataTable rows={lists.data?.inHouse} cols={outCols} rowKey={(s) => s.id} loading={lists.isLoading} onRowClick={(s) => router.push(`/reservations/${s.reservation.id}`)} />
              </Card>
            ),
          },
          { value: "notes", label: t("fd.notes"), content: <ShiftNotes />, hidden: !can("frontdesk.handover", "frontdesk.checkin") },
          { value: "police", label: t("fd.policeReport"), content: <PoliceReport />, hidden: !can("frontdesk.police_export") },
        ]}
      />
      <CheckInDialog stay={ci} open={!!ci} onOpenChange={(o) => !o && setCi(null)} />
      <CheckOutDialog stay={co} open={!!co} onOpenChange={(o) => !o && setCo(null)} />
      <MoveDialog stay={mv} open={!!mv} onOpenChange={(o) => !o && setMv(null)} />
      <ExtendDialog stay={ex} open={!!ex} onOpenChange={(o) => !o && setEx(null)} />
      <Modal open={walkIn} onOpenChange={setWalkIn} title={t("fd.walkIn")} size="full">
        <ReservationForm
          walkIn
          onCreated={(r) => {
            setWalkIn(false);
            router.push(`/reservations/${r.id}`);
          }}
        />
      </Modal>
    </div>
  );
}

function ShiftNotes() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const { businessDate, user, can } = useSession();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const notes = useQuery({ queryKey: ["shift-notes"], queryFn: () => get<{ id: string; text: string; authorName: string; shift: string; createdAt: string; businessDate: string; acknowledgedBy: { userId: string; name: string }[] }[]>(`/shift-notes?from=${addDays(businessDate, -3)}`) });
  return (
    <div className="grid lg:grid-cols-[1fr_360px] gap-4">
      <div className="space-y-2">
        {notes.data?.map((n) => (
          <Card key={n.id} className="p-3">
            <p className="whitespace-pre-wrap text-sm">{n.text}</p>
            <div className="flex items-center gap-2 mt-2 text-xs text-muted">
              <span>
                {n.authorName} · {f.dateTime(n.createdAt)} {n.shift ? `· ${t(`fd.shift.${n.shift}`)}` : ""}
              </span>
              <span className="ml-auto">{n.acknowledgedBy.length ? `✓ ${n.acknowledgedBy.map((a) => a.name).join(", ")}` : ""}</span>
              {!n.acknowledgedBy.some((a) => a.userId === user?.id) ? (
                <Button size="xs" icon={<CheckCheck className="size-3" />} onClick={() => post(`/shift-notes/${n.id}/ack`).then(() => qc.invalidateQueries({ queryKey: ["shift-notes"] }), errorToast)}>
                  {t("fd.ack")}
                </Button>
              ) : null}
            </div>
          </Card>
        ))}
        {notes.data && !notes.data.length ? <p className="text-sm text-muted">{t("dash.noNotes")}</p> : null}
      </div>
      {can("frontdesk.handover") ? (
        <Card className="p-3 space-y-2 h-fit">
          <Field label={t("fd.newNote")}>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-28" />
          </Field>
          <Button
            variant="primary"
            loading={busy}
            disabled={!text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const h = new Date().getHours();
                await post("/shift-notes", { text, shift: h < 14 ? "MORNING" : h < 22 ? "EVENING" : "NIGHT" });
                setText("");
                await qc.invalidateQueries({ queryKey: ["shift-notes"] });
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("common.save")}
          </Button>
        </Card>
      ) : null}
    </div>
  );
}

function PoliceReport() {
  const t = useT();
  const f = useFmt();
  const { businessDate } = useSession();
  const [from, setFrom] = useState(businessDate);
  const [to, setTo] = useState(businessDate);
  const q = useQuery({ queryKey: ["police", from, to], queryFn: () => get<{ rows: Record<string, string>[] }>(`/frontdesk/police-report?from=${from}&to=${to}`) });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <Field label={t("common.from")}>
          <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field label={t("common.to")}>
          <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
        <Button icon={<Printer className="size-4" />} onClick={() => void openPdf(`/reports/police/export?format=pdf&from=${from}&to=${to}`).catch(errorToast)}>
          PDF
        </Button>
        <Button icon={<Download className="size-4" />} onClick={() => void download(`/reports/police/export?format=xlsx&from=${from}&to=${to}`).then(() => toast.success(t("common.downloaded")), errorToast)}>
          Excel
        </Button>
      </div>
      <Card>
        <DataTable
          rows={q.data?.rows}
          loading={q.isLoading}
          rowKey={(r) => r.confirmationNo + r.passportNumber + r.room}
          cols={[
            { key: "n", header: t("common.name"), cell: (r) => r.guestName },
            { key: "nat", header: t("guest.nationality"), cell: (r) => r.nationality },
            { key: "pp", header: t("guest.passportNumber"), cell: (r) => r.passportNumber || <Badge tone="red">{t("common.missing")}</Badge> },
            { key: "visa", header: t("guest.visaNumber"), cell: (r) => r.visaNumber || <Badge tone="amber">{t("common.missing")}</Badge> },
            { key: "room", header: t("res.room"), cell: (r) => r.room },
            { key: "in", header: t("res.arrival"), cell: (r) => f.date(r.checkIn) },
            { key: "out", header: t("res.departure"), cell: (r) => f.date(r.checkOut) },
          ]}
        />
      </Card>
    </div>
  );
}
