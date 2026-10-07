"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Users } from "lucide-react";
import { addDays } from "@petra/core";
import { get } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { Badge, Button, Card, DataTable, Input, PageHeader, Select, StatusBadge, useDebounced } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface Row {
  id: string;
  confirmationNo: string;
  status: string;
  source: string;
  guest: { id: string; fullName: string; phone: string; vip: number };
  company: string;
  arrivalDate: string;
  departureDate: string;
  adults: number;
  children: number;
  isGroup: boolean;
  groupName: string;
  rooms: { id: string; status: string; room: string | null; type: string }[];
  total: number;
  createdAt: string;
}

export default function ReservationsPage() {
  const t = useT();
  const f = useFmt();
  const router = useRouter();
  const { businessDate, can } = useSession();
  useTitle(t("nav.reservations"));
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("CONFIRMED,TENTATIVE,WAITLIST,CHECKED_IN");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [field, setField] = useState("arrival");
  const [page, setPage] = useState(0);
  const dq = useDebounced(q, 300);
  const take = 50;
  const params = new URLSearchParams({ take: String(take), skip: String(page * take), dateField: field });
  if (dq) params.set("q", dq);
  if (status) params.set("status", status);
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const list = useQuery({ queryKey: ["reservations", params.toString()], queryFn: () => get<{ total: number; rows: Row[] }>(`/reservations?${params}`) });
  return (
    <div>
      <PageHeader
        title={t("nav.reservations")}
        sub={list.data ? t("common.count", { n: list.data.total }) : undefined}
        actions={
          can("reservations.create") ? (
            <Link href="/reservations/new">
              <Button variant="primary" icon={<Plus className="size-4" />}>
                {t("res.new")}
              </Button>
            </Link>
          ) : null
        }
      />
      <Card className="p-3 mb-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted" />
          <Input className="pl-8" placeholder={t("res.searchPlaceholder")} value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} />
        </div>
        <Select value={status} onChange={(e) => (setStatus(e.target.value), setPage(0))} className="w-48">
          <option value="CONFIRMED,TENTATIVE,WAITLIST,CHECKED_IN">{t("res.active")}</option>
          <option value="">{t("common.all")}</option>
          {["CONFIRMED", "TENTATIVE", "WAITLIST", "CHECKED_IN", "CHECKED_OUT", "CANCELLED", "NO_SHOW"].map((s) => (
            <option key={s} value={s}>
              {t(`status.${s}`)}
            </option>
          ))}
        </Select>
        <Select value={field} onChange={(e) => setField(e.target.value)} className="w-36">
          <option value="arrival">{t("res.arrival")}</option>
          <option value="departure">{t("res.departure")}</option>
          <option value="created">{t("res.bookedOn")}</option>
        </Select>
        <Input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPage(0))} className="w-38" />
        <Input type="date" value={to} onChange={(e) => (setTo(e.target.value), setPage(0))} className="w-38" />
        <Button size="sm" onClick={() => (setFrom(businessDate), setTo(addDays(businessDate, 7)), setField("arrival"))}>
          {t("res.next7")}
        </Button>
      </Card>
      <Card>
        <DataTable
          rows={list.data?.rows}
          loading={list.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/reservations/${r.id}`)}
          cols={[
            { key: "no", header: t("res.confNo"), cell: (r) => <b>{r.confirmationNo}</b>, sort: (r) => r.confirmationNo },
            {
              key: "g",
              header: t("res.guest"),
              cell: (r) => (
                <div>
                  <div className="font-medium flex items-center gap-1">
                    {r.guest.fullName} {r.guest.vip ? <Badge tone="amber">VIP</Badge> : null} {r.isGroup ? <Users className="size-3.5 text-muted" /> : null}
                  </div>
                  <div className="text-xs text-muted">{[r.company, r.groupName, r.guest.phone].filter(Boolean).join(" · ")}</div>
                </div>
              ),
              sort: (r) => r.guest.fullName,
            },
            { key: "d", header: t("res.dates"), cell: (r) => <span className="whitespace-nowrap">{f.short(r.arrivalDate)} → {f.short(r.departureDate)}</span>, sort: (r) => r.arrivalDate },
            { key: "rooms", header: t("res.rooms"), cell: (r) => <span className="text-xs">{r.rooms.filter((x) => !["CANCELLED", "NO_SHOW"].includes(x.status)).map((x) => x.room ?? x.type).join(", ")}</span> },
            { key: "src", header: t("res.source"), cell: (r) => <span className="text-xs">{t(`source.${r.source}`)}</span> },
            { key: "st", header: t("common.status"), cell: (r) => <StatusBadge status={r.status} /> },
            { key: "tot", header: t("res.roomTotal"), cell: (r) => f.money(r.total), align: "right", sort: (r) => r.total },
          ]}
        />
        {list.data && list.data.total > take ? (
          <div className="flex justify-end items-center gap-2 p-2 border-t border-line text-sm">
            <Button size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
              ←
            </Button>
            <span className="text-muted">
              {page * take + 1}–{Math.min(list.data.total, (page + 1) * take)} / {list.data.total}
            </span>
            <Button size="sm" disabled={(page + 1) * take >= list.data.total} onClick={() => setPage(page + 1)}>
              →
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
