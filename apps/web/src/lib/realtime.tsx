"use client";
// Live updates: one Server-Sent Events stream per window. Each server topic invalidates the related queries so
// every terminal sees changes within a second. Shows a reconnect banner when the stream drops.
import React, { createContext, useContext, useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { getToken } from "./api";
import { useSession } from "./session";

const TOPIC_KEYS: Record<string, string[]> = {
  rooms: ["rooms", "rack", "tape", "housekeeping", "dashboard", "availability", "frontdesk"],
  reservations: ["reservations", "reservation", "frontdesk", "rack", "tape", "dashboard", "availability", "guest"],
  folios: ["folios", "folio", "reservation", "ledger", "dashboard"],
  housekeeping: ["housekeeping", "rack", "rooms", "dashboard"],
  maintenance: ["maintenance", "rack", "tape", "dashboard", "rooms"],
  guests: ["guests", "guest"],
  settings: ["settings", "masters", "rate-plans", "seasons", "room-types", "hotel"],
  businessDate: ["*"],
  users: ["users", "sessions"],
  notes: ["shift-notes", "dashboard"],
  system: ["*"],
};

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: (n, e) => n < 2 && (e as { status?: number }).status !== 401 && (e as { status?: number }).status !== 403 },
      mutations: { retry: false },
    },
  });
}

const OnlineCtx = createContext<{ online: boolean }>({ online: true });
export const useOnline = () => useContext(OnlineCtx).online;

function Stream({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { user, setBusinessDate, refreshStatus } = useSession();
  const [online, setOnline] = useState(true);
  useEffect(() => {
    if (!user) return;
    let es: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let closed = false;
    let wasDown = false;
    const connect = () => {
      const token = getToken();
      if (!token || closed) return;
      es = new EventSource(`/api/events?token=${encodeURIComponent(token)}`);
      es.onopen = () => {
        setOnline(true);
        if (wasDown) {
          void qc.invalidateQueries(); // catch up on anything missed while offline
          wasDown = false;
        }
      };
      es.onmessage = (m) => {
        try {
          const ev = JSON.parse(m.data) as { topic: string; action: string; id?: string };
          const keys = TOPIC_KEYS[ev.topic] ?? [];
          if (keys.includes("*")) void qc.invalidateQueries();
          else keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
          if (ev.topic === "businessDate" && ev.id) setBusinessDate(ev.id);
          if (ev.topic === "system" || ev.topic === "settings") void refreshStatus().catch(() => undefined);
        } catch {
          /* ping or malformed */
        }
      };
      es.onerror = () => {
        setOnline(false);
        wasDown = true;
        es?.close();
        if (!closed) retry = setTimeout(connect, 3000);
      };
    };
    connect();
    const off = () => setOnline(false);
    const on = () => {
      es?.close();
      connect();
    };
    window.addEventListener("offline", off);
    window.addEventListener("online", on);
    return () => {
      closed = true;
      es?.close();
      if (retry) clearTimeout(retry);
      window.removeEventListener("offline", off);
      window.removeEventListener("online", on);
    };
  }, [user, qc, setBusinessDate, refreshStatus]);
  return <OnlineCtx.Provider value={{ online }}>{children}</OnlineCtx.Provider>;
}

export function DataProvider({ client, children }: { client: QueryClient; children: React.ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <Stream>{children}</Stream>
    </QueryClientProvider>
  );
}
