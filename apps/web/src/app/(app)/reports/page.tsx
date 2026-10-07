"use client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { addDays, monthStart } from "@petra/core";
import { download, get, openPdf } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useLocale, useT } from "@/lib/i18n";
import { Button, Card, CardHeader, DataTable, Empty, Input, PageHeader, Skeleton, cn, errorToast } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface Def {
  id: string;
  title: string;
  titleBn: string;
  group: string;
  range: boolean;
}
interface Result {
  title: string;
  subtitle: string;
  columns: { key: string; label: string; labelBn?: string; type: string }[];
  rows: Record<string, unknown>[];
  totals?: Record<string, unknown>;
  summary?: { label: string; value: string | number; type?: string }[];
}

export default function ReportsPage() {
  const t = useT();
  const f = useFmt();
  const locale = useLocale();
  const { businessDate, can } = useSession();
  useTitle(t("nav.reports"));
  const defs = useQuery({ queryKey: ["reports", "list"], queryFn: () => get<Def[]>("/reports") });
  const [sel, setSel] = useState("manager");
  const yesterday = addDays(businessDate, -1);
  const [from, setFrom] = useState(monthStart(yesterday));
  const [to, setTo] = useState(yesterday);
  const def = defs.data?.find((d) => d.id === sel);
  const qs = def?.range ? `from=${from}&to=${to}` : `to=${sel === "inhouse" || sel === "aging" ? businessDate : to}`;
  const r = useQuery({ queryKey: ["reports", sel, qs], enabled: !!def, queryFn: () => get<Result>(`/reports/${sel}?${qs}`) });
  const groups = useMemo(() => ["revenue", "finance", "front", "operations", "guests"].map((g) => ({ g, items: (defs.data ?? []).filter((d) => d.group === g) })).filter((x) => x.items.length), [defs.data]);
  const fmt = (v: unknown, type: string) => {
    if (v === null || v === undefined || v === "") return "";
    if (type === "money") return f.money(Number(v), { symbol: false });
    if (type === "percent") return f.pct(Number(v));
    if (type === "date") return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? f.date(String(v)) : String(v);
    if (type === "datetime") return f.dateTime(String(v));
    if (type === "number" && typeof v === "number") return f.num(v);
    return String(v);
  };
  return (
    <div>
      <PageHeader title={t("nav.reports")} />
      <div className="grid lg:grid-cols-[240px_1fr] gap-4">
        <Card className="p-2 h-fit">
          {groups.map(({ g, items }) => (
            <div key={g} className="mb-2">
              <p className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted">{t(`reports.group.${g}`)}</p>
              {items.map((d) => (
                <button key={d.id} onClick={() => setSel(d.id)} className={cn("w-full text-left rounded px-2 py-1.5 text-sm", sel === d.id ? "bg-surface-2 font-semibold text-accent" : "hover:bg-surface-2")}>
                  {locale === "bn" ? d.titleBn : d.title}
                </button>
              ))}
            </div>
          ))}
        </Card>
        <div className="min-w-0">
          <Card>
            <CardHeader
              title={def ? (locale === "bn" ? def.titleBn : def.title) : ""}
              sub={r.data?.subtitle}
              actions={
                <>
                  {def?.range ? (
                    <>
                      <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 w-36" />
                      <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-36" />
                    </>
                  ) : sel !== "inhouse" && sel !== "aging" && sel !== "guests" ? (
                    <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-8 w-36" />
                  ) : null}
                  {can("reports.export") ? (
                    <>
                      <Button size="sm" icon={<Printer className="size-3.5" />} onClick={() => void openPdf(`/reports/${sel}/export?format=pdf&${qs}&lang=${locale}`).catch(errorToast)}>
                        PDF
                      </Button>
                      <Button size="sm" icon={<FileSpreadsheet className="size-3.5" />} onClick={() => void download(`/reports/${sel}/export?format=xlsx&${qs}`).catch(errorToast)}>
                        XLSX
                      </Button>
                      <Button size="sm" icon={<FileText className="size-3.5" />} onClick={() => void download(`/reports/${sel}/export?format=csv&${qs}`).catch(errorToast)}>
                        CSV
                      </Button>
                    </>
                  ) : null}
                </>
              }
            />
            {r.isLoading ? (
              <Skeleton className="h-48 m-3" />
            ) : r.data ? (
              <>
                <DataTable
                  rows={r.data.rows.map((x, i) => ({ ...x, __i: i }))}
                  rowKey={(x) => String(x.__i)}
                  dense
                  className="max-h-[60vh]"
                  empty={<Empty title={t("common.noData")} />}
                  cols={r.data.columns.map((c) => ({
                    key: c.key,
                    header: locale === "bn" && c.labelBn ? c.labelBn : c.label,
                    align: ["money", "number", "percent"].includes(c.type) ? ("right" as const) : undefined,
                    cell: (row: Record<string, unknown>) => fmt(row[c.key], row._type && c.type === "number" ? String(row._type) : c.type),
                    sort: (row: Record<string, unknown>) => (typeof row[c.key] === "number" ? (row[c.key] as number) : String(row[c.key] ?? "")),
                  }))}
                />
                {r.data.totals ? (
                  <div className="flex flex-wrap gap-4 px-3 py-2 border-t border-line text-sm font-semibold bg-surface-2">
                    {r.data.columns
                      .filter((c) => r.data!.totals![c.key] !== undefined && c.key !== r.data!.columns[0].key)
                      .map((c) => (
                        <span key={c.key}>
                          {c.label}: {fmt(r.data!.totals![c.key], c.type)}
                        </span>
                      ))}
                  </div>
                ) : null}
                {r.data.summary?.length ? (
                  <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1 p-3 border-t border-line text-sm">
                    {r.data.summary.map((s) => (
                      <div key={s.label} className="flex justify-between">
                        <span className="text-muted">{s.label}</span>
                        <b className="num">{s.type ? fmt(s.value, s.type) : String(s.value)}</b>
                      </div>
                    ))}
                  </div>
                ) : null}
              </>
            ) : null}
          </Card>
          <p className="text-xs text-muted mt-2 flex items-center gap-1">
            <Download className="size-3" /> {t("reports.scheduledHint")}
          </p>
        </div>
      </div>
    </div>
  );
}
