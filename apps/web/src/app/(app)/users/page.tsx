"use client";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { KeyRound, Lock, Plus, ShieldAlert, Unlock } from "lucide-react";
import { del, get, patch, post, put } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useLocale, useT } from "@/lib/i18n";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, Tabs, cn, errorToast, toast, useConfirm } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface U {
  id: string;
  username: string;
  fullName: string;
  email: string;
  phone: string;
  roleId: string;
  role: { id: string; code: string; name: string; nameBn: string };
  active: boolean;
  locale: string;
  discountLimitBp: number;
  lastLoginAt: string | null;
  locked: boolean;
  hasPin: boolean;
  isDemo: boolean;
}
interface Role {
  id: string;
  code: string;
  name: string;
  nameBn: string;
  builtin: boolean;
  users: number;
  permissions: string[];
}
interface Perm {
  code: string;
  module: string;
  label: string;
  sensitive?: boolean;
}

export default function UsersPage() {
  const t = useT();
  const { can } = useSession();
  useTitle(t("nav.users"));
  return (
    <div>
      <PageHeader title={t("nav.users")} />
      <Tabs
        tabs={[
          { value: "users", label: t("users.users"), content: <Users /> },
          { value: "roles", label: t("users.roles"), content: <Roles />, hidden: !can("users.roles", "users.view") },
          { value: "sessions", label: t("users.sessions"), content: <Sessions />, hidden: !can("users.manage", "users.view") },
        ]}
      />
    </div>
  );
}

function useRoles() {
  return useQuery({ queryKey: ["roles"], queryFn: () => get<{ roles: Role[]; catalogue: Perm[] }>("/roles") });
}

function Users() {
  const t = useT();
  const f = useFmt();
  const locale = useLocale();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const list = useQuery({ queryKey: ["users"], queryFn: () => get<U[]>("/users") });
  const roles = useRoles();
  const [e, setE] = useState<(Partial<U> & { limit: string }) | null>(null);
  const [temp, setTemp] = useState<{ username: string; password: string } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["users"] });
  const save = async () => {
    if (!e) return;
    const body = { username: e.username, fullName: e.fullName, email: e.email ?? "", phone: e.phone ?? "", roleId: e.roleId, locale: e.locale ?? "en", discountLimitBp: Math.round((Number(e.limit) || 0) * 100), active: e.active ?? true };
    try {
      if (e.id) await patch(`/users/${e.id}`, body);
      else {
        const r = await post<{ temporaryPassword: string }>("/users", body);
        setTemp({ username: body.username!, password: r.temporaryPassword });
      }
      toast.success(t("common.saved"));
      setE(null);
      refresh();
    } catch (err) {
      errorToast(err);
    }
  };
  return (
    <Card>
      <CardHeader title={t("users.users")} actions={can("users.manage") ? <Button size="sm" variant="primary" icon={<Plus className="size-3.5" />} onClick={() => setE({ username: "", fullName: "", roleId: roles.data?.roles.find((r) => r.code === "RECEPTIONIST")?.id, locale: "en", active: true, limit: "10" })}>{t("users.new")}</Button> : null} />
      <DataTable
        rows={list.data}
        rowKey={(u) => u.id}
        onRowClick={can("users.manage") ? (u) => setE({ ...u, limit: String(u.discountLimitBp / 100) }) : undefined}
        cols={[
          { key: "n", header: t("users.fullName"), cell: (u) => <span className="font-medium">{u.fullName} {u.isDemo ? <Badge tone="blue">DEMO</Badge> : null}</span>, sort: (u) => u.fullName },
          { key: "u", header: t("auth.username"), cell: (u) => u.username },
          { key: "r", header: t("users.role"), cell: (u) => (locale === "bn" && u.role.nameBn ? u.role.nameBn : u.role.name), sort: (u) => u.role.name },
          { key: "pin", header: "PIN", cell: (u) => (u.hasPin ? "✓" : "—"), align: "center" },
          { key: "l", header: t("users.lastLogin"), cell: (u) => f.dateTime(u.lastLoginAt) },
          { key: "s", header: t("common.status"), cell: (u) => (!u.active ? <Badge tone="gray">{t("common.inactive")}</Badge> : u.locked ? <Badge tone="red">{t("users.locked")}</Badge> : <Badge tone="green">{t("common.active")}</Badge>) },
          {
            key: "a",
            header: "",
            align: "right",
            cell: (u) =>
              can("users.manage") ? (
                <div className="flex justify-end gap-1" onClick={(ev) => ev.stopPropagation()}>
                  {u.locked ? <Button size="xs" icon={<Unlock className="size-3" />} onClick={() => post(`/users/${u.id}/unlock`).then(refresh, errorToast)}>{t("users.unlock")}</Button> : null}
                  <Button
                    size="xs"
                    icon={<KeyRound className="size-3" />}
                    onClick={async () => {
                      const c = await confirm({ title: t("users.resetPassword"), message: t("users.resetConfirm", { name: u.fullName }) });
                      if (!c.ok) return;
                      try {
                        const r = await post<{ temporaryPassword: string }>(`/users/${u.id}/reset-password`);
                        setTemp({ username: u.username, password: r.temporaryPassword });
                      } catch (err) {
                        errorToast(err);
                      }
                    }}
                  >
                    {t("users.reset")}
                  </Button>
                </div>
              ) : null,
          },
        ]}
      />
      <Modal
        open={!!e}
        onOpenChange={(o) => !o && setE(null)}
        title={e?.id ? e.fullName : t("users.new")}
        size="md"
        footer={
          <>
            {e?.id ? <Button variant="danger" className="mr-auto" onClick={async () => { const c = await confirm({ title: t("common.delete"), message: e.fullName, danger: true }); if (c.ok) await del(`/users/${e.id}`).then(() => (setE(null), refresh()), errorToast); }}>{t("common.delete")}</Button> : null}
            <Button onClick={() => setE(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!e?.username || !e?.fullName || !e?.roleId} onClick={() => void save()}>{t("common.save")}</Button>
          </>
        }
      >
        {e ? (
          <div className="grid grid-cols-2 gap-3">
            <Field label={t("users.fullName")} required><Input value={e.fullName} onChange={(x) => setE({ ...e, fullName: x.target.value })} /></Field>
            <Field label={t("auth.username")} required><Input value={e.username} disabled={!!e.id} onChange={(x) => setE({ ...e, username: x.target.value.toLowerCase() })} /></Field>
            <Field label={t("users.role")} required>
              <Select value={e.roleId} onChange={(x) => setE({ ...e, roleId: x.target.value })}>
                {roles.data?.roles.map((r) => <option key={r.id} value={r.id}>{locale === "bn" && r.nameBn ? r.nameBn : r.name}</option>)}
              </Select>
            </Field>
            <Field label={t("prefs.language")}>
              <Select value={e.locale} onChange={(x) => setE({ ...e, locale: x.target.value })}><option value="en">English</option><option value="bn">বাংলা</option></Select>
            </Field>
            <Field label={t("common.phone")}><Input value={e.phone} onChange={(x) => setE({ ...e, phone: x.target.value })} /></Field>
            <Field label={t("common.email")}><Input value={e.email} onChange={(x) => setE({ ...e, email: x.target.value })} /></Field>
            <Field label={t("users.discountLimit")} hint={t("users.discountLimitHint")}><Input value={e.limit} onChange={(x) => setE({ ...e, limit: x.target.value })} /></Field>
            <Checkbox checked={!!e.active} onChange={(x) => setE({ ...e, active: x.target.checked })} label={t("common.active")} />
          </div>
        ) : null}
      </Modal>
      <Modal open={!!temp} onOpenChange={(o) => !o && setTemp(null)} title={t("users.tempPassword")} size="sm" footer={<Button variant="primary" onClick={() => setTemp(null)}>{t("common.done")}</Button>}>
        <div className="space-y-2 text-sm">
          <p className="flex gap-2"><ShieldAlert className="size-4 text-accent shrink-0" />{t("users.tempPasswordHint")}</p>
          <p>{t("auth.username")}: <b>{temp?.username}</b></p>
          <p className="text-lg">{t("auth.password")}: <code className="font-mono font-bold">{temp?.password}</code></p>
        </div>
      </Modal>
    </Card>
  );
}

function Roles() {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const r = useRoles();
  const [sel, setSel] = useState("");
  const [draft, setDraft] = useState<string[] | null>(null);
  const [create, setCreate] = useState<{ code: string; name: string; nameBn: string; copyFromRoleId: string } | null>(null);
  const role = r.data?.roles.find((x) => x.id === (sel || r.data?.roles[0]?.id));
  const perms = draft ?? role?.permissions ?? [];
  const modules = useMemo(() => [...new Set((r.data?.catalogue ?? []).map((p) => p.module))], [r.data]);
  const editable = can("users.roles") && role?.code !== "SUPER_ADMIN";
  const refresh = () => void qc.invalidateQueries({ queryKey: ["roles"] });
  return (
    <div className="grid lg:grid-cols-[240px_1fr] gap-4">
      <Card className="p-2 h-fit">
        {r.data?.roles.map((x) => (
          <button key={x.id} onClick={() => (setSel(x.id), setDraft(null))} className={cn("w-full text-left rounded px-2 py-1.5 text-sm flex justify-between", role?.id === x.id ? "bg-surface-2 font-semibold" : "hover:bg-surface-2")}>
            <span>{locale === "bn" && x.nameBn ? x.nameBn : x.name}</span>
            <span className="text-xs text-muted">{x.users}</span>
          </button>
        ))}
        {can("users.roles") ? <Button size="sm" className="w-full mt-2" icon={<Plus className="size-3.5" />} onClick={() => setCreate({ code: "", name: "", nameBn: "", copyFromRoleId: role?.id ?? "" })}>{t("users.newRole")}</Button> : null}
      </Card>
      {role ? (
        <Card>
          <CardHeader
            title={locale === "bn" && role.nameBn ? role.nameBn : role.name}
            sub={role.code === "SUPER_ADMIN" ? t("users.superAdminFixed") : t("users.permCount", { n: perms.length })}
            actions={
              editable ? (
                <>
                  {role.builtin ? <Button size="sm" onClick={async () => { const c = await confirm({ title: t("users.resetRole"), danger: true }); if (c.ok) await post(`/roles/${role.id}/reset`).then(() => (setDraft(null), refresh()), errorToast); }}>{t("users.resetRole")}</Button> : <Button size="sm" variant="danger" onClick={async () => { const c = await confirm({ title: t("common.delete"), danger: true }); if (c.ok) await del(`/roles/${role.id}`).then(() => (setSel(""), refresh()), errorToast); }}>{t("common.delete")}</Button>}
                  <Button size="sm" variant="primary" disabled={!draft} onClick={() => put(`/roles/${role.id}/permissions`, { permissions: perms }).then(() => (toast.success(t("common.saved")), setDraft(null), refresh()), errorToast)}>{t("common.save")}</Button>
                </>
              ) : null
            }
          />
          <div className="p-4 grid md:grid-cols-2 xl:grid-cols-3 gap-4">
            {modules.map((m) => (
              <div key={m}>
                <p className="text-xs font-semibold uppercase text-muted mb-1">{t(`perm.module.${m}`)}</p>
                {r.data!.catalogue.filter((p) => p.module === m).map((p) => (
                  <Checkbox
                    key={p.code}
                    className="flex py-0.5"
                    disabled={!editable}
                    checked={perms.includes(p.code)}
                    onChange={(e) => setDraft(e.target.checked ? [...perms, p.code] : perms.filter((x) => x !== p.code))}
                    label={<span className={cn("text-xs", p.sensitive && "text-accent")} title={p.code}>{p.label}{p.sensitive ? " ⚠" : ""}</span>}
                  />
                ))}
              </div>
            ))}
          </div>
          <p className="px-4 pb-3 text-xs text-muted">{t("users.sensitiveNote")}</p>
        </Card>
      ) : null}
      <Modal open={!!create} onOpenChange={(o) => !o && setCreate(null)} title={t("users.newRole")} size="sm" footer={<Button variant="primary" disabled={!create?.code || !create?.name} onClick={() => post<{ id: string }>("/roles", { ...create, copyFromRoleId: create!.copyFromRoleId || undefined }).then((x) => (setCreate(null), setSel(x.id), refresh()), errorToast)}>{t("common.create")}</Button>}>
        {create ? (
          <div className="grid gap-3">
            <Field label={t("common.code")}><Input value={create.code} onChange={(e) => setCreate({ ...create, code: e.target.value.toUpperCase() })} /></Field>
            <Field label={t("common.name")}><Input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} /></Field>
            <Field label={t("common.nameBn")}><Input value={create.nameBn} onChange={(e) => setCreate({ ...create, nameBn: e.target.value })} /></Field>
            <Field label={t("users.copyFrom")}><Select value={create.copyFromRoleId} onChange={(e) => setCreate({ ...create, copyFromRoleId: e.target.value })}><option value="">—</option>{r.data?.roles.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function Sessions() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const { can } = useSession();
  const q = useQuery({ queryKey: ["sessions"], queryFn: () => get<{ sessions: { id: string; user: { fullName: string; username: string }; terminalId: string; windowId: string; ip: string; deviceLabel: string; createdAt: string; lastSeenAt: string; current: boolean }[]; terminals: number; maxTerminals: number }>("/sessions"), refetchInterval: 30_000 });
  return (
    <Card>
      <CardHeader title={t("users.sessions")} sub={q.data ? t("users.terminalsUsed", { n: q.data.terminals, max: q.data.maxTerminals }) : undefined} />
      <DataTable
        rows={q.data?.sessions}
        rowKey={(s) => s.id}
        cols={[
          { key: "u", header: t("users.fullName"), cell: (s) => <span>{s.user?.fullName} {s.current ? <Badge tone="green">{t("users.thisWindow")}</Badge> : null}</span> },
          { key: "t", header: t("users.terminal"), cell: (s) => <span className="text-xs">{s.terminalId}</span> },
          { key: "ip", header: "IP", cell: (s) => s.ip },
          { key: "d", header: t("users.device"), cell: (s) => <span className="text-xs text-muted truncate max-w-48 inline-block">{s.deviceLabel}</span> },
          { key: "c", header: t("users.since"), cell: (s) => f.dateTime(s.createdAt) },
          { key: "l", header: t("users.lastSeen"), cell: (s) => f.dateTime(s.lastSeenAt) },
          { key: "a", header: "", align: "right", cell: (s) => (can("users.manage") && !s.current ? <Button size="xs" icon={<Lock className="size-3" />} onClick={() => del(`/sessions/${s.id}`).then(() => qc.invalidateQueries({ queryKey: ["sessions"] }), errorToast)}>{t("users.signOut")}</Button> : null) },
        ]}
      />
    </Card>
  );
}
