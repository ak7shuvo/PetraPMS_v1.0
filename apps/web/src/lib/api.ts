"use client";
// Browser API client. Each window/tab has its own session token (sessionStorage), so several users can work on
// one computer in different windows. The terminal id (localStorage) identifies the computer for the license's
// terminal limit; the Electron shell supplies a stable one.

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

declare global {
  interface Window {
    petra?: {
      isDesktop: boolean;
      terminalId: string;
      mode: string;
      print: (pdfUrl: string, opts?: { silent?: boolean; printer?: string; thermal?: boolean }) => Promise<{ ok: boolean; error?: string }>;
      previewPdf: (pdfUrl: string, title?: string) => Promise<{ ok: boolean }>;
      openPdfExternal: (pdfUrl: string) => Promise<{ ok: boolean; error?: string }>;
      printers: () => Promise<{ name: string; isDefault: boolean }[]>;
      openWindow: (route: string, opts?: { title?: string; bounds?: { x: number; y: number; width: number; height: number }; displayId?: number }) => Promise<void>;
      displays: () => Promise<{ id: number; label: string; bounds: { x: number; y: number; width: number; height: number }; primary: boolean }[]>;
      windowState: () => Promise<{ displayId: number; bounds: { x: number; y: number; width: number; height: number } }>;
      openWorkspace: (windows: { route: string; displayId: number; bounds: { x: number; y: number; width: number; height: number } }[]) => Promise<void>;
      saveFile: (name: string, data: ArrayBuffer) => Promise<string | null>;
      openDataFolder: () => Promise<void>;
      setKiosk: (on: boolean) => Promise<void>;
      appInfo: () => Promise<{ version: string; mode: string; dataDir: string; lanUrls: string[] }>;
      checkForUpdates: () => Promise<{ available: boolean; version?: string; downloaded?: boolean; error?: string }>;
      updateStatus: () => Promise<{ enabled: boolean; state: "idle" | "checking" | "downloading" | "downloaded" | "error"; version: string | null; progress: number; error: string | null; current: string }>;
      installUpdate: () => Promise<{ ok: boolean; error?: string }>;
    };
  }
}

const rnd = () => (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36)).replace(/-/g, "").slice(0, 24);

export function windowId(): string {
  if (typeof window === "undefined") return "";
  let id = sessionStorage.getItem("petra.window");
  if (!id) sessionStorage.setItem("petra.window", (id = rnd()));
  return id;
}

export function terminalId(): string {
  if (typeof window === "undefined") return "";
  if (window.petra?.terminalId) return window.petra.terminalId;
  let id = localStorage.getItem("petra.terminal");
  if (!id) localStorage.setItem("petra.terminal", (id = "web-" + rnd().slice(0, 12)));
  return id;
}

export const getToken = () => (typeof window === "undefined" ? null : sessionStorage.getItem("petra.token"));
export const setToken = (t: string | null) => (t ? sessionStorage.setItem("petra.token", t) : sessionStorage.removeItem("petra.token"));

type Listener = (e: ApiClientError) => void;
const listeners = new Set<Listener>();
/** Global error hooks (401 → sign-in screen, 423 → read-only banner). */
export const onApiError = (l: Listener) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

function headers(json = true): Record<string, string> {
  const h: Record<string, string> = { "x-petra-window": windowId(), "x-petra-terminal": terminalId() };
  if (json) h["content-type"] = "application/json";
  const t = getToken();
  if (t) h.authorization = `Bearer ${t}`;
  return h;
}

export async function api<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  } catch {
    const e = new ApiClientError(0, "NETWORK", "Cannot reach the PetraPMS server. Check the network connection.", { bn: "PetraPMS সার্ভারের সাথে সংযোগ হচ্ছে না। নেটওয়ার্ক সংযোগ পরীক্ষা করুন।" });
    listeners.forEach((l) => l(e));
    throw e;
  }
  let j: { ok: boolean; data?: T; error?: { code: string; message: string; details?: unknown } };
  try {
    j = await res.json();
  } catch {
    throw new ApiClientError(res.status, "BAD_RESPONSE", `Unexpected server response (${res.status})`, { bn: `সার্ভার থেকে অপ্রত্যাশিত উত্তর এসেছে (${res.status})। আবার চেষ্টা করুন।` });
  }
  if (!j.ok) {
    const e = new ApiClientError(res.status, j.error?.code ?? "ERROR", j.error?.message ?? "Request failed", j.error?.details);
    listeners.forEach((l) => l(e));
    throw e;
  }
  return j.data as T;
}

export const get = <T,>(p: string) => api<T>("GET", p);
export const post = <T,>(p: string, b?: unknown) => api<T>("POST", p, b ?? {});
export const put = <T,>(p: string, b?: unknown) => api<T>("PUT", p, b ?? {});
export const patch = <T,>(p: string, b?: unknown) => api<T>("PATCH", p, b ?? {});
export const del = <T,>(p: string) => api<T>("DELETE", p);

/** Fetches a binary document (PDF, CSV, XLSX) with this window's credentials. */
export async function fetchBlob(path: string): Promise<{ blob: Blob; fileName: string }> {
  const res = await fetch(`/api${path}`, { headers: headers(false), cache: "no-store" });
  if (!res.ok) {
    let msg = `Download failed (${res.status})`;
    try {
      const j = await res.json();
      msg = j.error?.message ?? msg;
    } catch {
      /* not json */
    }
    throw new ApiClientError(res.status, "DOWNLOAD", msg);
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const fileName = /filename="([^"]+)"/.exec(cd)?.[1] ?? "download";
  return { blob: await res.blob(), fileName };
}

export async function download(path: string) {
  const { blob, fileName } = await fetchBlob(path);
  if (window.petra?.saveFile) {
    await window.petra.saveFile(fileName, await blob.arrayBuffer());
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Opens a PDF for viewing / printing. In the desktop app it prints silently to the chosen printer when asked. */
export async function openPdf(path: string, opts: { print?: boolean; thermal?: boolean } = {}) {
  const { blob } = await fetchBlob(path);
  const url = URL.createObjectURL(blob);
  if (opts.print && window.petra?.print) {
    const printer = localStorage.getItem(opts.thermal ? "petra.printer.thermal" : "petra.printer.a4") || undefined;
    const silent = localStorage.getItem("petra.print.silent") === "1";
    const r = await window.petra.print(url, { silent, printer, thermal: opts.thermal });
    if (!r.ok) {
      // Never leave the receptionist with nothing: show the document so it can be printed from the viewer.
      await window.petra.previewPdf(url, "PetraPMS").catch(() => undefined);
      const bn = document.documentElement.lang === "bn";
      throw new ApiClientError(0, "PRINT", bn ? `প্রিন্ট করা যায়নি (${r.error ?? "অজানা ত্রুটি"})। ডকুমেন্টটি খোলা হয়েছে — সেখান থেকে ম্যানুয়ালি প্রিন্ট করুন।` : `Printing failed (${r.error ?? "unknown error"}). The document was opened so you can print it manually.`);
    }
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  if (window.petra?.previewPdf) {
    // The desktop app shows previews in its own PDF window (a blob: window.open would open the app's home page instead).
    await window.petra.previewPdf(url, "PetraPMS");
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return;
  }
  const w = window.open(url, "_blank");
  if (!w) {
    // popup blocked: fall back to download
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.click();
  }
  setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

export const fileToBase64 = (f: File | Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });

export const fileToDataUrl = (f: File | Blob) =>
  new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
