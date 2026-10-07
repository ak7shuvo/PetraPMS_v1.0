"use client";
// Sign-in (password or quick PIN), lock screen, forced password change.
import React, { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Lock, LogIn, UserRound } from "lucide-react";
import { get, post, ApiClientError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useT, useLocale } from "@/lib/i18n";
import { Button, Card, Field, Input, errorToast, toast, cn } from "../ui";
import { Logo } from "./splash";

function LangToggle() {
  const locale = useLocale();
  const { refresh } = useSession();
  return (
    <button
      className="text-xs text-muted hover:text-fg underline-offset-2 hover:underline"
      onClick={() => {
        localStorage.setItem("petra.locale", locale === "en" ? "bn" : "en");
        void refresh();
        location.reload();
      }}
    >
      {locale === "en" ? "বাংলা" : "English"}
    </button>
  );
}

export function LoginScreen() {
  const t = useT();
  const { login, pinLogin, status } = useSession();
  const [mode, setMode] = useState<"password" | "pin">("password");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pinUsers = useQuery({ queryKey: ["pin-users"], queryFn: () => get<{ username: string; fullName: string; role: string }[]>("/auth/pin-users"), enabled: mode === "pin" });

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (mode === "password") await login(username, secret);
      else await pinLogin(username, secret);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : t("auth.failed"));
      setSecret("");
    } finally {
      setBusy(false);
    }
  };
  const name = status?.branding?.appName || "PetraPMS";
  return (
    <div className="min-h-screen grid lg:grid-cols-[1fr_1.1fr] bg-bg">
      <div className="hidden lg:flex flex-col justify-between bg-[var(--petra-black)] text-[#e9e4d8] p-10">
        <Logo size={36} name={name} />
        <div>
          <p className="text-3xl font-bold leading-tight text-white">{status?.hotel?.name}</p>
          <p className="mt-2 text-sm opacity-70">{status?.hotel?.address}</p>
          {status?.branding?.loginMessage ? <p className="mt-6 text-sm opacity-90 max-w-md">{status.branding.loginMessage}</p> : null}
        </div>
        <p className="text-xs opacity-50">
          {name} {status?.version} · {status?.mode}
          {status?.branding?.poweredBy && name !== "PetraPMS" ? " · Powered by PetraPMS" : ""}
        </p>
      </div>
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-sm p-6">
          <div className="lg:hidden mb-6">
            <Logo name={name} />
          </div>
          <div className="flex items-center justify-between mb-5">
            <h1 className="text-lg font-bold">{t("auth.signIn")}</h1>
            <LangToggle />
          </div>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-md bg-surface-2 border border-line mb-5 text-sm">
            {(["password", "pin"] as const).map((m) => (
              <button key={m} onClick={() => (setMode(m), setSecret(""), setError(""))} className={cn("rounded py-1.5", mode === m ? "bg-surface shadow-sm font-semibold" : "text-muted")}>
                {m === "password" ? t("auth.password") : t("auth.quickPin")}
              </button>
            ))}
          </div>
          <form onSubmit={submit} className="grid gap-4">
            {mode === "pin" && pinUsers.data?.length ? (
              <div className="grid grid-cols-2 gap-2 max-h-48 overflow-auto">
                {pinUsers.data.map((u) => (
                  <button type="button" key={u.username} onClick={() => setUsername(u.username)} className={cn("flex items-center gap-2 rounded-md border px-2 py-2 text-left text-xs", username === u.username ? "border-accent bg-surface-2" : "border-line")}>
                    <UserRound className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0">
                      <span className="block font-semibold truncate">{u.fullName}</span>
                      <span className="block text-muted truncate">{u.role}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
            <Field label={t("auth.username")}>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus={mode === "password"} autoCapitalize="none" />
            </Field>
            <Field label={mode === "password" ? t("auth.password") : t("auth.pin")}>
              <Input type="password" inputMode={mode === "pin" ? "numeric" : undefined} maxLength={mode === "pin" ? 6 : 200} value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete={mode === "password" ? "current-password" : "off"} />
            </Field>
            {error ? <p className="text-sm text-accent" role="alert">{error}</p> : null}
            <Button type="submit" variant="primary" size="lg" loading={busy} disabled={!username || !secret} icon={<LogIn className="size-4" />}>
              {t("auth.signIn")}
            </Button>
          </form>
          {status?.license?.readOnly ? <p className="mt-4 text-xs text-accent">{status.license.warnings[0]}</p> : null}
        </Card>
      </div>
    </div>
  );
}

export function LockScreen() {
  const t = useT();
  const { user, pinLogin, login, logout, unlock } = useSession();
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState(false);
  const [username, setUsername] = useState(user?.username ?? "");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const who = other ? username : user!.username;
      if (/^\d{4,6}$/.test(secret)) await pinLogin(who, secret);
      else await login(who, secret);
      unlock();
    } catch (err) {
      errorToast(err);
      setSecret("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/70 backdrop-blur-sm p-4">
      <Card className="w-full max-w-sm p-6">
        <div className="flex items-center gap-3 mb-4">
          <Lock className="size-5 text-accent" />
          <div>
            <h2 className="font-bold">{t("auth.locked")}</h2>
            <p className="text-xs text-muted">{other ? t("auth.switchUser") : t("auth.lockedAs", { name: user?.fullName ?? "" })}</p>
          </div>
        </div>
        <form onSubmit={submit} className="grid gap-3">
          {other ? (
            <Field label={t("auth.username")}>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </Field>
          ) : null}
          <Field label={t("auth.pinOrPassword")}>
            <Input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus={!other} />
          </Field>
          <Button type="submit" variant="primary" loading={busy} disabled={!secret} icon={<KeyRound className="size-4" />}>
            {t("auth.unlock")}
          </Button>
          <div className="flex justify-between text-xs">
            <button type="button" className="text-muted hover:text-fg" onClick={() => (setOther(!other), setUsername(other ? (user?.username ?? "") : ""))}>
              {other ? t("auth.backToMe") : t("auth.switchUser")}
            </button>
            <button type="button" className="text-muted hover:text-accent" onClick={() => void logout()}>
              {t("auth.signOut")}
            </button>
          </div>
        </form>
      </Card>
    </div>
  );
}

export function ChangePasswordForm({ forced, onDone }: { forced?: boolean; onDone?: () => void }) {
  const t = useT();
  const { refresh } = useSession();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = again.length > 0 && again !== next;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await post("/auth/change-password", { current: cur, next });
      toast.success(t("auth.passwordChanged"));
      await refresh();
      onDone?.();
    } catch (err) {
      errorToast(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="grid gap-3">
      {forced ? <p className="text-sm text-muted">{t("auth.mustChange")}</p> : null}
      <Field label={forced ? t("auth.temporaryPassword") : t("auth.currentPassword")}>
        <Input type="password" value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" autoFocus />
      </Field>
      <Field label={t("auth.newPassword")} hint={t("auth.passwordRules")}>
        <Input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
      </Field>
      <Field label={t("auth.repeatPassword")} error={mismatch ? t("auth.mismatch") : null}>
        <Input type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />
      </Field>
      <Button type="submit" variant="primary" loading={busy} disabled={!cur || !next || next !== again}>
        {t("auth.changePassword")}
      </Button>
    </form>
  );
}

export function ForcedPasswordChange() {
  const t = useT();
  const { logout } = useSession();
  return (
    <div className="min-h-screen grid place-items-center p-4">
      <Card className="w-full max-w-sm p-6">
        <h1 className="font-bold mb-3">{t("auth.changePassword")}</h1>
        <ChangePasswordForm forced />
        <button className="mt-4 text-xs text-muted hover:text-accent" onClick={() => void logout()}>
          {t("auth.signOut")}
        </button>
      </Card>
    </div>
  );
}

/** Watches ?pop=1 windows: closes the lock if the opener signs in again, nothing else. */
export function useTitle(title: string) {
  const { status } = useSession();
  useEffect(() => {
    document.title = `${title} · ${status?.hotel?.name ?? status?.branding?.appName ?? "PetraPMS"}`;
  }, [title, status]);
}
