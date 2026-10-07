"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download } from "lucide-react";
import { download, get } from "@/lib/api";
import { useFmt, useT } from "@/lib/i18n";
import { Button, Card, DataTable, Input, Modal, PageHeader, errorToast, useDebounced } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";
import { useSession } from "@/lib/session";

interface Row {
  id: string;
  at: string;
  username: string;
  action: string;
  entity: string;
  entityId: string;
  reason: string;
  ip: string;
  terminalId: string;
  businessDate: string;
  before: string | null;
  after: string | null;
}

export default function AuditPage() {
  const t = useT();
  const f = useFmt();
  const { businessDate } = useSession();
  useTitle(t("nav.audit"));
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Row | null>(null);
  const dq = useDebounced(q, 300);
  const list = useQuery({ queryKey: ["audit", dq, from, page], queryFn: () => get<{ rows: Row[]; total: number }>(`/audit?take=100&skip=${page * 100}${dq ? `&q=${encodeURIComponent(dq)}` : ""}${from ? `&from=${from}` : ""}`) });
  const pretty = (s: string | null) => {
    if (!s) return "—";
    try {
      return JSON.stringify(JSON.parse(s), null, 2);
    } catch {
      return s;
    }
  };
  return (
    <div>
      <PageHeader
        title={t("nav.audit")}
        sub={list.data ? t("common.count", { n: list.data.total }) : undefined}
        actions={
          <Button icon={<Download className="size-4" />} onClick={() => void download(`/reports/audit-trail/export?format=xlsx&from=${from || businessDate}&to=${businessDate}`).catch(errorToast)}>
            Excel
          </Button>
        }
      />
      <Card className="p-3 mb-3 flex gap-2">
        <Input placeholder={t("audit.search")} value={q} onChange={(e) => (setQ(e.target.value), setPage(0))} />
        <Input type="date" value={from} onChange={(e) => (setFrom(e.target.value), setPage(0))} className="w-40" />
      </Card>
      <Card>
        <DataTable
          rows={list.data?.rows}
          loading={list.isLoading}
          rowKey={(r) => r.id}
          dense
          onRowClick={setOpen}
          cols={[
            { key: "a", header: t("audit.time"), cell: (r) => f.dateTime(r.at) },
            { key: "u", header: t("audit.user"), cell: (r) => r.username },
            { key: "act", header: t("audit.action"), cell: (r) => <code className="text-xs">{r.action}</code> },
            { key: "e", header: t("audit.entity"), cell: (r) => <span className="text-xs">{r.entity} {r.entityId ? `· ${r.entityId.slice(0, 12)}` : ""}</span> },
            { key: "r", header: t("common.reason"), cell: (r) => <span className="text-xs">{r.reason}</span> },
            { key: "t", header: t("users.terminal"), cell: (r) => <span className="text-xs text-muted">{[r.ip, r.terminalId].filter(Boolean).join(" · ")}</span> },
          ]}
        />
        {list.data && list.data.total > 100 ? (
          <div className="flex justify-end gap-2 p-2 border-t border-line">
            <Button size="sm" disabled={!page} onClick={() => setPage(page - 1)}>←</Button>
            <Button size="sm" disabled={(page + 1) * 100 >= list.data.total} onClick={() => setPage(page + 1)}>→</Button>
          </div>
        ) : null}
      </Card>
      <Modal open={!!open} onOpenChange={(o) => !o && setOpen(null)} title={open?.action ?? ""} description={open ? `${open.username} · ${f.dateTime(open.at)} · ${t("na.businessDate")} ${open.businessDate}` : ""} size="lg">
        {open ? (
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <p className="text-xs text-muted mb-1">{t("audit.before")}</p>
              <pre className="text-[11px] bg-surface-2 rounded p-2 overflow-auto max-h-96 whitespace-pre-wrap">{pretty(open.before)}</pre>
            </div>
            <div>
              <p className="text-xs text-muted mb-1">{t("audit.after")}</p>
              <pre className="text-[11px] bg-surface-2 rounded p-2 overflow-auto max-h-96 whitespace-pre-wrap">{pretty(open.after)}</pre>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
