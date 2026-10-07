"use client";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Wand2 } from "lucide-react";
import { del, get, post, put } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fromPoisha, toPoisha, useFmt, useT } from "@/lib/i18n";
import { useRoomTypes, useRooms, type Room, type RoomType } from "@/lib/queries";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, Input, Modal, MoneyInput, PageHeader, Select, StatusBadge, Tabs, Textarea, errorToast, toast, useConfirm } from "@/components/ui";
import { MasterEditor } from "@/components/master-editor";
import { BlockDialog } from "@/components/fd/block-dialog";
import { useTitle } from "@/components/shell/auth-screens";

const BEDS = ["SINGLE", "DOUBLE", "TWIN", "QUEEN", "KING", "TRIPLE"];

export default function RoomsAdminPage() {
  const t = useT();
  const { can } = useSession();
  useTitle(t("nav.rooms"));
  return (
    <div>
      <PageHeader title={t("nav.rooms")} />
      <Tabs
        tabs={[
          { value: "types", label: t("rooms.types"), content: <Types /> },
          { value: "rooms", label: t("rooms.rooms"), content: <Rooms /> },
          { value: "blocks", label: t("rooms.blocks"), content: <Blocks /> },
          {
            value: "amenities",
            label: t("rooms.amenities"),
            content: <MasterEditor path="amenities" title={t("rooms.amenities")} canEdit={can("rooms.manage")} fields={[{ key: "code", label: t("common.code"), type: "code", required: true }, { key: "name", label: t("common.name"), type: "text", required: true }, { key: "nameBn", label: t("common.nameBn"), type: "text" }]} />,
          },
        ]}
      />
    </div>
  );
}

function Types() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const types = useRoomTypes();
  const amen = useQuery({ queryKey: ["masters", "amenities"], queryFn: () => get<{ code: string; name: string }[]>("/amenities") });
  const [e, setE] = useState<(Partial<RoomType> & { rate: string; xa: string; xc: string; xb: string }) | null>(null);
  const openT = (x: RoomType | null) => setE({ ...(x ?? { code: "", name: "", nameBn: "", description: "", baseOccupancy: 2, maxAdults: 2, maxChildren: 1, maxOccupancy: 3, bedType: "DOUBLE", amenities: [], sortOrder: 0, active: true }), rate: x ? fromPoisha(x.baseRate) : "", xa: x ? fromPoisha(x.extraAdultRate) : "0", xc: x ? fromPoisha(x.extraChildRate) : "0", xb: x ? fromPoisha(x.extraBedRate) : "0" });
  const save = async () => {
    if (!e) return;
    const body = { code: e.code, name: e.name, nameBn: e.nameBn ?? "", description: e.description ?? "", baseOccupancy: Number(e.baseOccupancy), maxAdults: Number(e.maxAdults), maxChildren: Number(e.maxChildren), maxOccupancy: Number(e.maxOccupancy), bedType: e.bedType, amenities: e.amenities ?? [], baseRate: toPoisha(e.rate) ?? 0, extraAdultRate: toPoisha(e.xa) ?? 0, extraChildRate: toPoisha(e.xc) ?? 0, extraBedRate: toPoisha(e.xb) ?? 0, sortOrder: Number(e.sortOrder) || 0, active: e.active };
    try {
      if (e.id) await put(`/room-types/${e.id}`, body);
      else await post("/room-types", body);
      toast.success(t("common.saved"));
      setE(null);
      void qc.invalidateQueries({ queryKey: ["room-types"] });
    } catch (err) {
      errorToast(err);
    }
  };
  return (
    <Card>
      <CardHeader title={t("rooms.types")} actions={<Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => openT(null)}>{t("common.add")}</Button>} />
      <DataTable
        rows={types.data}
        rowKey={(x) => x.id}
        onRowClick={(x) => openT(x)}
        cols={[
          { key: "c", header: t("common.code"), cell: (x) => <b>{x.code}</b> },
          { key: "n", header: t("common.name"), cell: (x) => <span>{x.name} {!x.active ? <Badge tone="gray">{t("common.inactive")}</Badge> : null}</span> },
          { key: "b", header: t("rooms.bed"), cell: (x) => t(`bed.${x.bedType}`) },
          { key: "o", header: t("rooms.occupancy"), cell: (x) => `${x.baseOccupancy} / ${x.maxOccupancy}` },
          { key: "r", header: t("rooms.baseRate"), cell: (x) => f.money(x.baseRate), align: "right" },
          { key: "cnt", header: t("rooms.rooms"), cell: (x) => x.roomCount ?? 0, align: "right" },
        ]}
      />
      <Modal
        open={!!e}
        onOpenChange={(o) => !o && setE(null)}
        title={e?.id ? e.name : t("rooms.newType")}
        size="lg"
        footer={
          <>
            {e?.id ? <Button variant="danger" className="mr-auto" onClick={async () => { const c = await confirm({ title: t("common.delete"), danger: true }); if (c.ok) await del(`/room-types/${e.id}`).then(() => (setE(null), qc.invalidateQueries({ queryKey: ["room-types"] })), errorToast); }}>{t("common.delete")}</Button> : null}
            <Button onClick={() => setE(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!e?.code || !e?.name || toPoisha(e?.rate ?? "") === null} onClick={() => void save()}>{t("common.save")}</Button>
          </>
        }
      >
        {e ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Field label={t("common.code")} required><Input value={e.code} onChange={(x) => setE({ ...e, code: x.target.value.toUpperCase() })} /></Field>
            <Field label={t("common.name")} required><Input value={e.name} onChange={(x) => setE({ ...e, name: x.target.value })} /></Field>
            <Field label={t("common.nameBn")}><Input value={e.nameBn} onChange={(x) => setE({ ...e, nameBn: x.target.value })} /></Field>
            <Field label={t("rooms.bed")}><Select value={e.bedType} onChange={(x) => setE({ ...e, bedType: x.target.value })}>{BEDS.map((b) => <option key={b} value={b}>{t(`bed.${b}`)}</option>)}</Select></Field>
            <Field label={t("rooms.baseOcc")}><Input value={e.baseOccupancy} onChange={(x) => setE({ ...e, baseOccupancy: Number(x.target.value) })} /></Field>
            <Field label={t("rooms.maxAdults")}><Input value={e.maxAdults} onChange={(x) => setE({ ...e, maxAdults: Number(x.target.value) })} /></Field>
            <Field label={t("rooms.maxChildren")}><Input value={e.maxChildren} onChange={(x) => setE({ ...e, maxChildren: Number(x.target.value) })} /></Field>
            <Field label={t("rooms.maxOcc")}><Input value={e.maxOccupancy} onChange={(x) => setE({ ...e, maxOccupancy: Number(x.target.value) })} /></Field>
            <Field label={t("rooms.baseRate")} required><MoneyInput value={e.rate} onChange={(v) => setE({ ...e, rate: v })} /></Field>
            <Field label={t("rooms.extraAdult")}><MoneyInput value={e.xa} onChange={(v) => setE({ ...e, xa: v })} /></Field>
            <Field label={t("rooms.extraChild")}><MoneyInput value={e.xc} onChange={(v) => setE({ ...e, xc: v })} /></Field>
            <Field label={t("rooms.extraBed")}><MoneyInput value={e.xb} onChange={(v) => setE({ ...e, xb: v })} /></Field>
            <Field label={t("rooms.amenities")} className="col-span-full">
              <div className="flex flex-wrap gap-3">
                {amen.data?.map((a) => <Checkbox key={a.code} checked={(e.amenities ?? []).includes(a.code)} onChange={(x) => setE({ ...e, amenities: x.target.checked ? [...(e.amenities ?? []), a.code] : (e.amenities ?? []).filter((y) => y !== a.code) })} label={a.name} />)}
              </div>
            </Field>
            <Field label={t("folio.description")} className="col-span-full"><Textarea value={e.description} onChange={(x) => setE({ ...e, description: x.target.value })} className="min-h-12" /></Field>
            <Field label={t("rooms.sortOrder")}><Input value={e.sortOrder} onChange={(x) => setE({ ...e, sortOrder: Number(x.target.value) })} /></Field>
            <Checkbox checked={!!e.active} onChange={(x) => setE({ ...e, active: x.target.checked })} label={t("common.active")} />
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}

function Rooms() {
  const t = useT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const rooms = useRooms();
  const types = useRoomTypes();
  const [e, setE] = useState<(Partial<Room> & { isNew?: boolean }) | null>(null);
  const [gen, setGen] = useState<{ floor: string; firstNumber: string; count: string; roomTypeId: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["rooms"] });
  return (
    <Card>
      <CardHeader
        title={t("rooms.rooms")}
        sub={t("common.count", { n: rooms.data?.length ?? 0 })}
        actions={
          <>
            <Button size="sm" icon={<Wand2 className="size-3.5" />} onClick={() => setGen({ floor: "", firstNumber: "", count: "10", roomTypeId: types.data?.[0]?.id ?? "" })}>{t("rooms.generate")}</Button>
            <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setE({ isNew: true, number: "", floor: "1", roomTypeId: types.data?.[0]?.id, features: "", notes: "", active: true, sortOrder: 0 })}>{t("common.add")}</Button>
          </>
        }
      />
      <DataTable
        rows={rooms.data}
        rowKey={(r) => r.id}
        dense
        onRowClick={(r) => setE(r)}
        cols={[
          { key: "n", header: t("res.room"), cell: (r) => <b>{r.number}</b>, sort: (r) => r.number },
          { key: "f", header: t("setup.floor"), cell: (r) => r.floor, sort: (r) => r.floor },
          { key: "t", header: t("common.type"), cell: (r) => r.roomType?.name },
          { key: "h", header: t("rooms.hk"), cell: (r) => <StatusBadge status={r.hkStatus} /> },
          { key: "ft", header: t("rooms.features"), cell: (r) => <span className="text-xs text-muted">{r.features}</span> },
          { key: "a", header: "", cell: (r) => (!r.active ? <Badge tone="gray">{t("common.inactive")}</Badge> : null) },
        ]}
      />
      <Modal
        open={!!e}
        onOpenChange={(o) => !o && setE(null)}
        title={e?.isNew ? t("rooms.newRoom") : `${t("res.room")} ${e?.number ?? ""}`}
        size="md"
        footer={
          <>
            {!e?.isNew ? <Button variant="danger" className="mr-auto" onClick={async () => { const c = await confirm({ title: t("common.delete"), danger: true }); if (c.ok) await del(`/rooms/${e!.id}`).then(() => (setE(null), refresh()), errorToast); }}>{t("common.delete")}</Button> : null}
            <Button
              variant="primary"
              disabled={!e?.number || !e?.roomTypeId}
              onClick={async () => {
                const body = { number: e!.number, floor: e!.floor, roomTypeId: e!.roomTypeId, features: e!.features ?? "", notes: e!.notes ?? "", active: e!.active ?? true, sortOrder: Number(e!.sortOrder) || 0 };
                try {
                  if (e!.isNew) await post("/rooms", body);
                  else await put(`/rooms/${e!.id}`, { ...body, version: e!.version });
                  toast.success(t("common.saved"));
                  setE(null);
                  refresh();
                } catch (err) {
                  errorToast(err);
                }
              }}
            >
              {t("common.save")}
            </Button>
          </>
        }
      >
        {e ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("res.room")} required><Input value={e.number} onChange={(x) => setE({ ...e, number: x.target.value })} /></Field>
            <Field label={t("setup.floor")}><Input value={e.floor} onChange={(x) => setE({ ...e, floor: x.target.value })} /></Field>
            <Field label={t("common.type")} className="col-span-2"><Select value={e.roomTypeId} onChange={(x) => setE({ ...e, roomTypeId: x.target.value })}>{types.data?.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}</Select></Field>
            <Field label={t("rooms.features")} className="col-span-2"><Input value={e.features} onChange={(x) => setE({ ...e, features: x.target.value })} /></Field>
            <Field label={t("common.notes")} className="col-span-2"><Textarea value={e.notes} onChange={(x) => setE({ ...e, notes: x.target.value })} /></Field>
            <Checkbox checked={!!e.active} onChange={(x) => setE({ ...e, active: x.target.checked })} label={t("common.active")} />
          </div>
        ) : null}
      </Modal>
      <Modal
        open={!!gen}
        onOpenChange={(o) => !o && setGen(null)}
        title={t("rooms.generate")}
        size="sm"
        footer={<Button variant="primary" disabled={!gen?.floor || !gen?.firstNumber} onClick={() => post<{ created: number }>("/rooms/generate", { floor: gen!.floor, firstNumber: Number(gen!.firstNumber), count: Number(gen!.count), roomTypeId: gen!.roomTypeId }).then((r) => (toast.success(t("rooms.generated", { n: r.created })), setGen(null), refresh()), errorToast)}>{t("rooms.generate")}</Button>}
      >
        {gen ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("setup.floor")}><Input value={gen.floor} onChange={(x) => setGen({ ...gen, floor: x.target.value })} /></Field>
            <Field label={t("setup.firstRoom")}><Input value={gen.firstNumber} onChange={(x) => setGen({ ...gen, firstNumber: x.target.value })} /></Field>
            <Field label={t("setup.roomCount")}><Input value={gen.count} onChange={(x) => setGen({ ...gen, count: x.target.value })} /></Field>
            <Field label={t("common.type")}><Select value={gen.roomTypeId} onChange={(x) => setGen({ ...gen, roomTypeId: x.target.value })}>{types.data?.map((ty) => <option key={ty.id} value={ty.id}>{ty.name}</option>)}</Select></Field>
          </div>
        ) : null}
      </Modal>
    </Card>
  );
}

function Blocks() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const rooms = useRooms();
  const { businessDate, can } = useSession();
  const list = useQuery({ queryKey: ["rooms", "blocks"], queryFn: () => get<{ id: string; type: string; startDate: string; endDate: string; reason: string; room: { number: string } }[]>("/blocks") });
  const [room, setRoom] = useState<{ id: string; number: string } | null>(null);
  const [pick, setPick] = useState("");
  return (
    <Card>
      <CardHeader
        title={t("rooms.blocks")}
        actions={
          can("rooms.block") ? (
            <>
              <Select value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 w-32">
                <option value="">{t("res.room")}…</option>
                {rooms.data?.map((r) => <option key={r.id} value={r.id}>{r.number}</option>)}
              </Select>
              <Button size="sm" variant="primary" disabled={!pick} onClick={() => setRoom({ id: pick, number: rooms.data?.find((r) => r.id === pick)?.number ?? "" })}>{t("rooms.block")}</Button>
            </>
          ) : null
        }
      />
      <DataTable
        rows={list.data}
        rowKey={(b) => b.id}
        cols={[
          { key: "r", header: t("res.room"), cell: (b) => <b>{b.room.number}</b> },
          { key: "t", header: t("common.type"), cell: (b) => t(`blockType.${b.type}`) },
          { key: "d", header: t("res.dates"), cell: (b) => `${f.date(b.startDate)} – ${f.date(b.endDate)}` },
          { key: "re", header: t("common.reason"), cell: (b) => b.reason },
          { key: "a", header: "", align: "right", cell: (b) => (can("rooms.block") ? <Button size="xs" onClick={() => post(`/blocks/${b.id}/release`).then(() => qc.invalidateQueries({ queryKey: ["rooms"] }), errorToast)}>{t("rooms.release")}</Button> : null) },
        ]}
      />
      <BlockDialog room={room} businessDate={businessDate} onClose={() => (setRoom(null), void qc.invalidateQueries({ queryKey: ["rooms"] }))} />
    </Card>
  );
}
