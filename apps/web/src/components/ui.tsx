"use client";
// PetraPMS UI kit (shadcn-style primitives on Radix + Tailwind, themed with the Petra CSS variables).
import React, { createContext, forwardRef, useCallback, useContext, useRef, useState } from "react";
import { Dialog as D, Tabs as T, DropdownMenu as DM, Popover as P } from "radix-ui";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { ApiClientError } from "@/lib/api";
import { useT } from "@/lib/i18n";

export const cn = (...c: ClassValue[]) => twMerge(clsx(c));
export { toast };

// ── buttons ──────────────────────────────────────────────────────────────────
type Variant = "primary" | "secondary" | "ghost" | "danger" | "outline" | "dark";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-white hover:brightness-110 border border-accent",
  secondary: "bg-surface-2 text-fg border border-line hover:bg-line/60",
  outline: "bg-transparent text-fg border border-line hover:bg-surface-2",
  ghost: "bg-transparent text-fg hover:bg-surface-2 border border-transparent",
  danger: "bg-transparent text-accent border border-accent hover:bg-accent hover:text-white",
  dark: "bg-[var(--petra-black)] text-white border border-[var(--petra-black)] hover:brightness-125",
};
const SIZES = { xs: "h-7 px-2 text-xs gap-1", sm: "h-8 px-2.5 text-xs gap-1.5", md: "h-9 px-3.5 text-sm gap-2", lg: "h-11 px-5 text-base gap-2" };

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: keyof typeof SIZES;
  loading?: boolean;
  icon?: React.ReactNode;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ variant = "secondary", size = "md", loading, icon, className, children, disabled, type = "button", ...rest }, ref) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} className={cn("inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition select-none disabled:opacity-50 disabled:pointer-events-none touch-target", VARIANTS[variant], SIZES[size], className)} {...rest}>
      {loading ? <Loader2 className="size-4 animate-spin" /> : icon}
      {children}
    </button>
  );
});

// ── form controls ────────────────────────────────────────────────────────────
const field = "w-full h-9 rounded-md border border-line bg-surface px-2.5 text-sm text-fg placeholder:text-muted/70 focus:border-accent focus:outline-none disabled:opacity-60";
export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(field, className)} {...p} />;
});
export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(field, "h-auto min-h-20 py-2", className)} {...p} />;
});
export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, children, ...p }, ref) {
  return (
    <select ref={ref} className={cn(field, "pr-7", className)} {...p}>
      {children}
    </select>
  );
});
export function Checkbox({ label, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) {
  return (
    <label className={cn("inline-flex items-center gap-2 text-sm cursor-pointer select-none", className)}>
      <input type="checkbox" className="size-4 accent-[var(--accent)]" {...p} />
      {label}
    </label>
  );
}
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={cn("relative h-5 w-9 rounded-full transition disabled:opacity-50", checked ? "bg-accent" : "bg-line")}>
        <span className={cn("absolute top-0.5 size-4 rounded-full bg-white shadow transition", checked ? "left-[18px]" : "left-0.5")} />
      </button>
      {label}
    </label>
  );
}
export function Field({ label, error, hint, children, className, required }: { label?: React.ReactNode; error?: string | null; hint?: React.ReactNode; children: React.ReactNode; className?: string; required?: boolean }) {
  const labelId = React.useId();
  // Associate the visible label with its control (screen readers, tests) when there is exactly one control.
  let control = children;
  if (label && React.isValidElement(children)) {
    const p = children.props as Record<string, unknown>;
    if (!p["aria-label"] && !p["aria-labelledby"]) control = React.cloneElement(children as React.ReactElement<Record<string, unknown>>, { "aria-labelledby": labelId });
  }
  return (
    <div className={cn("flex flex-col gap-1 min-w-0", className)}>
      {label ? (
        <span id={labelId} className="text-xs text-muted">
          {label}
          {required ? <span className="text-accent"> *</span> : null}
        </span>
      ) : null}
      {control}
      {error ? <span className="text-xs text-accent">{error}</span> : hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

/** Money input in taka (stores poisha via the caller). */
export function MoneyInput({ value, onChange, className, ...p }: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <div className={cn("relative", className)}>
      <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted text-sm">৳</span>
      <Input inputMode="decimal" className="pl-6 text-right num" value={value} onChange={(e) => onChange(e.target.value)} {...p} />
    </div>
  );
}

// ── layout ──────────────────────────────────────────────────────────────────
export function Card({ className, children, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface", className)} {...p}>
      {children}
    </div>
  );
}
export function CardHeader({ title, actions, className, sub }: { title: React.ReactNode; actions?: React.ReactNode; className?: string; sub?: React.ReactNode }) {
  return (
    <div className={cn("flex items-center justify-between gap-2 px-4 py-2.5 border-b border-line", className)}>
      <div className="min-w-0">
        <h3 className="font-semibold text-sm truncate">{title}</h3>
        {sub ? <p className="text-xs text-muted truncate">{sub}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-1.5 shrink-0">{actions}</div> : null}
    </div>
  );
}
export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
      <div className="min-w-0">
        <h1 className="text-xl font-bold tracking-tight">{title}</h1>
        {sub ? <p className="text-sm text-muted">{sub}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

const TONES = {
  neutral: "bg-surface-2 text-fg border-line",
  red: "bg-[color-mix(in_srgb,var(--st-occupied)_12%,transparent)] text-st-occ border-[color-mix(in_srgb,var(--st-occupied)_35%,transparent)]",
  green: "bg-[color-mix(in_srgb,var(--st-vacant-clean)_12%,transparent)] text-st-vc border-[color-mix(in_srgb,var(--st-vacant-clean)_35%,transparent)]",
  amber: "bg-[color-mix(in_srgb,var(--st-vacant-dirty)_14%,transparent)] text-st-vd border-[color-mix(in_srgb,var(--st-vacant-dirty)_35%,transparent)]",
  blue: "bg-[color-mix(in_srgb,var(--st-reserved)_12%,transparent)] text-st-res border-[color-mix(in_srgb,var(--st-reserved)_35%,transparent)]",
  gray: "bg-[color-mix(in_srgb,var(--st-ooo)_14%,transparent)] text-st-ooo border-[color-mix(in_srgb,var(--st-ooo)_35%,transparent)]",
  purple: "bg-[color-mix(in_srgb,var(--st-maintenance)_12%,transparent)] text-st-mnt border-[color-mix(in_srgb,var(--st-maintenance)_35%,transparent)]",
  dark: "bg-[var(--petra-black)] text-white border-[var(--petra-black)]",
};
export type Tone = keyof typeof TONES;
export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium leading-none whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}

export const STATUS_TONE: Record<string, Tone> = {
  CONFIRMED: "blue",
  TENTATIVE: "amber",
  WAITLIST: "gray",
  CHECKED_IN: "red",
  CHECKED_OUT: "neutral",
  CANCELLED: "gray",
  NO_SHOW: "gray",
  RESERVED: "blue",
  OPEN: "amber",
  SETTLED: "green",
  CLOSED: "neutral",
  CLEAN: "green",
  INSPECTED: "green",
  DIRTY: "amber",
  IN_PROGRESS: "blue",
  PENDING: "amber",
  DONE: "green",
  SKIPPED: "gray",
  ON_HOLD: "gray",
  RESOLVED: "green",
  CRITICAL: "red",
  HIGH: "red",
  MEDIUM: "amber",
  LOW: "neutral",
  VACANT_CLEAN: "green",
  VACANT_DIRTY: "amber",
  OCCUPIED: "red",
  OUT_OF_ORDER: "gray",
  MAINTENANCE: "purple",
  QUEUED: "amber",
  SENT: "green",
  FAILED: "red",
  COMPLETED: "green",
  UNDONE: "gray",
  RUNNING: "blue",
  OK: "green",
};
export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{t(`status.${status}`)}</Badge>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}
export function SkeletonRows({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="p-3 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((__, j) => (
            <Skeleton key={j} className="flex-1 h-5" />
          ))}
        </div>
      ))}
    </div>
  );
}
export function Empty({ title, children, icon }: { title: React.ReactNode; children?: React.ReactNode; icon?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center gap-2 py-10 px-4 text-muted">
      {icon}
      <p className="font-medium text-fg">{title}</p>
      {children}
    </div>
  );
}
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin text-muted", className)} />;
}
export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded border border-line bg-surface-2 px-1 text-[10px] text-muted font-mono">{children}</kbd>;
}
export function Stat({ label, value, sub, tone }: { label: React.ReactNode; value: React.ReactNode; sub?: React.ReactNode; tone?: "accent" }) {
  return (
    <Card className="p-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn("text-2xl font-bold num mt-0.5", tone === "accent" && "text-accent")}>{value}</div>
      {sub ? <div className="text-xs text-muted mt-0.5">{sub}</div> : null}
    </Card>
  );
}

// ── table ────────────────────────────────────────────────────────────────────
export interface Col<R> {
  key: string;
  header: React.ReactNode;
  cell: (r: R) => React.ReactNode;
  className?: string;
  align?: "right" | "center";
  sort?: (r: R) => string | number;
}
export function DataTable<R>({ rows, cols, onRowClick, loading, empty, rowKey, className, dense, rowClass }: { rows: R[] | undefined; cols: Col<R>[]; onRowClick?: (r: R) => void; loading?: boolean; empty?: React.ReactNode; rowKey: (r: R) => string; className?: string; dense?: boolean; rowClass?: (r: R) => string }) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const t = useT();
  if (loading && !rows) return <SkeletonRows cols={Math.min(cols.length, 6)} />;
  let list = rows ?? [];
  if (sort) {
    const c = cols.find((x) => x.key === sort.key);
    if (c?.sort) list = [...list].sort((a, b) => (c.sort!(a) > c.sort!(b) ? sort.dir : c.sort!(a) < c.sort!(b) ? -sort.dir : 0));
  }
  return (
    <div className={cn("overflow-auto", className)}>
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 z-10 bg-surface-2">
          <tr>
            {cols.map((c) => (
              <th
                key={c.key}
                onClick={c.sort ? () => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })) : undefined}
                className={cn("text-left font-semibold text-xs text-muted px-3 py-2 border-b border-line whitespace-nowrap", c.align === "right" && "text-right", c.align === "center" && "text-center", c.sort && "cursor-pointer hover:text-fg", c.className)}
              >
                {c.header}
                {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {list.map((r) => (
            <tr key={rowKey(r)} onClick={onRowClick ? (e) => ((e.target as HTMLElement).closest("button,a,input,select,textarea,label,[role=menuitem],[data-no-row-click]") ? undefined : onRowClick(r)) : undefined} className={cn("border-b border-line/70 last:border-0", onRowClick && "cursor-pointer hover:bg-surface-2", rowClass?.(r))}>
              {cols.map((c) => (
                <td key={c.key} className={cn("px-3", dense ? "py-1" : "py-2", c.align === "right" && "text-right num", c.align === "center" && "text-center", c.className)}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!list.length && !loading ? empty ?? <Empty title={t("common.noData")} /> : null}
    </div>
  );
}

// ── dialogs ──────────────────────────────────────────────────────────────────
const SIZES_D = { sm: "max-w-md", md: "max-w-xl", lg: "max-w-3xl", xl: "max-w-5xl", full: "max-w-[96vw]" };
export function Modal({ open, onOpenChange, title, description, children, footer, size = "md" }: { open: boolean; onOpenChange: (o: boolean) => void; title: React.ReactNode; description?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; size?: keyof typeof SIZES_D }) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
        <D.Content className={cn("fixed left-1/2 top-[6vh] z-50 w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-lg border border-line bg-surface shadow-2xl flex flex-col max-h-[88vh]", SIZES_D[size])}>
          <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-line">
            <div>
              <D.Title className="font-bold">{title}</D.Title>
              {description ? <D.Description className="text-sm text-muted mt-0.5">{description}</D.Description> : <D.Description className="sr-only">{typeof title === "string" ? title : ""}</D.Description>}
            </div>
            <D.Close className="rounded p-1 text-muted hover:bg-surface-2" aria-label="Close">
              <X className="size-4" />
            </D.Close>
          </div>
          <div className="px-5 py-4 overflow-auto">{children}</div>
          {footer ? <div className="flex flex-wrap justify-end gap-2 px-5 py-3 border-t border-line bg-surface-2/60 rounded-b-lg">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

interface ConfirmOpts {
  title: string;
  message?: React.ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  /** require a reason (returned) */
  reason?: boolean;
  /** require typing this word */
  typeToConfirm?: string;
}
type ConfirmResult = { ok: false } | { ok: true; reason: string };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<ConfirmResult>>(async () => ({ ok: false }));
export const useConfirm = () => useContext(ConfirmCtx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [state, setState] = useState<(ConfirmOpts & { resolve: (r: ConfirmResult) => void }) | null>(null);
  const [reason, setReason] = useState("");
  const [typed, setTyped] = useState("");
  const confirm = useCallback((o: ConfirmOpts) => new Promise<ConfirmResult>((resolve) => (setReason(""), setTyped(""), setState({ ...o, resolve }))), []);
  const close = (r: ConfirmResult) => {
    state?.resolve(r);
    setState(null);
  };
  const disabled = (state?.reason && reason.trim().length < 3) || (state?.typeToConfirm && typed.trim().toUpperCase() !== state.typeToConfirm);
  return (
    <ConfirmCtx.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onOpenChange={(o) => !o && close({ ok: false })}
        title={state?.title ?? ""}
        size="sm"
        footer={
          <>
            <Button onClick={() => close({ ok: false })}>{t("common.cancel")}</Button>
            <Button variant={state?.danger ? "danger" : "primary"} disabled={!!disabled} onClick={() => close({ ok: true, reason: reason.trim() })} autoFocus>
              {state?.confirmLabel ?? t("common.confirm")}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          {state?.message ? <div>{state.message}</div> : null}
          {state?.reason ? (
            <Field label={t("common.reason")} required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
          ) : null}
          {state?.typeToConfirm ? (
            <Field label={t("common.typeToConfirm", { word: state.typeToConfirm })}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} />
            </Field>
          ) : null}
        </div>
      </Modal>
    </ConfirmCtx.Provider>
  );
}

/** Manager approval (username + PIN) when the server answers APPROVAL_REQUIRED; retries the action once. */
type Approval = { username: string; secret: string };
const ApprovalCtx = createContext<<R>(fn: (approval: Approval | null) => Promise<R>) => Promise<R>>(async (fn) => fn(null));
export const useWithApproval = () => useContext(ApprovalCtx);

export function ApprovalProvider({ children }: { children: React.ReactNode }) {
  const t = useT();
  const [pending, setPending] = useState<{ message: string; resolve: (a: Approval | null) => void } | null>(null);
  const [u, setU] = useState("");
  const [s, setS] = useState("");
  const withApproval = useCallback(async <R,>(fn: (approval: Approval | null) => Promise<R>): Promise<R> => {
    try {
      return await fn(null);
    } catch (e) {
      if (!(e instanceof ApiClientError) || e.code !== "APPROVAL_REQUIRED") throw e;
      for (let attempt = 0; attempt < 3; attempt++) {
        const a = await new Promise<Approval | null>((resolve) => (setU(""), setS(""), setPending({ message: e.message, resolve })));
        if (!a) throw new ApiClientError(403, "CANCELLED", t("approval.cancelled"));
        try {
          return await fn(a);
        } catch (e2) {
          if (e2 instanceof ApiClientError && (e2.code === "APPROVAL_REQUIRED" || e2.code === "BAD_CREDENTIALS")) {
            toast.error(e2.message);
            continue;
          }
          throw e2;
        }
      }
      throw e;
    }
  }, [t]);
  const done = (a: Approval | null) => {
    pending?.resolve(a);
    setPending(null);
  };
  return (
    <ApprovalCtx.Provider value={withApproval}>
      {children}
      <Modal
        open={!!pending}
        onOpenChange={(o) => !o && done(null)}
        title={t("approval.title")}
        description={pending?.message}
        size="sm"
        footer={
          <>
            <Button onClick={() => done(null)}>{t("common.cancel")}</Button>
            <Button variant="primary" disabled={!u || !s} onClick={() => done({ username: u, secret: s })}>
              {t("approval.approve")}
            </Button>
          </>
        }
      >
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (u && s) done({ username: u, secret: s });
          }}
        >
          <Field label={t("approval.manager")}>
            <Input value={u} onChange={(e) => setU(e.target.value)} autoFocus autoComplete="off" />
          </Field>
          <Field label={t("approval.pin")}>
            <Input type="password" value={s} onChange={(e) => setS(e.target.value)} autoComplete="off" />
          </Field>
          <button type="submit" hidden />
        </form>
      </Modal>
    </ApprovalCtx.Provider>
  );
}

/** Shows an API error as a toast (version conflicts get a reload hint). */
export function errorToast(e: unknown, fallback = "Something went wrong") {
  if (e instanceof ApiClientError) {
    if (e.code === "CANCELLED") return;
    if (e.code === "VERSION_CONFLICT" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("petra:conflict", { detail: e.message }));
      return;
    }
    const bn = typeof document !== "undefined" && document.documentElement.lang === "bn" ? (e.details as { bn?: string } | undefined)?.bn : undefined;
    toast.error(bn ?? e.message);
  } else toast.error((e as Error)?.message ?? fallback);
}

// ── tabs / menus / popover ───────────────────────────────────────────────────
export function Tabs({ tabs, value, onValueChange, className }: { tabs: { value: string; label: React.ReactNode; content: React.ReactNode; hidden?: boolean }[]; value?: string; onValueChange?: (v: string) => void; className?: string }) {
  const visible = tabs.filter((x) => !x.hidden);
  return (
    <T.Root value={value} defaultValue={value ? undefined : visible[0]?.value} onValueChange={onValueChange} className={className}>
      <T.List className="flex gap-1 border-b border-line mb-4 overflow-x-auto">
        {visible.map((x) => (
          <T.Trigger key={x.value} value={x.value} className="px-3 py-2 text-sm text-muted border-b-2 border-transparent -mb-px whitespace-nowrap data-[state=active]:border-accent data-[state=active]:text-fg data-[state=active]:font-semibold hover:text-fg">
            {x.label}
          </T.Trigger>
        ))}
      </T.List>
      {visible.map((x) => (
        <T.Content key={x.value} value={x.value}>
          {x.content}
        </T.Content>
      ))}
    </T.Root>
  );
}

export function Menu({ trigger, items }: { trigger: React.ReactNode; items: ({ label: React.ReactNode; onSelect: () => void; danger?: boolean; disabled?: boolean; icon?: React.ReactNode } | "sep" | false | null | undefined)[] }) {
  return (
    <DM.Root>
      <DM.Trigger asChild>{trigger}</DM.Trigger>
      <DM.Portal>
        <DM.Content align="end" sideOffset={4} className="z-50 min-w-44 rounded-md border border-line bg-surface p-1 shadow-xl">
          {items.filter(Boolean).map((it, i) =>
            it === "sep" ? (
              <DM.Separator key={i} className="my-1 h-px bg-line" />
            ) : (
              <DM.Item key={i} disabled={(it as { disabled?: boolean }).disabled} onSelect={(it as { onSelect: () => void }).onSelect} className={cn("flex items-center gap-2 rounded px-2 py-1.5 text-sm outline-none cursor-pointer data-[highlighted]:bg-surface-2 data-[disabled]:opacity-40", (it as { danger?: boolean }).danger && "text-accent")}>
                {(it as { icon?: React.ReactNode }).icon}
                {(it as { label: React.ReactNode }).label}
              </DM.Item>
            ),
          )}
        </DM.Content>
      </DM.Portal>
    </DM.Root>
  );
}

export function Popover({ trigger, children, className }: { trigger: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <P.Root>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content sideOffset={6} className={cn("z-50 rounded-md border border-line bg-surface p-3 shadow-xl", className)}>
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}

/** Debounced value (search boxes). */
export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setV(value), ms);
    return () => {
      if (t.current) clearTimeout(t.current);
    };
  }, [value, ms]);
  return v;
}
