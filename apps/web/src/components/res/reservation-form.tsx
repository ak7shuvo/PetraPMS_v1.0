"use client";
// New reservation / walk-in form: guest (search or new), dates, one or more rooms with live availability and
// price quotes, rate plan, discounts (manager approval above the user's limit), deposit.
import React, { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Trash2, UserPlus, X } from "lucide-react";
import { addDays, nightsBetween } from "@petra/core";
import { get, post } from "@/lib/api";
import { toPoisha, useFmt, useT } from "@/lib/i18n";
import { useCompanies, usePaymentMethods, useRatePlans, useRoomTypes, type Guest } from "@/lib/queries";
import { useSession } from "@/lib/session";
import { Badge, Button, Card, CardHeader, Checkbox, Field, Input, MoneyInput, Select, Textarea, cn, errorToast, toast, useDebounced, useWithApproval } from "../ui";
import { GuestFields, emptyGuest, guestPayload, type GuestDraft } from "../guest-form";

interface RoomLine {
  key: string;
  roomTypeId: string;
  roomId: string;
  ratePlanId: string;
  adults: string;
  children: string;
  extraBeds: string;
  overrideRate: string;
  discount: string;
}
interface Quote {
  nightCount: number;
  total: number;
  nights: { date: string; amount: number; season?: string }[];
  errors: { code: string; message: string }[];
}
const SOURCES = ["WALK_IN", "PHONE", "WEBSITE", "OTA", "CORPORATE", "AGENT", "EMAIL"];

let seq = 0;
const newLine = (roomTypeId = "", ratePlanId = ""): RoomLine => ({ key: String(++seq), roomTypeId, roomId: "", ratePlanId, adults: "2", children: "0", extraBeds: "0", overrideRate: "", discount: "" });

function LineQuote({ line, arrival, departure, onQuote }: { line: RoomLine; arrival: string; departure: string; onQuote: (key: string, q: Quote | null) => void }) {
  const f = useFmt();
  const t = useT();
  const args = useDebounced(JSON.stringify({ roomTypeId: line.roomTypeId, ratePlanId: line.ratePlanId || null, arrival, departure, adults: Number(line.adults) || 1, children: Number(line.children) || 0, extraBeds: Number(line.extraBeds) || 0, discountBp: Math.round((Number(line.discount) || 0) * 100) }), 300);
  const q = useQuery({ queryKey: ["quote", args], enabled: !!line.roomTypeId && departure > arrival, queryFn: () => post<Quote>("/rates/quote", JSON.parse(args)) });
  const override = toPoisha(line.overrideRate);
  const total = q.data ? (override !== null ? override * q.data.nightCount : q.data.total) : null;
  useEffect(() => {
    onQuote(line.key, q.data ? { ...q.data, total: total ?? 0 } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, total]);
  if (!q.data) return <span className="text-muted text-xs">—</span>;
  return (
    <div className="text-right">
      <div className="font-semibold num">{f.money(total)}</div>
      <div className="text-[11px] text-muted num">
        {q.data.nightCount} × {f.money(q.data.nightCount ? Math.round((total ?? 0) / q.data.nightCount) : 0)}
      </div>
      {q.data.errors.length && override === null ? <div className="text-[11px] text-accent">{q.data.errors[0].message}</div> : null}
      {q.data.nights.some((n) => n.season) ? <div className="text-[11px] text-st-res">{t("res.seasonApplied")}</div> : null}
    </div>
  );
}

export function GuestPicker({ value, onChange }: { value: { guest: Guest | null; draft: GuestDraft | null }; onChange: (v: { guest: Guest | null; draft: GuestDraft | null }) => void }) {
  const t = useT();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const res = useQuery({ queryKey: ["guests", "pick", dq], enabled: dq.trim().length >= 2, queryFn: () => get<{ rows: Guest[] }>(`/guests?take=8&q=${encodeURIComponent(dq)}`) });
  if (value.guest)
    return (
      <div className="flex items-center gap-3 rounded-md border border-line px-3 py-2">
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">
            {value.guest.fullName} {value.guest.vip ? <Badge tone="amber">VIP {value.guest.vip}</Badge> : null} {value.guest.blacklisted ? <Badge tone="red">{t("guest.blacklisted")}</Badge> : null}
          </p>
          <p className="text-xs text-muted truncate">
            {value.guest.code} · {value.guest.phone || "—"} · {value.guest.nationality} {value.guest.totalStays ? `· ${t("guest.stays", { n: value.guest.totalStays })}` : ""}
          </p>
          {value.guest.preferences ? <p className="text-xs text-st-res truncate">{value.guest.preferences}</p> : null}
        </div>
        <Button size="sm" variant="ghost" onClick={() => onChange({ guest: null, draft: null })} aria-label={t("common.remove")}>
          <X className="size-4" />
        </Button>
      </div>
    );
  if (value.draft)
    return (
      <div className="space-y-2">
        <GuestFields value={value.draft} onChange={(d) => onChange({ guest: null, draft: d })} compact />
        <Button size="sm" variant="ghost" onClick={() => onChange({ guest: null, draft: null })}>
          {t("res.searchExisting")}
        </Button>
      </div>
    );
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted" />
          <Input className="pl-8" placeholder={t("res.searchGuest")} value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        </div>
        <Button icon={<UserPlus className="size-4" />} onClick={() => onChange({ guest: null, draft: { ...emptyGuest(), firstName: /\d/.test(q) ? "" : q, phone: /\d/.test(q) ? q : "" } })}>
          {t("res.newGuest")}
        </Button>
      </div>
      {res.data?.rows.length ? (
        <div className="rounded-md border border-line divide-y divide-line max-h-56 overflow-auto">
          {res.data.rows.map((g) => (
            <button key={g.id} onClick={() => onChange({ guest: g, draft: null })} className="w-full text-left px-3 py-2 hover:bg-surface-2 text-sm flex justify-between gap-2">
              <span>
                {g.fullName} {g.blacklisted ? <Badge tone="red">{t("guest.blacklisted")}</Badge> : null}
              </span>
              <span className="text-xs text-muted">
                {g.phone} · {g.code}
              </span>
            </button>
          ))}
        </div>
      ) : dq.length >= 2 && res.isFetched ? (
        <p className="text-xs text-muted">{t("common.noResults")}</p>
      ) : null}
    </div>
  );
}

export function ReservationForm({ walkIn, onCreated, initial }: { walkIn?: boolean; onCreated: (r: { id: string; confirmationNo?: string; folioId?: string }) => void; initial?: { arrival?: string; departure?: string; roomTypeId?: string; roomId?: string; guest?: Guest | null } }) {
  const t = useT();
  const f = useFmt();
  const { businessDate, can, user } = useSession();
  const types = useRoomTypes();
  const plans = useRatePlans();
  const companies = useCompanies();
  const pms = usePaymentMethods();
  const withApproval = useWithApproval();
  const [who, setWho] = useState<{ guest: Guest | null; draft: GuestDraft | null }>({ guest: initial?.guest ?? null, draft: null });
  const [arrival, setArrival] = useState(initial?.arrival ?? businessDate);
  const [departure, setDeparture] = useState(initial?.departure ?? addDays(initial?.arrival ?? businessDate, 1));
  const [lines, setLines] = useState<RoomLine[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote | null>>({});
  const [h, setH] = useState({ status: "CONFIRMED", source: walkIn ? "WALK_IN" : "PHONE", sourceRef: "", agentName: "", companyId: "", eta: "", specialRequests: "", notes: "", depositRequired: "", groupName: "", paymentTerms: "GUEST" });
  const [dep, setDep] = useState({ method: "CASH", amount: "", reference: "" });
  const [busy, setBusy] = useState(false);
  const nights = departure > arrival ? nightsBetween(arrival, departure) : 0;

  const rack = useQuery({ queryKey: ["availability", arrival, departure], enabled: nights > 0, queryFn: () => get<{ types: { id: string; code: string; name: string }[]; grid: Record<string, Record<string, { available: number }>> }>(`/availability?from=${arrival}&to=${addDays(departure, -1)}`) });
  const freeRooms = useQuery({ queryKey: ["tape", "free", arrival, departure], enabled: nights > 0, queryFn: () => get<{ rooms: { id: string; number: string; roomType: { id: string } }[]; stays: { roomId: string; arrivalDate: string; departureDate: string; status: string }[]; blocks: { roomId: string; startDate: string; endDate: string }[] }>(`/tape-chart?from=${arrival}&days=${Math.max(7, Math.min(62, nights))}`) });

  useEffect(() => {
    if (types.data && !lines.length) {
      const rack = plans.data?.find((p) => p.type === (walkIn ? "WALKIN" : "RACK") && p.active) ?? plans.data?.find((p) => p.type === "RACK");
      setLines([{ ...newLine(initial?.roomTypeId ?? types.data.find((x) => x.active)?.id ?? "", rack?.id ?? ""), roomId: initial?.roomId ?? "" }]);
    }
  }, [types.data, plans.data, lines.length, walkIn, initial]);

  useEffect(() => {
    if (departure <= arrival) setDeparture(addDays(arrival, 1));
  }, [arrival, departure]);

  const minAvail = (typeId: string) => {
    const g = rack.data?.grid[typeId];
    if (!g) return null;
    const vals = Object.values(g).map((d) => d.available);
    return vals.length ? Math.min(...vals) : null;
  };
  const freeFor = (typeId: string, current: string) => {
    const d = freeRooms.data;
    if (!d) return [];
    const taken = new Set(lines.filter((l) => l.roomId && l.roomId !== current).map((l) => l.roomId));
    return d.rooms.filter((r) => r.roomType.id === typeId && !taken.has(r.id) && !d.stays.some((s) => s.roomId === r.id && ["RESERVED", "CHECKED_IN"].includes(s.status) && s.arrivalDate < departure && arrival < s.departureDate) && !d.blocks.some((b) => b.roomId === r.id && b.startDate < departure && arrival < b.endDate));
  };
  const total = useMemo(() => lines.reduce((a, l) => a + (quotes[l.key]?.total ?? 0), 0), [lines, quotes]);
  const setLine = (k: string, p: Partial<RoomLine>) => setLines((ls) => ls.map((l) => (l.key === k ? { ...l, ...p } : l)));
  const company = companies.data?.find((c) => c.id === h.companyId);

  useEffect(() => {
    // corporate: preselect the company's rate plan and discount
    if (company?.ratePlanId) setLines((ls) => ls.map((l) => ({ ...l, ratePlanId: company.ratePlanId! })));
    if (company?.discountBp) setLines((ls) => ls.map((l) => ({ ...l, discount: String(company.discountBp / 100) })));
  }, [company?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const valid = (who.guest || (who.draft && who.draft.firstName.trim())) && nights > 0 && lines.length > 0 && lines.every((l) => l.roomTypeId);

  const submit = async () => {
    setBusy(true);
    try {
      const body = {
        guestId: who.guest?.id ?? null,
        guest: who.draft ? guestPayload(who.draft) : null,
        companyId: h.companyId || null,
        status: walkIn ? "CONFIRMED" : h.status,
        source: h.source,
        sourceRef: h.sourceRef,
        agentName: h.agentName,
        arrival,
        departure,
        rooms: lines.map((l) => ({ roomTypeId: l.roomTypeId, roomId: l.roomId || null, ratePlanId: l.ratePlanId || null, adults: Number(l.adults) || 1, children: Number(l.children) || 0, extraBeds: Number(l.extraBeds) || 0, overrideRate: toPoisha(l.overrideRate), discountBp: Math.round((Number(l.discount) || 0) * 100) })),
        isGroup: lines.length > 1 && !!h.groupName,
        groupName: h.groupName,
        eta: h.eta,
        specialRequests: h.specialRequests,
        notes: h.notes,
        depositRequired: toPoisha(h.depositRequired) ?? 0,
        paymentTerms: h.paymentTerms,
        autoAssign: walkIn,
        deposit: toPoisha(dep.amount) ? { method: dep.method, amount: toPoisha(dep.amount), reference: dep.reference } : null,
      };
      if (walkIn) {
        const r = await withApproval((approval) => post<{ reservationId: string; confirmationNo: string; folioId?: string; error?: string; rooms?: string[] }>("/frontdesk/walk-in", { ...body, approval }));
        if (r.error) toast.warning(r.error);
        else toast.success(t("fd.walkInDone", { rooms: (r.rooms ?? []).join(", ") }));
        onCreated({ id: r.reservationId, confirmationNo: r.confirmationNo, folioId: r.folioId });
      } else {
        const r = await withApproval((approval) => post<{ id: string; confirmationNo: string }>("/reservations", { ...body, approval }));
        toast.success(t("res.created", { no: r.confirmationNo }));
        onCreated(r);
      }
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid xl:grid-cols-[1fr_340px] gap-4">
      <div className="space-y-4">
        <Card>
          <CardHeader title={t("res.guest")} />
          <div className="p-4">
            <GuestPicker value={who} onChange={setWho} />
          </div>
        </Card>
        <Card>
          <CardHeader title={t("res.stay")} sub={nights ? t("res.nights", { n: nights }) : undefined} />
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Field label={t("res.arrival")}>
                <Input type="date" value={arrival} min={businessDate} disabled={walkIn} onChange={(e) => setArrival(e.target.value)} />
              </Field>
              <Field label={t("res.departure")}>
                <Input type="date" value={departure} min={addDays(arrival, 1)} onChange={(e) => setDeparture(e.target.value)} />
              </Field>
              <Field label={t("res.nightsLabel")}>
                <Input inputMode="numeric" value={nights || ""} onChange={(e) => Number(e.target.value) > 0 && setDeparture(addDays(arrival, Math.min(Number(e.target.value), 365)))} />
              </Field>
              {!walkIn ? (
                <Field label={t("res.eta")}>
                  <Input type="time" value={h.eta} onChange={(e) => setH({ ...h, eta: e.target.value })} />
                </Field>
              ) : null}
            </div>
            <div className="space-y-3">
              {lines.map((l, i) => {
                const avail = minAvail(l.roomTypeId);
                const rt = types.data?.find((x) => x.id === l.roomTypeId);
                return (
                  <div key={l.key} className="rounded-md border border-line p-3">
                    <div className="grid grid-cols-2 md:grid-cols-12 gap-2 items-end">
                      <Field label={`${t("res.room")} ${i + 1}`} className="col-span-2 md:col-span-3">
                        <Select value={l.roomTypeId} onChange={(e) => setLine(l.key, { roomTypeId: e.target.value, roomId: "" })}>
                          {types.data?.filter((x) => x.active).map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name} ({minAvail(x.id) ?? "…"} {t("res.free")})
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t("res.ratePlan")} className="col-span-2 md:col-span-3">
                        <Select value={l.ratePlanId} onChange={(e) => setLine(l.key, { ratePlanId: e.target.value })}>
                          <option value="">{t("res.baseRate")}</option>
                          {plans.data?.filter((p) => p.active).map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.name}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label={t("res.adults")} className="md:col-span-1">
                        <Input inputMode="numeric" value={l.adults} onChange={(e) => setLine(l.key, { adults: e.target.value.replace(/\D/g, "") })} />
                      </Field>
                      <Field label={t("res.children")} className="md:col-span-1">
                        <Input inputMode="numeric" value={l.children} onChange={(e) => setLine(l.key, { children: e.target.value.replace(/\D/g, "") })} />
                      </Field>
                      <Field label={t("res.extraBeds")} className="md:col-span-1">
                        <Input inputMode="numeric" value={l.extraBeds} onChange={(e) => setLine(l.key, { extraBeds: e.target.value.replace(/\D/g, "") })} />
                      </Field>
                      <div className="col-span-2 md:col-span-3 flex items-end justify-end gap-2">
                        <LineQuote line={l} arrival={arrival} departure={departure} onQuote={(k, q) => setQuotes((qs) => ({ ...qs, [k]: q }))} />
                        <Button variant="ghost" size="sm" disabled={lines.length === 1} onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label={t("common.remove")}>
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                      <Field label={t("res.assignRoom")} className="col-span-2 md:col-span-3">
                        <Select value={l.roomId} onChange={(e) => setLine(l.key, { roomId: e.target.value })}>
                          <option value="">{walkIn ? t("fd.autoAssign") : t("res.unassigned")}</option>
                          {freeFor(l.roomTypeId, l.roomId).map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.number}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      {can("rates.override") ? (
                        <Field label={t("res.overrideRate")} className="col-span-1 md:col-span-2">
                          <MoneyInput value={l.overrideRate} onChange={(v) => setLine(l.key, { overrideRate: v })} placeholder={t("res.optional")} />
                        </Field>
                      ) : null}
                      {can("rates.discount", "rates.discount_approve") ? (
                        <Field label={t("res.discountPct")} className="col-span-1 md:col-span-2" hint={user && Number(l.discount) * 100 > user.discountLimitBp ? t("res.needsApproval") : undefined}>
                          <Input inputMode="decimal" value={l.discount} onChange={(e) => setLine(l.key, { discount: e.target.value })} placeholder="0" />
                        </Field>
                      ) : null}
                      <div className="col-span-2 md:col-span-5 text-xs text-muted self-center">
                        {rt ? t("res.capacity", { adults: rt.maxAdults, children: rt.maxChildren, max: rt.maxOccupancy }) : null}
                        {avail !== null && avail <= 0 ? <span className="block text-accent">{t("res.soldOut")}</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })}
              <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setLines([...lines, newLine(lines[lines.length - 1]?.roomTypeId, lines[lines.length - 1]?.ratePlanId)])}>
                {t("res.addRoom")}
              </Button>
            </div>
          </div>
        </Card>
        <Card>
          <CardHeader title={t("res.details")} />
          <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {!walkIn ? (
              <Field label={t("common.status")}>
                <Select value={h.status} onChange={(e) => setH({ ...h, status: e.target.value })}>
                  <option value="CONFIRMED">{t("status.CONFIRMED")}</option>
                  <option value="TENTATIVE">{t("status.TENTATIVE")}</option>
                  <option value="WAITLIST">{t("status.WAITLIST")}</option>
                </Select>
              </Field>
            ) : null}
            <Field label={t("res.source")}>
              <Select value={h.source} onChange={(e) => setH({ ...h, source: e.target.value })}>
                {SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {t(`source.${s}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("res.sourceRef")}>
              <Input value={h.sourceRef} onChange={(e) => setH({ ...h, sourceRef: e.target.value })} />
            </Field>
            <Field label={t("res.company")}>
              <Select value={h.companyId} onChange={(e) => setH({ ...h, companyId: e.target.value, paymentTerms: e.target.value ? h.paymentTerms : "GUEST" })}>
                <option value="">—</option>
                {companies.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </Field>
            {h.companyId ? (
              <Field label={t("res.paymentTerms")}>
                <Select value={h.paymentTerms} onChange={(e) => setH({ ...h, paymentTerms: e.target.value })}>
                  <option value="GUEST">{t("res.guestPays")}</option>
                  <option value="COMPANY">{t("res.companyPays")}</option>
                </Select>
              </Field>
            ) : null}
            {lines.length > 1 ? (
              <Field label={t("res.groupName")} className="col-span-2">
                <Input value={h.groupName} onChange={(e) => setH({ ...h, groupName: e.target.value })} />
              </Field>
            ) : null}
            <Field label={t("res.specialRequests")} className="col-span-2">
              <Textarea value={h.specialRequests} onChange={(e) => setH({ ...h, specialRequests: e.target.value })} className="min-h-14" />
            </Field>
            <Field label={t("res.internalNotes")} className="col-span-2">
              <Textarea value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} className="min-h-14" />
            </Field>
          </div>
        </Card>
      </div>
      <div className="space-y-4">
        <Card className="xl:sticky xl:top-20">
          <CardHeader title={t("res.summary")} />
          <div className="p-4 space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">{t("res.dates")}</span>
              <span>
                {f.short(arrival)} → {f.short(departure)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">{t("res.roomsCount")}</span>
              <span>
                {lines.length} × {nights} {t("res.nightsShort")}
              </span>
            </div>
            <div className="flex justify-between text-base border-t border-line pt-2">
              <b>{t("res.roomTotal")}</b>
              <b className="num">{f.money(total)}</b>
            </div>
            <p className="text-[11px] text-muted">{t("res.taxNote")}</p>
            {!walkIn ? (
              <Field label={t("res.depositRequired")}>
                <MoneyInput value={h.depositRequired} onChange={(v) => setH({ ...h, depositRequired: v })} />
              </Field>
            ) : null}
            {can("folio.payment") ? (
              <div className="rounded-md border border-line p-3 space-y-2">
                <p className="text-xs font-semibold text-muted">{walkIn ? t("fd.advance") : t("res.depositNow")}</p>
                <div className="grid grid-cols-2 gap-2">
                  <Select value={dep.method} onChange={(e) => setDep({ ...dep, method: e.target.value })}>
                    {pms.data?.filter((m) => m.active && m.type !== "CITY_LEDGER").map((m) => (
                      <option key={m.code} value={m.code}>
                        {m.name}
                      </option>
                    ))}
                  </Select>
                  <MoneyInput value={dep.amount} onChange={(v) => setDep({ ...dep, amount: v })} />
                </div>
                {dep.method !== "CASH" && toPoisha(dep.amount) ? <Input placeholder={t("folio.reference")} value={dep.reference} onChange={(e) => setDep({ ...dep, reference: e.target.value })} /> : null}
              </div>
            ) : null}
            <Button variant="primary" size="lg" className="w-full" loading={busy} disabled={!valid} onClick={() => void submit()}>
              {walkIn ? t("fd.walkInCheckIn") : t("res.create")}
            </Button>
            {!valid ? <p className={cn("text-[11px] text-muted")}>{t("res.fillRequired")}</p> : null}
          </div>
        </Card>
      </div>
    </div>
  );
}

export { Checkbox };
