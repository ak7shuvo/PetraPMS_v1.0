"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Crown, Plus, Search } from "lucide-react";
import { get } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import type { Guest } from "@/lib/queries";
import { Badge, Button, Card, DataTable, Input, Modal, PageHeader, Select, errorToast, toast, useDebounced } from "@/components/ui";
import { GuestFields, emptyGuest, saveGuest, type GuestDraft } from "@/components/guest-form";
import { useTitle } from "@/components/shell/auth-screens";

export default function GuestsPage() {
  const t = useT();
  const f = useFmt();
  const router = useRouter();
  const { can } = useSession();
  useTitle(t("nav.guests"));
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState("");
  const [page, setPage] = useState(0);
  const [create, setCreate] = useState<GuestDraft | null>(null);
  const dq = useDebounced(q, 300);
  const list = useQuery({ queryKey: ["guests", dq, filter, page], queryFn: () => get<{ total: number; rows: Guest[] }>(`/guests?take=50&skip=${page * 50}&sort=recent${dq ? `&q=${encodeURIComponent(dq)}` : ""}${filter ? `&${filter}=1` : ""}`) });
  return (
    <div>
      <PageHeader
        title={t("nav.guests")}
        sub={list.data ? t("common.count", { n: list.data.total }) : undefined}
        actions={
          can("guests.edit") ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate(emptyGuest())}>
              {t("res.newGuest")}
            </Button>
          ) : null
        }
      />
      <Card className="p-3 mb-3 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted" />
          <Input className="pl-8" placeholder={t("guest.search")} value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} />
        </div>
        <Select value={filter} onChange={(e) => (setFilter(e.target.value), setPage(0))} className="w-44">
          <option value="">{t("common.all")}</option>
          <option value="vip">VIP</option>
          <option value="foreign">{t("guest.foreign")}</option>
          <option value="blacklisted">{t("guest.blacklisted")}</option>
        </Select>
      </Card>
      <Card>
        <DataTable
          rows={list.data?.rows}
          loading={list.isLoading}
          rowKey={(g) => g.id}
          onRowClick={(g) => router.push(`/guests/${g.id}`)}
          cols={[
            { key: "c", header: t("common.code"), cell: (g) => <span className="text-xs text-muted">{g.code}</span> },
            { key: "n", header: t("common.name"), cell: (g) => <span className="font-medium flex items-center gap-1">{g.vip ? <Crown className="size-3.5 text-[var(--st-vacant-dirty)]" /> : null}{g.fullName}{g.blacklisted ? <Badge tone="red">{t("guest.blacklisted")}</Badge> : null}</span>, sort: (g) => g.fullName },
            { key: "p", header: t("common.phone"), cell: (g) => g.phone || "—" },
            { key: "nat", header: t("guest.nationality"), cell: (g) => g.nationality },
            { key: "co", header: t("res.company"), cell: (g) => g.company?.name ?? "—" },
            { key: "s", header: t("guest.staysCol"), cell: (g) => g.totalStays, align: "right", sort: (g) => g.totalStays },
            { key: "sp", header: t("guest.spend"), cell: (g) => f.money(g.totalSpend), align: "right", sort: (g) => g.totalSpend },
            { key: "l", header: t("guest.lastStay"), cell: (g) => f.date(g.lastStayAt), sort: (g) => g.lastStayAt },
          ]}
        />
        {list.data && list.data.total > 50 ? (
          <div className="flex justify-end gap-2 p-2 border-t border-line">
            <Button size="sm" disabled={!page} onClick={() => setPage(page - 1)}>←</Button>
            <Button size="sm" disabled={(page + 1) * 50 >= list.data.total} onClick={() => setPage(page + 1)}>→</Button>
          </div>
        ) : null}
      </Card>
      <Modal
        open={!!create}
        onOpenChange={(o) => !o && setCreate(null)}
        title={t("res.newGuest")}
        size="xl"
        footer={
          <Button
            variant="primary"
            disabled={!create?.firstName.trim()}
            onClick={async () => {
              try {
                const g = await saveGuest(create!);
                toast.success(t("common.saved"));
                setCreate(null);
                router.push(`/guests/${g.id}`);
              } catch (e) {
                errorToast(e);
              }
            }}
          >
            {t("common.save")}
          </Button>
        }
      >
        {create ? <GuestFields value={create} onChange={setCreate} /> : null}
      </Modal>
    </div>
  );
}
