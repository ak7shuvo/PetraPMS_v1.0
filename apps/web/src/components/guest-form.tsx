"use client";
// Guest profile form (create / edit) with duplicate detection, foreign-national section (for the police / SB
// report) and ID / photo capture from a webcam or a scanned file.
import React, { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Camera, Upload, AlertTriangle, X } from "lucide-react";
import { get, post, put, fileToDataUrl, getToken } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { Guest } from "@/lib/queries";
import { useCompanies } from "@/lib/queries";
import { Badge, Button, Field, Input, Modal, Select, Textarea, errorToast, toast, useDebounced } from "./ui";

export type GuestDraft = Omit<Guest, "id" | "code" | "fullName" | "idImage" | "idImageBack" | "photo" | "blacklisted" | "blacklistReason" | "loyaltyPoints" | "totalStays" | "totalNights" | "totalSpend" | "lastStayAt" | "company"> & { id?: string };

export const emptyGuest = (): GuestDraft => ({
  title: "",
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  gender: "",
  dateOfBirth: "",
  nationality: "BD",
  idType: "NID",
  idNumber: "",
  passportNumber: "",
  passportExpiry: "",
  passportIssuedAt: "",
  visaNumber: "",
  visaType: "",
  visaExpiry: "",
  arrivalFrom: "",
  arrivalDateBd: "",
  portOfEntry: "",
  purposeOfVisit: "",
  occupation: "",
  address: "",
  city: "",
  country: "BD",
  companyId: null,
  vip: 0,
  preferences: "",
  notes: "",
  marketingOptIn: false,
});

export function toDraft(g: Guest): GuestDraft {
  const d = emptyGuest() as Record<string, unknown>;
  for (const k of Object.keys(d)) if ((g as unknown as Record<string, unknown>)[k] !== undefined) d[k] = (g as unknown as Record<string, unknown>)[k];
  return { ...(d as GuestDraft), id: g.id };
}

const COUNTRIES = ["BD", "IN", "CN", "JP", "KR", "MY", "SG", "TH", "LK", "NP", "PK", "AE", "SA", "QA", "KW", "TR", "GB", "US", "CA", "AU", "DE", "FR", "NL", "IT", "SE", "NO", "DK", "RU"];

export function GuestFields({ value, onChange, compact }: { value: GuestDraft; onChange: (g: GuestDraft) => void; compact?: boolean }) {
  const t = useT();
  const companies = useCompanies();
  const set = (p: Partial<GuestDraft>) => onChange({ ...value, ...p });
  const foreign = value.nationality && value.nationality !== "BD";
  const dupKey = useDebounced(`${value.phone}|${value.idNumber}|${value.passportNumber}`, 500);
  const dups = useQuery({
    queryKey: ["guest-dups", dupKey, value.id],
    enabled: !!(value.phone.replace(/\D/g, "").length >= 10 || value.idNumber.length >= 5 || value.passportNumber.length >= 5),
    queryFn: () => get<{ id: string; code: string; fullName: string; phone: string; blacklisted: boolean }[]>(`/guests/duplicates?phone=${encodeURIComponent(value.phone)}&idNumber=${encodeURIComponent(value.idNumber)}&passportNumber=${encodeURIComponent(value.passportNumber)}${value.id ? `&exclude=${value.id}` : ""}`),
  });
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
        <Field label={t("guest.title")} className="sm:col-span-1">
          <Select value={value.title} onChange={(e) => set({ title: e.target.value })}>
            <option value="">—</option>
            {["Mr", "Mrs", "Ms", "Dr", "Prof", "Eng"].map((x) => (
              <option key={x}>{x}</option>
            ))}
          </Select>
        </Field>
        <Field label={t("guest.firstName")} required className="sm:col-span-2">
          <Input value={value.firstName} onChange={(e) => set({ firstName: e.target.value })} />
        </Field>
        <Field label={t("guest.lastName")} className="sm:col-span-3">
          <Input value={value.lastName} onChange={(e) => set({ lastName: e.target.value })} />
        </Field>
        <Field label={t("common.phone")} className="sm:col-span-2">
          <Input value={value.phone} onChange={(e) => set({ phone: e.target.value })} placeholder="01XXXXXXXXX" inputMode="tel" />
        </Field>
        <Field label={t("common.email")} className="sm:col-span-2">
          <Input value={value.email} onChange={(e) => set({ email: e.target.value })} type="email" />
        </Field>
        <Field label={t("guest.nationality")} className="sm:col-span-1">
          <Select value={value.nationality} onChange={(e) => set({ nationality: e.target.value, idType: e.target.value === "BD" ? value.idType || "NID" : "PASSPORT", country: e.target.value })}>
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("guest.gender")} className="sm:col-span-1">
          <Select value={value.gender} onChange={(e) => set({ gender: e.target.value })}>
            <option value="">—</option>
            <option value="M">{t("guest.male")}</option>
            <option value="F">{t("guest.female")}</option>
            <option value="O">{t("guest.other")}</option>
          </Select>
        </Field>
        <Field label={t("guest.idType")} className="sm:col-span-2">
          <Select value={value.idType} onChange={(e) => set({ idType: e.target.value })}>
            <option value="">—</option>
            {["NID", "PASSPORT", "DRIVING_LICENSE", "BIRTH_CERT", "OTHER"].map((x) => (
              <option key={x} value={x}>
                {t(`idType.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("guest.idNumber")} className="sm:col-span-2">
          <Input value={value.idNumber} onChange={(e) => set({ idNumber: e.target.value })} />
        </Field>
        <Field label={t("guest.dob")} className="sm:col-span-2">
          <Input type="date" value={value.dateOfBirth} onChange={(e) => set({ dateOfBirth: e.target.value })} />
        </Field>
      </div>
      {dups.data?.length ? (
        <div className="rounded-md border border-[var(--st-vacant-dirty)] bg-surface-2 p-2 text-xs">
          <p className="flex items-center gap-1 font-semibold mb-1">
            <AlertTriangle className="size-3.5 text-[var(--st-vacant-dirty)]" /> {t("guest.possibleDuplicates")}
          </p>
          {dups.data.map((d) => (
            <p key={d.id}>
              {d.code} · {d.fullName} · {d.phone} {d.blacklisted ? <Badge tone="red">{t("guest.blacklisted")}</Badge> : null}
            </p>
          ))}
        </div>
      ) : null}
      {foreign ? (
        <div className="rounded-md border border-line p-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <p className="col-span-full text-xs font-semibold text-muted">{t("guest.foreignSection")}</p>
          <Field label={t("guest.passportNumber")} required>
            <Input value={value.passportNumber} onChange={(e) => set({ passportNumber: e.target.value.toUpperCase(), idNumber: value.idNumber || e.target.value.toUpperCase() })} />
          </Field>
          <Field label={t("guest.passportExpiry")}>
            <Input type="date" value={value.passportExpiry} onChange={(e) => set({ passportExpiry: e.target.value })} />
          </Field>
          <Field label={t("guest.visaNumber")}>
            <Input value={value.visaNumber} onChange={(e) => set({ visaNumber: e.target.value })} />
          </Field>
          <Field label={t("guest.visaExpiry")}>
            <Input type="date" value={value.visaExpiry} onChange={(e) => set({ visaExpiry: e.target.value })} />
          </Field>
          <Field label={t("guest.visaType")}>
            <Input value={value.visaType} onChange={(e) => set({ visaType: e.target.value })} />
          </Field>
          <Field label={t("guest.arrivalFrom")}>
            <Input value={value.arrivalFrom} onChange={(e) => set({ arrivalFrom: e.target.value })} />
          </Field>
          <Field label={t("guest.arrivalDateBd")}>
            <Input type="date" value={value.arrivalDateBd} onChange={(e) => set({ arrivalDateBd: e.target.value })} />
          </Field>
          <Field label={t("guest.portOfEntry")}>
            <Input value={value.portOfEntry} onChange={(e) => set({ portOfEntry: e.target.value })} />
          </Field>
          <Field label={t("guest.purpose")} className="col-span-2">
            <Input value={value.purposeOfVisit} onChange={(e) => set({ purposeOfVisit: e.target.value })} />
          </Field>
        </div>
      ) : null}
      {!compact ? (
        <div className="grid grid-cols-2 sm:grid-cols-6 gap-3">
          <Field label={t("common.address")} className="col-span-2 sm:col-span-3">
            <Input value={value.address} onChange={(e) => set({ address: e.target.value })} />
          </Field>
          <Field label={t("common.city")} className="sm:col-span-1">
            <Input value={value.city} onChange={(e) => set({ city: e.target.value })} />
          </Field>
          <Field label={t("guest.occupation")} className="sm:col-span-2">
            <Input value={value.occupation} onChange={(e) => set({ occupation: e.target.value })} />
          </Field>
          <Field label={t("guest.company")} className="sm:col-span-3">
            <Select value={value.companyId ?? ""} onChange={(e) => set({ companyId: e.target.value || null })}>
              <option value="">—</option>
              {companies.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("guest.vip")} className="sm:col-span-1">
            <Select value={value.vip} onChange={(e) => set({ vip: Number(e.target.value) })}>
              {[0, 1, 2, 3].map((v) => (
                <option key={v} value={v}>
                  {v ? `VIP ${v}` : "—"}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t("guest.preferences")} className="col-span-2 sm:col-span-2">
            <Input value={value.preferences} onChange={(e) => set({ preferences: e.target.value })} />
          </Field>
          <Field label={t("common.notes")} className="col-span-full">
            <Textarea value={value.notes} onChange={(e) => set({ notes: e.target.value })} className="min-h-14" />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

/** Serialises a draft for the API (server normalises phone etc.). */
export function guestPayload(g: GuestDraft) {
  const { id: _id, ...rest } = g;
  return { ...rest, email: rest.email.trim(), companyId: rest.companyId || null };
}

export async function saveGuest(g: GuestDraft): Promise<Guest> {
  return g.id ? put<Guest>(`/guests/${g.id}`, guestPayload(g)) : post<Guest>("/guests", guestPayload(g));
}

/** Webcam / file capture of an ID card, passport page or guest photo. */
export function DocumentCapture({ guestId, kind, current, onSaved }: { guestId: string; kind: "idImage" | "idImageBack" | "photo"; current?: string; onSaved?: (file: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [camError, setCamError] = useState("");

  useEffect(() => {
    if (!open) return;
    let alive = true;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } } })
      .then((s) => {
        if (!alive) return s.getTracks().forEach((x) => x.stop());
        stream.current = s;
        if (video.current) {
          video.current.srcObject = s;
          void video.current.play();
        }
      })
      .catch(() => setCamError(t("capture.noCamera")));
    return () => {
      alive = false;
      stream.current?.getTracks().forEach((x) => x.stop());
      stream.current = null;
    };
  }, [open, t]);

  const upload = async (dataUrl: string) => {
    setBusy(true);
    try {
      const r = await post<{ file: string }>(`/guests/${guestId}/documents`, { kind, dataUrl });
      toast.success(t("capture.saved"));
      onSaved?.(r.file);
      setOpen(false);
      setPreview(null);
    } catch (e) {
      errorToast(e);
    } finally {
      setBusy(false);
    }
  };
  const snap = () => {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")!.drawImage(v, 0, 0);
    setPreview(c.toDataURL("image/jpeg", 0.85));
  };
  const label = t(`capture.${kind}`);
  return (
    <div className="flex items-center gap-2">
      {current ? <AuthImage name={current} className="h-12 w-16 object-cover rounded border border-line" /> : <div className="h-12 w-16 rounded border border-dashed border-line grid place-items-center text-[10px] text-muted">{label}</div>}
      <Button size="sm" icon={<Camera className="size-3.5" />} onClick={() => setOpen(true)}>
        {current ? t("capture.retake") : label}
      </Button>
      <Modal
        open={open}
        onOpenChange={(o) => (setOpen(o), setPreview(null), setCamError(""))}
        title={label}
        size="lg"
        footer={
          <>
            <label className="mr-auto">
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setPreview(await fileToDataUrl(f));
                }}
              />
              <span className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-line text-sm cursor-pointer hover:bg-surface-2">
                <Upload className="size-4" /> {t("capture.file")}
              </span>
            </label>
            {preview ? (
              <>
                <Button icon={<X className="size-4" />} onClick={() => setPreview(null)}>
                  {t("capture.retake")}
                </Button>
                <Button variant="primary" loading={busy} onClick={() => void upload(preview)}>
                  {t("common.save")}
                </Button>
              </>
            ) : (
              <Button variant="primary" icon={<Camera className="size-4" />} onClick={snap} disabled={!!camError}>
                {t("capture.snap")}
              </Button>
            )}
          </>
        }
      >
        <div className="aspect-video bg-black rounded overflow-hidden grid place-items-center">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="" className="max-h-full" />
          ) : camError ? (
            <p className="text-white/70 text-sm p-4 text-center">{camError}</p>
          ) : (
            <video ref={video} playsInline muted className="w-full h-full object-contain" />
          )}
        </div>
      </Modal>
    </div>
  );
}

/** Displays an uploaded file through the authenticated files API. */
export function AuthImage({ name, className }: { name: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    fetch(`/api/files/${encodeURIComponent(name)}`, { headers: { authorization: `Bearer ${getToken()}` } })
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => {
        if (b && alive) setSrc((url = URL.createObjectURL(b)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [name]);
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="" className={className} /> : <div className={className} />;
}
