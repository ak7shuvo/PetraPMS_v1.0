"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fromPoisha, toPoisha, useFmt, useT } from "@/lib/i18n";
import { useRatePlans, type Company } from "@/lib/queries";
import { Badge, Button, Card, DataTable, Field, Input, Modal, MoneyInput, PageHeader, Select, Switch, Textarea, errorToast, toast, useConfirm, useDebounced } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

const blank = { code: "", name: "", contactPerson: "", phone: "", email: "", address: "", bin: "", creditLimit: "", paymentTermsDays: "30", ratePlanId: "", discount: "", cityLedger: true, notes: "", active: true };

export default function CompaniesPage() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const plans = useRatePlans();
  const { can } = useSession();
  useTitle(t("nav.companies"));
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 300);
  const list = useQuery({ queryKey: ["companies", "all", dq], queryFn: () => get<Company[]>(`/companies${dq ? `?q=${encodeURIComponent(dq)}` : ""}`) });
  const [edit, setEdit] = useState<(typeof blank & { id?: string }) | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!edit) return;
    setBusy(true);
    const body = { code: edit.code || undefined, name: edit.name, contactPerson: edit.contactPerson, phone: edit.phone, email: edit.email, address: edit.address, bin: edit.bin, creditLimit: toPoisha(edit.creditLimit) ?? 0, paymentTermsDays: Number(edit.paymentTermsDays) || 0, ratePlanId: edit.ratePlanId || null, discountBp: Math.round((Number(edit.discount) || 0) * 100), cityLedger: edit.cityLedger, notes: edit.notes, active: edit.active };
    try {
      if (edit.id) await put(`/companies/${edit.id}`, body);
      else await post("/companies", body);
      toast.success(t("common.saved"));
      setEdit(null);
      void qc.invalidateQueries({ queryKey: ["companies"] });
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      <PageHeader
        title={t("nav.companies")}
        actions={
          can("guests.companies") ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEdit({ ...blank })}>
              {t("company.new")}
            </Button>
          ) : null
        }
      />
      <Card className="p-3 mb-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted" />
          <Input className="pl-8" placeholder={t("common.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </Card>
      <Card>
        <DataTable
          rows={list.data}
          loading={list.isLoading}
          rowKey={(c) => c.id}
          onRowClick={(c) => can("guests.companies") && setEdit({ id: c.id, code: c.code, name: c.name, contactPerson: c.contactPerson, phone: c.phone, email: c.email, address: c.address, bin: c.bin, creditLimit: fromPoisha(c.creditLimit), paymentTermsDays: String(c.paymentTermsDays), ratePlanId: c.ratePlanId ?? "", discount: String(c.discountBp / 100), cityLedger: c.cityLedger, notes: c.notes, active: c.active })}
          cols={[
            { key: "c", header: t("common.code"), cell: (c) => c.code, sort: (c) => c.code },
            { key: "n", header: t("common.name"), cell: (c) => <span className="font-medium">{c.name} {!c.active ? <Badge tone="gray">{t("common.inactive")}</Badge> : null}</span>, sort: (c) => c.name },
            { key: "p", header: t("company.contact"), cell: (c) => [c.contactPerson, c.phone].filter(Boolean).join(" · ") },
            { key: "bin", header: "BIN", cell: (c) => c.bin || "—" },
            { key: "l", header: t("company.limit"), cell: (c) => (c.creditLimit ? f.money(c.creditLimit) : "—"), align: "right" },
            { key: "d", header: t("company.terms"), cell: (c) => t("company.days", { n: c.paymentTermsDays }), align: "right" },
            { key: "disc", header: t("res.discountPct"), cell: (c) => (c.discountBp ? f.pct(c.discountBp) : "—"), align: "right" },
          ]}
        />
      </Card>
      <Modal
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={edit?.id ? edit.name : t("company.new")}
        size="lg"
        footer={
          <>
            {edit?.id ? (
              <Button
                variant="danger"
                className="mr-auto"
                onClick={async () => {
                  const c = await confirm({ title: t("common.delete"), message: edit.name, danger: true });
                  if (!c.ok) return;
                  try {
                    await del(`/companies/${edit.id}`);
                    setEdit(null);
                    void qc.invalidateQueries({ queryKey: ["companies"] });
                  } catch (e) {
                    errorToast(e);
                  }
                }}
              >
                {t("common.delete")}
              </Button>
            ) : null}
            <Button onClick={() => setEdit(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" loading={busy} disabled={!edit?.name.trim()} onClick={() => void save()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {edit ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label={t("common.code")} hint={!edit.id ? t("company.codeAuto") : undefined}>
              <Input value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />
            </Field>
            <Field label={t("common.name")} required className="md:col-span-3">
              <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            </Field>
            <Field label={t("company.contactPerson")} className="md:col-span-2">
              <Input value={edit.contactPerson} onChange={(e) => setEdit({ ...edit, contactPerson: e.target.value })} />
            </Field>
            <Field label={t("common.phone")}>
              <Input value={edit.phone} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
            </Field>
            <Field label={t("common.email")}>
              <Input value={edit.email} onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
            </Field>
            <Field label={t("common.address")} className="md:col-span-3">
              <Input value={edit.address} onChange={(e) => setEdit({ ...edit, address: e.target.value })} />
            </Field>
            <Field label="BIN">
              <Input value={edit.bin} onChange={(e) => setEdit({ ...edit, bin: e.target.value })} />
            </Field>
            <Field label={t("company.limit")} hint={t("company.limitHint")}>
              <MoneyInput value={edit.creditLimit} onChange={(v) => setEdit({ ...edit, creditLimit: v })} />
            </Field>
            <Field label={t("company.terms")}>
              <Input inputMode="numeric" value={edit.paymentTermsDays} onChange={(e) => setEdit({ ...edit, paymentTermsDays: e.target.value })} />
            </Field>
            <Field label={t("res.ratePlan")}>
              <Select value={edit.ratePlanId} onChange={(e) => setEdit({ ...edit, ratePlanId: e.target.value })}>
                <option value="">—</option>
                {plans.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("res.discountPct")}>
              <Input inputMode="decimal" value={edit.discount} onChange={(e) => setEdit({ ...edit, discount: e.target.value })} />
            </Field>
            <Field label={t("common.notes")} className="col-span-full">
              <Textarea value={edit.notes} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
            </Field>
            <Switch checked={edit.cityLedger} onChange={(v) => setEdit({ ...edit, cityLedger: v })} label={t("company.cityLedger")} />
            <Switch checked={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label={t("common.active")} />
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
