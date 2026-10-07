"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { addDays, dayOfWeek, eachDay } from "@petra/core";
import { del, get, post, put } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fromPoisha, toPoisha, useFmt, useT } from "@/lib/i18n";
import { useRatePlans, useRoomTypes, type RatePlan } from "@/lib/queries";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, Input, Modal, MoneyInput, PageHeader, Select, Tabs, Textarea, cn, errorToast, toast, useConfirm } from "@/components/ui";
import { MasterEditor } from "@/components/master-editor";
import { useTitle } from "@/components/shell/auth-screens";

const TYPES = ["RACK", "CORPORATE", "WEEKEND", "SEASONAL", "PACKAGE", "WALKIN", "OTA"];
const MEALS = ["RO", "BB", "HB", "FB"];

export default function RatesPage() {
  const t = useT();
  const { can } = useSession();
  useTitle(t("nav.rates"));
  const edit = can("rates.manage");
  const penalty = ["NONE", "FIRST_NIGHT", "PERCENT", "FULL"].map((v) => ({ value: v, label: t(`penalty.${v}`) }));
  return (
    <div>
      <PageHeader title={t("nav.rates")} />
      <Tabs
        tabs={[
          { value: "plans", label: t("rates.plans"), content: <Plans /> },
          { value: "seasons", label: t("rates.seasons"), content: <Seasons /> },
          { value: "calendar", label: t("rates.calendar"), content: <Calendar /> },
          { value: "avail", label: t("rates.availability"), content: <Availability /> },
          {
            value: "policies",
            label: t("rates.policies"),
            content: (
              <div className="space-y-4">
                <MasterEditor
                  path="cancellation-policies"
                  title={t("rates.policies")}
                  canEdit={edit}
                  fields={[
                    { key: "code", label: t("common.code"), type: "code", required: true },
                    { key: "name", label: t("common.name"), type: "text", required: true },
                    { key: "freeUntilHours", label: t("rates.freeUntil"), type: "int", default: 24 },
                    { key: "penaltyType", label: t("rates.penaltyType"), type: "enum", options: penalty, default: "FIRST_NIGHT" },
                    { key: "penaltyValue", label: t("rates.penaltyPct"), type: "percent", default: 0 },
                    { key: "noShowType", label: t("rates.noShowType"), type: "enum", options: penalty, default: "FIRST_NIGHT" },
                    { key: "description", label: t("folio.description"), type: "text", list: false },
                    { key: "active", label: t("common.active"), type: "bool", default: true },
                  ]}
                />
                <MasterEditor
                  path="discount-rules"
                  title={t("rates.discounts")}
                  canEdit={edit}
                  fields={[
                    { key: "code", label: t("common.code"), type: "code", required: true },
                    { key: "name", label: t("common.name"), type: "text", required: true },
                    { key: "type", label: t("common.type"), type: "enum", options: [{ value: "PERCENT", label: "%" }, { value: "AMOUNT", label: "৳" }], default: "PERCENT" },
                    { key: "value", label: t("rates.valueBpOrPoisha"), type: "int", default: 0 },
                    { key: "requiresApproval", label: t("rates.requiresApproval"), type: "bool", default: false },
                    { key: "active", label: t("common.active"), type: "bool", default: true },
                  ]}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

function Plans() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const plans = useRatePlans();
  const types = useRoomTypes();
  const pols = useQuery({ queryKey: ["masters", "cancellation-policies"], queryFn: () => get<{ id: string; code: string; name: string }[]>("/cancellation-policies") });
  const [edit, setEdit] = useState<(Partial<RatePlan> & { rates: Record<string, string>; adj: string; weekend: string; meal: string; mealChild: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const open = (p: RatePlan | null) =>
    setEdit({
      ...(p ?? { code: "", name: "", nameBn: "", type: "RACK", mealPlan: "RO", adjustmentType: "NONE", weekendDays: [5, 6], minStay: 1, maxStay: 0, active: true, description: "", cancellationPolicyId: null }),
      rates: Object.fromEntries((p?.roomRates ?? []).map((r) => [r.roomTypeId, fromPoisha(r.rate)])),
      adj: p ? (p.adjustmentType === "AMOUNT" ? fromPoisha(p.adjustmentValue) : String(p.adjustmentValue / 100)) : "0",
      weekend: p ? String(p.weekendAdjustmentBp / 100) : "0",
      meal: p ? fromPoisha(p.mealPricePerAdult) : "0",
      mealChild: p ? fromPoisha(p.mealPricePerChild) : "0",
    });
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    const body = {
      code: edit.code,
      name: edit.name,
      nameBn: edit.nameBn ?? "",
      type: edit.type,
      mealPlan: edit.mealPlan,
      mealPricePerAdult: toPoisha(edit.meal) ?? 0,
      mealPricePerChild: toPoisha(edit.mealChild) ?? 0,
      adjustmentType: edit.adjustmentType,
      adjustmentValue: edit.adjustmentType === "AMOUNT" ? (toPoisha(edit.adj) ?? 0) : Math.round((Number(edit.adj) || 0) * 100),
      weekendDays: edit.weekendDays,
      weekendAdjustmentBp: Math.round((Number(edit.weekend) || 0) * 100),
      minStay: Number(edit.minStay) || 1,
      maxStay: Number(edit.maxStay) || 0,
      cancellationPolicyId: edit.cancellationPolicyId || null,
      description: edit.description ?? "",
      active: edit.active,
      roomRates: Object.entries(edit.rates)
        .filter(([, v]) => toPoisha(v) !== null)
        .map(([roomTypeId, v]) => ({ roomTypeId, rate: toPoisha(v)! })),
    };
    try {
      if (edit.id) await put(`/rate-plans/${edit.id}`, body);
      else await post("/rate-plans", body);
      toast.success(t("common.saved"));
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ["rate-plans"] });
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title={t("rates.plans")} actions={can("rates.manage") ? <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => open(null)}>{t("common.add")}</Button> : null} />
      <DataTable
        rows={plans.data}
        rowKey={(p) => p.id}
        onRowClick={can("rates.manage") ? (p) => open(p) : undefined}
        cols={[
          { key: "c", header: t("common.code"), cell: (p) => <b>{p.code}</b> },
          { key: "n", header: t("common.name"), cell: (p) => <span>{p.name} {!p.active ? <Badge tone="gray">{t("common.inactive")}</Badge> : null}</span> },
          { key: "t", header: t("common.type"), cell: (p) => t(`planType.${p.type}`) },
          { key: "m", header: t("rates.meal"), cell: (p) => `${p.mealPlan}${p.mealPricePerAdult ? ` +${f.money(p.mealPricePerAdult)}` : ""}` },
          { key: "a", header: t("rates.adjustment"), cell: (p) => (p.adjustmentType === "PERCENT" ? `${p.adjustmentValue / 100}%` : p.adjustmentType === "AMOUNT" ? f.money(p.adjustmentValue) : p.roomRates.length ? t("rates.fixedRates") : "—") },
          { key: "pol", header: t("res.policy"), cell: (p) => p.cancellationPolicy?.name ?? "—" },
        ]}
      />
      <Modal
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.id ? edit.name : t("rates.newPlan")}
        size="lg"
        footer={
          <>
            {edit?.id ? (
              <Button
                variant="danger"
                className="mr-auto"
                onClick={async () => {
                  const c = await confirm({ title: t("common.delete"), danger: true });
                  if (c.ok) await del(`/rate-plans/${edit.id}`).then(() => (setEdit(null), qc.invalidateQueries({ queryKey: ["rate-plans"] })), errorToast);
                }}
              >
                {t("common.delete")}
              </Button>
            ) : null}
            <Button onClick={() => setEdit(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={busy} disabled={!edit?.code || !edit?.name} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {edit ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label={t("common.code")} required>
              <Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t("common.name")} required className="md:col-span-2">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label={t("common.type")}>
              <Select value={edit.type} onChange={(e) => setEdit({ ...edit, type: e.target.value })}>
                {TYPES.map((x) => <option key={x} value={x}>{t(`planType.${x}`)}</option>)}
              </Select>
            </Field>
            <Field label={t("rates.meal")}>
              <Select value={edit.mealPlan} onChange={(e) => setEdit({ ...edit, mealPlan: e.target.value })}>
                {MEALS.map((x) => <option key={x} value={x}>{t(`meal.${x}`)}</option>)}
              </Select>
            </Field>
            <Field label={t("rates.mealAdult")}>
              <MoneyInput value={edit.meal} onChange={(v) => setEdit({ ...edit, meal: v })} />
            </Field>
            <Field label={t("rates.mealChild")}>
              <MoneyInput value={edit.mealChild} onChange={(v) => setEdit({ ...edit, mealChild: v })} />
            </Field>
            <Field label={t("res.policy")}>
              <Select value={edit.cancellationPolicyId ?? ""} onChange={(e) => setEdit({ ...edit, cancellationPolicyId: e.target.value || null })}>
                <option value="">—</option>
                {pols.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t("rates.adjustType")}>
              <Select value={edit.adjustmentType} onChange={(e) => setEdit({ ...edit, adjustmentType: e.target.value })}>
                <option value="NONE">{t("rates.none")}</option>
                <option value="PERCENT">% {t("rates.ofBase")}</option>
                <option value="AMOUNT">৳ {t("rates.ofBase")}</option>
              </Select>
            </Field>
            <Field label={t("rates.adjustValue")} hint={t("rates.adjustHint")}>
              <Input value={edit.adj} onChange={(e) => setEdit({ ...edit, adj: e.target.value })} disabled={edit.adjustmentType === "NONE"} />
            </Field>
            <Field label={t("rates.weekendPct")}>
              <Input value={edit.weekend} onChange={(e) => setEdit({ ...edit, weekend: e.target.value })} />
            </Field>
            <Field label={t("rates.minStay")}>
              <Input value={edit.minStay} onChange={(e) => setEdit({ ...edit, minStay: Number(e.target.value) || 1 })} />
            </Field>
            <Field label={t("rates.weekendDays")} className="col-span-2 md:col-span-4">
              <div className="flex flex-wrap gap-3">
                {[0, 1, 2, 3, 4, 5, 6].map((d) => (
                  <Checkbox key={d} checked={(edit.weekendDays ?? []).includes(d)} onChange={(e) => setEdit({ ...edit, weekendDays: e.target.checked ? [...(edit.weekendDays ?? []), d] : (edit.weekendDays ?? []).filter((x) => x !== d) })} label={t(`dow.${d}`)} />
                ))}
              </div>
            </Field>
            <div className="col-span-2 md:col-span-4">
              <p className="text-xs text-muted mb-2">{t("rates.fixedHelp")}</p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {types.data?.map((rt) => (
                  <Field key={rt.id} label={`${rt.code} (${t("rates.base")} ${f.money(rt.baseRate)})`}>
                    <MoneyInput value={edit.rates[rt.id] ?? ""} onChange={(v) => setEdit({ ...edit, rates: { ...edit.rates, [rt.id]: v } })} placeholder={t("rates.auto")} />
                  </Field>
                ))}
              </div>
            </div>
            <Field label={t("folio.description")} className="col-span-2 md:col-span-4">
              <Textarea value={edit.description ?? ""} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className="min-h-12" />
            </Field>
            <Checkbox checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} label={t("common.active")} />
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}

interface Season {
  id: string;
  name: string;
  ratePlanId: string | null;
  roomTypeId: string | null;
  startDate: string;
  endDate: string;
  adjustmentType: string;
  value: number;
  daysOfWeek: number[];
  minStay: number;
  priority: number;
  active: boolean;
  ratePlan: { code: string } | null;
  roomType: { code: string } | null;
}

function Seasons() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const { can, businessDate } = useSession();
  const plans = useRatePlans();
  const types = useRoomTypes();
  const list = useQuery({ queryKey: ["seasons"], queryFn: () => get<Season[]>("/seasons") });
  const [e, setE] = useState<(Omit<Season, "value" | "ratePlan" | "roomType"> & { value: string }) | null>(null);
  const save = async () => {
    if (!e) return;
    const body = { name: e.name, ratePlanId: e.ratePlanId || null, roomTypeId: e.roomTypeId || null, startDate: e.startDate, endDate: e.endDate, adjustmentType: e.adjustmentType, value: e.adjustmentType === "PERCENT" ? Math.round(Number(e.value) * 100) : (toPoisha(e.value) ?? 0), daysOfWeek: e.daysOfWeek, minStay: e.minStay, priority: e.priority, active: e.active };
    try {
      if (e.id) await put(`/seasons/${e.id}`, body);
      else await post("/seasons", body);
      setE(null);
      void qc.invalidateQueries({ queryKey: ["seasons"] });
      toast.success(t("common.saved"));
    } catch (err) {
      errorToast(err);
    }
  };
  return (
    <Card>
      <CardHeader title={t("rates.seasons")} sub={t("rates.seasonsHint")} actions={can("rates.manage") ? <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setE({ id: "", name: "", ratePlanId: null, roomTypeId: null, startDate: businessDate, endDate: addDays(businessDate, 7), adjustmentType: "PERCENT", value: "10", daysOfWeek: [0, 1, 2, 3, 4, 5, 6], minStay: 0, priority: 0, active: true })}>{t("common.add")}</Button> : null} />
      <DataTable
        rows={list.data}
        rowKey={(s) => s.id}
        onRowClick={can("rates.manage") ? (s) => setE({ ...s, value: s.adjustmentType === "PERCENT" ? String(s.value / 100) : fromPoisha(s.value) }) : undefined}
        cols={[
          { key: "n", header: t("common.name"), cell: (s) => <b>{s.name}</b> },
          { key: "d", header: t("res.dates"), cell: (s) => `${f.date(s.startDate)} – ${f.date(s.endDate)}`, sort: (s) => s.startDate },
          { key: "v", header: t("rates.adjustment"), cell: (s) => (s.adjustmentType === "PERCENT" ? `${s.value > 0 ? "+" : ""}${s.value / 100}%` : s.adjustmentType === "AMOUNT" ? f.money(s.value) : `= ${f.money(s.value)}`) },
          { key: "p", header: t("res.ratePlan"), cell: (s) => s.ratePlan?.code ?? t("common.all") },
          { key: "t", header: t("common.type"), cell: (s) => s.roomType?.code ?? t("common.all") },
          { key: "dow", header: t("rates.days"), cell: (s) => (s.daysOfWeek.length === 7 ? t("common.all") : s.daysOfWeek.map((d) => t(`dow.${d}`)).join(" ")) },
          { key: "a", header: "", cell: (s) => (!s.active ? <Badge tone="gray">{t("common.inactive")}</Badge> : null) },
        ]}
      />
      <Modal
        open={!!e}
        onOpenChange={(o) => !o && setE(null)}
        title={t("rates.season")}
        size="md"
        footer={
          <>
            {e?.id ? <Button variant="danger" className="mr-auto" onClick={() => del(`/seasons/${e.id}`).then(() => (setE(null), qc.invalidateQueries({ queryKey: ["seasons"] })), errorToast)}>{t("common.delete")}</Button> : null}
            <Button variant="primary" disabled={!e?.name || !e?.value} onClick={() => void save()}>{t("common.save")}</Button>
          </>
        }
      >
        {e ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("common.name")} className="col-span-2"><Input value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} placeholder="Eid-ul-Fitr" /></Field>
            <Field label={t("common.from")}><Input type="date" value={e.startDate} onChange={(x) => setE({ ...e, startDate: x.target.value })} /></Field>
            <Field label={t("rates.toInclusive")}><Input type="date" value={e.endDate} onChange={(x) => setE({ ...e, endDate: x.target.value })} /></Field>
            <Field label={t("rates.adjustType")}>
              <Select value={e.adjustmentType} onChange={(x) => setE({ ...e, adjustmentType: x.target.value })}>
                <option value="PERCENT">%</option>
                <option value="AMOUNT">± ৳</option>
                <option value="FIXED">= ৳</option>
              </Select>
            </Field>
            <Field label={t("rates.adjustValue")}><Input value={e.value} onChange={(x) => setE({ ...e, value: x.target.value })} /></Field>
            <Field label={t("res.ratePlan")}>
              <Select value={e.ratePlanId ?? ""} onChange={(x) => setE({ ...e, ratePlanId: x.target.value || null })}>
                <option value="">{t("common.all")}</option>
                {plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t("common.type")}>
              <Select value={e.roomTypeId ?? ""} onChange={(x) => setE({ ...e, roomTypeId: x.target.value || null })}>
                <option value="">{t("common.all")}</option>
                {types.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </Select>
            </Field>
            <Field label={t("rates.minStay")}><Input value={e.minStay} onChange={(x) => setE({ ...e, minStay: Number(x.target.value) || 0 })} /></Field>
            <Field label={t("rates.priority")}><Input value={e.priority} onChange={(x) => setE({ ...e, priority: Number(x.target.value) || 0 })} /></Field>
            <Field label={t("rates.days")} className="col-span-2">
              <div className="flex flex-wrap gap-3">
                {[0, 1, 2, 3, 4, 5, 6].map((d) => <Checkbox key={d} checked={e.daysOfWeek.includes(d)} onChange={(x) => setE({ ...e, daysOfWeek: x.target.checked ? [...e.daysOfWeek, d] : e.daysOfWeek.filter((y) => y !== d) })} label={t(`dow.${d}`)} />)}
              </div>
            </Field>
            <Checkbox checked={e.active} onChange={(x) => setE({ ...e, active: x.target.checked })} label={t("common.active")} />
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}

function Calendar() {
  const t = useT();
  const f = useFmt();
  const { businessDate } = useSession();
  const plans = useRatePlans();
  const [plan, setPlan] = useState("");
  const [from, setFrom] = useState(businessDate);
  const q = useQuery({ queryKey: ["rates", "calendar", plan, from], queryFn: () => get<{ rows: { roomType: { code: string; name: string }; nights: { date: string; amount: number; season: string | null }[] }[] }>(`/rates/calendar?from=${from}&days=21${plan ? `&ratePlanId=${plan}` : ""}`) });
  const days = eachDay(from, addDays(from, 20));
  return (
    <Card>
      <CardHeader
        title={t("rates.calendar")}
        sub={t("rates.calendarHint")}
        actions={
          <>
            <Select value={plan} onChange={(e) => setPlan(e.target.value)} className="h-8 w-44">
              <option value="">{t("res.baseRate")}</option>
              {plans.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36" />
          </>
        }
      />
      <div className="overflow-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface-2 px-2 py-1 text-left border-b border-line">{t("common.type")}</th>
              {days.map((d) => <th key={d} className={cn("px-1.5 py-1 border-b border-line font-medium whitespace-nowrap", [5, 6].includes(dayOfWeek(d)) && "text-accent")}>{f.short(d)}</th>)}
            </tr>
          </thead>
          <tbody>
            {q.data?.rows.map((r) => (
              <tr key={r.roomType.code}>
                <td className="sticky left-0 bg-surface px-2 py-1 border-b border-line font-semibold whitespace-nowrap">{r.roomType.name}</td>
                {r.nights.map((n) => <td key={n.date} title={n.season ?? ""} className={cn("px-1.5 py-1 border-b border-line text-right num whitespace-nowrap", n.season && "bg-[color-mix(in_srgb,var(--st-reserved)_10%,transparent)]")}>{f.money(n.amount, { symbol: false }).replace(/\.00$/, "")}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Availability() {
  const t = useT();
  const f = useFmt();
  const { businessDate } = useSession();
  const [from, setFrom] = useState(businessDate);
  const q = useQuery({ queryKey: ["availability", "grid", from], queryFn: () => get<{ types: { id: string; code: string; name: string }[]; grid: Record<string, Record<string, { total: number; available: number; sold: number; blocked: number }>>; days: { date: string; occupancyBp: number }[] }>(`/availability?from=${from}&to=${addDays(from, 20)}`) });
  return (
    <Card>
      <CardHeader title={t("rates.availability")} actions={<Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36" />} />
      <div className="overflow-auto">
        <table className="text-xs border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 bg-surface-2 px-2 py-1 text-left border-b border-line">{t("common.type")}</th>
              {q.data?.days.map((d) => <th key={d.date} className="px-1.5 py-1 border-b border-line font-medium whitespace-nowrap">{f.short(d.date)}<div className="text-muted font-normal">{f.pct(d.occupancyBp).replace(".0", "")}</div></th>)}
            </tr>
          </thead>
          <tbody>
            {q.data?.types.map((ty) => (
              <tr key={ty.id}>
                <td className="sticky left-0 bg-surface px-2 py-1 border-b border-line font-semibold">{ty.name}</td>
                {q.data!.days.map((d) => {
                  const c = q.data!.grid[ty.id]?.[d.date];
                  return <td key={d.date} className={cn("px-1.5 py-1 border-b border-line text-center num font-semibold", c && c.available <= 0 ? "text-accent" : c && c.available <= 2 ? "text-[var(--st-vacant-dirty)]" : "text-st-vc")} title={c ? `${t("dash.rooms")} ${c.total} · ${t("rates.sold")} ${c.sold} · OOO ${c.blocked}` : ""}>{c?.available ?? "—"}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
