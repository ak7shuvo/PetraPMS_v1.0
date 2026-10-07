"use client";
// Generic list + edit dialog for configuration masters (payment methods, taxes, charge codes, policies…).
import React, { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { fromPoisha, toPoisha, useFmt, useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, Input, Modal, MoneyInput, Select, errorToast, toast, useConfirm } from "./ui";

export interface MasterField {
  key: string;
  label: string;
  type: "text" | "code" | "int" | "money" | "percent" | "bool" | "enum" | "multi";
  options?: { value: string; label: string }[];
  required?: boolean;
  list?: boolean;
  default?: unknown;
}

function toForm(fields: MasterField[], row: Record<string, unknown> | null): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row ? row[f.key] : f.default;
    if (f.type === "money") out[f.key] = v === undefined || v === null ? "" : fromPoisha(v as number);
    else if (f.type === "percent") out[f.key] = v === undefined || v === null ? "" : String((v as number) / 100);
    else if (f.type === "bool") out[f.key] = v ?? true;
    else if (f.type === "multi") out[f.key] = (v as string[]) ?? [];
    else if (f.type === "int") out[f.key] = v === undefined || v === null ? "" : String(v);
    else out[f.key] = v ?? "";
  }
  return out;
}
function fromForm(fields: MasterField[], v: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const x = v[f.key];
    if (f.type === "money") out[f.key] = toPoisha(x as string) ?? 0;
    else if (f.type === "percent") out[f.key] = Math.round((Number(x) || 0) * 100);
    else if (f.type === "int") out[f.key] = Number(x) || 0;
    else out[f.key] = x;
  }
  return out;
}

export function MasterEditor({ path, title, fields, canEdit, queryKey }: { path: string; title: string; fields: MasterField[]; canEdit: boolean; queryKey?: unknown[] }) {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const key = queryKey ?? ["masters", path];
  const list = useQuery({ queryKey: key, queryFn: () => get<Record<string, unknown>[]>(`/${path}`) });
  const [edit, setEdit] = useState<{ id?: string; v: Record<string, unknown> } | null>(null);
  const [busy, setBusy] = useState(false);
  const show = (fd: MasterField, row: Record<string, unknown>) => {
    const v = row[fd.key];
    if (fd.type === "money") return f.money(v as number);
    if (fd.type === "percent") return f.pct(v as number);
    if (fd.type === "bool") return v ? "✓" : <Badge tone="gray">{t("common.no")}</Badge>;
    if (fd.type === "enum") return fd.options?.find((o) => o.value === v)?.label ?? String(v);
    if (fd.type === "multi") return (v as string[]).map((x) => fd.options?.find((o) => o.value === x)?.label ?? x).join(", ");
    return String(v ?? "");
  };
  return (
    <Card>
      <CardHeader
        title={title}
        actions={
          canEdit ? (
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ v: toForm(fields, null) })}>
              {t("common.add")}
            </Button>
          ) : null
        }
      />
      <DataTable
        rows={list.data}
        loading={list.isLoading}
        rowKey={(r) => String(r.id)}
        dense
        onRowClick={canEdit ? (r) => setEdit({ id: String(r.id), v: toForm(fields, r) }) : undefined}
        cols={fields.filter((x) => x.list !== false).map((fd) => ({ key: fd.key, header: fd.label, cell: (r: Record<string, unknown>) => show(fd, r), align: fd.type === "money" || fd.type === "percent" ? ("right" as const) : undefined }))}
      />
      <Modal
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={title}
        size="md"
        footer={
          <>
            {edit?.id ? (
              <Button
                variant="danger"
                className="mr-auto"
                onClick={async () => {
                  const c = await confirm({ title: t("common.delete"), danger: true });
                  if (!c.ok) return;
                  try {
                    await del(`/${path}/${edit.id}`);
                    setEdit(null);
                    void qc.invalidateQueries({ queryKey: key });
                  } catch (e) {
                    errorToast(e);
                  }
                }}
              >
                {t("common.delete")}
              </Button>
            ) : null}
            <Button onClick={() => setEdit(null)}>{t("common.cancel")}</Button>
            <Button
              variant="primary"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const body = fromForm(fields, edit!.v);
                  if (edit!.id) await put(`/${path}/${edit!.id}`, body);
                  else await post(`/${path}`, body);
                  toast.success(t("common.saved"));
                  setEdit(null);
                  void qc.invalidateQueries({ queryKey: key });
                  void qc.invalidateQueries({ queryKey: ["masters"] });
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
        {edit ? (
          <div className="grid grid-cols-2 gap-3">
            {fields.map((fd) => {
              const v = edit.v[fd.key];
              const set = (x: unknown) => setEdit({ ...edit, v: { ...edit.v, [fd.key]: x } });
              if (fd.type === "bool") return <Checkbox key={fd.key} checked={!!v} onChange={(e) => set(e.target.checked)} label={fd.label} className="col-span-2" />;
              if (fd.type === "multi")
                return (
                  <Field key={fd.key} label={fd.label} className="col-span-2">
                    <div className="grid grid-cols-2 gap-1">
                      {fd.options?.map((o) => (
                        <Checkbox key={o.value} checked={(v as string[]).includes(o.value)} onChange={(e) => set(e.target.checked ? [...(v as string[]), o.value] : (v as string[]).filter((x) => x !== o.value))} label={o.label} />
                      ))}
                    </div>
                  </Field>
                );
              return (
                <Field key={fd.key} label={fd.label} required={fd.required}>
                  {fd.type === "enum" ? (
                    <Select value={String(v)} onChange={(e) => set(e.target.value)}>
                      {fd.options?.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </Select>
                  ) : fd.type === "money" ? (
                    <MoneyInput value={String(v)} onChange={set} />
                  ) : (
                    <Input value={String(v)} inputMode={fd.type === "int" || fd.type === "percent" ? "decimal" : undefined} onChange={(e) => set(fd.type === "code" ? e.target.value.toUpperCase() : e.target.value)} />
                  )}
                </Field>
              );
            })}
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
