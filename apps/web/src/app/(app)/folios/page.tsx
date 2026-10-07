"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Search } from "lucide-react";
import { get, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, errorToast, useDebounced } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface Row {
  id: string;
  number: string;
  name: string;
  type: string;
  status: string;
  room: string;
  balance: number;
  cityLedger: boolean;
  openedAt: string;
  company: { name: string } | null;
}

export default function FoliosPage() {
  const t = useT();
  const f = useFmt();
  const router = useRouter();
  const qc = useQueryClient();
  const { can } = useSession();
  useTitle(t("nav.folios"));
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("OPEN");
  const [create, setCreate] = useState(false);
  const [name, setName] = useState("");
  const dq = useDebounced(q, 300);
  const list = useQuery({ queryKey: ["folios", dq, status], queryFn: () => get<{ total: number; rows: Row[] }>(`/folios?take=200${status ? `&status=${status}` : ""}${dq ? `&q=${encodeURIComponent(dq)}` : ""}`) });
  return (
    <div>
      <PageHeader
        title={t("nav.folios")}
        actions={
          can("folio.charge") ? (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate(true)}>
              {t("folio.newHouse")}
            </Button>
          ) : null
        }
      />
      <Card className="p-3 mb-3 flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-56">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-muted" />
          <Input className="pl-8" placeholder={t("folio.search")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-40">
          <option value="OPEN">{t("status.OPEN")}</option>
          <option value="SETTLED">{t("status.SETTLED")}</option>
          <option value="CLOSED">{t("status.CLOSED")}</option>
          <option value="">{t("common.all")}</option>
        </Select>
      </Card>
      <Card>
        <DataTable
          rows={list.data?.rows}
          loading={list.isLoading}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.push(`/folios/${r.id}`)}
          cols={[
            { key: "n", header: t("folio.number"), cell: (r) => <b>{r.number}</b>, sort: (r) => r.number },
            { key: "name", header: t("common.name"), cell: (r) => <span>{r.name} {r.cityLedger ? <Badge tone="purple">{t("folio.cityLedger")}</Badge> : null}</span>, sort: (r) => r.name },
            { key: "room", header: t("res.room"), cell: (r) => r.room || "—" },
            { key: "type", header: t("common.type"), cell: (r) => t(`folioType.${r.type}`) },
            { key: "st", header: t("common.status"), cell: (r) => <StatusBadge status={r.status} /> },
            { key: "o", header: t("folio.opened"), cell: (r) => f.dateTime(r.openedAt), sort: (r) => r.openedAt },
            { key: "b", header: t("folio.balance"), cell: (r) => <span className={r.balance > 0 ? "text-accent font-semibold" : ""}>{f.money(r.balance)}</span>, align: "right", sort: (r) => r.balance },
          ]}
        />
      </Card>
      <Modal
        open={create}
        onOpenChange={setCreate}
        title={t("folio.newHouse")}
        size="sm"
        footer={
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={async () => {
              try {
                const fo = await post<{ id: string }>("/folios", { name, type: "WALK_IN" });
                void qc.invalidateQueries({ queryKey: ["folios"] });
                setCreate(false);
                router.push(`/folios/${fo.id}`);
              } catch (e) {
                errorToast(e);
              }
            }}
          >
            {t("common.create")}
          </Button>
        }
      >
        <Field label={t("common.name")} hint={t("folio.houseHint")}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </div>
  );
}
