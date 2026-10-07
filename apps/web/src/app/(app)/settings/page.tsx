"use client";
import React, { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, KeyRound, LayoutPanelTop, Monitor, Plus, Printer, Send, Trash2 } from "lucide-react";
import { del, download, fileToDataUrl, get, openPdf, post, put } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fromPoisha, toPoisha, useFmt, useLocale, useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, Input, Modal, MoneyInput, PageHeader, Select, Switch, Tabs, Textarea, errorToast, toast, useConfirm } from "@/components/ui";
import { MasterEditor } from "@/components/master-editor";
import { useTitle } from "@/components/shell/auth-screens";

type Settings = Record<string, Record<string, unknown>>;

interface SField {
  key: string;
  label: string;
  type: "bool" | "int" | "text" | "time" | "enum" | "textarea" | "color";
  options?: { value: string; label: string }[];
  hint?: string;
}

function SectionForm({ section, title, fields, sub, perm = "settings.manage" }: { section: string; title: string; fields: SField[]; sub?: string; perm?: string }) {
  const t = useT();
  const qc = useQueryClient();
  const { can } = useSession();
  const s = useQuery({ queryKey: ["settings"], queryFn: () => get<Settings>("/settings") });
  const [v, setV] = useState<Record<string, unknown> | null>(null);
  useEffect(() => {
    if (s.data && !v) setV(s.data[section]);
  }, [s.data, v, section]);
  if (!v) return null;
  const editable = can(perm);
  return (
    <Card>
      <CardHeader
        title={title}
        sub={sub}
        actions={
          editable ? (
            <Button
              size="sm"
              variant="primary"
              onClick={async () => {
                try {
                  const r = await put<Record<string, unknown>>(`/settings/${section}`, v);
                  setV(r);
                  toast.success(t("common.saved"));
                  void qc.invalidateQueries({ queryKey: ["settings"] });
                } catch (e) {
                  errorToast(e);
                }
              }}
            >
              {t("common.save")}
            </Button>
          ) : null
        }
      />
      <div className="p-4 grid sm:grid-cols-2 gap-3">
        {fields.map((fd) =>
          fd.type === "bool" ? (
            <Switch key={fd.key} checked={!!v[fd.key]} disabled={!editable} onChange={(x) => setV({ ...v, [fd.key]: x })} label={<span className="text-sm">{fd.label}{fd.hint ? <span className="block text-xs text-muted">{fd.hint}</span> : null}</span>} />
          ) : (
            <Field key={fd.key} label={fd.label} hint={fd.hint} className={fd.type === "textarea" ? "sm:col-span-2" : undefined}>
              {fd.type === "enum" ? (
                <Select value={String(v[fd.key])} disabled={!editable} onChange={(e) => setV({ ...v, [fd.key]: e.target.value })}>
                  {fd.options?.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : fd.type === "textarea" ? (
                <Textarea value={String(v[fd.key] ?? "")} disabled={!editable} onChange={(e) => setV({ ...v, [fd.key]: e.target.value })} />
              ) : (
                <Input type={fd.type === "time" ? "time" : fd.type === "color" ? "color" : "text"} inputMode={fd.type === "int" ? "numeric" : undefined} value={String(v[fd.key] ?? "")} disabled={!editable} onChange={(e) => setV({ ...v, [fd.key]: fd.type === "int" ? Number(e.target.value) || 0 : e.target.value })} />
              )}
            </Field>
          ),
        )}
      </div>
    </Card>
  );
}

export default function SettingsPage() {
  const t = useT();
  const sp = useSearchParams();
  const { can } = useSession();
  useTitle(t("nav.settings"));
  return (
    <div>
      <PageHeader title={t("nav.settings")} />
      <Tabs
        value={sp.get("tab") ?? undefined}
        tabs={[
          { value: "hotel", label: t("settings.hotel"), content: <HotelTab /> },
          { value: "billing", label: t("settings.billing"), content: <BillingTab /> },
          { value: "operations", label: t("settings.operations"), content: <OperationsTab /> },
          { value: "notifications", label: t("settings.notifications"), content: <NotificationsTab />, hidden: !can("settings.manage") },
          { value: "pos", label: t("settings.pos"), content: <PosTab />, hidden: !can("pos.manage", "pos.view") },
          { value: "devices", label: t("settings.devices"), content: <DevicesTab /> },
          { value: "workspaces", label: t("settings.workspaces"), content: <WorkspacesTab /> },
          { value: "branding", label: t("settings.branding"), content: <BrandingTab />, hidden: !can("settings.branding") },
          { value: "license", label: t("settings.license"), content: <LicenseTab /> },
        ]}
      />
    </div>
  );
}

function HotelTab() {
  const t = useT();
  const qc = useQueryClient();
  const { can, refreshStatus } = useSession();
  const h = useQuery({ queryKey: ["hotel", "full"], queryFn: () => get<Record<string, unknown>>("/hotel") });
  const [v, setV] = useState<Record<string, unknown> | null>(null);
  const [regTerms, setRegTerms] = useState("");
  useEffect(() => {
    if (h.data && !v) setV({ ...h.data, usd: fromPoisha(h.data.usdRate as number) });
  }, [h.data, v]);
  if (!v) return null;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  const editable = can("settings.manage");
  return (
    <div className="grid xl:grid-cols-[1fr_360px] gap-4">
      <Card>
        <CardHeader
          title={t("settings.hotel")}
          actions={
            editable ? (
              <Button
                size="sm"
                variant="primary"
                onClick={async () => {
                  try {
                    const body = { name: v.name, legalName: v.legalName, address: v.address, city: v.city, country: v.country, phone: v.phone, email: v.email, website: v.website, bin: v.bin, tradeLicense: v.tradeLicense, logo: v.logo, checkInTime: v.checkInTime, checkOutTime: v.checkOutTime, usdRate: toPoisha(String(v.usd)) ?? 12000, showUsd: !!v.showUsd };
                    await put("/hotel", body);
                    toast.success(t("common.saved"));
                    void qc.invalidateQueries({ queryKey: ["hotel"] });
                    void refreshStatus();
                  } catch (e) {
                    errorToast(e);
                  }
                }}
              >
                {t("common.save")}
              </Button>
            ) : null
          }
        />
        <div className="p-4 grid sm:grid-cols-2 gap-3">
          <Field label={t("setup.hotelName")}><Input value={String(v.name)} onChange={set("name")} disabled={!editable} /></Field>
          <Field label={t("settings.legalName")}><Input value={String(v.legalName)} onChange={set("legalName")} disabled={!editable} /></Field>
          <Field label={t("common.address")} className="sm:col-span-2"><Input value={String(v.address)} onChange={set("address")} disabled={!editable} /></Field>
          <Field label={t("common.city")}><Input value={String(v.city)} onChange={set("city")} disabled={!editable} /></Field>
          <Field label={t("common.phone")}><Input value={String(v.phone)} onChange={set("phone")} disabled={!editable} /></Field>
          <Field label={t("common.email")}><Input value={String(v.email)} onChange={set("email")} disabled={!editable} /></Field>
          <Field label={t("settings.website")}><Input value={String(v.website)} onChange={set("website")} disabled={!editable} /></Field>
          <Field label={t("setup.bin")}><Input value={String(v.bin)} onChange={set("bin")} disabled={!editable} /></Field>
          <Field label={t("settings.tradeLicense")}><Input value={String(v.tradeLicense)} onChange={set("tradeLicense")} disabled={!editable} /></Field>
          <Field label={t("setup.checkInTime")}><Input type="time" value={String(v.checkInTime)} onChange={set("checkInTime")} disabled={!editable} /></Field>
          <Field label={t("setup.checkOutTime")}><Input type="time" value={String(v.checkOutTime)} onChange={set("checkOutTime")} disabled={!editable} /></Field>
          <Field label={t("settings.usdRate")} hint={t("settings.usdRateHint")}><MoneyInput value={String(v.usd)} onChange={(x) => setV({ ...v, usd: x })} disabled={!editable} /></Field>
          <Switch checked={!!v.showUsd} onChange={(x) => setV({ ...v, showUsd: x })} disabled={!editable} label={t("settings.showUsd")} />
          <Field label={t("settings.logo")} hint={t("settings.logoHint")} className="sm:col-span-2">
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {v.logo ? <img src={String(v.logo)} alt="" className="h-14 w-14 object-contain border border-line rounded" /> : null}
              {editable ? <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={async (e) => { const file = e.target.files?.[0]; if (file) { if (file.size > 400_000) return errorToast(new Error(t("settings.logoTooBig"))); setV({ ...v, logo: await fileToDataUrl(file) }); } }} className="text-sm" /> : null}
              {v.logo && editable ? <Button size="sm" variant="ghost" onClick={() => setV({ ...v, logo: "" })}><Trash2 className="size-4" /></Button> : null}
            </div>
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title={t("settings.regTerms")} actions={editable ? <Button size="sm" onClick={() => put("/settings-regcard", { terms: regTerms }).then(() => toast.success(t("common.saved")), errorToast)}>{t("common.save")}</Button> : null} />
        <div className="p-4">
          <Textarea value={regTerms} onChange={(e) => setRegTerms(e.target.value)} placeholder={t("settings.regTermsHint")} className="min-h-48" disabled={!editable} />
        </div>
      </Card>
    </div>
  );
}

function BillingTab() {
  const t = useT();
  const { can } = useSession();
  const cats = ["ROOM", "EXTRA_BED", "FNB", "LAUNDRY", "MINIBAR", "TRANSPORT", "TOUR", "MISC", "CANCELLATION", "ADJUSTMENT", "OPENING_BALANCE", "PAID_OUT"].map((c) => ({ value: c, label: t(`category.${c}`) }));
  const edit = can("settings.manage");
  return (
    <div className="space-y-4">
      <SectionForm
        section="billing"
        title={t("settings.billing")}
        fields={[
          { key: "taxMode", label: t("setup.taxMode"), type: "enum", options: [{ value: "EXCLUSIVE", label: t("setup.exclusive") }, { value: "INCLUSIVE", label: t("setup.inclusive") }] },
          { key: "invoiceLayout", label: t("settings.invoiceLayout"), type: "enum", options: [{ value: "STANDARD", label: t("settings.layoutStandard") }, { value: "MUSHAK", label: t("settings.layoutMushak") }] },
          { key: "cityLedgerPaymentTermsDays", label: t("settings.clTerms"), type: "int" },
          { key: "showQr", label: t("settings.showQr"), type: "bool" },
          { key: "showUsd", label: t("settings.showUsd"), type: "bool" },
          { key: "invoiceFooter", label: t("settings.invoiceFooter"), type: "textarea" },
        ]}
      />
      <MasterEditor path="tax-rules" title={t("settings.taxRules")} canEdit={edit} fields={[{ key: "code", label: t("common.code"), type: "code", required: true }, { key: "name", label: t("common.name"), type: "text", required: true }, { key: "nameBn", label: t("common.nameBn"), type: "text", list: false }, { key: "rateBp", label: t("settings.ratePct"), type: "percent", default: 1500 }, { key: "base", label: t("settings.taxBase"), type: "enum", options: [{ value: "NET", label: t("settings.baseNet") }, { value: "NET_PLUS_PREVIOUS", label: t("settings.baseCompound") }], default: "NET" }, { key: "appliesTo", label: t("settings.appliesTo"), type: "multi", options: [{ value: "*", label: t("folio.allCharges") }, ...cats], default: ["*"] }, { key: "sortOrder", label: t("rooms.sortOrder"), type: "int", default: 1 }, { key: "active", label: t("common.active"), type: "bool", default: true }]} />
      <MasterEditor path="payment-methods" title={t("settings.paymentMethods")} canEdit={edit} queryKey={["masters", "payment-methods"]} fields={[{ key: "code", label: t("common.code"), type: "code", required: true }, { key: "name", label: t("common.name"), type: "text", required: true }, { key: "nameBn", label: t("common.nameBn"), type: "text", list: false }, { key: "type", label: t("common.type"), type: "enum", options: ["CASH", "CARD", "MOBILE", "BANK", "CITY_LEDGER", "OTHER"].map((x) => ({ value: x, label: t(`pmType.${x}`) })), default: "OTHER" }, { key: "sortOrder", label: t("rooms.sortOrder"), type: "int", default: 0 }, { key: "active", label: t("common.active"), type: "bool", default: true }]} />
      <MasterEditor path="charge-codes" title={t("settings.chargeCodes")} canEdit={edit} queryKey={["masters", "charge-codes"]} fields={[{ key: "code", label: t("common.code"), type: "code", required: true }, { key: "name", label: t("common.name"), type: "text", required: true }, { key: "nameBn", label: t("common.nameBn"), type: "text", list: false }, { key: "category", label: t("settings.category"), type: "enum", options: cats, default: "MISC" }, { key: "defaultAmount", label: t("settings.defaultAmount"), type: "money", default: 0 }, { key: "taxable", label: t("settings.taxable"), type: "bool", default: true }, { key: "sortOrder", label: t("rooms.sortOrder"), type: "int", default: 0 }, { key: "active", label: t("common.active"), type: "bool", default: true }]} />
    </div>
  );
}

function OperationsTab() {
  const t = useT();
  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <SectionForm section="frontdesk" title={t("settings.frontdesk")} fields={[{ key: "requireIdForCheckIn", label: t("settings.requireId"), type: "bool" }, { key: "requireDepositAtCheckIn", label: t("settings.requireDeposit"), type: "bool" }, { key: "autoAssignRoom", label: t("settings.autoAssign"), type: "bool" }, { key: "allowCheckoutWithBalance", label: t("settings.allowBalance"), type: "bool", hint: t("settings.allowBalanceHint") }, { key: "earlyCheckInFrom", label: t("settings.earlyFrom"), type: "time" }]} />
      <SectionForm section="audit" title={t("nav.nightAudit")} fields={[{ key: "autoTime", label: t("settings.auditTime"), type: "time", hint: t("settings.auditTimeHint") }, { key: "requireDeparturesResolved", label: t("settings.requireDepartures"), type: "bool" }, { key: "postNoShowPenalty", label: t("settings.noShowPenalty"), type: "bool" }]} />
      <SectionForm section="housekeeping" title={t("nav.housekeeping")} fields={[{ key: "stayoverDaily", label: t("settings.stayoverDaily"), type: "bool" }, { key: "inspectionRequired", label: t("settings.inspection"), type: "bool" }]} />
      <MaintenanceSettings />
      <SectionForm section="security" title={t("settings.security")} fields={[{ key: "idleMinutes", label: t("settings.idle"), type: "int" }, { key: "maxFailedAttempts", label: t("settings.maxFailed"), type: "int" }, { key: "lockMinutes", label: t("settings.lockMinutes"), type: "int" }, { key: "sessionHours", label: t("settings.sessionHours"), type: "int" }, { key: "minPasswordLength", label: t("settings.minPassword"), type: "int" }]} />
      <SectionForm section="locale" title={t("settings.locale")} fields={[{ key: "defaultLocale", label: t("prefs.language"), type: "enum", options: [{ value: "en", label: "English" }, { value: "bn", label: "বাংলা" }] }, { key: "grouping", label: t("settings.grouping"), type: "enum", options: [{ value: "lakh", label: "1,25,000 (lakh)" }, { value: "intl", label: "125,000" }] }, { key: "dateFormat", label: t("settings.dateFormat"), type: "enum", options: ["DD/MM/YYYY", "DD MMM YYYY", "YYYY-MM-DD"].map((x) => ({ value: x, label: x })) }]} />
      <SectionForm section="reports" title={t("settings.scheduledExport")} fields={[{ key: "scheduledExportEnabled", label: t("settings.scheduledExportOn"), type: "bool", hint: t("settings.scheduledExportHint") }, { key: "scheduledExportFolder", label: t("data.folder"), type: "text" }]} />
    </div>
  );
}

interface MaintCfg {
  slaHours: Record<string, number>;
  autoBlockCritical: boolean;
}

function MaintenanceSettings() {
  const t = useT();
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["settings"], queryFn: () => get<Settings>("/settings") });
  const [v, setV] = useState<MaintCfg | null>(null);
  useEffect(() => {
    if (s.data && !v) setV(s.data.maintenance as unknown as MaintCfg);
  }, [s.data, v]);
  if (!v) return null;
  return (
    <Card>
      <CardHeader title={t("nav.maintenance")} actions={<Button size="sm" variant="primary" onClick={() => put("/settings/maintenance", v).then(() => (toast.success(t("common.saved")), qc.invalidateQueries({ queryKey: ["settings"] })), errorToast)}>{t("common.save")}</Button>} />
      <div className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        {["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((p) => (
          <Field key={p} label={`SLA ${t(`status.${p}`)} (h)`}>
            <Input value={v.slaHours[p]} onChange={(e) => setV({ ...v, slaHours: { ...v.slaHours, [p]: Number(e.target.value) || 1 } })} />
          </Field>
        ))}
        <div className="col-span-full">
          <Switch checked={v.autoBlockCritical} onChange={(x) => setV({ ...v, autoBlockCritical: x })} label={t("settings.autoBlock")} />
        </div>
      </div>
    </Card>
  );
}

interface Notif {
  smsEnabled: boolean;
  sms: { url: string; method: string; bodyTemplate: string; headers: string; senderId: string };
  emailEnabled: boolean;
  email: { url: string; headers: string; bodyTemplate: string; from: string };
  whatsappEnabled: boolean;
  whatsapp: { url: string; headers: string; bodyTemplate: string };
  events: Record<string, { sms: boolean; email: boolean; whatsapp: boolean }>;
}

function NotificationsTab() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const s = useQuery({ queryKey: ["settings"], queryFn: () => get<Settings>("/settings") });
  const queue = useQuery({ queryKey: ["notifications"], queryFn: () => get<{ id: string; channel: string; to: string; templateCode: string; status: string; attempts: number; lastError: string; createdAt: string }[]>("/notifications") });
  const [v, setV] = useState<Notif | null>(null);
  const [test, setTest] = useState({ channel: "SMS", to: "" });
  useEffect(() => {
    if (s.data && !v) setV(s.data.notifications as unknown as Notif);
  }, [s.data, v]);
  if (!v) return null;
  const save = () => put("/settings/notifications", v).then(() => (toast.success(t("common.saved")), qc.invalidateQueries({ queryKey: ["settings"] })), errorToast);
  const ch = (k: "sms" | "email" | "whatsapp", label: string) => (
    <Card>
      <CardHeader title={label} actions={<Switch checked={v[`${k}Enabled` as "smsEnabled"]} onChange={(x) => setV({ ...v, [`${k}Enabled`]: x })} label="" />} />
      <div className="p-4 grid gap-3">
        <Field label={t("settings.providerUrl")} hint={k === "sms" ? t("settings.smsUrlHint") : undefined}>
          <Input value={v[k].url} onChange={(e) => setV({ ...v, [k]: { ...v[k], url: e.target.value } })} placeholder="https://api.sms-provider.com.bd/send" />
        </Field>
        {k === "sms" ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label="HTTP"><Select value={v.sms.method} onChange={(e) => setV({ ...v, sms: { ...v.sms, method: e.target.value } })}><option>POST</option><option>GET</option></Select></Field>
            <Field label={t("settings.senderId")}><Input value={v.sms.senderId} onChange={(e) => setV({ ...v, sms: { ...v.sms, senderId: e.target.value } })} /></Field>
          </div>
        ) : null}
        {k === "email" ? <Field label={t("settings.fromAddress")}><Input value={v.email.from} onChange={(e) => setV({ ...v, email: { ...v.email, from: e.target.value } })} /></Field> : null}
        <Field label={t("settings.headersJson")} hint={t("settings.headersHint")}><Textarea value={v[k].headers} onChange={(e) => setV({ ...v, [k]: { ...v[k], headers: e.target.value } })} className="min-h-12 font-mono text-xs" /></Field>
        <Field label={t("settings.bodyTemplate")} hint="{{to}} {{message}} {{subject}} {{sender}} {{from}}"><Textarea value={v[k].bodyTemplate} onChange={(e) => setV({ ...v, [k]: { ...v[k], bodyTemplate: e.target.value } })} className="min-h-12 font-mono text-xs" /></Field>
      </div>
    </Card>
  );
  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button variant="primary" onClick={() => void save()}>{t("common.save")}</Button></div>
      <div className="grid xl:grid-cols-3 gap-4">
        {ch("sms", "SMS")}
        {ch("email", "Email")}
        {ch("whatsapp", "WhatsApp")}
      </div>
      <Card>
        <CardHeader title={t("settings.events")} />
        <div className="p-4 space-y-2">
          {Object.entries(v.events).map(([ev, c]) => (
            <div key={ev} className="flex flex-wrap items-center gap-4 text-sm">
              <span className="w-56">{t(`notifEvent.${ev}`)}</span>
              {(["sms", "email", "whatsapp"] as const).map((x) => <Checkbox key={x} checked={c[x]} onChange={(e) => setV({ ...v, events: { ...v.events, [ev]: { ...c, [x]: e.target.checked } } })} label={x.toUpperCase()} />)}
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <CardHeader title={t("settings.testAndQueue")} actions={<><Select value={test.channel} onChange={(e) => setTest({ ...test, channel: e.target.value })} className="h-8 w-28"><option>SMS</option><option>EMAIL</option><option>WHATSAPP</option></Select><Input value={test.to} onChange={(e) => setTest({ ...test, to: e.target.value })} placeholder="+8801…" className="h-8 w-44" /><Button size="sm" icon={<Send className="size-3.5" />} onClick={() => post<{ status: string; error: string }>("/notifications/test", test).then((r) => (r.status === "SENT" ? toast.success(t("settings.testSent")) : toast.error(r.error || r.status), queue.refetch()), errorToast)}>{t("settings.sendTest")}</Button></>} />
        <DataTable rows={queue.data} rowKey={(n) => n.id} dense cols={[{ key: "d", header: t("common.date"), cell: (n) => f.dateTime(n.createdAt) }, { key: "c", header: t("settings.channel"), cell: (n) => n.channel }, { key: "to", header: t("settings.to"), cell: (n) => n.to }, { key: "tp", header: t("settings.template"), cell: (n) => n.templateCode }, { key: "s", header: t("common.status"), cell: (n) => <span><Badge tone={n.status === "SENT" ? "green" : n.status === "FAILED" ? "red" : "amber"}>{n.status}</Badge> <span className="text-xs text-muted">{n.lastError}</span></span> }, { key: "a", header: "", align: "right", cell: (n) => (n.status === "FAILED" ? <Button size="xs" onClick={() => post(`/notifications/${n.id}/retry`).then(() => queue.refetch(), errorToast)}>{t("settings.retry")}</Button> : null) }]} />
      </Card>
    </div>
  );
}

function PosTab() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const keys = useQuery({ queryKey: ["pos", "keys"], queryFn: () => get<{ id: string; name: string; prefix: string; active: boolean; lastUsedAt: string | null; createdAt: string }[]>("/pos/keys"), enabled: can("pos.manage") });
  const log = useQuery({ queryKey: ["pos", "log"], queryFn: () => get<{ id: string; at: string; ref: string; room: string; folio: string; guest: string; description: string; total: number; voided: boolean }[]>("/pos/log") });
  const [newKey, setNewKey] = useState<string | null>(null);
  const [sim, setSim] = useState({ key: "", room: "", amount: "1500", check: "" });
  return (
    <div className="space-y-4">
      {can("pos.manage") ? (
        <Card>
          <CardHeader
            title={t("pos.keys")}
            sub={t("pos.keysHint")}
            actions={
              <>
                <a href="/api/pos/v1/openapi.json" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs underline"><ExternalLink className="size-3" />OpenAPI</a>
                <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={async () => { const name = prompt(t("pos.keyName")); if (!name) return; try { const r = await post<{ key: string }>("/pos/keys", { name }); setNewKey(r.key); void qc.invalidateQueries({ queryKey: ["pos"] }); } catch (e) { errorToast(e); } }}>{t("pos.newKey")}</Button>
              </>
            }
          />
          <DataTable rows={keys.data} rowKey={(k) => k.id} dense cols={[{ key: "n", header: t("common.name"), cell: (k) => k.name }, { key: "p", header: t("pos.prefix"), cell: (k) => <code>{k.prefix}…</code> }, { key: "u", header: t("pos.lastUsed"), cell: (k) => f.dateTime(k.lastUsedAt) }, { key: "s", header: t("common.status"), cell: (k) => (k.active ? <Badge tone="green">{t("common.active")}</Badge> : <Badge tone="gray">{t("pos.revoked")}</Badge>) }, { key: "a", header: "", align: "right", cell: (k) => (k.active ? <Button size="xs" variant="danger" onClick={async () => { const c = await confirm({ title: t("pos.revoke"), danger: true }); if (c.ok) await del(`/pos/keys/${k.id}`).then(() => qc.invalidateQueries({ queryKey: ["pos"] }), errorToast); }}>{t("pos.revoke")}</Button> : null) }]} />
        </Card>
      ) : null}
      <Card>
        <CardHeader title={t("pos.simulator")} sub={t("pos.simulatorHint")} />
        <div className="p-4 grid sm:grid-cols-5 gap-2 items-end">
          <Field label={t("pos.apiKey")} className="sm:col-span-2"><Input value={sim.key} onChange={(e) => setSim({ ...sim, key: e.target.value })} placeholder="ppk_…" /></Field>
          <Field label={t("res.room")}><Input value={sim.room} onChange={(e) => setSim({ ...sim, room: e.target.value })} /></Field>
          <Field label={t("folio.amount")}><MoneyInput value={sim.amount} onChange={(x) => setSim({ ...sim, amount: x })} /></Field>
          <Button
            variant="primary"
            disabled={!sim.key || !sim.room}
            onClick={async () => {
              const check = sim.check || `SIM-${Date.now().toString(36).toUpperCase()}`;
              const r = await fetch("/api/pos/v1/charges", { method: "POST", headers: { "content-type": "application/json", "x-api-key": sim.key }, body: JSON.stringify({ roomNumber: sim.room, checkNumber: check, amount: toPoisha(sim.amount), outlet: "SIMULATOR", description: "POS simulator", items: [{ name: "Test item", quantity: 1, amount: toPoisha(sim.amount) }] }) });
              const j = await r.json();
              if (j.ok) {
                toast.success(t("pos.posted", { total: f.money(j.data.total), folio: j.data.folio }));
                void log.refetch();
              } else toast.error(j.error?.message ?? "Error");
            }}
          >
            {t("pos.post")}
          </Button>
        </div>
      </Card>
      <Card>
        <CardHeader title={t("pos.log")} />
        <DataTable rows={log.data} rowKey={(l) => l.id} dense cols={[{ key: "t", header: t("audit.time"), cell: (l) => f.dateTime(l.at) }, { key: "r", header: t("pos.ref"), cell: (l) => <code className="text-xs">{l.ref}</code> }, { key: "room", header: t("res.room"), cell: (l) => l.room }, { key: "g", header: t("res.guest"), cell: (l) => l.guest }, { key: "a", header: t("folio.total"), cell: (l) => <span className={l.voided ? "line-through" : ""}>{f.money(l.total)}</span>, align: "right" }]} />
      </Card>
      <Modal open={!!newKey} onOpenChange={(o) => !o && setNewKey(null)} title={t("pos.newKey")} size="sm" footer={<Button variant="primary" onClick={() => setNewKey(null)}>{t("common.done")}</Button>}>
        <p className="text-sm mb-2">{t("pos.copyNow")}</p>
        <div className="flex gap-2">
          <code className="flex-1 break-all rounded bg-surface-2 p-2 text-xs font-mono">{newKey}</code>
          <Button size="sm" onClick={() => void navigator.clipboard.writeText(newKey ?? "").then(() => toast.success(t("common.copied")))}><Copy className="size-4" /></Button>
        </div>
      </Modal>
    </div>
  );
}

/** Printers, LAN address, kiosk mode and app updates (per computer). */
function DevicesTab() {
  const t = useT();
  const locale = useLocale();
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean }[]>([]);
  const [info, setInfo] = useState<{ version: string; mode: string; dataDir: string; lanUrls: string[] } | null>(null);
  const [a4, setA4] = useState("");
  const [thermal, setThermal] = useState("");
  const [silent, setSilent] = useState(false);
  const desktop = typeof window !== "undefined" && !!window.petra;
  const sys = useQuery({ queryKey: ["system", "info"], queryFn: () => get<{ version: string; mode: string; provider: string; dataDir: string; schemaVersion: string; node: string; platform: string }>("/system/info") });
  useEffect(() => {
    setA4(localStorage.getItem("petra.printer.a4") ?? "");
    setThermal(localStorage.getItem("petra.printer.thermal") ?? "");
    setSilent(localStorage.getItem("petra.print.silent") === "1");
    if (window.petra) {
      void window.petra.printers().then(setPrinters).catch(() => undefined);
      void window.petra.appInfo().then(setInfo).catch(() => undefined);
    }
  }, []);
  const lanUrl = info?.lanUrls?.[0] ?? (typeof location !== "undefined" ? location.origin : "");
  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Printer className="size-4" />{t("settings.printers")}</span>} sub={desktop ? t("settings.printersHint") : t("settings.printersBrowser")} />
        <div className="p-4 grid gap-3">
          <Field label={t("settings.a4Printer")}>
            {desktop ? <Select value={a4} onChange={(e) => (setA4(e.target.value), localStorage.setItem("petra.printer.a4", e.target.value))}><option value="">{t("settings.systemDefault")}</option>{printers.map((p) => <option key={p.name}>{p.name}</option>)}</Select> : <Input disabled value={t("settings.browserDialog")} />}
          </Field>
          <Field label={t("settings.thermalPrinter")}>
            {desktop ? <Select value={thermal} onChange={(e) => (setThermal(e.target.value), localStorage.setItem("petra.printer.thermal", e.target.value))}><option value="">{t("settings.systemDefault")}</option>{printers.map((p) => <option key={p.name}>{p.name}</option>)}</Select> : <Input disabled value={t("settings.browserDialog")} />}
          </Field>
          {desktop ? <Switch checked={silent} onChange={(x) => (setSilent(x), localStorage.setItem("petra.print.silent", x ? "1" : "0"))} label={t("settings.silentPrint")} /> : null}
          <div className="flex flex-wrap gap-2 pt-1">
            <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => void openPdf(`/print/test?format=A4&printer=${encodeURIComponent(a4)}&lang=${locale}`, { print: true }).catch(errorToast)}>{t("settings.testA4")}</Button>
            <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => void openPdf(`/print/test?format=80mm&printer=${encodeURIComponent(thermal)}&lang=${locale}`, { print: true, thermal: true }).catch(errorToast)}>{t("settings.testThermal")}</Button>
          </div>
          <p className="text-xs text-muted">{t("settings.testPrintHint")}</p>
        </div>
      </Card>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><Monitor className="size-4" />{t("settings.thisComputer")}</span>} />
        <div className="p-4 space-y-2 text-sm">
          <p>{t("settings.version")}: <b>{sys.data?.version}</b> · {t("settings.mode")}: <b>{sys.data?.mode}</b> · DB: <b>{sys.data?.provider}</b></p>
          <p className="text-xs text-muted break-all">{t("data.folder")}: {sys.data?.dataDir}</p>
          <Button size="sm" onClick={() => void download("/system/diagnostics").catch(errorToast)}>{t("settings.supportBundle")}</Button>
          <p className="text-xs text-muted">{t("settings.supportBundleHint")}</p>
          <p className="text-xs text-muted">Schema {sys.data?.schemaVersion} · Node {sys.data?.node} · {sys.data?.platform}</p>
          <div className="pt-2 border-t border-line">
            <p className="text-xs text-muted mb-1">{t("settings.lanUrl")}</p>
            <div className="flex items-center gap-3">
              <code className="text-sm">{lanUrl}</code>
              <Button size="xs" onClick={() => void navigator.clipboard.writeText(lanUrl).then(() => toast.success(t("common.copied")))}><Copy className="size-3" /></Button>
            </div>
            <LanQr url={lanUrl} />
          </div>
          {desktop ? <UpdatePanel /> : null}
          {desktop ? (
            <div className="flex flex-wrap gap-2 pt-2">
              <Button size="sm" onClick={() => void window.petra!.openDataFolder()}>{t("settings.openDataFolder")}</Button>
              <Button size="sm" onClick={() => void window.petra!.checkForUpdates().then((r) => (r.error ? toast.error(r.error) : r.available ? toast.success(t("settings.updateAvailable", { v: r.version ?? "" })) : toast.info(t("settings.upToDate"))))}>{t("settings.checkUpdates")}</Button>
              <Button size="sm" onClick={() => void window.petra!.setKiosk(true)}>{t("settings.kiosk")}</Button>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}

function LanQr({ url }: { url: string }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!url) return;
    void import("qrcode").then((q) => q.toDataURL(url, { margin: 1, width: 140 })).then(setSrc).catch(() => undefined);
  }, [url]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={url} className="mt-2 rounded border border-line" width={140} height={140} /> : null;
}

/** Saved multi-monitor workspaces: which screens open on which display. */
function WorkspacesTab() {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["workspaces"], queryFn: () => get<{ id: string; name: string; isDefault: boolean; layout: { path: string; title: string; screenId: string; screenLabel: string; bounds: { x: number; y: number; width: number; height: number } | null }[] }[]>("/workspaces") });
  const [displays, setDisplays] = useState<{ id: number; label: string; bounds: { x: number; y: number; width: number; height: number }; primary: boolean }[]>([]);
  const [draft, setDraft] = useState<{ name: string; items: { path: string; displayId: string }[] }>({ name: "", items: [{ path: "/frontdesk", displayId: "" }] });
  const desktop = typeof window !== "undefined" && !!window.petra?.displays;
  useEffect(() => {
    if (window.petra?.displays) void window.petra.displays().then(setDisplays);
  }, []);
  const SCREENS = ["/dashboard", "/frontdesk", "/rack", "/tape-chart", "/reservations", "/housekeeping", "/folios", "/maintenance", "/reports"];
  const open = (layout: { path: string; screenId: string; bounds: { x: number; y: number; width: number; height: number } | null }[]) => {
    if (window.petra?.openWorkspace) void window.petra.openWorkspace(layout.map((l) => ({ route: l.path, displayId: Number(l.screenId) || 0, bounds: l.bounds ?? { x: 0, y: 0, width: 1280, height: 860 } })));
    else layout.forEach((l) => window.open(`${l.path}?pop=1`, "_blank", "popup,width=1280,height=860"));
  };
  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <Card>
        <CardHeader title={<span className="flex items-center gap-2"><LayoutPanelTop className="size-4" />{t("settings.workspaces")}</span>} sub={t("settings.workspacesHint")} />
        <DataTable rows={list.data} rowKey={(w) => w.id} cols={[{ key: "n", header: t("common.name"), cell: (w) => <span>{w.name} {w.isDefault ? <Badge tone="green">{t("settings.default")}</Badge> : null}</span> }, { key: "s", header: t("settings.screens"), cell: (w) => <span className="text-xs">{w.layout.map((l) => `${l.title || l.path}${l.screenLabel ? ` @ ${l.screenLabel}` : ""}`).join(", ")}</span> }, { key: "a", header: "", align: "right", cell: (w) => <div className="flex justify-end gap-1"><Button size="xs" variant="primary" onClick={() => open(w.layout)}>{t("settings.open")}</Button><Button size="xs" variant="ghost" onClick={() => del(`/workspaces/${w.id}`).then(() => qc.invalidateQueries({ queryKey: ["workspaces"] }), errorToast)}><Trash2 className="size-3.5" /></Button></div> }]} />
      </Card>
      <Card>
        <CardHeader title={t("settings.newWorkspace")} sub={desktop ? t("settings.displaysFound", { n: displays.length }) : t("settings.browserWorkspace")} />
        <div className="p-4 space-y-2">
          <Field label={t("common.name")}><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder={t("settings.workspacePlaceholder")} /></Field>
          {draft.items.map((it, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Select value={it.path} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)) })}>{SCREENS.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
              <Select value={it.displayId} onChange={(e) => setDraft({ ...draft, items: draft.items.map((x, j) => (j === i ? { ...x, displayId: e.target.value } : x)) })} disabled={!desktop}>
                <option value="">{t("settings.anyDisplay")}</option>
                {displays.map((d) => <option key={d.id} value={String(d.id)}>{d.label}{d.primary ? " ★" : ""}</option>)}
              </Select>
              <Button variant="ghost" onClick={() => setDraft({ ...draft, items: draft.items.filter((_, j) => j !== i) })}><Trash2 className="size-4" /></Button>
            </div>
          ))}
          <div className="flex gap-2">
            <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setDraft({ ...draft, items: [...draft.items, { path: "/rack", displayId: "" }] })}>{t("settings.addScreen")}</Button>
            <Button
              size="sm"
              variant="primary"
              disabled={!draft.name || !draft.items.length}
              onClick={async () => {
                const layout = draft.items.map((it) => {
                  const d = displays.find((x) => String(x.id) === it.displayId);
                  return { path: it.path, title: it.path.slice(1), screenId: it.displayId, screenLabel: d?.label ?? "", bounds: d ? d.bounds : null, fullscreen: false };
                });
                try {
                  await post("/workspaces", { name: draft.name, layout, isDefault: false });
                  toast.success(t("common.saved"));
                  setDraft({ name: "", items: [{ path: "/frontdesk", displayId: "" }] });
                  void qc.invalidateQueries({ queryKey: ["workspaces"] });
                } catch (e) {
                  errorToast(e);
                }
              }}
            >
              {t("common.save")}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function BrandingTab() {
  const t = useT();
  return (
    <SectionForm
      section="branding"
      perm="settings.branding"
      title={t("settings.branding")}
      sub={t("settings.brandingHint")}
      fields={[
        { key: "appName", label: t("settings.appName"), type: "text" },
        { key: "primaryColor", label: t("settings.primaryColor"), type: "color" },
        { key: "poweredBy", label: t("settings.poweredBy"), type: "bool" },
        { key: "loginMessage", label: t("settings.loginMessage"), type: "textarea" },
      ]}
    />
  );
}

function LicenseTab() {
  const t = useT();
  const f = useFmt();
  const { can, refreshStatus } = useSession();
  const q = useQuery({ queryKey: ["license"], queryFn: () => get<{ state: { mode: string; readOnly: boolean; daysLeft?: number | null; reason?: string; warnings: string[] }; fingerprint: string; edition: string; customer: string | null; hotel: string | null; expiresAt: string | null; supportUntil: string | null; licenseId: string | null; maxRooms: number | null; maxTerminals: number; modules: string[]; roomsActive: number; terminalsInUse: number; hotelId: string | null; plan: string | null; ref: string | null; statusSeq: number; statusAt: string | null }>("/license") });
  const [statusDoc, setStatusDoc] = useState("");
  const [reqCode, setReqCode] = useState("");
  const [key, setKey] = useState("");
  const [code, setCode] = useState("");
  const l = q.data;
  return (
    <div className="grid xl:grid-cols-2 gap-4">
      <Card>
        <CardHeader title={t("settings.license")} />
        {l ? (
          <div className="p-4 space-y-2 text-sm">
            <p className="flex items-center gap-2">
              <Badge tone={l.state.readOnly ? "red" : l.state.mode === "TRIAL" ? "amber" : "green"}>{t(`licenseMode.${l.state.mode}`)}</Badge>
              {l.edition} {l.state.mode === "TRIAL" ? `· ${t("settings.daysLeft", { n: l.state.daysLeft ?? 0 })}` : ""}
            </p>
            {l.state.reason ? <p className="text-danger text-xs font-medium">{t(`licenseReason.${l.state.reason}`)}</p> : null}
            {l.state.warnings.map((w) => <p key={w} className="text-accent text-xs">{w}</p>)}
            {l.customer ? <p>{t("settings.licensedTo")}: <b>{l.customer}</b> · {l.hotel}</p> : null}
            <p>{t("settings.rooms")}: {l.roomsActive} / {l.maxRooms ?? "∞"} · {t("settings.terminals")}: {l.terminalsInUse} / {l.maxTerminals}</p>
            {l.expiresAt ? <p>{t("settings.expires")}: {f.date(l.expiresAt)}</p> : l.licenseId ? <p>{t("settings.perpetual")}</p> : null}
            {l.plan || l.hotelId ? <p className="text-xs text-muted">{[l.plan, l.hotelId].filter(Boolean).join(" · ")}{l.ref ? ` · ${l.ref}` : ""}</p> : null}
            {l.supportUntil ? <p>{t("settings.support")}: {f.date(l.supportUntil)}</p> : null}
            <p className="text-xs text-muted">{t("settings.modules")}: {l.modules.join(", ")}</p>
            <div className="pt-2 border-t border-line">
              <p className="text-xs text-muted">{t("settings.fingerprint")}</p>
              <div className="flex items-center gap-2"><code className="font-mono text-base">{l.fingerprint}</code><Button size="xs" onClick={() => void navigator.clipboard.writeText(l.fingerprint).then(() => toast.success(t("common.copied")))}><Copy className="size-3" /></Button></div>
              <p className="text-xs text-muted mt-1">{t("settings.fingerprintHint")}</p>
            </div>
          </div>
        ) : null}
      </Card>
      {can("license.manage") ? (
        <Card>
          <CardHeader title={t("settings.activate")} />
          <div className="p-4 space-y-3">
            <Textarea value={key} onChange={(e) => setKey(e.target.value)} placeholder="PETRA1.…" className="font-mono text-xs min-h-28" />
            <Button variant="primary" icon={<KeyRound className="size-4" />} disabled={key.length < 20} onClick={() => post("/license/activate", { key }).then(() => (toast.success(t("settings.activated")), setKey(""), q.refetch(), refreshStatus()), errorToast)}>{t("settings.activate")}</Button>
            <div className="pt-3 border-t border-line space-y-2">
              <p className="text-sm font-semibold">{t("settings.requestCode")}</p>
              <p className="text-xs text-muted">{t("settings.requestCodeHint")}</p>
              <Button size="sm" onClick={() => get<{ code: string }>("/license/request-code").then((r) => setReqCode(r.code), errorToast)}>{t("settings.requestCodeBtn")}</Button>
              {reqCode ? <code className="block break-all rounded bg-surface-2 p-2 text-xs font-mono">{reqCode}</code> : null}
            </div>
            <div className="pt-3 border-t border-line space-y-2">
              <p className="text-sm font-semibold">{t("settings.statusList")}</p>
              <p className="text-xs text-muted">{t("settings.statusListHint")}{l?.statusAt ? ` (#${l.statusSeq}, ${f.date(l.statusAt)})` : ""}</p>
              <Textarea value={statusDoc} onChange={(e) => setStatusDoc(e.target.value)} placeholder="PETRAS1.…" className="font-mono text-xs min-h-16" />
              <Button size="sm" disabled={statusDoc.length < 20} onClick={() => post("/license/status", { doc: statusDoc }).then(() => (toast.success(t("settings.statusImported")), setStatusDoc(""), q.refetch(), refreshStatus()), errorToast)}>{t("settings.statusImport")}</Button>
            </div>
            {l?.licenseId ? (
              <div className="pt-3 border-t border-line space-y-2">
                <p className="text-sm font-semibold">{t("settings.transfer")}</p>
                <p className="text-xs text-muted">{t("settings.transferHint")}</p>
                <Button size="sm" onClick={() => get<{ code: string }>("/license/transfer-code").then((r) => setCode(r.code), errorToast)}>{t("settings.transferCode")}</Button>
                {code ? <code className="block break-all rounded bg-surface-2 p-2 text-xs font-mono">{code}</code> : null}
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}

/** Update step in the app: shows download state; installing first takes a verified "Before update" backup. */
function UpdatePanel() {
  const t = useT();
  const [st, setSt] = useState<Awaited<ReturnType<NonNullable<typeof window.petra>["updateStatus"]>> | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const poll = () => void window.petra!.updateStatus().then((r) => live && setSt(r)).catch(() => undefined);
    poll();
    const id = setInterval(poll, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, []);
  if (!st?.enabled || (st.state !== "downloaded" && st.state !== "downloading" && st.state !== "error")) return null;
  async function install() {
    setBusy(true);
    try {
      await post("/system/update/prepare", {}); // verified backup first; failure aborts the update
      const r = await window.petra!.installUpdate();
      if (!r.ok) toast.error(r.error ?? t("settings.updateFailed"));
    } catch (e) {
      toast.error(`${t("settings.updateBackupFailed")} ${(e as Error).message}`);
      setBusy(false);
    }
  }
  return (
    <div className="pt-2 border-t border-line text-sm space-y-2">
      {st.state === "downloading" ? <p>{t("settings.updateDownloading", { v: st.version ?? "", p: st.progress })}</p> : null}
      {st.state === "error" ? <p className="text-danger">{t("settings.updateFailed")} {st.error}</p> : null}
      {st.state === "downloaded" ? (
        <>
          <p>{t("settings.updateReady", { v: st.version ?? "" })}</p>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void install()}>{busy ? t("common.loading") : t("settings.updateInstall")}</Button>
        </>
      ) : null}
    </div>
  );
}
