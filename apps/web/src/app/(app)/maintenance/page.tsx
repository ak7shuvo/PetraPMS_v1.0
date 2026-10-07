"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, Plus } from "lucide-react";
import { del, fileToDataUrl, get, patch, post, put } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { useRooms } from "@/lib/queries";
import { Badge, Button, Card, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, errorToast, toast } from "@/components/ui";
import { AuthImage } from "@/components/guest-form";
import { useTitle } from "@/components/shell/auth-screens";

interface Ticket {
  id: string;
  number: string;
  title: string;
  description: string;
  roomId: string | null;
  room: { number: string } | null;
  area: string;
  category: string;
  priority: string;
  status: string;
  assignedTo: { id: string; fullName: string } | null;
  slaDueAt: string;
  createdAt: string;
  resolution: string;
  photos: string[];
  overdue: boolean;
  version: number;
  blockId: string | null;
}
const CATS = ["ELECTRICAL", "PLUMBING", "AC", "FURNITURE", "IT", "GENERAL"];
const PRIOS = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];

export default function MaintenancePage() {
  const t = useT();
  const { can } = useSession();
  useTitle(t("nav.maintenance"));
  return (
    <div>
      <PageHeader title={t("nav.maintenance")} />
      <Tabs
        tabs={[
          { value: "tickets", label: t("mt.tickets"), content: <Tickets /> },
          { value: "pm", label: t("mt.preventive"), content: <Schedules />, hidden: !can("maintenance.manage", "maintenance.view") },
        ]}
      />
    </div>
  );
}

function useStaff() {
  return useQuery({ queryKey: ["users", "staff"], queryFn: () => get<{ id: string; fullName: string; active: boolean }[]>("/users"), staleTime: 300_000 });
}

function Tickets() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const { can } = useSession();
  const rooms = useRooms();
  const staff = useStaff();
  const [status, setStatus] = useState("OPEN,IN_PROGRESS,ON_HOLD");
  const list = useQuery({ queryKey: ["maintenance", status], queryFn: () => get<Ticket[]>(`/maintenance${status ? `?status=${status}` : ""}`), refetchInterval: 60_000 });
  const [create, setCreate] = useState<null | { title: string; description: string; roomId: string; area: string; category: string; priority: string; blockRoom: boolean; photos: string[] }>(null);
  const [open, setOpen] = useState<Ticket | null>(null);
  const [upd, setUpd] = useState<{ status: string; assignedToId: string; resolution: string; priority: string }>({ status: "", assignedToId: "", resolution: "", priority: "" });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["maintenance"] });
  return (
    <div>
      <div className="flex gap-2 mb-3">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-48">
          <option value="OPEN,IN_PROGRESS,ON_HOLD">{t("mt.open")}</option>
          <option value="RESOLVED">{t("status.RESOLVED")}</option>
          <option value="CLOSED">{t("status.CLOSED")}</option>
          <option value="">{t("common.all")}</option>
        </Select>
        <div className="flex-1" />
        {can("maintenance.create") ? (
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreate({ title: "", description: "", roomId: "", area: "", category: "GENERAL", priority: "MEDIUM", blockRoom: false, photos: [] })}>
            {t("mt.new")}
          </Button>
        ) : null}
      </div>
      <Card>
        <DataTable
          rows={list.data}
          loading={list.isLoading}
          rowKey={(x) => x.id}
          onRowClick={(x) => (setOpen(x), setUpd({ status: x.status, assignedToId: x.assignedTo?.id ?? "", resolution: x.resolution, priority: x.priority }))}
          cols={[
            { key: "n", header: "#", cell: (x) => x.number },
            { key: "t", header: t("mt.title"), cell: (x) => <span className="font-medium">{x.title}</span> },
            { key: "w", header: t("hk.where"), cell: (x) => (x.room ? `${t("res.room")} ${x.room.number}` : x.area) },
            { key: "c", header: t("mt.category"), cell: (x) => t(`mtCat.${x.category}`) },
            { key: "p", header: t("hk.priority"), cell: (x) => <StatusBadge status={x.priority} />, sort: (x) => PRIOS.indexOf(x.priority) },
            { key: "a", header: t("hk.assignedTo"), cell: (x) => x.assignedTo?.fullName ?? "—" },
            { key: "sla", header: "SLA", cell: (x) => <span className={x.overdue ? "text-accent font-semibold" : ""}>{f.dateTime(x.slaDueAt)}</span>, sort: (x) => x.slaDueAt },
            { key: "s", header: t("common.status"), cell: (x) => <span className="flex gap-1"><StatusBadge status={x.status} />{x.blockId ? <Badge tone="purple">{t("mt.blocked")}</Badge> : null}</span> },
          ]}
        />
      </Card>
      <Modal
        open={!!create}
        onOpenChange={(o) => !o && setCreate(null)}
        title={t("mt.new")}
        size="md"
        footer={
          <Button
            variant="primary"
            disabled={!create?.title.trim()}
            onClick={async () => {
              try {
                await post("/maintenance", { ...create, roomId: create!.roomId || null, blockRoom: create!.blockRoom || undefined });
                toast.success(t("common.saved"));
                setCreate(null);
                refresh();
              } catch (e) {
                errorToast(e);
              }
            }}
          >
            {t("common.save")}
          </Button>
        }
      >
        {create ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("mt.title")} required className="col-span-2">
              <Input value={create.title} onChange={(e) => setCreate({ ...create, title: e.target.value })} autoFocus />
            </Field>
            <Field label={t("res.room")}>
              <Select value={create.roomId} onChange={(e) => setCreate({ ...create, roomId: e.target.value })}>
                <option value="">{t("mt.publicArea")}</option>
                {rooms.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number}
                  </option>
                ))}
              </Select>
            </Field>
            {!create.roomId ? (
              <Field label={t("mt.area")}>
                <Input value={create.area} onChange={(e) => setCreate({ ...create, area: e.target.value })} />
              </Field>
            ) : (
              <div />
            )}
            <Field label={t("mt.category")}>
              <Select value={create.category} onChange={(e) => setCreate({ ...create, category: e.target.value })}>
                {CATS.map((c) => (
                  <option key={c} value={c}>
                    {t(`mtCat.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("hk.priority")} hint={create.priority === "CRITICAL" && create.roomId ? t("mt.autoBlock") : undefined}>
              <Select value={create.priority} onChange={(e) => setCreate({ ...create, priority: e.target.value })}>
                {PRIOS.map((p) => (
                  <option key={p} value={p}>
                    {t(`status.${p}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("folio.description")} className="col-span-2">
              <Textarea value={create.description} onChange={(e) => setCreate({ ...create, description: e.target.value })} />
            </Field>
            {create.roomId && can("rooms.block") ? <Checkbox className="col-span-2" checked={create.blockRoom} onChange={(e) => setCreate({ ...create, blockRoom: e.target.checked })} label={t("mt.blockRoom")} /> : null}
            <label className="col-span-2 inline-flex items-center gap-2 text-sm cursor-pointer">
              <Camera className="size-4" /> {t("mt.addPhoto")} ({create.photos.length}/4)
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file && create.photos.length < 4) setCreate({ ...create, photos: [...create.photos, await fileToDataUrl(file)] });
                }}
              />
            </label>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={!!open}
        onOpenChange={(o) => !o && setOpen(null)}
        title={open ? `${open.number} · ${open.title}` : ""}
        size="md"
        footer={
          can("maintenance.manage") ? (
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  await patch(`/maintenance/${open!.id}`, { version: open!.version, status: upd.status, assignedToId: upd.assignedToId || null, resolution: upd.resolution, priority: upd.priority });
                  toast.success(t("common.saved"));
                  setOpen(null);
                  refresh();
                } catch (e) {
                  errorToast(e);
                }
              }}
            >
              {t("common.save")}
            </Button>
          ) : undefined
        }
      >
        {open ? (
          <div className="grid gap-3 text-sm">
            <p className="text-muted whitespace-pre-wrap">{open.description || "—"}</p>
            <div className="flex gap-2 flex-wrap">
              {open.photos.map((p) => (
                <AuthImage key={p} name={p} className="h-24 w-32 object-cover rounded border border-line" />
              ))}
            </div>
            {can("maintenance.manage") ? (
              <div className="grid grid-cols-3 gap-2">
                <Field label={t("common.status")}>
                  <Select value={upd.status} onChange={(e) => setUpd({ ...upd, status: e.target.value })}>
                    {["OPEN", "IN_PROGRESS", "ON_HOLD", "RESOLVED", "CLOSED"].map((s) => (
                      <option key={s} value={s}>
                        {t(`status.${s}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("hk.priority")}>
                  <Select value={upd.priority} onChange={(e) => setUpd({ ...upd, priority: e.target.value })}>
                    {PRIOS.map((p) => (
                      <option key={p} value={p}>
                        {t(`status.${p}`)}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("hk.assignedTo")}>
                  <Select value={upd.assignedToId} onChange={(e) => setUpd({ ...upd, assignedToId: e.target.value })}>
                    <option value="">—</option>
                    {staff.data?.filter((u) => u.active).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.fullName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t("mt.resolution")} className="col-span-3">
                  <Textarea value={upd.resolution} onChange={(e) => setUpd({ ...upd, resolution: e.target.value })} />
                </Field>
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Schedules() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const { can, businessDate } = useSession();
  const rooms = useRooms();
  const list = useQuery({ queryKey: ["maintenance", "schedules"], queryFn: () => get<{ id: string; title: string; roomId: string | null; area: string; category: string; intervalDays: number; nextDueDate: string; active: boolean }[]>("/maintenance/schedules") });
  const [edit, setEdit] = useState<null | { id?: string; title: string; roomId: string; area: string; category: string; intervalDays: string; nextDueDate: string; active: boolean }>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["maintenance", "schedules"] });
  return (
    <Card>
      <div className="flex justify-end p-2">
        {can("maintenance.manage") ? (
          <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ title: "", roomId: "", area: "", category: "GENERAL", intervalDays: "30", nextDueDate: businessDate, active: true })}>
            {t("common.add")}
          </Button>
        ) : null}
      </div>
      <DataTable
        rows={list.data}
        rowKey={(x) => x.id}
        onRowClick={(x) => can("maintenance.manage") && setEdit({ ...x, roomId: x.roomId ?? "", intervalDays: String(x.intervalDays) })}
        cols={[
          { key: "t", header: t("mt.title"), cell: (x) => x.title },
          { key: "w", header: t("hk.where"), cell: (x) => rooms.data?.find((r) => r.id === x.roomId)?.number ?? x.area },
          { key: "c", header: t("mt.category"), cell: (x) => t(`mtCat.${x.category}`) },
          { key: "i", header: t("mt.every"), cell: (x) => t("company.days", { n: x.intervalDays }) },
          { key: "n", header: t("mt.nextDue"), cell: (x) => <span className={x.nextDueDate <= businessDate ? "text-accent" : ""}>{f.date(x.nextDueDate)}</span> },
          { key: "a", header: "", cell: (x) => (!x.active ? <Badge tone="gray">{t("common.inactive")}</Badge> : null) },
        ]}
      />
      <Modal
        open={!!edit}
        onOpenChange={(o) => !o && setEdit(null)}
        title={t("mt.preventive")}
        size="md"
        footer={
          <>
            {edit?.id ? (
              <Button variant="danger" className="mr-auto" onClick={() => del(`/maintenance/schedules/${edit.id}`).then(() => (setEdit(null), refresh()), errorToast)}>
                {t("common.delete")}
              </Button>
            ) : null}
            <Button
              variant="primary"
              disabled={!edit?.title}
              onClick={async () => {
                const body = { title: edit!.title, roomId: edit!.roomId || null, area: edit!.area, category: edit!.category, intervalDays: Number(edit!.intervalDays), nextDueDate: edit!.nextDueDate, active: edit!.active };
                try {
                  if (edit!.id) await put(`/maintenance/schedules/${edit!.id}`, body);
                  else await post("/maintenance/schedules", body);
                  setEdit(null);
                  refresh();
                } catch (e) {
                  errorToast(e);
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
            <Field label={t("mt.title")} className="col-span-2">
              <Input value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            </Field>
            <Field label={t("res.room")}>
              <Select value={edit.roomId} onChange={(e) => setEdit({ ...edit, roomId: e.target.value })}>
                <option value="">{t("mt.publicArea")}</option>
                {rooms.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("mt.area")}>
              <Input value={edit.area} onChange={(e) => setEdit({ ...edit, area: e.target.value })} />
            </Field>
            <Field label={t("mt.category")}>
              <Select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
                {CATS.map((c) => (
                  <option key={c} value={c}>
                    {t(`mtCat.${c}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("mt.everyDays")}>
              <Input inputMode="numeric" value={edit.intervalDays} onChange={(e) => setEdit({ ...edit, intervalDays: e.target.value })} />
            </Field>
            <Field label={t("mt.nextDue")}>
              <Input type="date" value={edit.nextDueDate} onChange={(e) => setEdit({ ...edit, nextDueDate: e.target.value })} />
            </Field>
            <Checkbox checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} label={t("common.active")} />
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
