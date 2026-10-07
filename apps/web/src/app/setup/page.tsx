"use client";
// Quick Setup wizard: a working hotel in a few minutes (hotel → license → administrator → database check → floors & rooms →
// room types & rates → taxes → backups → review). Everything can be refined later in Settings or the Data Import Center.
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { get, post, put, ApiClientError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { toPoisha, useT, useLocale } from "@/lib/i18n";
import { Button, Card, Checkbox, Field, Input, MoneyInput, Select, Textarea, cn, errorToast, toast } from "@/components/ui";
import { Logo, Splash } from "@/components/shell/splash";

interface Floor {
  floor: string;
  firstNumber: string;
  count: string;
}
interface RType {
  code: string;
  name: string;
  bedType: string;
  baseOccupancy: string;
  maxAdults: string;
  maxChildren: string;
  maxOccupancy: string;
  baseRate: string;
  extraBedRate: string;
}
interface Assign {
  roomTypeCode: string;
  from: string;
  to: string;
}

const BEDS = ["SINGLE", "DOUBLE", "TWIN", "QUEEN", "KING", "TRIPLE"];

export default function SetupPage() {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const { status, loading, login, refresh } = useSession();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [hotel, setHotel] = useState({ name: "", address: "", city: "Dhaka", phone: "", email: "", bin: "", checkInTime: "14:00", checkOutTime: "12:00" });
  const [floors, setFloors] = useState<Floor[]>([
    { floor: "1", firstNumber: "101", count: "10" },
    { floor: "2", firstNumber: "201", count: "10" },
    { floor: "3", firstNumber: "301", count: "10" },
  ]);
  const [types, setTypes] = useState<RType[]>([
    { code: "STD", name: "Standard", bedType: "DOUBLE", baseOccupancy: "2", maxAdults: "2", maxChildren: "1", maxOccupancy: "3", baseRate: "4500", extraBedRate: "1000" },
    { code: "DLX", name: "Deluxe", bedType: "QUEEN", baseOccupancy: "2", maxAdults: "3", maxChildren: "2", maxOccupancy: "4", baseRate: "6500", extraBedRate: "1200" },
    { code: "STE", name: "Suite", bedType: "KING", baseOccupancy: "2", maxAdults: "3", maxChildren: "2", maxOccupancy: "4", baseRate: "12000", extraBedRate: "1500" },
  ]);
  const [assign, setAssign] = useState<Assign[]>([
    { roomTypeCode: "DLX", from: "201", to: "210" },
    { roomTypeCode: "STE", from: "301", to: "303" },
  ]);
  const [tax, setTax] = useState({ vat: "15", sc: "10", mode: "EXCLUSIVE" as "EXCLUSIVE" | "INCLUSIVE" });
  const [admin, setAdmin] = useState({ fullName: "", username: "admin", password: "", password2: "", pin: "" });
  const [loadDemo, setLoadDemo] = useState(false);
  const [licenseKey, setLicenseKey] = useState("");
  const [req, setReq] = useState<{ code: string; fingerprint: string } | null>(null);
  const [envInfo, setEnvInfo] = useState<{ provider: string; dataDir: string; writable: boolean; freeBytes: number; low: boolean; error: string | null; sqliteFile: string | null; version: string } | null>(null);
  const [backup, setBackup] = useState({ enabled: true, time: "03:00", folder: "", encrypt: false });
  const order = ["hotel", "license", "admin", "database", "rooms", "types", "tax", "backup", "review"] as const;
  const cur = order[step];

  useEffect(() => {
    if (!loading && status?.setupComplete) router.replace("/dashboard");
  }, [loading, status, router]);
  useEffect(() => {
    if (cur === "database" && !envInfo) void get<NonNullable<typeof envInfo>>("/setup/environment").then(setEnvInfo, () => undefined);
  }, [cur, envInfo]);

  const rooms = useMemo(() => {
    const out: { number: string; floor: string; type: string }[] = [];
    for (const f of floors) {
      const first = Number(f.firstNumber);
      const n = Math.min(Number(f.count) || 0, 60);
      for (let i = 0; i < n && Number.isFinite(first); i++) {
        const num = String(first + i);
        const a = assign.find((x) => Number(num) >= Number(x.from) && Number(num) <= Number(x.to));
        out.push({ number: num, floor: f.floor, type: a?.roomTypeCode || types[0]?.code || "" });
      }
    }
    return out;
  }, [floors, assign, types]);

  const steps = order.map((id) => t(`setup.${id === "license" ? "licenseStep" : id === "database" ? "databaseStep" : id === "backup" ? "backupStep" : id}`));
  const valid: Record<(typeof order)[number], boolean> = {
    hotel: hotel.name.trim().length >= 2,
    license: true,
    admin: admin.fullName.trim().length >= 2 && admin.username.length >= 3 && admin.password.length >= 8 && admin.password === admin.password2 && (!admin.pin || /^\d{4,6}$/.test(admin.pin)),
    database: !envInfo || envInfo.writable,
    rooms: rooms.length > 0 && new Set(rooms.map((r) => r.number)).size === rooms.length,
    types: types.length > 0 && types.every((x) => x.code && x.name && toPoisha(x.baseRate) !== null) && new Set(types.map((x) => x.code.toUpperCase())).size === types.length,
    tax: Number(tax.vat) >= 0 && Number(tax.sc) >= 0,
    backup: /^\d{2}:\d{2}$/.test(backup.time),
    review: true,
  };

  const submit = async () => {
    setBusy(true);
    try {
      await post("/setup", {
        locale,
        hotel,
        floors: floors.map((f) => ({ floor: f.floor, firstNumber: Number(f.firstNumber), count: Number(f.count) })),
        roomTypes: types.map((x) => ({ code: x.code.toUpperCase(), name: x.name, bedType: x.bedType, baseOccupancy: Number(x.baseOccupancy), maxAdults: Number(x.maxAdults), maxChildren: Number(x.maxChildren), maxOccupancy: Number(x.maxOccupancy), baseRate: toPoisha(x.baseRate) ?? 0, extraBedRate: toPoisha(x.extraBedRate) ?? 0 })),
        assignments: assign.filter((a) => a.from && a.to),
        tax: { vatBp: Math.round(Number(tax.vat) * 100), scBp: Math.round(Number(tax.sc) * 100), mode: tax.mode },
        admin: { fullName: admin.fullName, username: admin.username, password: admin.password, pin: admin.pin },
        loadDemo,
      });
      await refresh();
      await login(admin.username, admin.password);
      // Optional parts: a failure here never undoes the setup; the same screens exist in Settings.
      if (licenseKey.trim()) await post("/license/activate", { key: licenseKey.trim() }).catch(errorToast);
      await put("/settings/backup", backup).catch(errorToast);
      router.replace("/dashboard");
    } catch (e) {
      errorToast(e);
      if (e instanceof ApiClientError && /PIN|password/i.test(e.message)) setStep(order.indexOf("admin"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Splash />;
  const set = <T,>(list: T[], i: number, patch: Partial<T>) => list.map((x, j) => (j === i ? { ...x, ...patch } : x));

  return (
    <div className="min-h-screen bg-bg">
      <header className="h-14 px-5 flex items-center justify-between border-b border-line bg-surface">
        <Logo size={24} />
        <span className="text-sm text-muted">{t("setup.title")}</span>
      </header>
      <div className="max-w-5xl mx-auto p-4 sm:p-6">
        <ol className="flex flex-wrap gap-2 mb-6">
          {steps.map((s, i) => (
            <li key={s} className={cn("flex items-center gap-2 text-xs rounded-full border px-3 py-1", i === step ? "border-accent text-fg font-semibold bg-surface" : i < step ? "border-line text-fg" : "border-line text-muted")}>
              <span className={cn("grid place-items-center size-5 rounded-full text-[10px]", i < step ? "bg-[var(--st-vacant-clean)] text-white" : i === step ? "bg-accent text-white" : "bg-surface-2")}>{i < step ? <Check className="size-3" /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        <Card className="p-5">
          {cur === "hotel" ? (
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label={t("setup.hotelName")} required className="sm:col-span-2">
                <Input value={hotel.name} onChange={(e) => setHotel({ ...hotel, name: e.target.value })} autoFocus placeholder="Hotel Sea Pearl" />
              </Field>
              <Field label={t("common.address")} className="sm:col-span-2">
                <Input value={hotel.address} onChange={(e) => setHotel({ ...hotel, address: e.target.value })} />
              </Field>
              <Field label={t("common.city")}>
                <Input value={hotel.city} onChange={(e) => setHotel({ ...hotel, city: e.target.value })} />
              </Field>
              <Field label={t("common.phone")}>
                <Input value={hotel.phone} onChange={(e) => setHotel({ ...hotel, phone: e.target.value })} />
              </Field>
              <Field label={t("common.email")}>
                <Input value={hotel.email} onChange={(e) => setHotel({ ...hotel, email: e.target.value })} />
              </Field>
              <Field label={t("setup.bin")} hint={t("setup.binHint")}>
                <Input value={hotel.bin} onChange={(e) => setHotel({ ...hotel, bin: e.target.value })} />
              </Field>
              <Field label={t("setup.checkInTime")}>
                <Input type="time" value={hotel.checkInTime} onChange={(e) => setHotel({ ...hotel, checkInTime: e.target.value })} />
              </Field>
              <Field label={t("setup.checkOutTime")}>
                <Input type="time" value={hotel.checkOutTime} onChange={(e) => setHotel({ ...hotel, checkOutTime: e.target.value })} />
              </Field>
            </div>
          ) : null}

          {cur === "rooms" ? (
            <div>
              <p className="text-sm text-muted mb-4">{t("setup.roomsHelp")}</p>
              <div className="grid gap-2">
                {floors.map((f, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 items-end">
                    <Field label={t("setup.floor")}>
                      <Input value={f.floor} onChange={(e) => setFloors(set(floors, i, { floor: e.target.value }))} />
                    </Field>
                    <Field label={t("setup.firstRoom")}>
                      <Input inputMode="numeric" value={f.firstNumber} onChange={(e) => setFloors(set(floors, i, { firstNumber: e.target.value.replace(/\D/g, "") }))} />
                    </Field>
                    <Field label={t("setup.roomCount")}>
                      <Input inputMode="numeric" value={f.count} onChange={(e) => setFloors(set(floors, i, { count: e.target.value.replace(/\D/g, "") }))} />
                    </Field>
                    <Button variant="ghost" onClick={() => setFloors(floors.filter((_, j) => j !== i))} aria-label={t("common.remove")} disabled={floors.length === 1}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button className="mt-3" icon={<Plus className="size-4" />} onClick={() => setFloors([...floors, { floor: String(floors.length + 1), firstNumber: String((floors.length + 1) * 100 + 1), count: "10" }])}>
                {t("setup.addFloor")}
              </Button>
              <p className="mt-4 text-sm">
                <b>{rooms.length}</b> {t("setup.roomsTotal")}: <span className="text-muted">{rooms.slice(0, 12).map((r) => r.number).join(", ")}{rooms.length > 12 ? " …" : ""}</span>
              </p>
              {new Set(rooms.map((r) => r.number)).size !== rooms.length ? <p className="text-sm text-accent mt-1">{t("setup.duplicateRooms")}</p> : null}
            </div>
          ) : null}

          {cur === "types" ? (
            <div className="space-y-5">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      {[t("common.code"), t("common.name"), t("rooms.bed"), t("rooms.baseOcc"), t("rooms.maxAdults"), t("rooms.maxChildren"), t("rooms.maxOcc"), t("rooms.baseRate"), t("rooms.extraBed"), ""].map((h, i) => (
                        <th key={i} className="text-left font-medium px-1 pb-1">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {types.map((x, i) => (
                      <tr key={i}>
                        <td className="p-1 w-20"><Input value={x.code} onChange={(e) => setTypes(set(types, i, { code: e.target.value.toUpperCase() }))} /></td>
                        <td className="p-1 min-w-36"><Input value={x.name} onChange={(e) => setTypes(set(types, i, { name: e.target.value }))} /></td>
                        <td className="p-1 w-28">
                          <Select value={x.bedType} onChange={(e) => setTypes(set(types, i, { bedType: e.target.value }))}>
                            {BEDS.map((b) => <option key={b} value={b}>{t(`bed.${b}`)}</option>)}
                          </Select>
                        </td>
                        {(["baseOccupancy", "maxAdults", "maxChildren", "maxOccupancy"] as const).map((k) => (
                          <td key={k} className="p-1 w-16"><Input inputMode="numeric" value={x[k]} onChange={(e) => setTypes(set(types, i, { [k]: e.target.value.replace(/\D/g, "") } as Partial<RType>))} /></td>
                        ))}
                        <td className="p-1 w-32"><MoneyInput value={x.baseRate} onChange={(v) => setTypes(set(types, i, { baseRate: v }))} /></td>
                        <td className="p-1 w-28"><MoneyInput value={x.extraBedRate} onChange={(v) => setTypes(set(types, i, { extraBedRate: v }))} /></td>
                        <td className="p-1"><Button variant="ghost" disabled={types.length === 1} onClick={() => setTypes(types.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Button icon={<Plus className="size-4" />} onClick={() => setTypes([...types, { code: "", name: "", bedType: "DOUBLE", baseOccupancy: "2", maxAdults: "2", maxChildren: "1", maxOccupancy: "3", baseRate: "", extraBedRate: "0" }])}>
                {t("setup.addType")}
              </Button>
              <div>
                <h3 className="font-semibold text-sm mb-1">{t("setup.assignTitle")}</h3>
                <p className="text-xs text-muted mb-2">{t("setup.assignHelp", { type: types[0]?.name ?? "" })}</p>
                {assign.map((a, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 mb-2">
                    <Select value={a.roomTypeCode} onChange={(e) => setAssign(set(assign, i, { roomTypeCode: e.target.value }))}>
                      {types.map((x) => <option key={x.code} value={x.code}>{x.code} – {x.name}</option>)}
                    </Select>
                    <Input placeholder={t("common.from")} value={a.from} onChange={(e) => setAssign(set(assign, i, { from: e.target.value }))} />
                    <Input placeholder={t("common.to")} value={a.to} onChange={(e) => setAssign(set(assign, i, { to: e.target.value }))} />
                    <Button variant="ghost" onClick={() => setAssign(assign.filter((_, j) => j !== i))}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <Button size="sm" icon={<Plus className="size-4" />} onClick={() => setAssign([...assign, { roomTypeCode: types[0]?.code ?? "", from: "", to: "" }])}>
                  {t("setup.addRange")}
                </Button>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  {types.map((x) => (
                    <span key={x.code} className="rounded border border-line px-2 py-1">
                      {x.code}: <b>{rooms.filter((r) => r.type === x.code).length}</b>
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {cur === "tax" ? (
            <div className="grid sm:grid-cols-3 gap-4 max-w-2xl">
              <Field label={t("setup.vat")} hint="%">
                <Input inputMode="decimal" value={tax.vat} onChange={(e) => setTax({ ...tax, vat: e.target.value })} />
              </Field>
              <Field label={t("setup.sc")} hint="%">
                <Input inputMode="decimal" value={tax.sc} onChange={(e) => setTax({ ...tax, sc: e.target.value })} />
              </Field>
              <Field label={t("setup.taxMode")}>
                <Select value={tax.mode} onChange={(e) => setTax({ ...tax, mode: e.target.value as typeof tax.mode })}>
                  <option value="EXCLUSIVE">{t("setup.exclusive")}</option>
                  <option value="INCLUSIVE">{t("setup.inclusive")}</option>
                </Select>
              </Field>
              <p className="sm:col-span-3 text-sm text-muted">{t("setup.taxHelp")}</p>
            </div>
          ) : null}

          {cur === "admin" ? (
            <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
              <Field label={t("users.fullName")} required>
                <Input value={admin.fullName} onChange={(e) => setAdmin({ ...admin, fullName: e.target.value })} autoFocus />
              </Field>
              <Field label={t("auth.username")} required>
                <Input value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value.toLowerCase() })} autoCapitalize="none" />
              </Field>
              <Field label={t("auth.password")} required hint={t("auth.passwordRules")}>
                <Input type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} autoComplete="new-password" />
              </Field>
              <Field label={t("auth.repeatPassword")} required error={admin.password2 && admin.password2 !== admin.password ? t("auth.mismatch") : null}>
                <Input type="password" value={admin.password2} onChange={(e) => setAdmin({ ...admin, password2: e.target.value })} autoComplete="new-password" />
              </Field>
              <Field label={t("prefs.newPin")} hint={t("setup.pinHint")}>
                <Input inputMode="numeric" maxLength={6} value={admin.pin} onChange={(e) => setAdmin({ ...admin, pin: e.target.value.replace(/\D/g, "") })} />
              </Field>
            </div>
          ) : null}

          {cur === "license" ? (
            <div className="grid gap-4 max-w-2xl">
              <p className="text-sm text-muted">{t("setup.licenseHelp")}</p>
              <div className="rounded border border-line p-3 space-y-2">
                <p className="text-sm font-semibold">{t("settings.requestCode")}</p>
                <p className="text-xs text-muted">{t("settings.requestCodeHint")}</p>
                <Button size="sm" onClick={() => get<{ code: string; fingerprint: string }>(`/setup/request-code?hotel=${encodeURIComponent(hotel.name)}&rooms=${rooms.length}`).then(setReq, errorToast)}>{t("settings.requestCodeBtn")}</Button>
                {req ? (
                  <div className="space-y-1">
                    <code className="block break-all rounded bg-surface-2 p-2 text-xs font-mono">{req.code}</code>
                    <Button size="xs" onClick={() => void navigator.clipboard.writeText(req.code).then(() => toast.success(t("common.copied")))}>{t("common.copy")}</Button>
                  </div>
                ) : null}
              </div>
              <Field label={t("settings.activate")} hint={t("setup.licenseKeyHint")}>
                <Textarea value={licenseKey} onChange={(e) => setLicenseKey(e.target.value)} placeholder="PETRA1.…" className="font-mono text-xs min-h-24" />
              </Field>
              <p className="text-xs text-muted">{t("setup.licenseTrial")}</p>
            </div>
          ) : null}

          {cur === "database" ? (
            <div className="grid gap-3 max-w-2xl text-sm">
              <p className="text-muted">{t("setup.databaseHelp")}</p>
              {envInfo ? (
                <div className="rounded border border-line p-3 space-y-1">
                  <p>{t("setup.dbEngine")}: <b>{envInfo.provider === "sqlite" ? "SQLite" : "PostgreSQL"}</b> · PetraPMS {envInfo.version}</p>
                  <p className="break-all text-xs text-muted">{t("data.folder")}: {envInfo.dataDir}</p>
                  <p>{t("setup.dbWritable")}: <b className={envInfo.writable ? "text-[var(--st-vacant-clean)]" : "text-danger"}>{envInfo.writable ? "✓" : "✗"}</b> · {t("setup.dbFree")}: <b>{Math.round(envInfo.freeBytes / 1048576).toLocaleString()} MB</b></p>
                  {!envInfo.writable ? <p className="text-danger text-xs">{t("dash.storageReadonly")}</p> : envInfo.low ? <p className="text-accent text-xs">{t("dash.storageLow", { mb: Math.round(envInfo.freeBytes / 1048576) })}</p> : null}
                </div>
              ) : (
                <p className="text-muted">…</p>
              )}
            </div>
          ) : null}

          {cur === "backup" ? (
            <div className="grid gap-4 max-w-2xl">
              <p className="text-sm text-muted">{t("setup.backupHelp")}</p>
              <Checkbox checked={backup.enabled} onChange={(e) => setBackup({ ...backup, enabled: e.target.checked })} label={t("data.dailyBackup")} />
              <Field label={t("data.time")}>
                <Input type="time" value={backup.time} onChange={(e) => setBackup({ ...backup, time: e.target.value })} />
              </Field>
              <Field label={t("data.folder")} hint={t("data.folderHint")}>
                <Input value={backup.folder} onChange={(e) => setBackup({ ...backup, folder: e.target.value })} placeholder="D:\\PetraBackups" />
              </Field>
              <Checkbox checked={backup.encrypt} onChange={(e) => setBackup({ ...backup, encrypt: e.target.checked })} label={t("data.encrypt")} />
              <p className="text-xs text-muted">{t("setup.backupEncryptHint")}</p>
            </div>
          ) : null}

          {cur === "review" ? (
            <div className="space-y-3 text-sm">
              <p>
                <b>{hotel.name}</b> · {hotel.city}
              </p>
              <p>
                {rooms.length} {t("setup.roomsTotal")} · {types.map((x) => `${x.code} ${rooms.filter((r) => r.type === x.code).length}`).join(" · ")}
              </p>
              <p>
                {t("setup.vat")} {tax.vat}% · {t("setup.sc")} {tax.sc}% · {tax.mode === "EXCLUSIVE" ? t("setup.exclusive") : t("setup.inclusive")}
              </p>
              <p>
                {t("setup.admin")}: {admin.fullName} ({admin.username})
              </p>
              <p>
                {t("setup.licenseStep")}: {licenseKey.trim() ? t("setup.licenseWillActivate") : t("setup.licenseTrialShort")} · {t("setup.backupStep")}: {backup.enabled ? backup.time : t("setup.off")}{backup.encrypt ? " 🔒" : ""}
              </p>
              <Checkbox checked={loadDemo} onChange={(e) => setLoadDemo(e.target.checked)} label={t("setup.loadDemo")} />
              <p className="text-xs text-muted">{t("setup.demoHint")}</p>
              <p className="text-xs text-muted">{t("setup.importHint")}</p>
            </div>
          ) : null}

          <div className="flex justify-between mt-6 pt-4 border-t border-line">
            <Button icon={<ChevronLeft className="size-4" />} disabled={step === 0} onClick={() => setStep(step - 1)}>
              {t("common.back")}
            </Button>
            {step < order.length - 1 ? (
              <Button variant="primary" disabled={!valid[cur]} onClick={() => setStep(step + 1)}>
                {t("common.next")} <ChevronRight className="size-4" />
              </Button>
            ) : (
              <Button variant="primary" loading={busy} onClick={submit} icon={<Check className="size-4" />}>
                {t("setup.finish")}
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
