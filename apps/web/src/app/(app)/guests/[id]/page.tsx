"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Ban, GitMerge, Plus } from "lucide-react";
import { del, get, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import type { Guest } from "@/lib/queries";
import { Badge, Button, Card, CardHeader, DataTable, Field, Input, Modal, PageHeader, Skeleton, StatusBadge, errorToast, toast, useConfirm, useDebounced } from "@/components/ui";
import { DocumentCapture, GuestFields, saveGuest, toDraft, type GuestDraft } from "@/components/guest-form";
import { useTitle } from "@/components/shell/auth-screens";

type GuestDetail = Guest & { history: { id: string; confirmationNo: string; arrivalDate: string; departureDate: string; status: string; rooms: { room: { number: string } | null }[] }[] };

export default function GuestPage() {
  const t = useT();
  const f = useFmt();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["guest", id], queryFn: () => get<GuestDetail>(`/guests/${id}`) });
  const g = q.data;
  useTitle(g?.fullName ?? t("nav.guests"));
  const [draft, setDraft] = useState<GuestDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [merge, setMerge] = useState(false);
  useEffect(() => {
    if (g) setDraft(toDraft(g));
  }, [g]);
  if (!g || !draft) return <Skeleton className="h-64" />;
  const refresh = () => void qc.invalidateQueries({ queryKey: ["guest", id] });
  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <button onClick={() => router.back()} className="text-muted hover:text-fg" aria-label={t("common.back")}>
              <ArrowLeft className="size-5" />
            </button>
            {g.fullName} {g.vip ? <Badge tone="amber">VIP {g.vip}</Badge> : null} {g.blacklisted ? <Badge tone="red">{t("guest.blacklisted")}</Badge> : null}
          </span>
        }
        sub={`${g.code} · ${t("guest.stays", { n: g.totalStays })} · ${t("guest.nights", { n: g.totalNights })} · ${f.money(g.totalSpend)}`}
        actions={
          <>
            {can("reservations.create") && !g.blacklisted ? (
              <Button icon={<Plus className="size-4" />} onClick={() => router.push(`/reservations/new?guestId=${g.id}`)}>
                {t("res.new")}
              </Button>
            ) : null}
            {can("guests.blacklist") ? (
              <Button
                variant="danger"
                icon={<Ban className="size-4" />}
                onClick={async () => {
                  const c = await confirm({ title: g.blacklisted ? t("guest.unblacklist") : t("guest.blacklist"), reason: !g.blacklisted, danger: !g.blacklisted });
                  if (!c.ok) return;
                  try {
                    await post(`/guests/${g.id}/blacklist`, { blacklisted: !g.blacklisted, reason: c.reason });
                    refresh();
                  } catch (e) {
                    errorToast(e);
                  }
                }}
              >
                {g.blacklisted ? t("guest.unblacklist") : t("guest.blacklist")}
              </Button>
            ) : null}
            {can("guests.merge") ? (
              <Button icon={<GitMerge className="size-4" />} onClick={() => setMerge(true)}>
                {t("guest.merge")}
              </Button>
            ) : null}
          </>
        }
      />
      {g.blacklisted ? <p className="mb-3 text-sm text-accent">{g.blacklistReason}</p> : null}
      <div className="grid xl:grid-cols-[1fr_380px] gap-4">
        <Card>
          <CardHeader
            title={t("guest.profile")}
            actions={
              can("guests.edit") ? (
                <Button
                  variant="primary"
                  size="sm"
                  loading={busy}
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await saveGuest(draft);
                      toast.success(t("common.saved"));
                      refresh();
                    } catch (e) {
                      errorToast(e);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t("common.save")}
                </Button>
              ) : null
            }
          />
          <div className="p-4">
            <GuestFields value={draft} onChange={setDraft} />
          </div>
        </Card>
        <div className="space-y-4">
          <Card className="p-4 space-y-3">
            <p className="text-xs font-semibold text-muted">{t("guest.documents")}</p>
            <DocumentCapture guestId={g.id} kind="idImage" current={g.idImage} onSaved={refresh} />
            <DocumentCapture guestId={g.id} kind="idImageBack" current={g.idImageBack} onSaved={refresh} />
            <DocumentCapture guestId={g.id} kind="photo" current={g.photo} onSaved={refresh} />
          </Card>
          <Card>
            <CardHeader title={t("guest.history")} />
            <DataTable
              rows={g.history}
              rowKey={(h) => h.id}
              dense
              onRowClick={(h) => router.push(`/reservations/${h.id}`)}
              cols={[
                { key: "n", header: t("res.confNo"), cell: (h) => h.confirmationNo },
                { key: "d", header: t("res.dates"), cell: (h) => <span className="text-xs">{f.short(h.arrivalDate)}–{f.short(h.departureDate)}</span> },
                { key: "r", header: t("res.room"), cell: (h) => h.rooms.map((x) => x.room?.number).filter(Boolean).join(", ") },
                { key: "s", header: "", cell: (h) => <StatusBadge status={h.status} /> },
              ]}
            />
          </Card>
          {can("guests.merge") && !g.history.length ? (
            <Button
              variant="danger"
              size="sm"
              onClick={async () => {
                const c = await confirm({ title: t("common.delete"), message: g.fullName, danger: true });
                if (c.ok) {
                  try {
                    await del(`/guests/${g.id}`);
                    router.replace("/guests");
                  } catch (e) {
                    errorToast(e);
                  }
                }
              }}
            >
              {t("common.delete")}
            </Button>
          ) : null}
        </div>
      </div>
      <MergeDialog open={merge} onClose={() => setMerge(false)} into={g} onDone={refresh} />
    </div>
  );
}

function MergeDialog({ open, onClose, into, onDone }: { open: boolean; onClose: () => void; into: Guest; onDone: () => void }) {
  const t = useT();
  const confirm = useConfirm();
  const [q, setQ] = useState(into.phone || into.lastName);
  const dq = useDebounced(q, 300);
  const res = useQuery({ queryKey: ["guests", "merge", dq], enabled: open && dq.length >= 2, queryFn: () => get<{ rows: Guest[] }>(`/guests?take=10&q=${encodeURIComponent(dq)}`) });
  return (
    <Modal open={open} onOpenChange={(o) => !o && onClose()} title={t("guest.merge")} description={t("guest.mergeHelp", { name: into.fullName })} size="md">
      <Field label={t("common.search")}>
        <Input value={q} onChange={(e) => setQ(e.target.value)} />
      </Field>
      <div className="mt-3 divide-y divide-line">
        {res.data?.rows
          .filter((x) => x.id !== into.id)
          .map((x) => (
            <div key={x.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1">
                {x.fullName} <span className="text-muted text-xs">{x.code} · {x.phone}</span>
              </span>
              <Button
                size="sm"
                onClick={async () => {
                  const c = await confirm({ title: t("guest.merge"), message: t("guest.mergeConfirm", { from: x.fullName, into: into.fullName }), danger: true });
                  if (!c.ok) return;
                  try {
                    await post(`/guests/${into.id}/merge`, { fromId: x.id });
                    toast.success(t("common.saved"));
                    onDone();
                    onClose();
                  } catch (e) {
                    errorToast(e);
                  }
                }}
              >
                {t("guest.mergeThis")}
              </Button>
            </div>
          ))}
      </div>
    </Modal>
  );
}
