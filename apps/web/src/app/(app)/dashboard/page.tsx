"use client";
import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, BedDouble, Crown, DatabaseBackup, Moon, Sparkles, Wrench } from "lucide-react";
import { addDays, homeFor } from "@petra/core";
import { get } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, Empty, PageHeader, Skeleton, Stat, StatusBadge } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface Day {
  sold: number;
  available: number;
  occupancyBp: number;
  roomRevenue: number | null;
  otherRevenue: number | null;
  totalRevenue: number | null;
  adr: number | null;
  revpar: number | null;
  arrivals: number;
  departures: number;
  noShows: number;
  guestsInHouse: number;
  outOfOrder: number;
  payments: Record<string, number>;
}
interface Dash {
  businessDate: string;
  calendarDate: string;
  auditOverdue: boolean;
  storage?: { writable: boolean; low: boolean; freeBytes: number | null };
  today: Day;
  yesterday: Day;
  forecast: { date: string; sold: number; available: number; occupancyBp: number; revenue: number | null }[];
  roomStatus: Record<string, number>;
  pending: { arrivals: number; departures: number; inHouse: number; dirty: number; openTickets: number; overdueTickets: number };
  vip: { id: string; name: string; vip: number; room: string | null; status: string; conf: string }[];
  notes: { id: string; text: string; authorName: string; createdAt: string; shift: string }[];
  backup: { state: string; last: { at: string; fileName: string } | null; lastError: string | null };
  license: { mode: string; readOnly: boolean; daysLeft: number | null; warnings: string[] };
  demoData: boolean;
}

export default function DashboardPage() {
  const t = useT();
  const f = useFmt();
  const router = useRouter();
  const { can, user } = useSession();
  useTitle(t("nav.dashboard"));
  useEffect(() => {
    if (user && !can("dashboard.view")) router.replace(homeFor(user.permissions));
  }, [user, can, router]);
  const q = useQuery({ queryKey: ["dashboard"], queryFn: () => get<Dash>("/dashboard"), refetchInterval: 60_000, enabled: can("dashboard.view") });
  const d = q.data;
  const money = can("dashboard.financials");

  return (
    <div>
      <PageHeader
        title={t("nav.dashboard")}
        sub={d ? t("dash.sub", { date: f.date(d.businessDate, "DD MMM YYYY") }) : undefined}
        actions={
          <>
            {can("reservations.create") ? (
              <Link href="/reservations/new">
                <Button variant="primary">{t("res.new")}</Button>
              </Link>
            ) : null}
            {can("frontdesk.checkin") ? (
              <Link href="/frontdesk?walkin=1">
                <Button>{t("fd.walkIn")}</Button>
              </Link>
            ) : null}
          </>
        }
      />
      {d?.demoData ? (
        <div className="mb-3 rounded-md border border-[var(--st-reserved)] bg-surface px-3 py-2 text-sm flex items-center gap-2">
          <Badge tone="blue">DEMO</Badge> {t("dash.demoBanner")}
          {can("data.demo") ? (
            <Link href="/data?tab=demo" className="ml-auto underline text-xs">
              {t("dash.clearDemo")}
            </Link>
          ) : null}
        </div>
      ) : null}
      {d?.auditOverdue && can("nightaudit.run") ? (
        <div className="mb-3 rounded-md bg-[var(--petra-black)] text-white px-3 py-2 text-sm flex items-center gap-2">
          <Moon className="size-4 text-[var(--petra-red)]" />
          {t("dash.auditOverdue", { date: f.date(d.businessDate) })}
          <Link href="/night-audit" className="ml-auto underline font-semibold">
            {t("nav.nightAudit")}
          </Link>
        </div>
      ) : null}
      {d?.storage && (!d.storage.writable || d.storage.low) ? (
        <div className="mb-3 rounded-md border border-accent bg-surface px-3 py-2 text-sm flex items-center gap-2" role="alert">
          <AlertTriangle className="size-4 text-accent" />
          {d.storage.writable ? t("dash.storageLow", { mb: Math.round((d.storage.freeBytes ?? 0) / 1048576) }) : t("dash.storageReadonly")}
        </div>
      ) : null}
      {d && d.backup.state !== "OK" && can("data.backup") ? (
        <div className="mb-3 rounded-md border border-accent bg-surface px-3 py-2 text-sm flex items-center gap-2">
          <AlertTriangle className="size-4 text-accent" />
          {t(`dash.backup.${d.backup.state}`)} {d.backup.lastError ? `— ${d.backup.lastError}` : ""}
          <Link href="/data?tab=backup" className="ml-auto underline text-xs">
            {t("dash.backupNow")}
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3 mb-4">
        {!d ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />)
        ) : (
          <>
            <Stat label={t("dash.occupancy")} value={f.pct(d.today.occupancyBp)} sub={`${f.num(d.today.sold)} / ${f.num(d.today.available)} ${t("dash.rooms")}`} tone="accent" />
            <Stat label={t("dash.arrivals")} value={f.num(d.pending.arrivals)} sub={t("dash.pendingOf", { n: f.num(d.today.arrivals) })} />
            <Stat label={t("dash.departures")} value={f.num(d.pending.departures)} sub={t("dash.dueOut")} />
            <Stat label={t("dash.inHouse")} value={f.num(d.pending.inHouse)} sub={`${f.num(d.today.guestsInHouse)} ${t("dash.guests")}`} />
            {money ? <Stat label="ADR" value={f.money(d.yesterday.adr)} sub={t("dash.yesterday")} /> : <Stat label={t("dash.dirty")} value={f.num(d.pending.dirty)} />}
            {money ? <Stat label="RevPAR" value={f.money(d.yesterday.revpar)} sub={t("dash.yesterday")} /> : <Stat label={t("dash.tickets")} value={f.num(d.pending.openTickets)} />}
          </>
        )}
      </div>

      <div className="grid xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2">
          <CardHeader title={t("dash.forecast")} sub={t("dash.forecastSub")} />
          <div className="h-64 p-3">
            {d ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.forecast.map((x) => ({ ...x, occ: x.occupancyBp / 100, label: f.short(x.date) }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted)" }} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted)" }} unit="%" domain={[0, 100]} />
                  <Tooltip formatter={(v) => [`${Number(v).toFixed(1)}%`, t("dash.occupancy")]} contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", fontSize: 12 }} />
                  <Bar dataKey="occ" fill="var(--petra-red)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <Skeleton className="h-full" />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("dash.roomStatus")} actions={<Link href="/rack" className="text-xs underline">{t("nav.rack")}</Link>} />
          <div className="p-4 grid grid-cols-2 gap-2 text-sm">
            {d
              ? (["CLEAN", "INSPECTED", "DIRTY", "IN_PROGRESS"] as const).map((s) => (
                  <div key={s} className="flex items-center justify-between rounded border border-line px-3 py-2">
                    <StatusBadge status={s} />
                    <b className="num">{f.num(d.roomStatus[s] ?? 0)}</b>
                  </div>
                ))
              : null}
            <div className="col-span-2 grid grid-cols-3 gap-2 mt-2">
              <QuickLink href="/frontdesk?tab=arrivals" icon={<ArrowDownToLine className="size-4" />} label={t("dash.arrivals")} />
              <QuickLink href="/frontdesk?tab=departures" icon={<ArrowUpFromLine className="size-4" />} label={t("dash.departures")} />
              <QuickLink href="/housekeeping" icon={<Sparkles className="size-4" />} label={t("nav.housekeeping")} />
            </div>
          </div>
        </Card>

        {money && d ? (
          <Card>
            <CardHeader title={t("dash.yesterdayRevenue")} sub={f.date(addDays(d.businessDate, -1))} />
            <div className="p-4 space-y-2 text-sm">
              <Row label={t("dash.roomRevenue")} value={f.money(d.yesterday.roomRevenue)} />
              <Row label={t("dash.otherRevenue")} value={f.money(d.yesterday.otherRevenue)} />
              <Row label={t("dash.totalRevenue")} value={f.money(d.yesterday.totalRevenue)} bold />
              <div className="pt-2 border-t border-line">
                {Object.entries(d.yesterday.payments).map(([k, v]) => (
                  <Row key={k} label={k} value={f.money(v)} />
                ))}
                {!Object.keys(d.yesterday.payments).length ? <p className="text-muted text-xs">{t("dash.noPayments")}</p> : null}
              </div>
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHeader title={t("dash.vip")} />
          <div className="p-2">
            {d?.vip.length ? (
              d.vip.map((v) => (
                <div key={v.id} className="flex items-center gap-2 px-2 py-1.5 text-sm">
                  <Crown className="size-4 text-[var(--st-vacant-dirty)]" />
                  <span className="flex-1 truncate">{v.name}</span>
                  <span className="text-muted text-xs">{v.room ?? "—"}</span>
                  <StatusBadge status={v.status} />
                </div>
              ))
            ) : (
              <Empty title={t("dash.noVip")} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("dash.handover")} actions={<Link href="/frontdesk?tab=notes" className="text-xs underline">{t("common.viewAll")}</Link>} />
          <div className="p-3 space-y-2">
            {d?.notes.length ? (
              d.notes.map((n) => (
                <div key={n.id} className="text-sm border-l-2 border-accent pl-2">
                  <p className="whitespace-pre-wrap">{n.text}</p>
                  <p className="text-xs text-muted">
                    {n.authorName} · {f.dateTime(n.createdAt)}
                  </p>
                </div>
              ))
            ) : (
              <Empty title={t("dash.noNotes")} />
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title={t("dash.alerts")} />
          <div className="p-3 space-y-2 text-sm">
            <AlertRow icon={<Wrench className="size-4" />} label={t("dash.openTickets")} value={d?.pending.openTickets} warn={(d?.pending.overdueTickets ?? 0) > 0} sub={d?.pending.overdueTickets ? t("dash.overdue", { n: d.pending.overdueTickets }) : undefined} href="/maintenance" />
            <AlertRow icon={<BedDouble className="size-4" />} label={t("dash.outOfOrder")} value={d?.today.outOfOrder} href="/rack" />
            <AlertRow icon={<DatabaseBackup className="size-4" />} label={t("dash.lastBackup")} value={d?.backup.last ? f.dateTime(d.backup.last.at) : "—"} warn={d?.backup.state !== "OK"} href="/data?tab=backup" />
            {d?.license.warnings.map((w) => (
              <p key={w} className="text-xs text-accent">
                {w}
              </p>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={bold ? "font-bold num" : "num"}>{value}</span>
    </div>
  );
}
function QuickLink({ href, icon, label }: { href: string; icon: React.ReactNode; label: string }) {
  return (
    <Link href={href} className="flex flex-col items-center gap-1 rounded border border-line px-2 py-2 text-xs hover:border-accent">
      {icon}
      {label}
    </Link>
  );
}
function AlertRow({ icon, label, value, sub, warn, href }: { icon: React.ReactNode; label: string; value?: React.ReactNode; sub?: string; warn?: boolean; href: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded px-2 py-1.5 hover:bg-surface-2">
      <span className={warn ? "text-accent" : "text-muted"}>{icon}</span>
      <span className="flex-1">
        {label}
        {sub ? <span className="block text-xs text-accent">{sub}</span> : null}
      </span>
      <b className="num">{value ?? "—"}</b>
    </Link>
  );
}
