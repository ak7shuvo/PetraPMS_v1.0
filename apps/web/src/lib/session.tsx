"use client";
// Window-scoped session: who is signed in in THIS window, their permissions and preferences, the business date.
// Idle timeout locks the window (PIN / password to resume); another user can take over with their PIN.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api, get, onApiError, post, setToken, getToken, terminalId, windowId } from "./api";

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  roleCode: string;
  roleName: string;
  roleNameBn: string;
  locale: "en" | "bn";
  banglaDigits: boolean;
  uiScale: number;
  theme: "light" | "dark" | "system";
  mustChangePassword: boolean;
  discountLimitBp: number;
  hasPin: boolean;
  permissions: string[];
}

export interface AppStatus {
  setupComplete: boolean;
  hotel: { name: string; logo: string; address: string; phone: string } | null;
  locale: { defaultLocale: "en" | "bn"; grouping: "lakh" | "intl"; dateFormat: "DD/MM/YYYY" | "DD MMM YYYY" | "YYYY-MM-DD" };
  license: { mode: string; readOnly: boolean; warnings: string[]; edition: string };
  version: string;
  mode: string;
  provider?: string;
  businessDate: string | null;
  idleMinutes: number;
  branding: { appName: string; primaryColor: string; poweredBy: boolean; loginMessage: string };
}

interface SessionCtx {
  status: AppStatus | null;
  user: SessionUser | null;
  businessDate: string;
  locked: boolean;
  loading: boolean;
  can: (...perms: string[]) => boolean;
  login: (username: string, password: string) => Promise<{ home: string }>;
  pinLogin: (username: string, pin: string) => Promise<{ home: string }>;
  logout: () => Promise<void>;
  unlock: () => void;
  refresh: () => Promise<void>;
  refreshStatus: () => Promise<void>;
  setUser: (u: SessionUser) => void;
  setBusinessDate: (d: string) => void;
}

const Ctx = createContext<SessionCtx | null>(null);

export function applyPrefs(u: Pick<SessionUser, "theme" | "uiScale" | "locale"> | null) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const theme = u?.theme ?? (localStorage.getItem("petra.theme") as SessionUser["theme"]) ?? "light";
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  root.dataset.theme = dark ? "dark" : "light";
  root.style.setProperty("--ui-scale", String((u?.uiScale ?? Number(localStorage.getItem("petra.uiScale") || 100)) / 100));
  root.lang = u?.locale ?? localStorage.getItem("petra.locale") ?? "en";
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [user, setUserState] = useState<SessionUser | null>(null);
  const [businessDate, setBusinessDate] = useState("");
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const lastActivity = useRef(Date.now());

  const setUser = useCallback((u: SessionUser) => {
    setUserState(u);
    applyPrefs(u);
    localStorage.setItem("petra.locale", u.locale);
  }, []);

  const refreshStatus = useCallback(async () => {
    const s = await get<AppStatus>("/status");
    setStatus(s);
    if (s.businessDate) setBusinessDate(s.businessDate);
  }, []);

  const refresh = useCallback(async () => {
    try {
      await refreshStatus();
      if (getToken()) {
        const me = await get<{ user: SessionUser; businessDate: string }>("/auth/me");
        setUser(me.user);
        setBusinessDate(me.businessDate);
      }
    } catch {
      /* not signed in or offline */
    } finally {
      setLoading(false);
    }
  }, [refreshStatus, setUser]);

  useEffect(() => {
    applyPrefs(null);
    void refresh();
    return onApiError((e) => {
      if (e.status === 401 && getToken()) {
        setToken(null);
        setUserState(null);
      }
      if (e.status === 423) void refreshStatus();
    });
  }, [refresh, refreshStatus]);

  useEffect(() => {
    const lock = () => setLocked(true);
    window.addEventListener("petra:lock", lock);
    return () => window.removeEventListener("petra:lock", lock);
  }, []);

  // idle lock
  useEffect(() => {
    if (!user || !status) return;
    const bump = () => (lastActivity.current = Date.now());
    const evs = ["mousemove", "keydown", "pointerdown", "wheel", "touchstart"];
    evs.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const t = setInterval(() => {
      if (!locked && Date.now() - lastActivity.current > status.idleMinutes * 60_000) setLocked(true);
    }, 15_000);
    return () => {
      evs.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(t);
    };
  }, [user, status, locked]);

  const finish = useCallback(
    async (r: { token: string; user: SessionUser; home: string; businessDate: string }) => {
      setToken(r.token);
      setUser(r.user);
      setBusinessDate(r.businessDate);
      setLocked(false);
      lastActivity.current = Date.now();
      await refreshStatus().catch(() => undefined);
      return { home: r.home };
    },
    [setUser, refreshStatus],
  );

  const login = useCallback(async (username: string, password: string) => finish(await post("/auth/login", { username, password, windowId: windowId(), terminalId: terminalId(), deviceLabel: navigator.userAgent.slice(0, 80) })), [finish]);
  const pinLogin = useCallback(async (username: string, pin: string) => finish(await post("/auth/pin", { username, pin, windowId: windowId(), terminalId: terminalId() })), [finish]);
  const logout = useCallback(async () => {
    try {
      await api("POST", "/auth/logout", {});
    } catch {
      /* ignore */
    }
    setToken(null);
    setUserState(null);
    setLocked(false);
  }, []);

  const value = useMemo<SessionCtx>(
    () => ({
      status,
      user,
      businessDate,
      locked,
      loading,
      can: (...perms) => !!user && perms.some((p) => user.permissions.includes(p)),
      login,
      pinLogin,
      logout,
      unlock: () => {
        lastActivity.current = Date.now();
        setLocked(false);
      },
      refresh,
      refreshStatus,
      setUser,
      setBusinessDate,
    }),
    [status, user, businessDate, locked, loading, login, pinLogin, logout, refresh, refreshStatus, setUser],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside SessionProvider");
  return c;
}
