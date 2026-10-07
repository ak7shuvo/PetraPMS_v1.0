"use client";
// Front desk dialogs shared by the front desk, room rack, tape chart and reservation screens.
import React, { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Printer, XCircle } from "lucide-react";
import { ApiClientError, get, openPdf, post } from "@/lib/api";
import { fromPoisha, toPoisha, useFmt, useT } from "@/lib/i18n";
import { useCompanies, usePaymentMethods, useRooms, type Guest } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { Badge, Button, Checkbox, Field, Input, Modal, MoneyInput, Select, Textarea, errorToast, toast, useConfirm, useWithApproval } from "../ui";
import { DocumentCapture, GuestFields, saveGuest, toDraft, type GuestDraft } from "../guest-form";

export interface StayRef {
  id: string;
  version: number;
  reservationId: string;
  arrivalDate: string;
  departureDate: string;
  roomId?: string | null;
  roomNumber?: string | null;
  roomTypeId?: string;
  guestName?: string;
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["frontdesk", "rack", "tape", "reservation", "reservations", "folios", "folio", "dashboard", "rooms", "housekeeping"]) void qc.invalidateQueries({ queryKey: [k] });
  };
}

interface Readiness {
  ready: boolean;
  foreign: boolean;
  issues: { code: string; message: string; blocking: boolean }[];
}

export function CheckInDialog({ stay, open, onOpenChange, onDone }: { stay: StayRef | null; open: boolean; onOpenChange: (o: boolean) => void; onDone?: (r: { folioId: string; roomNumber: string }) => void }) {
  const t = useT();
  const f = useFmt();
  const invalidate = useInvalidate();
  const pms = usePaymentMethods();
  const rooms = useRooms();
  const [roomId, setRoomId] = useState("");
  const [guest, setGuest] = useState<GuestDraft | null>(null);
  const [guestId, setGuestId] = useState("");
  const [deposit, setDeposit] = useState({ method: "CASH", amount: "", reference: "" });
  const [eci, setEci] = useState("");
  const [busy, setBusy] = useState(false);
  const [printCard, setPrintCard] = useState(true);
  const confirm = useConfirm();

  const res = useQuery({ queryKey: ["reservation", stay?.reservationId], enabled: !!stay && open, queryFn: () => get<{ guest: Guest; rooms: { id: string; guest: { id: string } | null; roomTypeId: string; version: number }[] }>(`/reservations/${stay!.reservationId}`) });
  const ready = useQuery({ queryKey: ["frontdesk", "readiness", stay?.id], enabled: !!stay && open, queryFn: () => get<Readiness>(`/stays/${stay!.id}/checkin-readiness`) });
  const avail = useQuery({ queryKey: ["tape", "free-rooms", stay?.id], enabled: !!stay && open, queryFn: () => get<{ rooms: { id: string; number: string; status: string; roomType: { code: string } }[] }>("/rack") });

  useEffect(() => {
    if (!open || !stay) return;
    setRoomId(stay.roomId ?? "");
    setDeposit({ method: "CASH", amount: "", reference: "" });
    setEci("");
  }, [open, stay]);
  useEffect(() => {
    if (res.data) {
      const g = res.data.guest;
      setGuestId(g.id);
      setGuest(toDraft(g));
    }
  }, [res.data]);

  if (!stay) return null;
  const freeRooms = (avail.data?.rooms ?? []).filter((r) => r.id === stay.roomId || r.status === "VACANT_CLEAN" || r.status === "VACANT_DIRTY");
  const typeId = res.data?.rooms.find((r) => r.id === stay.id)?.roomTypeId;
  const roomObjs = rooms.data ?? [];

  const doCheckIn = async (allowDirty = false) => {
    if (!guest) return;
    setBusy(true);
    try {
      await saveGuest({ ...guest, id: guestId });
      const r = await post<{ folioId: string; roomNumber: string }>(`/stays/${stay.id}/check-in`, {
        version: (await get<{ rooms: { id: string; version: number }[] }>(`/reservations/${stay.reservationId}`)).rooms.find((x) => x.id === stay.id)?.version ?? stay.version,
        roomId: roomId || null,
        allowDirty,
        earlyCheckInCharge: toPoisha(eci) ?? 0,
        deposit: toPoisha(deposit.amount) ? { method: deposit.method, amount: toPoisha(deposit.amount), reference: deposit.reference } : null,
      });
      toast.success(t("fd.checkedIn", { room: r.roomNumber }));
      invalidate();
      onOpenChange(false);
      onDone?.(r);
      if (printCard) void openPdf(`/stays/${stay.id}/registration-card/pdf`).catch(errorToast);
    } catch (e) {
      if (e instanceof ApiClientError && e.code === "ROOM_NOT_READY") {
        const c = await confirm({ title: t("fd.roomNotReady"), message: e.message, confirmLabel: t("fd.checkInAnyway") });
        if (c.ok) return doCheckIn(true);
      } else errorToast(e);
      void ready.refetch();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("fd.checkInTitle", { name: stay.guestName ?? "" })}
      description={`${f.date(stay.arrivalDate)} → ${f.date(stay.departureDate)}`}
      size="xl"
      footer={
        <>
          <Checkbox className="mr-auto" checked={printCard} onChange={(e) => setPrintCard(e.target.checked)} label={t("fd.printRegCard")} />
          <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={busy} disabled={!guest?.firstName} onClick={() => void doCheckIn()}>
            {t("fd.checkIn")}
          </Button>
        </>
      }
    >
      <div className="grid lg:grid-cols-[1fr_280px] gap-5">
        <div className="space-y-4">
          {guest ? <GuestFields value={guest} onChange={setGuest} compact /> : null}
          {guestId ? (
            <div className="flex flex-wrap gap-4">
              <DocumentCapture guestId={guestId} kind="idImage" current={res.data?.guest.idImage} onSaved={() => void res.refetch()} />
              <DocumentCapture guestId={guestId} kind="photo" current={res.data?.guest.photo} onSaved={() => void res.refetch()} />
            </div>
          ) : null}
        </div>
        <div className="space-y-4">
          <div className="rounded-md border border-line p-3 space-y-1.5">
            <p className="text-xs font-semibold text-muted">{t("fd.checklist")}</p>
            {ready.data?.issues.length ? (
              ready.data.issues.map((i) => (
                <p key={i.code} className="flex gap-1.5 text-xs">
                  {i.blocking ? <XCircle className="size-3.5 text-accent shrink-0" /> : <AlertTriangle className="size-3.5 text-[var(--st-vacant-dirty)] shrink-0" />}
                  {i.message}
                </p>
              ))
            ) : (
              <p className="flex gap-1.5 text-xs">
                <CheckCircle2 className="size-3.5 text-[var(--st-vacant-clean)]" /> {t("fd.allGood")}
              </p>
            )}
          </div>
          <Field label={t("fd.room")}>
            <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">{t("fd.autoAssign")}</option>
              {freeRooms
                .filter((r) => !typeId || roomObjs.find((x) => x.id === r.id)?.roomTypeId === typeId || r.id === stay.roomId)
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number} · {r.roomType.code} {r.status === "VACANT_DIRTY" ? `(${t("status.DIRTY")})` : ""}
                  </option>
                ))}
              <optgroup label={t("fd.otherTypes")}>
                {freeRooms
                  .filter((r) => typeId && roomObjs.find((x) => x.id === r.id)?.roomTypeId !== typeId && r.id !== stay.roomId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.number} · {r.roomType.code} ({t("fd.upgrade")})
                    </option>
                  ))}
              </optgroup>
            </Select>
          </Field>
          <Field label={t("fd.deposit")}>
            <div className="grid grid-cols-2 gap-2">
              <Select value={deposit.method} onChange={(e) => setDeposit({ ...deposit, method: e.target.value })}>
                {pms.data?.filter((m) => m.active && m.type !== "CITY_LEDGER").map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name}
                  </option>
                ))}
              </Select>
              <MoneyInput value={deposit.amount} onChange={(v) => setDeposit({ ...deposit, amount: v })} />
            </div>
          </Field>
          {deposit.method !== "CASH" && toPoisha(deposit.amount) ? (
            <Field label={t("folio.reference")}>
              <Input value={deposit.reference} onChange={(e) => setDeposit({ ...deposit, reference: e.target.value })} />
            </Field>
          ) : null}
          <Field label={t("fd.earlyCheckInCharge")}>
            <MoneyInput value={eci} onChange={setEci} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

interface FolioRow {
  id: string;
  number: string;
  name: string;
  status: string;
  balance: number;
  reservationRoomId: string | null;
  cityLedger: boolean;
}

export function CheckOutDialog({ stay, open, onOpenChange }: { stay: StayRef | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const f = useFmt();
  const invalidate = useInvalidate();
  const { businessDate, can } = useSession();
  const pms = usePaymentMethods();
  const companies = useCompanies(open);
  const withApproval = useWithApproval();
  const [method, setMethod] = useState("CASH");
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [lco, setLco] = useState("");
  const [cl, setCl] = useState("");
  const [busy, setBusy] = useState(false);
  const [invoice, setInvoice] = useState(true);
  const folios = useQuery({ queryKey: ["folios", "stay", stay?.id], enabled: !!stay && open, queryFn: () => get<{ rows: FolioRow[] }>(`/folios?reservationId=${stay!.reservationId}&take=50`) });
  const mine = (folios.data?.rows ?? []).filter((x) => (x.reservationRoomId === stay?.id || !x.reservationRoomId) && !x.cityLedger && x.status !== "CLOSED");
  const due = mine.reduce((a, x) => a + x.balance, 0) + (toPoisha(lco) ?? 0);
  useEffect(() => {
    if (open) {
      setAmount("");
      setReference("");
      setLco("");
      setCl("");
    }
  }, [open]);
  useEffect(() => {
    if (open && folios.data) setAmount(due > 0 ? fromPoisha(due) : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, folios.data, lco]);
  if (!stay) return null;
  const early = stay.departureDate > businessDate;

  const submit = async () => {
    setBusy(true);
    try {
      const fresh = await get<{ rooms: { id: string; version: number }[] }>(`/reservations/${stay.reservationId}`);
      const version = fresh.rooms.find((x) => x.id === stay.id)?.version ?? stay.version;
      const pay = toPoisha(amount);
      const r = await withApproval((approval) =>
        post<{ folioId: string }>(`/stays/${stay.id}/check-out`, { version, early, lateCheckOutCharge: toPoisha(lco) ?? 0, payment: pay && pay > 0 && !cl ? { method, amount: pay, reference } : null, cityLedgerCompanyId: cl || null, approval }),
      );
      toast.success(t("fd.checkedOut"));
      invalidate();
      onOpenChange(false);
      if (invoice) {
        try {
          const inv = await post<{ id: string }>(`/folios/${r.folioId}/invoices`, {});
          void openPdf(`/invoices/${inv.id}/pdf`);
        } catch (e) {
          if (!(e instanceof ApiClientError && e.code === "EMPTY_FOLIO")) errorToast(e);
        }
      }
    } catch (e) {
      errorToast(e);
      void folios.refetch();
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("fd.checkOutTitle", { name: stay.guestName ?? "", room: stay.roomNumber ?? "" })}
      size="md"
      footer={
        <>
          <Checkbox className="mr-auto" checked={invoice} onChange={(e) => setInvoice(e.target.checked)} label={t("fd.printInvoice")} />
          <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {t("fd.checkOut")}
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        {early ? (
          <p className="rounded-md border border-[var(--st-vacant-dirty)] px-3 py-2 text-xs">
            <AlertTriangle className="inline size-3.5 mr-1 text-[var(--st-vacant-dirty)]" />
            {t("fd.earlyDeparture", { date: f.date(stay.departureDate) })}
          </p>
        ) : null}
        <div className="rounded-md border border-line divide-y divide-line">
          {mine.map((x) => (
            <div key={x.id} className="flex justify-between px-3 py-2">
              <span>
                {x.number} · {x.name}
              </span>
              <b className={x.balance > 0 ? "text-accent num" : "num"}>{f.money(x.balance)}</b>
            </div>
          ))}
          <div className="flex justify-between px-3 py-2 bg-surface-2">
            <span className="font-semibold">{t("fd.totalDue")}</span>
            <b className="num">{f.money(due)}</b>
          </div>
        </div>
        <Field label={t("fd.lateCheckOutCharge")}>
          <MoneyInput value={lco} onChange={setLco} />
        </Field>
        {due > 0 ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field label={t("folio.method")}>
                <Select value={method} onChange={(e) => setMethod(e.target.value)} disabled={!!cl}>
                  {pms.data?.filter((m) => m.active && m.type !== "CITY_LEDGER").map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t("folio.amount")}>
                <MoneyInput value={amount} onChange={setAmount} disabled={!!cl} />
              </Field>
            </div>
            {method !== "CASH" && !cl ? (
              <Field label={t("folio.reference")}>
                <Input value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            ) : null}
            {can("frontdesk.checkout", "ledger.manage") ? (
              <Field label={t("fd.billToCompany")} hint={t("fd.billToCompanyHint")}>
                <Select value={cl} onChange={(e) => setCl(e.target.value)}>
                  <option value="">—</option>
                  {companies.data?.filter((c) => c.cityLedger).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}
          </>
        ) : due < 0 ? (
          <p className="text-accent text-xs">{t("fd.refundFirst")}</p>
        ) : null}
      </div>
    </Modal>
  );
}

export function MoveDialog({ stay, open, onOpenChange }: { stay: StayRef | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const invalidate = useInvalidate();
  const rack = useQuery({ queryKey: ["rack", "move"], enabled: open, queryFn: () => get<{ rooms: { id: string; number: string; status: string; roomType: { code: string; name: string } }[] }>("/rack") });
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [reprice, setReprice] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!stay) return null;
  const free = (rack.data?.rooms ?? []).filter((r) => r.status === "VACANT_CLEAN" || r.status === "VACANT_DIRTY");
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("fd.moveTitle", { room: stay.roomNumber ?? "" })}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!to || reason.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                const fresh = await get<{ rooms: { id: string; version: number }[] }>(`/reservations/${stay.reservationId}`);
                await post(`/stays/${stay.id}/move`, { version: fresh.rooms.find((x) => x.id === stay.id)?.version ?? stay.version, toRoomId: to, reason, reprice });
                toast.success(t("fd.moved"));
                invalidate();
                onOpenChange(false);
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("fd.move")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t("fd.toRoom")}>
          <Select value={to} onChange={(e) => setTo(e.target.value)}>
            <option value="">—</option>
            {free.map((r) => (
              <option key={r.id} value={r.id}>
                {r.number} · {r.roomType.name} {r.status === "VACANT_DIRTY" ? `(${t("status.DIRTY")})` : ""}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("common.reason")} required>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <Checkbox checked={reprice} onChange={(e) => setReprice(e.target.checked)} label={t("fd.reprice")} />
      </div>
    </Modal>
  );
}

export function ExtendDialog({ stay, open, onOpenChange }: { stay: StayRef | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const invalidate = useInvalidate();
  const [dep, setDep] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (stay && open) setDep(stay.departureDate);
  }, [stay, open]);
  if (!stay) return null;
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t("fd.changeDeparture")}
      size="sm"
      footer={
        <>
          <Button onClick={() => onOpenChange(false)}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!dep || dep === stay.departureDate}
            onClick={async () => {
              setBusy(true);
              try {
                const fresh = await get<{ rooms: { id: string; version: number }[] }>(`/reservations/${stay.reservationId}`);
                await post(`/stays/${stay.id}/extend`, { version: fresh.rooms.find((x) => x.id === stay.id)?.version ?? stay.version, departure: dep });
                toast.success(t("common.saved"));
                invalidate();
                onOpenChange(false);
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
      <Field label={t("res.departure")} hint={t("fd.extendHint")}>
        <Input type="date" value={dep} min={stay.arrivalDate} onChange={(e) => setDep(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function PrintMenuItems(stayId: string, reservationId: string, t: (k: string) => string) {
  return [
    { label: t("fd.printRegCard"), icon: <Printer className="size-4" />, onSelect: () => void openPdf(`/stays/${stayId}/registration-card/pdf`).catch(errorToast) },
    { label: t("res.printConfirmation"), icon: <Printer className="size-4" />, onSelect: () => void openPdf(`/reservations/${reservationId}/confirmation/pdf`).catch(errorToast) },
  ];
}

export { Badge };
