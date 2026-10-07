"use client";
// Housekeeping: supervisor board (rooms, tasks, assignment, inspection) and a tablet-friendly "My tasks" view
// for housekeepers. Lost & found and linen inventory tabs.
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ClipboardCheck, Play, Plus, RefreshCw, UserCheck } from "lucide-react";
import { get, patch, post } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { useRooms } from "@/lib/queries";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, cn, errorToast, toast } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface Task {
  id: string;
  roomId: string;
  businessDate: string;
  type: string;
  status: string;
  priority: number;
  notes: string;
  version: number;
  minutes: number;
  assignedTo: { id: string; fullName: string } | null;
  room: { number: string; floor: string };
  startedAt: string | null;
  completedAt: string | null;
}
interface BoardRoom {
  id: string;
  number: string;
  floor: string;
  type: { code: string; name: string };
  hkStatus: string;
  version: number;
  occupied: boolean;
  departing: boolean;
  arriving: boolean;
  block: { type: string; reason: string } | null;
  guests: number;
}
interface Board {
  date: string;
  rooms: BoardRoom[];
  tasks: Task[];
  staff: { id: string; fullName: string }[];
  summary: Record<string, number>;
}

const HK_COLOR: Record<string, string> = { CLEAN: "var(--st-vacant-clean)", INSPECTED: "var(--st-vacant-clean)", DIRTY: "var(--st-vacant-dirty)", IN_PROGRESS: "var(--st-reserved)" };

export default function HousekeepingPage() {
  const t = useT();
  const { can } = useSession();
  useTitle(t("nav.housekeeping"));
  const sup = can("housekeeping.assign");
  return (
    <div>
      <PageHeader title={t("nav.housekeeping")} />
      <Tabs
        tabs={[
          { value: "board", label: sup ? t("hk.board") : t("hk.myTasks"), content: sup ? <SupervisorBoard /> : <MyTasks /> },
          { value: "mine", label: t("hk.myTasks"), content: <MyTasks />, hidden: !sup || !can("housekeeping.update") },
          { value: "lf", label: t("hk.lostFound"), content: <LostFound />, hidden: !can("housekeeping.lostfound") },
          { value: "linen", label: t("hk.linen"), content: <Linen />, hidden: !can("housekeeping.linen") },
        ]}
      />
    </div>
  );
}

function useBoard(mine = false) {
  return useQuery({ queryKey: ["housekeeping", "board", mine], queryFn: () => get<Board>(`/housekeeping/board${mine ? "?mine=1" : ""}`), refetchInterval: 60_000 });
}

function useTaskAction() {
  const qc = useQueryClient();
  const t = useT();
  return async (task: Task, status: string) => {
    try {
      await post(`/housekeeping/tasks/${task.id}/status`, { status, version: task.version });
      toast.success(t(`hk.toast.${status}`));
    } catch (e) {
      errorToast(e);
    } finally {
      void qc.invalidateQueries({ queryKey: ["housekeeping"] });
      void qc.invalidateQueries({ queryKey: ["rack"] });
    }
  };
}

function SupervisorBoard() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const b = useBoard();
  const act = useTaskAction();
  const [sel, setSel] = useState<string[]>([]);
  const [assignTo, setAssignTo] = useState("");
  const [newTask, setNewTask] = useState(false);
  const [filter, setFilter] = useState("open");
  const tasks = useMemo(() => (b.data?.tasks ?? []).filter((x) => (filter === "open" ? ["PENDING", "IN_PROGRESS", "DONE"].includes(x.status) : true)), [b.data, filter]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["housekeeping"] });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {(["DIRTY", "IN_PROGRESS", "CLEAN", "INSPECTED"] as const).map((s) => (
          <span key={s} className="flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs">
            <span className="size-3 rounded-sm" style={{ background: HK_COLOR[s] }} /> {t(`status.${s}`)} <b>{f.num(b.data?.summary[s.toLowerCase() === "in_progress" ? "inProgress" : s.toLowerCase()] ?? 0)}</b>
          </span>
        ))}
        <div className="flex-1" />
        <Button icon={<RefreshCw className="size-4" />} onClick={() => post<{ created: number }>("/housekeeping/generate").then((r) => (toast.success(t("hk.generated", { n: r.created })), refresh()), errorToast)}>
          {t("hk.generate")}
        </Button>
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setNewTask(true)}>
          {t("hk.newTask")}
        </Button>
      </div>
      <Card>
        <CardHeader title={t("hk.rooms")} />
        <div className="p-3 grid grid-cols-[repeat(auto-fill,minmax(92px,1fr))] gap-1.5">
          {b.data?.rooms.map((r) => (
            <button
              key={r.id}
              title={`${r.type.name}${r.block ? ` · ${r.block.reason}` : ""}`}
              onClick={async () => {
                const next = r.hkStatus === "DIRTY" ? "CLEAN" : r.hkStatus === "CLEAN" ? "INSPECTED" : "DIRTY";
                try {
                  await post(`/housekeeping/rooms/${r.id}/status`, { hkStatus: next, version: r.version });
                  refresh();
                } catch (e) {
                  errorToast(e);
                }
              }}
              className="rounded-md border border-line bg-surface p-1.5 text-left hover:shadow touch-target"
            >
              <div className="flex items-center justify-between">
                <b className="text-sm">{r.number}</b>
                <span className="size-2.5 rounded-full" style={{ background: HK_COLOR[r.hkStatus] }} />
              </div>
              <div className="text-[10px] text-muted truncate">
                {r.block ? t(`blockType.${r.block.type}`) : r.departing ? t("fd.dueOut") : r.occupied ? t("hk.occupied") : r.arriving ? t("fd.arrival") : t("hk.vacant")}
              </div>
            </button>
          ))}
        </div>
        <p className="px-3 pb-2 text-[11px] text-muted">{t("hk.clickCycle")}</p>
      </Card>
      <Card>
        <CardHeader
          title={t("hk.tasks")}
          actions={
            <>
              <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="h-8 w-36 text-xs">
                <option value="open">{t("hk.openTasks")}</option>
                <option value="all">{t("common.all")}</option>
              </Select>
              {sel.length ? (
                <>
                  <Select value={assignTo} onChange={(e) => setAssignTo(e.target.value)} className="h-8 w-44 text-xs">
                    <option value="">{t("hk.unassign")}</option>
                    {b.data?.staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.fullName}
                      </option>
                    ))}
                  </Select>
                  <Button size="sm" variant="primary" icon={<UserCheck className="size-3.5" />} onClick={() => post("/housekeeping/assign", { taskIds: sel, assignedToId: assignTo || null }).then(() => (setSel([]), refresh()), errorToast)}>
                    {t("hk.assign", { n: sel.length })}
                  </Button>
                </>
              ) : null}
            </>
          }
        />
        <DataTable
          rows={tasks}
          loading={b.isLoading}
          rowKey={(x) => x.id}
          dense
          cols={[
            { key: "s", header: <input type="checkbox" className="accent-[var(--accent)]" checked={!!tasks.length && sel.length === tasks.length} onChange={(e) => setSel(e.target.checked ? tasks.map((x) => x.id) : [])} />, cell: (x) => <input type="checkbox" className="accent-[var(--accent)]" checked={sel.includes(x.id)} onChange={(e) => setSel(e.target.checked ? [...sel, x.id] : sel.filter((y) => y !== x.id))} /> },
            { key: "r", header: t("res.room"), cell: (x) => <b>{x.room.number}</b>, sort: (x) => x.room.number },
            { key: "t", header: t("common.type"), cell: (x) => t(`hkType.${x.type}`) },
            { key: "p", header: t("hk.priority"), cell: (x) => (x.priority === 1 ? <Badge tone="red">{t("hk.high")}</Badge> : x.priority === 3 ? t("hk.low") : t("hk.normal")), sort: (x) => x.priority },
            { key: "a", header: t("hk.assignedTo"), cell: (x) => x.assignedTo?.fullName ?? <span className="text-muted">—</span> },
            { key: "st", header: t("common.status"), cell: (x) => <StatusBadge status={x.status} /> },
            { key: "m", header: t("hk.minutes"), cell: (x) => (x.minutes ? x.minutes : "—"), align: "right" },
            {
              key: "act",
              header: "",
              align: "right",
              cell: (x) => (
                <div className="flex justify-end gap-1">
                  {x.status === "DONE" ? (
                    <Button size="xs" variant="primary" icon={<ClipboardCheck className="size-3" />} onClick={() => void act(x, "INSPECTED")}>
                      {t("hk.inspect")}
                    </Button>
                  ) : null}
                  {x.status === "DONE" ? (
                    <Button size="xs" onClick={() => void act(x, "PENDING")}>
                      {t("hk.reject")}
                    </Button>
                  ) : null}
                  {x.status === "PENDING" ? (
                    <Button size="xs" variant="ghost" onClick={() => void act(x, "SKIPPED")}>
                      {t("hk.skip")}
                    </Button>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
      </Card>
      <NewTaskDialog open={newTask} onClose={() => setNewTask(false)} staff={b.data?.staff ?? []} />
    </div>
  );
}

function NewTaskDialog({ open, onClose, staff }: { open: boolean; onClose: () => void; staff: { id: string; fullName: string }[] }) {
  const t = useT();
  const qc = useQueryClient();
  const rooms = useRooms();
  const [v, setV] = useState({ roomIds: [] as string[], type: "DEEP_CLEAN", priority: "2", assignedToId: "", notes: "" });
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("hk.newTask")}
      size="md"
      footer={
        <Button
          variant="primary"
          disabled={!v.roomIds.length}
          onClick={async () => {
            try {
              const r = await post<{ created: number }>("/housekeeping/tasks", { ...v, priority: Number(v.priority), assignedToId: v.assignedToId || null });
              toast.success(t("hk.generated", { n: r.created }));
              void qc.invalidateQueries({ queryKey: ["housekeeping"] });
              onClose();
            } catch (e) {
              errorToast(e);
            }
          }}
        >
          {t("common.create")}
        </Button>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-2">
          <Field label={t("common.type")}>
            <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
              {["CHECKOUT_CLEAN", "STAYOVER", "DEEP_CLEAN", "TURNDOWN", "INSPECTION", "CUSTOM"].map((x) => (
                <option key={x} value={x}>
                  {t(`hkType.${x}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("hk.priority")}>
            <Select value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })}>
              <option value="1">{t("hk.high")}</option>
              <option value="2">{t("hk.normal")}</option>
              <option value="3">{t("hk.low")}</option>
            </Select>
          </Field>
          <Field label={t("hk.assignedTo")}>
            <Select value={v.assignedToId} onChange={(e) => setV({ ...v, assignedToId: e.target.value })}>
              <option value="">—</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.fullName}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={t("res.rooms")}>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(70px,1fr))] gap-1 max-h-48 overflow-auto rounded border border-line p-2">
            {rooms.data?.filter((r) => r.active).map((r) => (
              <Checkbox key={r.id} checked={v.roomIds.includes(r.id)} onChange={(e) => setV({ ...v, roomIds: e.target.checked ? [...v.roomIds, r.id] : v.roomIds.filter((x) => x !== r.id) })} label={r.number} />
            ))}
          </div>
        </Field>
        <Field label={t("common.notes")}>
          <Textarea value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

/** Big-button task list for housekeepers on a phone or tablet. */
function MyTasks() {
  const t = useT();
  const b = useBoard(true);
  const act = useTaskAction();
  const { user } = useSession();
  const mine = (b.data?.tasks ?? []).filter((x) => ["PENDING", "IN_PROGRESS"].includes(x.status) && (!x.assignedTo || x.assignedTo.id === user?.id)).sort((a, z) => a.priority - z.priority);
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {mine.map((x) => (
        <Card key={x.id} className={cn("p-4", x.priority === 1 && "border-accent")}>
          <div className="flex items-center justify-between">
            <span className="text-3xl font-bold">{x.room.number}</span>
            <StatusBadge status={x.status} />
          </div>
          <p className="text-sm mt-1">
            {t(`hkType.${x.type}`)} {x.priority === 1 ? <Badge tone="red">{t("hk.high")}</Badge> : null}
          </p>
          {x.notes ? <p className="text-xs text-muted mt-1">{x.notes}</p> : null}
          <div className="mt-3 grid gap-2">
            {x.status === "PENDING" ? (
              <Button size="lg" variant="dark" icon={<Play className="size-4" />} onClick={() => void act(x, "IN_PROGRESS")}>
                {t("hk.start")}
              </Button>
            ) : (
              <Button size="lg" variant="primary" icon={<CheckCircle2 className="size-4" />} onClick={() => void act(x, "DONE")}>
                {t("hk.done")}
              </Button>
            )}
          </div>
        </Card>
      ))}
      {b.data && !mine.length ? <p className="text-muted text-sm">{t("hk.noTasks")}</p> : null}
    </div>
  );
}

function LostFound() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const rooms = useRooms();
  const list = useQuery({ queryKey: ["housekeeping", "lf"], queryFn: () => get<{ id: string; itemNo: string; foundAt: string; description: string; room: { number: string } | null; location: string; foundBy: string; status: string; returnedTo: string }[]>("/lost-found") });
  const [v, setV] = useState<{ description: string; roomId: string; location: string; foundBy: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["housekeeping", "lf"] });
  return (
    <Card>
      <CardHeader title={t("hk.lostFound")} actions={<Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setV({ description: "", roomId: "", location: "", foundBy: "" })}>{t("common.add")}</Button>} />
      <DataTable
        rows={list.data}
        rowKey={(x) => x.id}
        cols={[
          { key: "n", header: "#", cell: (x) => x.itemNo },
          { key: "d", header: t("common.date"), cell: (x) => f.dateTime(x.foundAt) },
          { key: "desc", header: t("folio.description"), cell: (x) => x.description },
          { key: "w", header: t("hk.where"), cell: (x) => x.room?.number ?? x.location },
          { key: "b", header: t("hk.foundBy"), cell: (x) => x.foundBy },
          { key: "s", header: t("common.status"), cell: (x) => <Badge tone={x.status === "STORED" ? "amber" : "green"}>{t(`lf.${x.status}`)}{x.returnedTo ? ` → ${x.returnedTo}` : ""}</Badge> },
          {
            key: "a",
            header: "",
            align: "right",
            cell: (x) =>
              x.status === "STORED" ? (
                <Button
                  size="xs"
                  onClick={async () => {
                    const to = prompt(t("hk.returnedTo"));
                    if (!to) return;
                    await patch(`/lost-found/${x.id}`, { status: "RETURNED", returnedTo: to }).then(refresh, errorToast);
                  }}
                >
                  {t("hk.markReturned")}
                </Button>
              ) : null,
          },
        ]}
      />
      <Modal
        open={!!v}
        onOpenChange={(o) => !o && setV(null)}
        title={t("hk.lostFound")}
        size="sm"
        footer={
          <Button variant="primary" disabled={!v?.description.trim()} onClick={() => post("/lost-found", { ...v, roomId: v!.roomId || null }).then(() => (setV(null), refresh()), errorToast)}>
            {t("common.save")}
          </Button>
        }
      >
        {v ? (
          <div className="grid gap-3">
            <Field label={t("folio.description")}>
              <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} autoFocus />
            </Field>
            <Field label={t("res.room")}>
              <Select value={v.roomId} onChange={(e) => setV({ ...v, roomId: e.target.value })}>
                <option value="">—</option>
                {rooms.data?.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.number}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("hk.where")}>
              <Input value={v.location} onChange={(e) => setV({ ...v, location: e.target.value })} />
            </Field>
            <Field label={t("hk.foundBy")}>
              <Input value={v.foundBy} onChange={(e) => setV({ ...v, foundBy: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}

function Linen() {
  const t = useT();
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ["housekeeping", "linen"], queryFn: () => get<{ id: string; code: string; name: string; par: number; inStore: number; inUse: number; inLaundry: number; damaged: number }[]>("/linen") });
  const [mv, setMv] = useState<{ id: string; name: string; from: string; to: string; qty: string } | null>(null);
  const [add, setAdd] = useState<{ code: string; name: string; par: string; inStore: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["housekeeping", "linen"] });
  const LOC = ["inStore", "inUse", "inLaundry", "damaged"];
  return (
    <Card>
      <CardHeader title={t("hk.linen")} actions={<Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setAdd({ code: "", name: "", par: "0", inStore: "0" })}>{t("common.add")}</Button>} />
      <DataTable
        rows={list.data}
        rowKey={(x) => x.id}
        cols={[
          { key: "n", header: t("common.name"), cell: (x) => `${x.code} · ${x.name}` },
          { key: "par", header: t("hk.par"), cell: (x) => x.par, align: "right" },
          ...LOC.map((l) => ({ key: l, header: t(`hk.loc.${l}`), cell: (x: Record<string, number | string>) => <span className={l === "inStore" && Number(x.inStore) < Number(x.par) * 0.3 ? "text-accent font-semibold" : ""}>{x[l]}</span>, align: "right" as const })),
          { key: "a", header: "", align: "right", cell: (x) => <Button size="xs" onClick={() => setMv({ id: x.id, name: x.name, from: "inStore", to: "inUse", qty: "" })}>{t("hk.move")}</Button> },
        ]}
      />
      <Modal
        open={!!mv}
        onOpenChange={(o) => !o && setMv(null)}
        title={mv?.name ?? ""}
        size="sm"
        footer={
          <Button variant="primary" disabled={!Number(mv?.qty)} onClick={() => post(`/linen/${mv!.id}/move`, { from: mv!.from, to: mv!.to, qty: Number(mv!.qty) }).then(() => (setMv(null), refresh()), errorToast)}>
            {t("common.save")}
          </Button>
        }
      >
        {mv ? (
          <div className="grid grid-cols-3 gap-2">
            <Field label={t("common.from")}>
              <Select value={mv.from} onChange={(e) => setMv({ ...mv, from: e.target.value })}>
                {LOC.map((l) => (
                  <option key={l} value={l}>
                    {t(`hk.loc.${l}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("common.to")}>
              <Select value={mv.to} onChange={(e) => setMv({ ...mv, to: e.target.value })}>
                {LOC.map((l) => (
                  <option key={l} value={l}>
                    {t(`hk.loc.${l}`)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label={t("folio.qty")}>
              <Input inputMode="numeric" value={mv.qty} onChange={(e) => setMv({ ...mv, qty: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Modal>
      <Modal
        open={!!add}
        onOpenChange={(o) => !o && setAdd(null)}
        title={t("hk.linen")}
        size="sm"
        footer={
          <Button variant="primary" disabled={!add?.code || !add.name} onClick={() => post("/linen", { code: add!.code, name: add!.name, par: Number(add!.par) || 0, inStore: Number(add!.inStore) || 0 }).then(() => (setAdd(null), refresh()), errorToast)}>
            {t("common.save")}
          </Button>
        }
      >
        {add ? (
          <div className="grid grid-cols-2 gap-2">
            <Field label={t("common.code")}>
              <Input value={add.code} onChange={(e) => setAdd({ ...add, code: e.target.value })} />
            </Field>
            <Field label={t("common.name")}>
              <Input value={add.name} onChange={(e) => setAdd({ ...add, name: e.target.value })} />
            </Field>
            <Field label={t("hk.par")}>
              <Input value={add.par} onChange={(e) => setAdd({ ...add, par: e.target.value })} />
            </Field>
            <Field label={t("hk.loc.inStore")}>
              <Input value={add.inStore} onChange={(e) => setAdd({ ...add, inStore: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}
