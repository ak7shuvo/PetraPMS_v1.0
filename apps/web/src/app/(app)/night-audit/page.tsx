"use client";
// Night audit wizard: 1 review → 2 run → 3 summary. History and Super-Admin rollback.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Moon, Printer, RotateCcw, XCircle } from "lucide-react";
import { get, openPdf, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, DataTable, PageHeader, Stat, StatusBadge, cn, errorToast, toast, useConfirm } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface AuditStay {
  id: string;
  reservationId: string;
  confirmationNo: string;
  guestName: string;
  roomNumber: string | null;
  arrivalDate: string;
  departureDate: string;
}
interface Preview {
  businessDate: string;
  nextBusinessDate: string;
  pendingArrivals: AuditStay[];
  noShows: AuditStay[];
  overdueDepartures: AuditStay[];
  roomCharges: number;
  roomRevenue: number;
  warnings: string[];
  blocking: string[];
  alreadyRun: boolean;
  postNoShowPenalty: boolean;
}
interface Result {
  businessDate: string;
  nextBusinessDate: string;
  roomCharges: number;
  noShows: number;
  stats: { occupancyBp: number; sold: number; available: number; roomRevenue: number; otherRevenue: number; adr: number; revpar: number; payments: Record<string, number> };
}

export default function NightAuditPage() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { businessDate, can, setBusinessDate } = useSession();
  useTitle(t("nav.nightAudit"));
  const prev = useQuery({ queryKey: ["night-audit", "preview", businessDate], queryFn: () => get<Preview>("/night-audit/preview") });
  const hist = useQuery({ queryKey: ["night-audit", "history"], queryFn: () => get<{ id: string; businessDate: string; status: string; completedAt: string | null; error: string; summary: { stats?: Result["stats"] } }[]>("/night-audit/history") });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const p = prev.data;

  const run = async () => {
    if (!p) return;
    const c = await confirm({ title: t("na.confirmTitle", { date: f.date(p.businessDate) }), message: t("na.confirmText", { next: f.date(p.nextBusinessDate) }), confirmLabel: t("na.run") });
    if (!c.ok) return;
    setBusy(true);
    try {
      const r = await post<Result>("/night-audit/run", { businessDate: p.businessDate });
      setResult(r);
      setBusinessDate(r.nextBusinessDate);
      toast.success(t("na.done", { date: f.date(r.nextBusinessDate) }));
      void qc.invalidateQueries();
    } catch (e) {
      errorToast(e);
      void prev.refetch();
    } finally {
      setBusy(false);
    }
  };

  const List = ({ title, rows, tone }: { title: string; rows: AuditStay[]; tone: "red" | "amber" }) => (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2">{title} <Badge tone={rows.length ? tone : "green"}>{rows.length}</Badge></span>} />
      {rows.length ? (
        <DataTable
          rows={rows}
          rowKey={(r) => r.id}
          dense
          cols={[
            { key: "c", header: t("res.confNo"), cell: (r) => <Link className="underline" href={`/reservations/${r.reservationId}`}>{r.confirmationNo}</Link> },
            { key: "g", header: t("res.guest"), cell: (r) => r.guestName },
            { key: "r", header: t("res.room"), cell: (r) => r.roomNumber ?? "—" },
            { key: "d", header: t("res.dates"), cell: (r) => `${f.short(r.arrivalDate)} → ${f.short(r.departureDate)}` },
          ]}
        />
      ) : (
        <p className="p-4 text-sm text-muted flex items-center gap-2"><CheckCircle2 className="size-4 text-[var(--st-vacant-clean)]" />{t("na.none")}</p>
      )}
    </Card>
  );

  return (
    <div>
      <PageHeader title={t("nav.nightAudit")} sub={t("na.sub", { date: f.date(businessDate, "DD MMM YYYY") })} />
      {result ? (
        <Card className="p-5 mb-4 border-[var(--st-vacant-clean)]">
          <h2 className="font-bold flex items-center gap-2 mb-3">
            <CheckCircle2 className="size-5 text-[var(--st-vacant-clean)]" /> {t("na.completed", { date: f.date(result.businessDate) })}
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label={t("dash.occupancy")} value={f.pct(result.stats.occupancyBp)} sub={`${result.stats.sold}/${result.stats.available}`} />
            <Stat label={t("dash.roomRevenue")} value={f.money(result.stats.roomRevenue)} />
            <Stat label="ADR" value={f.money(result.stats.adr)} />
            <Stat label="RevPAR" value={f.money(result.stats.revpar)} />
            <Stat label={t("na.roomCharges")} value={result.roomCharges} sub={`${result.noShows} ${t("na.noShows")}`} />
          </div>
          <Button className="mt-4" icon={<Printer className="size-4" />} onClick={() => void openPdf(`/reports/manager/export?format=pdf&to=${result.businessDate}`).catch(errorToast)}>
            {t("na.printManager")}
          </Button>
        </Card>
      ) : null}
      {p && !result ? (
        <div className="space-y-4">
          <div className="grid md:grid-cols-3 gap-3">
            <Stat label={t("na.roomCharges")} value={f.num(p.roomCharges)} sub={f.money(p.roomRevenue)} />
            <Stat label={t("na.pendingArrivals")} value={f.num(p.pendingArrivals.length)} sub={t("na.willBeNoShow")} />
            <Stat label={t("na.overdue")} value={f.num(p.overdueDepartures.length)} sub={p.blocking.length ? t("na.blocks") : t("na.warningOnly")} />
          </div>
          {p.blocking.length ? (
            <Card className="p-3 border-accent">
              {p.blocking.map((b) => (
                <p key={b} className="flex items-center gap-2 text-sm text-accent">
                  <XCircle className="size-4" /> {b}
                </p>
              ))}
            </Card>
          ) : null}
          {p.warnings.length ? (
            <Card className="p-3">
              {p.warnings.map((w) => (
                <p key={w} className="flex items-center gap-2 text-sm">
                  <AlertTriangle className="size-4 text-[var(--st-vacant-dirty)]" /> {w}
                </p>
              ))}
            </Card>
          ) : null}
          <div className="grid xl:grid-cols-2 gap-4">
            <List title={t("na.pendingArrivals")} rows={[...p.pendingArrivals, ...p.noShows]} tone="amber" />
            <List title={t("na.overdue")} rows={p.overdueDepartures} tone="red" />
          </div>
          <div className="flex items-center gap-3">
            <Button size="lg" variant="dark" icon={<Moon className="size-4 text-[var(--petra-red)]" />} loading={busy} disabled={!!p.blocking.length || p.alreadyRun || !can("nightaudit.run")} onClick={() => void run()}>
              {t("na.runFor", { date: f.date(p.businessDate) })}
            </Button>
            <p className="text-xs text-muted">{t("na.backupNote")}</p>
          </div>
        </div>
      ) : null}
      <Card className="mt-6">
        <CardHeader
          title={t("na.history")}
          actions={
            can("nightaudit.rollback") ? (
              <Button
                size="sm"
                variant="danger"
                icon={<RotateCcw className="size-3.5" />}
                onClick={async () => {
                  const c = await confirm({ title: t("na.rollback"), message: t("na.rollbackText"), reason: true, danger: true, typeToConfirm: "ROLLBACK" });
                  if (!c.ok) return;
                  try {
                    const r = await post<{ businessDate: string }>("/night-audit/rollback", { reason: c.reason });
                    setBusinessDate(r.businessDate);
                    setResult(null);
                    toast.success(t("na.rolledBack", { date: f.date(r.businessDate) }));
                    void qc.invalidateQueries();
                  } catch (e) {
                    errorToast(e);
                  }
                }}
              >
                {t("na.rollback")}
              </Button>
            ) : null
          }
        />
        <DataTable
          rows={hist.data}
          rowKey={(h) => h.id}
          dense
          cols={[
            { key: "d", header: t("na.businessDate"), cell: (h) => f.date(h.businessDate) },
            { key: "s", header: t("common.status"), cell: (h) => <span className={cn(h.status === "FAILED" && "text-accent")}><StatusBadge status={h.status} /> {h.error}</span> },
            { key: "o", header: t("dash.occupancy"), cell: (h) => (h.summary.stats ? f.pct(h.summary.stats.occupancyBp) : "—"), align: "right" },
            { key: "r", header: t("dash.roomRevenue"), cell: (h) => (h.summary.stats ? f.money(h.summary.stats.roomRevenue) : "—"), align: "right" },
            { key: "c", header: t("na.completedAt"), cell: (h) => f.dateTime(h.completedAt) },
            { key: "p", header: "", align: "right", cell: (h) => (h.status === "COMPLETED" ? <Button size="xs" variant="ghost" onClick={() => void openPdf(`/reports/manager/export?format=pdf&to=${h.businessDate}`).catch(errorToast)}><Printer className="size-3.5" /></Button> : null) },
          ]}
        />
      </Card>
    </div>
  );
}
