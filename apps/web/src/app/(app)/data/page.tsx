"use client";
// Data Import & Seeding Center: import wizard (file or Excel paste), history with undo, round-trip exports,
// configuration export/import, backup & restore, demo data, go-live checklist.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { AlertTriangle, CheckCircle2, ClipboardPaste, Database, DownloadCloud, FileUp, HardDriveDownload, KeyRound, Play, RotateCcw, ShieldAlert, Trash2, Undo2, Upload } from "lucide-react";
import { download, fileToBase64, get, post, put } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useFmt, useLocale, useT } from "@/lib/i18n";
import { ENTITIES, type EntityDef } from "@/features/data-import/registry";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, Input, Modal, PageHeader, Select, StatusBadge, Tabs, Textarea, cn, errorToast, toast, useConfirm } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

type Rows = Record<string, string>[];
interface RunResult {
  batchId: string | null;
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  skipped: number;
  errors: { row: number; field: string; message: string }[];
  warnings: { row: number; field: string; message: string }[];
  output: Record<string, unknown>[];
  backup: string | null;
}

export default function DataCenterPage() {
  const t = useT();
  const sp = useSearchParams();
  const { can } = useSession();
  useTitle(t("nav.data"));
  return (
    <div>
      <PageHeader title={t("nav.data")} sub={t("data.sub")} />
      <Tabs
        value={sp.get("tab") ?? undefined}
        tabs={[
          { value: "checklist", label: t("data.checklist"), content: <Checklist />, hidden: !can("data.import") },
          { value: "import", label: t("data.import"), content: <ImportWizard />, hidden: !can("data.import") },
          { value: "history", label: t("data.history"), content: <History />, hidden: !can("data.import") },
          { value: "export", label: t("data.export"), content: <ExportTab />, hidden: !can("data.export") },
          { value: "backup", label: t("data.backup"), content: <BackupTab />, hidden: !can("data.backup") },
          { value: "demo", label: t("data.demo"), content: <DemoTab />, hidden: !can("data.demo") },
        ]}
      />
    </div>
  );
}

function useEntities() {
  return useQuery({ queryKey: ["data", "entities"], queryFn: () => get<(EntityDef & { count: number })[]>("/data/entities") });
}

function Checklist() {
  const t = useT();
  const locale = useLocale();
  const ents = useEntities();
  return (
    <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
      {[...(ents.data ?? [])].sort((a, b) => a.order - b.order).map((e) => (
        <Card key={e.id} className="p-4 flex flex-col gap-2">
          <div className="flex items-center gap-2">
            {e.count ? <CheckCircle2 className="size-5 text-[var(--st-vacant-clean)]" /> : <span className="size-5 rounded-full border-2 border-line" />}
            <h3 className="font-semibold">{locale === "bn" ? e.labelBn : e.label}</h3>
            <Badge className="ml-auto">{e.count}</Badge>
          </div>
          <p className="text-xs text-muted flex-1">{e.description}</p>
          <div className="flex gap-2">
            <Button size="sm" icon={<DownloadCloud className="size-3.5" />} onClick={() => void download(`/data/templates/${e.id}?format=xlsx`).catch(errorToast)}>
              {t("data.templateXlsx")}
            </Button>
            <a href={`/templates/petrapms-${e.id}-template.csv`} download className="inline-flex items-center h-8 px-2.5 text-xs rounded-md border border-line hover:bg-surface-2">
              CSV
            </a>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ImportWizard() {
  const t = useT();
  const f = useFmt();
  const locale = useLocale();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [step, setStep] = useState(0);
  const [entityId, setEntityId] = useState("roomTypes");
  const entity = ENTITIES.find((e) => e.id === entityId)!;
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Rows>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [presets, setPresets] = useState<{ name: string; mapping: Record<string, string> }[]>([]);
  const [mode, setMode] = useState<"ALL_OR_NOTHING" | "SKIP_INVALID">("ALL_OR_NOTHING");
  const [strategy, setStrategy] = useState<"CREATE" | "UPDATE" | "UPSERT">("CREATE");
  const [dry, setDry] = useState<RunResult | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [paste, setPaste] = useState(false);

  const reset = () => {
    setStep(0);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setDry(null);
    setResult(null);
    setFileName("");
  };
  useEffect(() => {
    if (entity.createOnly) setStrategy("CREATE");
  }, [entity]);

  const onFile = async (file: File) => {
    if (file.size > 5 * 1024 * 1024) return errorToast(new Error(t("data.tooLarge")));
    setBusy(true);
    try {
      const r = await post<{ headers: string[]; rows: Rows; mapping: Record<string, string>; presets: typeof presets }>("/data/import/parse", { entityId, fileName: file.name, fileBase64: await fileToBase64(file) });
      setFileName(file.name);
      setHeaders(r.headers);
      setRows(r.rows);
      setMapping(r.mapping);
      setPresets(r.presets);
      setStep(1);
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const runDry = async () => {
    setBusy(true);
    try {
      const r = await post<RunResult>("/data/import/run", { entityId, mapping, rows, mode, strategy, dryRun: true, fileName });
      setDry(r);
      setStep(2);
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };

  const execute = async () => {
    const c = await confirm({ title: t("data.confirmImport"), message: t("data.confirmImportText", { n: rows.length, entity: locale === "bn" ? entity.labelBn : entity.label }) });
    if (!c.ok) return;
    setBusy(true);
    const jobId = Math.random().toString(36).slice(2);
    const timer = setInterval(() => void get<{ processed: number; total: number }>(`/data/import/progress/${jobId}`).then(setProgress).catch(() => undefined), 700);
    try {
      const r = await post<RunResult>("/data/import/run", { entityId, mapping, rows, mode, strategy, dryRun: false, fileName, jobId });
      setResult(r);
      setStep(3);
      void qc.invalidateQueries();
      if (r.created || r.updated) toast.success(t("data.imported", { created: r.created, updated: r.updated }));
      else toast.error(t("data.nothingImported"));
    } catch (e) {
      errorToast(e);
    } finally {
      clearInterval(timer);
      setProgress(null);
      setBusy(false);
    }
  };

  const errorCsv = (res: RunResult) => {
    const out = res.errors.map((e) => ({ row: e.row, field: e.field, problem: e.message, ...rows[e.row - 1] }));
    const blob = new Blob(["\uFEFF" + Papa.unparse(out)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${entityId}-errors.csv`;
    a.click();
  };

  const steps = [t("data.step.source"), t("data.step.map"), t("data.step.preview"), t("data.step.done")];
  return (
    <Card className="p-4">
      <ol className="flex flex-wrap gap-2 mb-4">
        {steps.map((s, i) => (
          <li key={s} className={cn("rounded-full border px-3 py-1 text-xs", i === step ? "border-accent font-semibold" : "border-line text-muted")}>
            {i + 1}. {s}
          </li>
        ))}
      </ol>
      {step === 0 ? (
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <Field label={t("data.whatToImport")}>
              <Select value={entityId} onChange={(e) => (setEntityId(e.target.value), reset())}>
                {[...ENTITIES].sort((a, b) => a.order - b.order).map((e) => (
                  <option key={e.id} value={e.id}>
                    {locale === "bn" ? e.labelBn : e.label}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-sm text-muted">{entity.description}</p>
            {entity.dependsOn?.length ? <p className="text-xs text-muted">{t("data.dependsOn", { list: entity.dependsOn.map((d) => ENTITIES.find((e) => e.id === d)?.label).join(", ") })}</p> : null}
            <div className="flex gap-2">
              <Button size="sm" icon={<DownloadCloud className="size-3.5" />} onClick={() => void download(`/data/templates/${entityId}?format=xlsx`).catch(errorToast)}>
                {t("data.templateXlsx")}
              </Button>
              <a href={`/templates/petrapms-${entityId}-template.csv`} download className="inline-flex items-center h-8 px-2.5 text-xs rounded-md border border-line hover:bg-surface-2">
                {t("data.templateCsv")}
              </a>
            </div>
          </div>
          <div className="space-y-3">
            <DropZone busy={busy} onFile={(file) => void onFile(file)} />
            <Button className="w-full" icon={<ClipboardPaste className="size-4" />} onClick={() => setPaste(true)}>
              {t("data.pasteFromExcel")}
            </Button>
          </div>
        </div>
      ) : null}
      {step === 1 ? (
        <div className="space-y-3">
          <p className="text-sm">
            <b>{fileName}</b> · {t("data.rowsFound", { n: rows.length })}
          </p>
          <div className="flex flex-wrap gap-2 items-end">
            {presets.length ? (
              <Field label={t("data.preset")}>
                <Select onChange={(e) => e.target.value && setMapping(presets.find((p) => p.name === e.target.value)?.mapping ?? mapping)} defaultValue="">
                  <option value="">—</option>
                  {presets.map((p) => (
                    <option key={p.name}>{p.name}</option>
                  ))}
                </Select>
              </Field>
            ) : null}
            <Button
              size="sm"
              onClick={async () => {
                const name = prompt(t("data.presetName"));
                if (!name) return;
                try {
                  setPresets(await put(`/data/import/presets/${entityId}`, { name, mapping }));
                  toast.success(t("common.saved"));
                } catch (e) {
                  errorToast(e);
                }
              }}
            >
              {t("data.savePreset")}
            </Button>
          </div>
          <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-2">
            {entity.fields.map((fd) => (
              <Field key={fd.key} label={`${locale === "bn" ? fd.labelBn : fd.label}${fd.required ? " *" : ""}`} hint={fd.help ?? `${t("data.example")}: ${fd.example || "—"}`}>
                <Select value={mapping[fd.key] ?? ""} onChange={(e) => setMapping({ ...mapping, [fd.key]: e.target.value })} className={cn(fd.required && !mapping[fd.key] && "border-accent")}>
                  <option value="">{t("data.notMapped")}</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h} {rows[0]?.[h] ? `(${String(rows[0][h]).slice(0, 20)})` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-end pt-3 border-t border-line">
            <Field label={t("data.mode")}>
              <Select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
                <option value="ALL_OR_NOTHING">{t("data.allOrNothing")}</option>
                <option value="SKIP_INVALID">{t("data.skipInvalid")}</option>
              </Select>
            </Field>
            <Field label={t("data.strategy")}>
              <Select value={strategy} onChange={(e) => setStrategy(e.target.value as typeof strategy)} disabled={entity.createOnly}>
                <option value="CREATE">{t("data.create")}</option>
                <option value="UPDATE">{t("data.update")}</option>
                <option value="UPSERT">{t("data.upsert")}</option>
              </Select>
            </Field>
            <div className="flex-1" />
            <Button onClick={reset}>{t("common.back")}</Button>
            <Button variant="primary" loading={busy} disabled={entity.fields.some((x) => x.required && !mapping[x.key])} onClick={() => void runDry()}>
              {t("data.dryRun")}
            </Button>
          </div>
        </div>
      ) : null}
      {step === 2 && dry ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Summary label={t("data.rows")} value={dry.total} />
            <Summary label={t("data.willCreate")} value={dry.created} tone="green" />
            <Summary label={t("data.willUpdate")} value={dry.updated} tone="blue" />
            <Summary label={t("data.errorsCount")} value={dry.errors.length} tone={dry.errors.length ? "red" : undefined} />
          </div>
          {dry.errors.length ? (
            <Card>
              <CardHeader title={t("data.errors")} actions={<Button size="sm" onClick={() => errorCsv(dry)}>{t("data.errorCsv")}</Button>} />
              <DataTable rows={dry.errors.slice(0, 300)} rowKey={(e) => `${e.row}-${e.field}-${e.message}`} dense cols={[{ key: "r", header: t("data.row"), cell: (e) => e.row }, { key: "f", header: t("data.field"), cell: (e) => e.field }, { key: "m", header: t("data.problem"), cell: (e) => <span className="text-accent">{e.message}</span> }]} className="max-h-72" />
            </Card>
          ) : (
            <p className="flex items-center gap-2 text-sm text-[var(--st-vacant-clean)]">
              <CheckCircle2 className="size-4" /> {t("data.noErrors")}
            </p>
          )}
          {dry.warnings.length ? <p className="text-xs text-muted">{t("data.warnings", { n: dry.warnings.length })}: {dry.warnings.slice(0, 5).map((w) => `#${w.row} ${w.field}: ${w.message}`).join("; ")}</p> : null}
          {mode === "ALL_OR_NOTHING" && dry.errors.length ? <p className="text-sm text-accent">{t("data.aonBlocked")}</p> : null}
          {progress ? (
            <div className="h-2 rounded bg-surface-2 overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${Math.round((progress.processed / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
          ) : null}
          <div className="flex gap-2 justify-end">
            <Button onClick={() => setStep(1)}>{t("common.back")}</Button>
            <Button variant="primary" icon={<Play className="size-4" />} loading={busy} disabled={(mode === "ALL_OR_NOTHING" && !!dry.errors.length) || !(dry.created + dry.updated)} onClick={() => void execute()}>
              {t("data.importNow", { n: dry.created + dry.updated })}
            </Button>
          </div>
        </div>
      ) : null}
      {step === 3 && result ? (
        <div className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Summary label={t("data.created")} value={result.created} tone="green" />
            <Summary label={t("data.updated")} value={result.updated} tone="blue" />
            <Summary label={t("data.skipped")} value={result.skipped} />
            <Summary label={t("data.errorsCount")} value={result.errors.length} tone={result.errors.length ? "red" : undefined} />
          </div>
          {result.output.length ? (
            <Card className="border-accent">
              <CardHeader title={<span className="flex items-center gap-2"><KeyRound className="size-4 text-accent" />{t("data.tempPasswords")}</span>} sub={t("data.tempPasswordsHint")} />
              <DataTable rows={result.output as { username: string; temporaryPassword: string }[]} rowKey={(o) => o.username} dense cols={[{ key: "u", header: t("auth.username"), cell: (o) => o.username }, { key: "p", header: t("auth.temporaryPassword"), cell: (o) => <code className="font-mono">{o.temporaryPassword}</code> }]} />
            </Card>
          ) : null}
          {result.errors.length ? <Button size="sm" onClick={() => errorCsv(result)}>{t("data.errorCsv")}</Button> : null}
          <p className="text-xs text-muted">{result.backup ? t("data.backupTaken", { file: result.backup }) : ""} {t("data.undoHint")}</p>
          <Button variant="primary" onClick={reset}>
            {t("data.another")}
          </Button>
        </div>
      ) : null}
      <PasteEditor
        open={paste}
        entity={entity}
        onClose={() => setPaste(false)}
        onUse={(r) => {
          setFileName(t("data.pasted"));
          setHeaders(entity.fields.map((x) => x.key));
          setRows(r);
          setMapping(Object.fromEntries(entity.fields.map((x) => [x.key, x.key])));
          setPaste(false);
          setStep(1);
        }}
      />
    </Card>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone?: "green" | "blue" | "red" }) {
  return (
    <div className="rounded-md border border-line p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("text-2xl font-bold num", tone === "green" && "text-st-vc", tone === "blue" && "text-st-res", tone === "red" && "text-accent")}>{value}</p>
    </div>
  );
}

function DropZone({ onFile, busy }: { onFile: (f: File) => void; busy: boolean }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return (
    <div
      onDragOver={(e) => (e.preventDefault(), setOver(true))}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files[0];
        if (file) onFile(file);
      }}
      onClick={() => ref.current?.click()}
      className={cn("rounded-lg border-2 border-dashed p-8 text-center cursor-pointer transition", over ? "border-accent bg-surface-2" : "border-line hover:border-muted")}
    >
      <FileUp className="size-8 mx-auto text-muted" />
      <p className="mt-2 font-semibold">{busy ? t("common.loading") : t("data.dropFile")}</p>
      <p className="text-xs text-muted">{t("data.fileLimits")}</p>
      <input ref={ref} type="file" accept=".csv,.xlsx,.txt" hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
    </div>
  );
}

/** Bulk editor: paste cells copied from Excel (tab-separated) and edit before importing. */
function PasteEditor({ open, entity, onClose, onUse }: { open: boolean; entity: EntityDef; onClose: () => void; onUse: (rows: Rows) => void }) {
  const t = useT();
  const locale = useLocale();
  const [rows, setRows] = useState<Rows>([]);
  const [withHeader, setWithHeader] = useState(false);
  useEffect(() => {
    if (open) setRows([Object.fromEntries(entity.fields.map((x) => [x.key, ""]))]);
  }, [open, entity]);
  const keys = entity.fields.map((x) => x.key);
  const onPaste = (e: React.ClipboardEvent, r: number, c: number) => {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();
    let grid = text.replace(/\r/g, "").split("\n").filter((l, i, a) => l.length || i < a.length - 1).map((l) => l.split("\t"));
    if (withHeader) grid = grid.slice(1);
    setRows((prev) => {
      const next = [...prev];
      grid.forEach((cells, i) => {
        const row = { ...(next[r + i] ?? Object.fromEntries(keys.map((k) => [k, ""]))) };
        cells.forEach((v, j) => {
          const k = keys[c + j];
          if (k) row[k] = v.trim();
        });
        next[r + i] = row;
      });
      return next;
    });
  };
  const filled = rows.filter((r) => Object.values(r).some((v) => v.trim()));
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("data.pasteFromExcel")}
      description={t("data.pasteHelp")}
      size="full"
      footer={
        <>
          <Checkbox className="mr-auto" checked={withHeader} onChange={(e) => setWithHeader(e.target.checked)} label={t("data.firstRowHeader")} />
          <Button onClick={() => setRows([...rows, Object.fromEntries(keys.map((k) => [k, ""]))])}>{t("data.addRow")}</Button>
          <Button variant="primary" disabled={!filled.length} onClick={() => onUse(filled)}>
            {t("data.useRows", { n: filled.length })}
          </Button>
        </>
      }
    >
      <div className="overflow-auto max-h-[60vh]">
        <table className="text-xs border-collapse">
          <thead className="sticky top-0 bg-surface-2">
            <tr>
              <th className="px-1 border border-line">#</th>
              {entity.fields.map((fd) => (
                <th key={fd.key} className="px-2 py-1 border border-line whitespace-nowrap text-left font-semibold">
                  {locale === "bn" ? fd.labelBn : fd.label}
                  {fd.required ? " *" : ""}
                </th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r}>
                <td className="px-1 border border-line text-muted">{r + 1}</td>
                {keys.map((k, c) => (
                  <td key={k} className="border border-line p-0">
                    <input className="w-32 px-1.5 py-1 bg-transparent focus:outline-none focus:bg-surface-2" value={row[k] ?? ""} onPaste={(e) => onPaste(e, r, c)} onChange={(e) => setRows(rows.map((x, i) => (i === r ? { ...x, [k]: e.target.value } : x)))} />
                  </td>
                ))}
                <td className="px-1">
                  <button onClick={() => setRows(rows.filter((_, i) => i !== r))} className="text-muted hover:text-accent" aria-label={t("common.remove")}>
                    <Trash2 className="size-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );
}

function History() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const list = useQuery({ queryKey: ["data", "batches"], queryFn: () => get<{ id: string; entity: string; fileName: string; mode: string; strategy: string; status: string; total: number; created: number; updated: number; skipped: number; createdAt: string; expiresAt: string; undoable: boolean }[]>("/data/import/batches") });
  return (
    <Card>
      <DataTable
        rows={list.data}
        rowKey={(b) => b.id}
        cols={[
          { key: "d", header: t("common.date"), cell: (b) => f.dateTime(b.createdAt) },
          { key: "e", header: t("data.entity"), cell: (b) => ENTITIES.find((e) => e.id === b.entity)?.label ?? b.entity },
          { key: "file", header: t("data.file"), cell: (b) => <span className="text-xs">{b.fileName}</span> },
          { key: "s", header: t("common.status"), cell: (b) => <StatusBadge status={b.status} /> },
          { key: "c", header: t("data.created"), cell: (b) => b.created, align: "right" },
          { key: "u", header: t("data.updated"), cell: (b) => b.updated, align: "right" },
          { key: "k", header: t("data.skipped"), cell: (b) => b.skipped, align: "right" },
          {
            key: "a",
            header: "",
            align: "right",
            cell: (b) =>
              b.undoable ? (
                <Button
                  size="xs"
                  icon={<Undo2 className="size-3" />}
                  onClick={async () => {
                    const c = await confirm({ title: t("data.undo"), message: t("data.undoConfirm", { n: b.created + b.updated }), danger: true });
                    if (!c.ok) return;
                    try {
                      await post(`/data/import/batches/${b.id}/undo`);
                      toast.success(t("data.undone"));
                      void qc.invalidateQueries();
                    } catch (e) {
                      errorToast(e);
                    }
                  }}
                >
                  {t("data.undo")}
                </Button>
              ) : null,
          },
        ]}
      />
    </Card>
  );
}

function ExportTab() {
  const t = useT();
  const locale = useLocale();
  const qc = useQueryClient();
  const { can } = useSession();
  const [cfg, setCfg] = useState<Record<string, unknown> | null>(null);
  const [parts, setParts] = useState<string[]>(["taxRules", "paymentMethods", "chargeCodes", "cancellationPolicies", "amenities"]);
  const PARTS = ["hotel", "settings", "taxRules", "paymentMethods", "chargeCodes", "cancellationPolicies", "discountRules", "amenities", "roles"];
  return (
    <div className="grid lg:grid-cols-2 gap-4">
      <Card>
        <CardHeader title={t("data.roundTrip")} sub={t("data.roundTripHint")} />
        <div className="p-3 divide-y divide-line">
          {ENTITIES.map((e) => (
            <div key={e.id} className="flex items-center gap-2 py-2 text-sm">
              <span className="flex-1">{locale === "bn" ? e.labelBn : e.label}</span>
              <Button size="xs" onClick={() => void download(`/data/export/${e.id}?format=xlsx`).catch(errorToast)}>
                XLSX
              </Button>
              <Button size="xs" onClick={() => void download(`/data/export/${e.id}?format=csv`).catch(errorToast)}>
                CSV
              </Button>
            </div>
          ))}
        </div>
      </Card>
      <div className="space-y-4">
        <Card>
          <CardHeader title={t("data.config")} sub={t("data.configHint")} />
          <div className="p-4 space-y-3">
            <Button icon={<HardDriveDownload className="size-4" />} onClick={() => void download("/data/config/export").catch(errorToast)}>
              {t("data.configExport")}
            </Button>
            {can("settings.manage") ? (
              <>
                <input
                  type="file"
                  accept=".json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    try {
                      setCfg(JSON.parse(await file.text()));
                    } catch {
                      errorToast(new Error(t("data.badJson")));
                    }
                  }}
                  className="text-sm"
                />
                {cfg ? (
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-1">
                      {PARTS.map((p) => (
                        <Checkbox key={p} checked={parts.includes(p)} onChange={(e) => setParts(e.target.checked ? [...parts, p] : parts.filter((x) => x !== p))} label={t(`data.part.${p}`)} />
                      ))}
                    </div>
                    <Button
                      variant="primary"
                      icon={<Upload className="size-4" />}
                      disabled={!parts.length}
                      onClick={async () => {
                        try {
                          const r = await post<Record<string, number>>("/data/config/import", { config: cfg, parts });
                          toast.success(t("data.configImported", { list: Object.entries(r).map(([k, v]) => `${k} ${v}`).join(", ") }));
                          setCfg(null);
                          void qc.invalidateQueries();
                        } catch (e) {
                          errorToast(e);
                        }
                      }}
                    >
                      {t("data.configImport")}
                    </Button>
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </Card>
        {can("settings.manage") ? (
          <Card className="p-4">
            <p className="text-sm font-semibold mb-1">{t("data.supportBundle")}</p>
            <p className="text-xs text-muted mb-2">{t("data.supportBundleHint")}</p>
            <Button size="sm" onClick={() => void download("/data/support-bundle").catch(errorToast)}>
              {t("data.downloadBundle")}
            </Button>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

interface BackupRow {
  id: string;
  fileName: string;
  kind: string;
  sizeBytes: number;
  encrypted: boolean;
  status: string;
  error: string;
  createdAt: string;
  exists: boolean;
  appVersion: string;
}

interface BackupCfg {
  enabled: boolean;
  time: string;
  folder: string;
  retentionDays: number;
  encrypt: boolean;
  lastRunDate: string;
  remote: { provider: "none" | "folder" | "s3"; folder: string; endpoint: string; region: string; bucket: string; prefix: string; accessKeyId: string; secretAccessKey: string };
  lastRemote: { at: string; ok: boolean; error: string; fileName: string };
}

function BackupTab() {
  const t = useT();
  const f = useFmt();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const list = useQuery({ queryKey: ["backups"], queryFn: () => get<{ rows: BackupRow[]; health: { state: string; folder: string; encrypt: boolean; last: { at: string } | null } }>("/backups") });
  const settings = useQuery({ queryKey: ["settings"], queryFn: () => get<{ backup: BackupCfg }>("/settings") });
  const [cfg, setCfg] = useState<BackupCfg | null>(null);
  const [busy, setBusy] = useState(false);
  const [restore, setRestore] = useState<{ id?: string; fileBase64?: string; name: string } | null>(null);
  const [key, setKey] = useState("");
  const [insp, setInsp] = useState<{ ok: boolean; problems: string[]; header: { createdAt: string; appVersion: string; hotel: string; encrypted: boolean } } | null>(null);
  const [rk, setRk] = useState<string | null>(null);
  useEffect(() => {
    if (settings.data && !cfg) setCfg(settings.data.backup);
  }, [settings.data, cfg]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["backups"] });
  const inspect = async (r: NonNullable<typeof restore>, recoveryKey?: string) => {
    try {
      setInsp(await post("/backups/inspect", { id: r.id, fileBase64: r.fileBase64, recoveryKey: recoveryKey || undefined }));
    } catch (e) {
      setInsp(null);
      errorToast(e);
    }
  };
  return (
    <div className="grid xl:grid-cols-[1fr_360px] gap-4">
      <Card>
        <CardHeader
          title={t("data.backups")}
          sub={list.data ? `${t(`dash.backup.${list.data.health.state}`)} · ${list.data.health.folder}` : undefined}
          actions={
            <>
              <Button
                size="sm"
                variant="primary"
                icon={<Database className="size-3.5" />}
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    await post("/backups");
                    toast.success(t("data.backupDone"));
                    refresh();
                  } catch (e) {
                    errorToast(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t("data.backupNow")}
              </Button>
              {can("data.restore") ? (
                <label className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs rounded-md border border-line cursor-pointer hover:bg-surface-2">
                  <Upload className="size-3.5" /> {t("data.restoreFile")}
                  <input
                    type="file"
                    accept=".petrabak"
                    hidden
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      const r = { fileBase64: await fileToBase64(file), name: file.name };
                      setRestore(r);
                      setKey("");
                      void inspect(r);
                    }}
                  />
                </label>
              ) : null}
            </>
          }
        />
        <DataTable
          rows={list.data?.rows}
          rowKey={(b) => b.id}
          dense
          cols={[
            { key: "d", header: t("common.date"), cell: (b) => f.dateTime(b.createdAt), sort: (b) => b.createdAt },
            { key: "k", header: t("common.type"), cell: (b) => <Badge>{t(`backupKind.${b.kind}`)}</Badge> },
            { key: "f", header: t("data.file"), cell: (b) => <span className="text-xs">{b.fileName}{b.encrypted ? " 🔒" : ""}</span> },
            { key: "s", header: t("data.size"), cell: (b) => `${(b.sizeBytes / 1048576).toFixed(1)} MB`, align: "right" },
            { key: "st", header: t("common.status"), cell: (b) => (b.status === "OK" ? (b.exists ? <StatusBadge status="OK" /> : <Badge tone="gray">{t("data.missingFile")}</Badge>) : <span className="text-accent text-xs">{b.error}</span>) },
            {
              key: "a",
              header: "",
              align: "right",
              cell: (b) =>
                b.exists ? (
                  <div className="flex justify-end gap-1">
                    <Button size="xs" variant="ghost" onClick={() => void download(`/backups/${b.id}/download`).catch(errorToast)}>
                      <HardDriveDownload className="size-3.5" />
                    </Button>
                    {can("data.restore") ? (
                      <Button size="xs" variant="ghost" icon={<RotateCcw className="size-3" />} onClick={() => (setRestore({ id: b.id, name: b.fileName }), setKey(""), void inspect({ id: b.id, name: b.fileName }))}>
                        {t("data.restore")}
                      </Button>
                    ) : null}
                  </div>
                ) : null,
            },
          ]}
        />
      </Card>
      <div className="space-y-4">
        {cfg && can("settings.manage") ? (
          <Card>
            <CardHeader title={t("data.backupSettings")} />
            <div className="p-4 grid gap-3">
              <Checkbox checked={cfg.enabled} onChange={(e) => setCfg({ ...cfg, enabled: e.target.checked })} label={t("data.dailyBackup")} />
              <div className="grid grid-cols-2 gap-2">
                <Field label={t("data.time")}>
                  <Input type="time" value={cfg.time} onChange={(e) => setCfg({ ...cfg, time: e.target.value })} />
                </Field>
                <Field label={t("data.retention")}>
                  <Input inputMode="numeric" value={cfg.retentionDays} onChange={(e) => setCfg({ ...cfg, retentionDays: Number(e.target.value) || 1 })} />
                </Field>
              </div>
              <Field label={t("data.folder")} hint={t("data.folderHint")}>
                <Input value={cfg.folder} onChange={(e) => setCfg({ ...cfg, folder: e.target.value })} placeholder="D:\\PetraBackups" />
              </Field>
              <Checkbox checked={cfg.encrypt} onChange={(e) => setCfg({ ...cfg, encrypt: e.target.checked })} label={t("data.encrypt")} />
              <Field label={t("data.remote")} hint={t("data.remoteHint")}>
                <select className="h-9 rounded border border-line bg-surface px-2 text-sm w-full" value={cfg.remote.provider} onChange={(e) => setCfg({ ...cfg, remote: { ...cfg.remote, provider: e.target.value as BackupCfg["remote"]["provider"] } })}>
                  <option value="none">{t("data.remoteNone")}</option>
                  <option value="folder">{t("data.remoteFolder")}</option>
                  <option value="s3">{t("data.remoteS3")}</option>
                </select>
              </Field>
              {cfg.remote.provider === "folder" ? (
                <Field label={t("data.folder")}>
                  <Input value={cfg.remote.folder} onChange={(e) => setCfg({ ...cfg, remote: { ...cfg.remote, folder: e.target.value } })} placeholder="\\\\NAS\\PetraBackups" />
                </Field>
              ) : null}
              {cfg.remote.provider === "s3" ? (
                <div className="grid gap-2">
                  {!cfg.encrypt ? <p className="text-xs text-danger">{t("data.remoteNeedsEncrypt")}</p> : null}
                  <Field label="Endpoint">
                    <Input value={cfg.remote.endpoint} onChange={(e) => setCfg({ ...cfg, remote: { ...cfg.remote, endpoint: e.target.value } })} placeholder="https://<account>.r2.cloudflarestorage.com" />
                  </Field>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Bucket">
                      <Input value={cfg.remote.bucket} onChange={(e) => setCfg({ ...cfg, remote: { ...cfg.remote, bucket: e.target.value } })} />
                    </Field>
                    <Field label="Region">
                      <Input value={cfg.remote.region} onChange={(e) => setCfg({ ...cfg, remote: { ...cfg.remote, region: e.target.value } })} />
                    </Field>
                  </div>
                  <Field label="Access key ID">
                    <Input autoComplete="off" value={cfg.remote.accessKeyId} onChange={(e) => setCfg({ ...cfg, remote: { ...cfg.remote, accessKeyId: e.target.value } })} />
                  </Field>
                  <Field label="Secret access key">
                    <Input type="password" autoComplete="new-password" value={cfg.remote.secretAccessKey} onChange={(e) => setCfg({ ...cfg, remote: { ...cfg.remote, secretAccessKey: e.target.value } })} />
                  </Field>
                </div>
              ) : null}
              {cfg.remote.provider !== "none" ? (
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={async () => {
                      try {
                        await put("/settings/backup", cfg);
                        await post("/backups/remote/test", {});
                        toast.success(t("data.remoteOk"));
                      } catch (e) {
                        errorToast(e);
                      }
                    }}
                  >
                    {t("data.remoteTest")}
                  </Button>
                  {cfg.lastRemote.at ? <span className={`text-xs ${cfg.lastRemote.ok ? "text-muted" : "text-danger"}`}>{cfg.lastRemote.ok ? t("data.remoteLastOk", { at: f.dateTime(cfg.lastRemote.at) }) : cfg.lastRemote.error}</span> : null}
                </div>
              ) : null}
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    await put("/settings/backup", cfg);
                    toast.success(t("common.saved"));
                    void settings.refetch();
                    refresh();
                  } catch (e) {
                    errorToast(e);
                  }
                }}
              >
                {t("common.save")}
              </Button>
              {can("data.restore") ? (
                <Button
                  size="sm"
                  icon={<KeyRound className="size-3.5" />}
                  onClick={async () => {
                    try {
                      setRk((await get<{ key: string | null }>("/backups/recovery-key")).key ?? t("data.noKeyYet"));
                    } catch (e) {
                      errorToast(e);
                    }
                  }}
                >
                  {t("data.showRecoveryKey")}
                </Button>
              ) : null}
              {rk ? (
                <div className="rounded border border-accent p-2 text-xs">
                  <p className="font-semibold mb-1 flex items-center gap-1">
                    <ShieldAlert className="size-3.5 text-accent" /> {t("data.recoveryKeyWarn")}
                  </p>
                  <code className="break-all font-mono">{rk}</code>
                </div>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
      <Modal
        open={!!restore}
        onOpenChange={(o) => !o && (setRestore(null), setInsp(null))}
        title={t("data.restoreTitle")}
        description={restore?.name}
        size="sm"
        footer={
          <Button
            variant="danger"
            loading={busy}
            disabled={!insp?.ok}
            onClick={async () => {
              const c = await confirm({ title: t("data.restoreTitle"), message: t("data.restoreWarn"), danger: true, typeToConfirm: "RESTORE" });
              if (!c.ok) return;
              setBusy(true);
              try {
                const r = await post<{ restoredFrom: string; preRestoreBackup: string }>("/backups/restore", { id: restore!.id, fileBase64: restore!.fileBase64, recoveryKey: key || undefined, confirm: "RESTORE" });
                toast.success(t("data.restored", { file: r.preRestoreBackup }));
                setTimeout(() => location.reload(), 1200);
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("data.restore")}
          </Button>
        }
      >
        <div className="space-y-3 text-sm">
          {insp ? (
            <>
              <p>
                {insp.header.hotel} · {f.dateTime(insp.header.createdAt)} · v{insp.header.appVersion} {insp.header.encrypted ? "🔒" : ""}
              </p>
              {insp.problems.map((p) => (
                <p key={p} className="text-accent flex gap-1">
                  <AlertTriangle className="size-4 shrink-0" />
                  {p}
                </p>
              ))}
              {insp.ok ? <p className="text-st-vc">{t("data.backupValid")}</p> : null}
            </>
          ) : (
            <Field label={t("data.recoveryKey")} hint={t("data.recoveryKeyHint")}>
              <div className="flex gap-2">
                <Input value={key} onChange={(e) => setKey(e.target.value)} />
                <Button onClick={() => restore && void inspect(restore, key)}>{t("data.check")}</Button>
              </div>
            </Field>
          )}
          <p className="text-xs text-muted">{t("data.restoreNote")}</p>
        </div>
      </Modal>
    </div>
  );
}

function DemoTab() {
  const t = useT();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const dash = useQuery({ queryKey: ["dashboard", "demo"], queryFn: () => get<{ demoData: boolean }>("/dashboard") });
  const has = dash.data?.demoData;
  return (
    <Card className="p-5 max-w-2xl space-y-3">
      <p className="text-sm">{t("data.demoText")}</p>
      <p className="text-xs text-muted">{t("data.demoUsers")}</p>
      {has ? (
        <Button
          variant="danger"
          loading={busy}
          icon={<Trash2 className="size-4" />}
          onClick={async () => {
            const c = await confirm({ title: t("data.clearDemo"), message: t("data.clearDemoText"), danger: true, typeToConfirm: "CLEAR" });
            if (!c.ok) return;
            setBusy(true);
            try {
              await post("/demo/clear", { confirm: "CLEAR" });
              toast.success(t("data.demoCleared"));
              void qc.invalidateQueries();
            } catch (e) {
              errorToast(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("data.clearDemo")}
        </Button>
      ) : (
        <Button
          variant="primary"
          loading={busy}
          icon={<Database className="size-4" />}
          onClick={async () => {
            setBusy(true);
            try {
              await post("/demo/load");
              toast.success(t("data.demoLoaded"));
              void qc.invalidateQueries();
            } catch (e) {
              errorToast(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("data.loadDemo")}
        </Button>
      )}
      <Textarea readOnly value="demo.gm / demo.fd / demo.hk / demo.acc — Demo@1234 — PIN 7391" className="min-h-10 text-xs" />
    </Card>
  );
}
