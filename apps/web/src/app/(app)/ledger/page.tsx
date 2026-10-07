"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { download, get, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { toPoisha, useFmt, useT } from "@/lib/i18n";
import { usePaymentMethods } from "@/lib/queries";
import { Badge, Button, Card, CardHeader, DataTable, Field, Input, Modal, MoneyInput, PageHeader, Select, Stat, errorToast, toast } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface Item {
  id: string;
  number: string;
  name: string;
  companyId: string;
  company: { id: string; name: string; code: string; creditLimit: number } | null;
  dueDate: string;
  balance: number;
  bucket: string;
}
interface Ledger {
  asOf: string;
  items: Item[];
  aging: { totals: Record<string, number>; byCompany: Record<string, Record<string, number>> } | Record<string, unknown>;
}
const BUCKETS = ["CURRENT", "D1_30", "D31_60", "D61_90", "D90_PLUS"];

export default function LedgerPage() {
  const t = useT();
  const f = useFmt();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  const pms = usePaymentMethods();
  useTitle(t("nav.ledger"));
  const q = useQuery({ queryKey: ["ledger"], queryFn: () => get<Ledger>("/ledger") });
  const [pay, setPay] = useState<{ companyId: string; name: string; due: number } | null>(null);
  const [v, setV] = useState({ method: "BANK", amount: "", reference: "" });
  const items = q.data?.items ?? [];
  const byCompany = new Map<string, { id: string; name: string; total: number; limit: number; buckets: Record<string, number> }>();
  for (const i of items) {
    const k = i.companyId || "—";
    const c = byCompany.get(k) ?? { id: k, name: i.company?.name ?? "—", total: 0, limit: i.company?.creditLimit ?? 0, buckets: {} };
    c.total += i.balance;
    c.buckets[i.bucket] = (c.buckets[i.bucket] ?? 0) + i.balance;
    byCompany.set(k, c);
  }
  const totals = BUCKETS.map((b) => items.filter((i) => i.bucket === b).reduce((a, i) => a + i.balance, 0));
  return (
    <div>
      <PageHeader
        title={t("nav.ledger")}
        sub={q.data ? t("ledger.asOf", { date: f.date(q.data.asOf) }) : undefined}
        actions={
          <Button icon={<Download className="size-4" />} onClick={() => void download("/reports/aging/export?format=xlsx").catch(errorToast)}>
            Excel
          </Button>
        }
      />
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        {BUCKETS.map((b, i) => (
          <Stat key={b} label={t(`aging.${b}`)} value={f.money(totals[i])} tone={b === "D90_PLUS" && totals[i] > 0 ? "accent" : undefined} />
        ))}
      </div>
      <Card className="mb-4">
        <CardHeader title={t("ledger.byCompany")} />
        <DataTable
          rows={[...byCompany.values()]}
          rowKey={(r) => r.id}
          cols={[
            { key: "n", header: t("res.company"), cell: (r) => <b>{r.name}</b>, sort: (r) => r.name },
            ...BUCKETS.map((b) => ({ key: b, header: t(`aging.${b}`), cell: (r: { buckets: Record<string, number> }) => (r.buckets[b] ? f.money(r.buckets[b], { symbol: false }) : "—"), align: "right" as const })),
            { key: "t", header: t("folio.total"), cell: (r) => <b>{f.money(r.total)}</b>, align: "right", sort: (r) => r.total },
            { key: "l", header: t("company.limit"), cell: (r) => (r.limit ? <span className={r.total > r.limit ? "text-accent" : ""}>{f.money(r.limit)}</span> : "—"), align: "right" },
            { key: "a", header: "", align: "right", cell: (r) => (can("ledger.manage") && r.id !== "—" ? <Button size="sm" onClick={() => (setPay({ companyId: r.id, name: r.name, due: r.total }), setV({ method: "BANK", amount: (r.total / 100).toFixed(2), reference: "" }))}>{t("ledger.receive")}</Button> : null) },
          ]}
        />
      </Card>
      <Card>
        <CardHeader title={t("ledger.invoices")} />
        <DataTable
          rows={items}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/folios/${r.id}`)}
          cols={[
            { key: "n", header: t("folio.number"), cell: (r) => r.number },
            { key: "c", header: t("res.company"), cell: (r) => r.company?.name ?? "—", sort: (r) => r.company?.name ?? "" },
            { key: "name", header: t("common.name"), cell: (r) => r.name },
            { key: "due", header: t("folio.dueDate"), cell: (r) => f.date(r.dueDate), sort: (r) => r.dueDate },
            { key: "b", header: t("ledger.age"), cell: (r) => <Badge tone={r.bucket === "CURRENT" ? "green" : r.bucket === "D90_PLUS" ? "red" : "amber"}>{t(`aging.${r.bucket}`)}</Badge> },
            { key: "bal", header: t("folio.balance"), cell: (r) => f.money(r.balance), align: "right", sort: (r) => r.balance },
          ]}
        />
      </Card>
      <Modal
        open={!!pay}
        onOpenChange={(o) => !o && setPay(null)}
        title={t("ledger.receiveFrom", { name: pay?.name ?? "" })}
        size="sm"
        footer={
          <Button
            variant="primary"
            disabled={!toPoisha(v.amount)}
            onClick={async () => {
              try {
                const r = await post<{ applied: { folio: string; amount: number }[] }>("/ledger/payments", { companyId: pay!.companyId, method: v.method, amount: toPoisha(v.amount), reference: v.reference });
                toast.success(t("ledger.applied", { n: r.applied.length }));
                void qc.invalidateQueries({ queryKey: ["ledger"] });
                setPay(null);
              } catch (e) {
                errorToast(e);
              }
            }}
          >
            {t("common.save")}
          </Button>
        }
      >
        <div className="grid gap-3">
          <p className="text-sm">
            {t("ledger.outstanding")}: <b>{f.money(pay?.due ?? 0)}</b>
          </p>
          <Field label={t("folio.method")}>
            <Select value={v.method} onChange={(e) => setV({ ...v, method: e.target.value })}>
              {pms.data?.filter((m) => m.active && m.type !== "CITY_LEDGER").map((m) => (
                <option key={m.code} value={m.code}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("folio.amount")} hint={t("ledger.oldestFirst")}>
            <MoneyInput value={v.amount} onChange={(x) => setV({ ...v, amount: x })} />
          </Field>
          <Field label={t("folio.reference")}>
            <Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} placeholder={t("ledger.chequeNo")} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
