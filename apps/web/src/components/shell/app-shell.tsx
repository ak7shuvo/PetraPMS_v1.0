"use client";
// Application frame: sidebar (filtered by permissions & licensed modules), header with the window's user chip
// (user · role · business date), Ctrl+K search, pop-out, preferences, offline / read-only banners.
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import {
  BarChart3, BedDouble, BookOpen, Building2, CalendarRange, ClipboardList, ConciergeBell, Database, ExternalLink, FileText, Gauge, KeyRound, LayoutGrid, Lock, LogOut, Menu as MenuIcon, Moon, Receipt, Search, Settings, ShieldCheck, Sparkles, Users, Wallet, Wrench, Landmark, PanelsTopLeft,
} from "lucide-react";
import { get, patch, post } from "@/lib/api";
import { useSession, type SessionUser } from "@/lib/session";
import { useFmt, useT } from "@/lib/i18n";
import { useOnline } from "@/lib/realtime";
import { Button, Field, Input, Kbd, Menu, Modal, Select, Switch, Tabs, cn, errorToast, toast, useDebounced } from "../ui";
import { ChangePasswordForm } from "./auth-screens";
import { Logo } from "./splash";

export interface NavItem {
  href: string;
  key: string;
  icon: React.ComponentType<{ className?: string }>;
  perms: string[];
  module?: string;
  group: "front" | "ops" | "finance" | "admin";
}

export const NAV: NavItem[] = [
  { href: "/dashboard", key: "nav.dashboard", icon: Gauge, perms: ["dashboard.view"], group: "front" },
  { href: "/frontdesk", key: "nav.frontdesk", icon: ConciergeBell, perms: ["frontdesk.checkin", "frontdesk.checkout"], group: "front" },
  { href: "/rack", key: "nav.rack", icon: LayoutGrid, perms: ["rooms.view"], group: "front" },
  { href: "/tape-chart", key: "nav.tapeChart", icon: CalendarRange, perms: ["rooms.view", "reservations.view"], group: "front" },
  { href: "/reservations", key: "nav.reservations", icon: BookOpen, perms: ["reservations.view"], group: "front" },
  { href: "/guests", key: "nav.guests", icon: Users, perms: ["guests.view"], group: "front" },
  { href: "/housekeeping", key: "nav.housekeeping", icon: Sparkles, perms: ["housekeeping.view"], module: "housekeeping", group: "ops" },
  { href: "/maintenance", key: "nav.maintenance", icon: Wrench, perms: ["maintenance.view", "maintenance.create"], module: "maintenance", group: "ops" },
  { href: "/folios", key: "nav.folios", icon: Receipt, perms: ["folio.view"], group: "finance" },
  { href: "/ledger", key: "nav.ledger", icon: Landmark, perms: ["ledger.view"], module: "cityledger", group: "finance" },
  { href: "/companies", key: "nav.companies", icon: Building2, perms: ["guests.companies"], group: "finance" },
  { href: "/night-audit", key: "nav.nightAudit", icon: Moon, perms: ["nightaudit.run"], group: "finance" },
  { href: "/reports", key: "nav.reports", icon: BarChart3, perms: ["reports.view", "reports.financial"], module: "reports", group: "finance" },
  { href: "/rates", key: "nav.rates", icon: Wallet, perms: ["rates.view"], group: "admin" },
  { href: "/rooms", key: "nav.rooms", icon: BedDouble, perms: ["rooms.manage"], group: "admin" },
  { href: "/data", key: "nav.data", icon: Database, perms: ["data.import", "data.export", "data.backup"], group: "admin" },
  { href: "/users", key: "nav.users", icon: ShieldCheck, perms: ["users.view", "users.manage"], group: "admin" },
  { href: "/audit", key: "nav.audit", icon: ClipboardList, perms: ["audit.view"], group: "admin" },
  { href: "/settings", key: "nav.settings", icon: Settings, perms: ["settings.view", "settings.manage", "license.manage"], group: "admin" },
];

export function useNav() {
  const { can } = useSession();
  const me = useQuery({ queryKey: ["me-modules"], queryFn: () => get<{ license: { modules: string[] } }>("/auth/me"), staleTime: 300_000 });
  const modules = me.data?.license.modules;
  return NAV.filter((n) => can(...n.perms) && (!n.module || !modules || modules.includes(n.module)));
}

function UserChip() {
  const t = useT();
  const f = useFmt();
  const { user, businessDate } = useSession();
  if (!user) return null;
  return (
    <div className="hidden md:flex items-center gap-2 rounded-md border border-line bg-surface px-2.5 py-1 text-xs" title={t("shell.windowUser")}>
      <span className="font-semibold">{user.fullName}</span>
      <span className="text-muted">·</span>
      <span className="text-muted">{user.locale === "bn" && user.roleNameBn ? user.roleNameBn : user.roleName}</span>
      <span className="text-muted">·</span>
      <span className="font-semibold text-accent num">{f.date(businessDate, "DD MMM YYYY")}</span>
    </div>
  );
}

function Preferences({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { user, setUser } = useSession();
  const [pinPw, setPinPw] = useState("");
  const [pin, setPin] = useState("");
  if (!user) return null;
  const save = async (p: Partial<Pick<SessionUser, "locale" | "banglaDigits" | "uiScale" | "theme">>) => {
    try {
      setUser(await patch<SessionUser>("/auth/preferences", p));
    } catch (e) {
      errorToast(e);
    }
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("prefs.title")} size="md">
      <Tabs
        tabs={[
          {
            value: "display",
            label: t("prefs.display"),
            content: (
              <div className="grid gap-4">
                <Field label={t("prefs.language")}>
                  <Select value={user.locale} onChange={(e) => void save({ locale: e.target.value as "en" | "bn" })}>
                    <option value="en">English</option>
                    <option value="bn">বাংলা</option>
                  </Select>
                </Field>
                <Switch checked={user.banglaDigits} onChange={(v) => void save({ banglaDigits: v })} label={t("prefs.banglaDigits")} />
                <Field label={t("prefs.theme")}>
                  <Select value={user.theme} onChange={(e) => void save({ theme: e.target.value as SessionUser["theme"] })}>
                    <option value="light">{t("prefs.light")}</option>
                    <option value="dark">{t("prefs.dark")}</option>
                    <option value="system">{t("prefs.system")}</option>
                  </Select>
                </Field>
                <Field label={`${t("prefs.scale")}: ${user.uiScale}%`}>
                  <input type="range" min={90} max={150} step={10} value={user.uiScale} onChange={(e) => void save({ uiScale: Number(e.target.value) })} className="accent-[var(--accent)]" />
                </Field>
              </div>
            ),
          },
          { value: "password", label: t("auth.changePassword"), content: <ChangePasswordForm onDone={() => onOpenChange(false)} /> },
          {
            value: "pin",
            label: t("prefs.pin"),
            content: (
              <form
                className="grid gap-3"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await post("/auth/pin/set", { password: pinPw, pin });
                    toast.success(pin ? t("prefs.pinSet") : t("prefs.pinRemoved"));
                    setPin("");
                    setPinPw("");
                  } catch (err) {
                    errorToast(err);
                  }
                }}
              >
                <p className="text-sm text-muted">{t("prefs.pinHelp")}</p>
                <Field label={t("auth.currentPassword")}>
                  <Input type="password" value={pinPw} onChange={(e) => setPinPw(e.target.value)} />
                </Field>
                <Field label={t("prefs.newPin")} hint={t("prefs.pinBlank")}>
                  <Input inputMode="numeric" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))} />
                </Field>
                <Button type="submit" variant="primary" disabled={!pinPw}>
                  {t("common.save")}
                </Button>
              </form>
            ),
          },
        ]}
      />
    </Modal>
  );
}

/** Ctrl+K: jump to modules, reservations, guests and rooms. */
function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const nav = useNav();
  const router = useRouter();
  const { can } = useSession();
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 250);
  const search = useQuery({
    queryKey: ["palette", dq],
    enabled: open && dq.trim().length >= 2,
    queryFn: async () => {
      const [res, guests] = await Promise.all([
        can("reservations.view") ? get<{ rows: { id: string; confirmationNo: string; guest: { fullName: string }; arrivalDate: string; status: string; rooms: { room: string | null }[] }[] }>(`/reservations?take=8&order=desc&q=${encodeURIComponent(dq)}`) : Promise.resolve({ rows: [] }),
        can("guests.view") ? get<{ rows: { id: string; fullName: string; phone: string; code: string }[] }>(`/guests?take=6&q=${encodeURIComponent(dq)}`) : Promise.resolve({ rows: [] }),
      ]);
      return { res: res.rows, guests: guests.rows };
    },
  });
  const go = (href: string) => {
    onOpenChange(false);
    setQ("");
    router.push(href);
  };
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={t("shell.search")} size="md">
      <Command shouldFilter={false} className="text-sm">
        <Command.Input value={q} onValueChange={setQ} placeholder={t("shell.searchPlaceholder")} className="w-full h-10 rounded-md border border-line bg-surface px-3 mb-3 focus:outline-none focus:border-accent" autoFocus />
        <Command.List className="max-h-[50vh] overflow-auto">
          <Command.Empty className="py-6 text-center text-muted">{t("common.noResults")}</Command.Empty>
          {search.data?.res.length ? (
            <Command.Group heading={t("nav.reservations")} className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
              {search.data.res.map((r) => (
                <Command.Item key={r.id} value={`res-${r.id}`} onSelect={() => go(`/reservations/${r.id}`)} className="flex justify-between gap-2 rounded px-2 py-2 text-fg cursor-pointer data-[selected=true]:bg-surface-2">
                  <span>
                    <b>{r.confirmationNo}</b> · {r.guest.fullName}
                  </span>
                  <span className="text-muted text-xs">
                    {r.rooms.map((x) => x.room).filter(Boolean).join(", ")} {r.arrivalDate}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          {search.data?.guests.length ? (
            <Command.Group heading={t("nav.guests")} className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
              {search.data.guests.map((g) => (
                <Command.Item key={g.id} value={`g-${g.id}`} onSelect={() => go(`/guests/${g.id}`)} className="flex justify-between rounded px-2 py-2 text-fg cursor-pointer data-[selected=true]:bg-surface-2">
                  <span>{g.fullName}</span>
                  <span className="text-muted text-xs">{g.phone || g.code}</span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
          <Command.Group heading={t("shell.goTo")} className="text-xs text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1">
            {nav
              .filter((n) => !q || t(n.key).toLowerCase().includes(q.toLowerCase()))
              .map((n) => (
                <Command.Item key={n.href} value={n.href} onSelect={() => go(n.href)} className="flex items-center gap-2 rounded px-2 py-2 text-fg cursor-pointer data-[selected=true]:bg-surface-2">
                  <n.icon className="size-4 text-muted" />
                  {t(n.key)}
                </Command.Item>
              ))}
            {can("reservations.create") ? (
              <Command.Item value="new-res" onSelect={() => go("/reservations/new")} className="flex items-center gap-2 rounded px-2 py-2 text-fg cursor-pointer data-[selected=true]:bg-surface-2">
                <FileText className="size-4 text-muted" /> {t("res.new")}
              </Command.Item>
            ) : null}
          </Command.Group>
        </Command.List>
      </Command>
    </Modal>
  );
}

function popOut(path: string) {
  const url = `${path}${path.includes("?") ? "&" : "?"}pop=1`;
  if (window.petra?.openWindow) void window.petra.openWindow(url);
  else window.open(url, "_blank", "popup,width=1280,height=860");
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const t = useT();
  const nav = useNav();
  const pathname = usePathname();
  const router = useRouter();
  const online = useOnline();
  const { user, status, logout } = useSession();
  const [palette, setPalette] = useState(false);
  const [prefs, setPrefs] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [compact, setCompact] = useState(false);
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    setCompact(new URLSearchParams(location.search).get("pop") === "1");
    setDesktop(!!window.petra?.openWorkspace);
  }, [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette(true);
      } else if (e.altKey && !mod) {
        const map: Record<string, string> = { d: "/dashboard", f: "/frontdesk", r: "/rack", t: "/tape-chart", n: "/reservations/new", g: "/guests", h: "/housekeeping", b: "/folios" };
        const href = map[e.key.toLowerCase()];
        if (href && nav.some((n) => href.startsWith(n.href) || (href === "/reservations/new" && n.href === "/reservations"))) {
          e.preventDefault();
          router.push(href);
        }
      } else if (e.key === "F1") {
        e.preventDefault();
        setPalette(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [nav, router]);

  const groups = useMemo(() => (["front", "ops", "finance", "admin"] as const).map((g) => ({ g, items: nav.filter((n) => n.group === g) })).filter((x) => x.items.length), [nav]);
  const lic = status?.license;
  const sidebar = (
    <nav className="flex flex-col h-full">
      <div className="px-4 h-14 flex items-center border-b border-white/10">
        <Logo size={24} name={status?.branding?.appName || "PetraPMS"} />
      </div>
      <div className="flex-1 overflow-y-auto py-3">
        {groups.map(({ g, items }) => (
          <div key={g} className="mb-3">
            <p className="px-4 mb-1 text-[10px] uppercase tracking-wider opacity-40">{t(`nav.group.${g}`)}</p>
            {items.map((n) => {
              const active = pathname === n.href || pathname.startsWith(n.href + "/");
              return (
                <Link key={n.href} href={n.href} onClick={() => setMobile(false)} className={cn("flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded-md text-sm transition", active ? "bg-white/10 text-white font-semibold" : "opacity-75 hover:opacity-100 hover:bg-white/5")}>
                  <n.icon className={cn("size-4", active && "text-[var(--petra-red)]")} />
                  {t(n.key)}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-white/10 text-[10px] opacity-50">
        {status?.hotel?.name} · v{status?.version}
      </div>
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-bg">
      {!compact ? <aside className="hidden lg:block w-56 shrink-0 bg-sidebar text-sidebar-fg sticky top-0 h-screen no-print">{sidebar}</aside> : null}
      {mobile ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/50" onClick={() => setMobile(false)} />
          <aside className="absolute left-0 top-0 bottom-0 w-64 bg-sidebar text-sidebar-fg">{sidebar}</aside>
        </div>
      ) : null}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-14 sticky top-0 z-30 flex items-center gap-2 px-3 sm:px-4 border-b border-line bg-surface/95 backdrop-blur no-print">
          {!compact ? (
            <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setMobile(true)} aria-label="Menu">
              <MenuIcon className="size-5" />
            </Button>
          ) : (
            <Logo size={20} name="" />
          )}
          <button onClick={() => setPalette(true)} className="flex items-center gap-2 h-9 min-w-0 flex-1 max-w-md rounded-md border border-line bg-surface-2 px-3 text-sm text-muted hover:border-accent">
            <Search className="size-4 shrink-0" />
            <span className="truncate">{t("shell.searchPlaceholder")}</span>
            <span className="ml-auto hidden sm:flex gap-0.5">
              <Kbd>Ctrl</Kbd>
              <Kbd>K</Kbd>
            </span>
          </button>
          <div className="flex-1" />
          <UserChip />
          <Button variant="ghost" size="sm" title={t("shell.popOut")} onClick={() => popOut(location.pathname + location.search.replace(/[?&]pop=1/, ""))} className="hidden sm:inline-flex">
            <ExternalLink className="size-4" />
          </Button>
          {desktop ? (
            <Button variant="ghost" size="sm" title={t("shell.workspaces")} onClick={() => router.push("/settings?tab=workspaces")} className="hidden sm:inline-flex">
              <PanelsTopLeft className="size-4" />
            </Button>
          ) : null}
          <Menu
            trigger={
              <Button variant="outline" size="sm" className="gap-1.5">
                <span className="grid place-items-center size-6 rounded-full bg-[var(--petra-black)] text-white text-[11px] font-bold">{user?.fullName.slice(0, 1).toUpperCase()}</span>
              </Button>
            }
            items={[
              { label: <span className="text-xs text-muted">{user?.fullName} ({user?.username})</span>, onSelect: () => undefined, disabled: true },
              "sep",
              { label: t("prefs.title"), icon: <Settings className="size-4" />, onSelect: () => setPrefs(true) },
              { label: t("shell.lock"), icon: <Lock className="size-4" />, onSelect: () => window.dispatchEvent(new Event("petra:lock")) },
              { label: t("auth.switchUser"), icon: <KeyRound className="size-4" />, onSelect: () => window.dispatchEvent(new Event("petra:lock")) },
              "sep",
              { label: t("auth.signOut"), icon: <LogOut className="size-4" />, danger: true, onSelect: () => void logout() },
            ]}
          />
        </header>
        {!online ? <div className="bg-[var(--st-vacant-dirty)] text-white text-sm px-4 py-1.5 no-print">{t("shell.offline")}</div> : null}
        {lic?.readOnly ? (
          <div className="bg-accent text-white text-sm px-4 py-1.5 flex items-center gap-3 no-print">
            <span className="flex-1">{lic.warnings[0] ?? t("shell.readOnly")}</span>
            <Link href="/settings?tab=license" className="underline font-semibold">
              {t("shell.activate")}
            </Link>
          </div>
        ) : lic?.warnings?.length ? (
          <div className="bg-[var(--petra-black)] text-white text-xs px-4 py-1 no-print">{lic.warnings.join(" · ")}</div>
        ) : null}
        <main className="flex-1 p-3 sm:p-5 min-w-0">{children}</main>
      </div>
      <CommandPalette open={palette} onOpenChange={setPalette} />
      <Preferences open={prefs} onOpenChange={setPrefs} />
    </div>
  );
}

