"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Banknote, FileText, MoreHorizontal, Plus, Printer, Receipt, Split, Undo2 } from "lucide-react";
import { get, openPdf, post, put } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fromPoisha, toPoisha, useFmt, useT } from "@/lib/i18n";
import { useChargeCodes, useCompanies, useHotel, usePaymentMethods } from "@/lib/queries";
import { Badge, Button, Card, CardHeader, Checkbox, DataTable, Field, Input, Menu, Modal, MoneyInput, PageHeader, Select, Skeleton, StatusBadge, cn, errorToast, toast, useConfirm, useWithApproval } from "@/components/ui";
import { useTitle } from "@/components/shell/auth-screens";

interface Charge {
  id: string;
  businessDate: string;
  category: string;
  description: string;
  quantity: number;
  unitAmount: number;
  amount: number;
  serviceCharge: number;
  vat: number;
  total: number;
  source: string;
  roomNumber: string;
  isAdjustment: boolean;
  reason: string;
  voidedAt: string | null;
  voidReason: string;
  createdAt: string;
}
interface Payment {
  id: string;
  businessDate: string;
  type: string;
  method: string;
  amount: number;
  reference: string;
  receiptNo: string;
  voidedAt: string | null;
  voidReason: string;
  createdAt: string;
}
interface Folio {
  id: string;
  number: string;
  name: string;
  type: string;
  status: string;
  cityLedger: boolean;
  dueDate: string;
  parentFolioId: string | null;
  routing: string[];
  version: number;
  companyId: string | null;
  charges: Charge[];
  payments: Payment[];
  invoices: { id: string; number: string; total: number; issuedAt: string; voidedAt: string | null }[];
  guest: { id: string; fullName: string; phone: string } | null;
  company: { id: string; name: string } | null;
  reservation: { id: string; confirmationNo: string; arrivalDate: string; departureDate: string; status: string } | null;
  reservationRoom: { id: string; room: { number: string } | null; arrivalDate: string; departureDate: string; status: string } | null;
  balance: { charges: number; net: number; serviceCharge: number; vat: number; payments: number; refunds: number; balance: number };
  family: { id: string; number: string; name: string; status: string; parentFolioId: string | null; routing: string[] }[];
}

const CATEGORIES = ["ROOM", "EXTRA_BED", "FNB", "LAUNDRY", "MINIBAR", "TRANSPORT", "TOUR", "MISC"];

export default function FolioPage() {
  const t = useT();
  const f = useFmt();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { can } = useSession();
  const hotel = useHotel();
  const q = useQuery({ queryKey: ["folio", id], queryFn: () => get<Folio>(`/folios/${id}`) });
  const fo = q.data;
  useTitle(fo ? `${t("folio.folio")} ${fo.number}` : t("nav.folios"));
  const [charge, setCharge] = useState(false);
  const [pay, setPay] = useState<null | "PAYMENT" | "REFUND" | "DEPOSIT">(null);
  const [split, setSplit] = useState(false);
  const [cl, setCl] = useState(false);
  const [routing, setRouting] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const [showVoid, setShowVoid] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["folio"] });
    void qc.invalidateQueries({ queryKey: ["reservation"] });
    setSel([]);
  };
  const charges = useMemo(() => (fo?.charges ?? []).filter((c) => showVoid || !c.voidedAt), [fo, showVoid]);
  if (!fo) return <Skeleton className="h-64" />;
  const open = fo.status === "OPEN";
  const bal = fo.balance.balance;
  const run = async (fn: () => Promise<unknown>, ok = t("common.saved")) => {
    try {
      await fn();
      toast.success(ok);
      refresh();
    } catch (e) {
      errorToast(e);
    }
  };
  const voidCharge = async (c: Charge) => {
    const r = await confirm({ title: t("folio.voidCharge"), message: `${c.description} · ${f.money(c.total)}`, reason: true, danger: true });
    if (r.ok) await run(() => post(`/charges/${c.id}/void`, { reason: r.reason }));
  };
  const voidPayment = async (p: Payment) => {
    const r = await confirm({ title: t("folio.voidPayment"), message: `${p.receiptNo} · ${p.method} · ${f.money(p.amount)}`, reason: true, danger: true });
    if (r.ok) await run(() => post(`/payments/${p.id}/void`, { reason: r.reason }));
  };
  const issueInvoice = async (format: "A4" | "80mm") => {
    try {
      const inv = await post<{ id: string }>(`/folios/${fo.id}/invoices`, {});
      refresh();
      await openPdf(`/invoices/${inv.id}/pdf${format === "80mm" ? "?format=80mm" : ""}`, { print: true, thermal: format === "80mm" });
    } catch (e) {
      errorToast(e);
    }
  };
  const transfer = async (toFolioId: string) => {
    await run(() => post(`/folios/${fo.id}/transfer`, { chargeIds: sel, toFolioId }), t("folio.transferred"));
  };

  return (
    <div>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            <button onClick={() => router.back()} className="text-muted hover:text-fg" aria-label={t("common.back")}>
              <ArrowLeft className="size-5" />
            </button>
            {t("folio.folio")} {fo.number} <StatusBadge status={fo.status} /> {fo.cityLedger ? <Badge tone="purple">{t("folio.cityLedger")}</Badge> : null}
          </span>
        }
        sub={
          <span>
            {fo.name}
            {fo.reservation ? (
              <>
                {" · "}
                <Link href={`/reservations/${fo.reservation.id}`} className="underline">
                  {fo.reservation.confirmationNo}
                </Link>
              </>
            ) : null}
            {fo.reservationRoom?.room ? ` · ${t("res.room")} ${fo.reservationRoom.room.number}` : ""}
            {fo.company ? ` · ${fo.company.name}` : ""}
          </span>
        }
        actions={
          <>
            {open && can("folio.charge") ? (
              <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCharge(true)}>
                {t("folio.postCharge")}
              </Button>
            ) : null}
            {fo.status !== "CLOSED" && can("folio.payment") ? (
              <Button icon={<Banknote className="size-4" />} onClick={() => setPay("PAYMENT")}>
                {t("folio.takePayment")}
              </Button>
            ) : null}
            <Menu
              trigger={<Button icon={<Printer className="size-4" />}>{t("common.print")}</Button>}
              items={[
                { label: t("folio.proforma"), onSelect: () => void openPdf(`/folios/${fo.id}/proforma/pdf`).catch(errorToast) },
                { label: t("folio.proforma80"), onSelect: () => void openPdf(`/folios/${fo.id}/proforma/pdf?format=80mm`, { print: true, thermal: true }).catch(errorToast) },
                can("folio.invoice") ? "sep" : null,
                can("folio.invoice") ? { label: t("folio.issueInvoiceA4"), icon: <FileText className="size-4" />, onSelect: () => void issueInvoice("A4") } : null,
                can("folio.invoice") ? { label: t("folio.issueInvoice80"), icon: <Receipt className="size-4" />, onSelect: () => void issueInvoice("80mm") } : null,
              ]}
            />
            <Menu
              trigger={<Button icon={<MoreHorizontal className="size-4" />}>{t("common.more")}</Button>}
              items={[
                can("folio.refund") && bal < 0 ? { label: t("folio.refund"), icon: <Undo2 className="size-4" />, onSelect: () => setPay("REFUND") } : null,
                can("folio.payment") ? { label: t("folio.deposit"), onSelect: () => setPay("DEPOSIT") } : null,
                can("folio.transfer") && !fo.parentFolioId && open ? { label: t("folio.split"), icon: <Split className="size-4" />, onSelect: () => setSplit(true) } : null,
                can("folio.transfer") && fo.parentFolioId ? { label: t("folio.routing"), onSelect: () => setRouting(true) } : null,
                can("frontdesk.checkout_balance", "ledger.manage") && bal > 0 && !fo.cityLedger ? { label: t("folio.toCityLedger"), onSelect: () => setCl(true) } : null,
                open && bal === 0 && can("folio.payment") ? { label: t("folio.settle"), onSelect: () => void run(() => post(`/folios/${fo.id}/settle`)) } : null,
                fo.status !== "OPEN" && can("folio.reopen")
                  ? {
                      label: t("folio.reopen"),
                      onSelect: async () => {
                        const r = await confirm({ title: t("folio.reopen"), reason: true });
                        if (r.ok) await run(() => post(`/folios/${fo.id}/reopen`, { reason: r.reason }));
                      },
                    }
                  : null,
              ]}
            />
          </>
        }
      />
      {fo.family.length > 1 ? (
        <div className="flex flex-wrap gap-2 mb-3">
          {fo.family.map((x) => (
            <Link key={x.id} href={`/folios/${x.id}`} className={cn("rounded-md border px-3 py-1.5 text-xs", x.id === fo.id ? "border-accent bg-surface font-semibold" : "border-line bg-surface/60")}>
              {x.number} · {x.name} {x.routing.length ? <span className="text-muted">({x.routing.join(", ")})</span> : null}
            </Link>
          ))}
        </div>
      ) : null}
      <div className="grid xl:grid-cols-[1fr_300px] gap-4">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title={t("folio.charges")}
              actions={
                <>
                  <Checkbox checked={showVoid} onChange={(e) => setShowVoid(e.target.checked)} label={<span className="text-xs">{t("folio.showVoided")}</span>} />
                  {sel.length && can("folio.transfer") && fo.family.length > 1 ? (
                    <Menu
                      trigger={<Button size="sm">{t("folio.transferTo", { n: sel.length })}</Button>}
                      items={fo.family.filter((x) => x.id !== fo.id && x.status === "OPEN").map((x) => ({ label: `${x.number} · ${x.name}`, onSelect: () => void transfer(x.id) }))}
                    />
                  ) : null}
                </>
              }
            />
            <DataTable
              rows={charges}
              rowKey={(c) => c.id}
              dense
              rowClass={(c) => (c.voidedAt ? "line-through opacity-50" : "")}
              cols={[
                ...(can("folio.transfer") && open ? [{ key: "sel", header: "", cell: (c: Charge) => (!c.voidedAt ? <input type="checkbox" className="accent-[var(--accent)]" checked={sel.includes(c.id)} onChange={(e) => setSel(e.target.checked ? [...sel, c.id] : sel.filter((x) => x !== c.id))} /> : null) }] : []),
                { key: "d", header: t("common.date"), cell: (c) => f.short(c.businessDate), sort: (c) => c.businessDate + c.createdAt },
                { key: "desc", header: t("folio.description"), cell: (c) => (<span>{c.description}{c.quantity > 1 ? ` ×${c.quantity}` : ""}{c.isAdjustment ? <Badge tone="amber" className="ml-1">{t("folio.adjustment")}</Badge> : null}{c.source === "POS" ? <Badge className="ml-1">POS</Badge> : null}{c.voidedAt ? <span className="block text-[10px] text-accent no-underline">{t("folio.voided")}: {c.voidReason}</span> : c.reason ? <span className="block text-[10px] text-muted">{c.reason}</span> : null}</span>) },
                { key: "net", header: t("folio.net"), cell: (c) => f.money(c.amount, { symbol: false }), align: "right" },
                { key: "sc", header: "SC", cell: (c) => f.money(c.serviceCharge, { symbol: false }), align: "right" },
                { key: "vat", header: "VAT", cell: (c) => f.money(c.vat, { symbol: false }), align: "right" },
                { key: "tot", header: t("folio.total"), cell: (c) => <b>{f.money(c.total, { symbol: false })}</b>, align: "right" },
                { key: "x", header: "", align: "right", cell: (c) => (!c.voidedAt && open && can("folio.void") ? <Button size="xs" variant="ghost" onClick={() => void voidCharge(c)}>{t("folio.void")}</Button> : null) },
              ]}
            />
          </Card>
          <Card>
            <CardHeader title={t("folio.payments")} />
            <DataTable
              rows={fo.payments.filter((p) => showVoid || !p.voidedAt)}
              rowKey={(p) => p.id}
              dense
              rowClass={(p) => (p.voidedAt ? "line-through opacity-50" : "")}
              empty={<p className="p-4 text-sm text-muted">{t("folio.noPayments")}</p>}
              cols={[
                { key: "d", header: t("common.date"), cell: (p) => f.short(p.businessDate) },
                { key: "r", header: t("folio.receipt"), cell: (p) => p.receiptNo },
                { key: "t", header: t("common.type"), cell: (p) => <Badge tone={p.type === "REFUND" ? "red" : p.type === "DEPOSIT" ? "blue" : "green"}>{t(`payType.${p.type}`)}</Badge> },
                { key: "m", header: t("folio.method"), cell: (p) => `${p.method}${p.reference ? ` · ${p.reference}` : ""}` },
                { key: "a", header: t("folio.amount"), cell: (p) => <b>{f.money(p.type === "REFUND" ? -p.amount : p.amount, { symbol: false })}</b>, align: "right" },
                {
                  key: "x",
                  header: "",
                  align: "right",
                  cell: (p) => (
                    <div className="flex justify-end gap-1">
                      <Button size="xs" variant="ghost" title={t("folio.printReceipt")} onClick={() => void openPdf(`/payments/${p.id}/receipt/pdf`, { print: true, thermal: true }).catch(errorToast)}>
                        <Printer className="size-3.5" />
                      </Button>
                      {!p.voidedAt && fo.status !== "CLOSED" && can("folio.void") ? (
                        <Button size="xs" variant="ghost" onClick={() => void voidPayment(p)}>
                          {t("folio.void")}
                        </Button>
                      ) : null}
                    </div>
                  ),
                },
              ]}
            />
          </Card>
        </div>
        <div className="space-y-4">
          <Card className="p-4 space-y-2 text-sm">
            <Line label={t("folio.net")} value={f.money(fo.balance.net)} />
            <Line label={t("folio.serviceCharge")} value={f.money(fo.balance.serviceCharge)} />
            <Line label="VAT" value={f.money(fo.balance.vat)} />
            <Line label={t("folio.totalCharges")} value={f.money(fo.balance.charges)} bold />
            <Line label={t("folio.paid")} value={f.money(fo.balance.payments)} />
            <div className={cn("flex justify-between rounded px-2 py-2 text-base", bal > 0 ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "bg-surface-2")}>
              <b>{bal >= 0 ? t("folio.balanceDue") : t("folio.credit")}</b>
              <b className={cn("num", bal > 0 && "text-accent")}>{f.money(Math.abs(bal))}</b>
            </div>
            {hotel.data?.showUsd && hotel.data.usdRate ? <p className="text-xs text-muted text-right">≈ USD {(fo.balance.charges / hotel.data.usdRate).toFixed(2)}</p> : null}
            {fo.cityLedger ? <p className="text-xs text-muted">{t("folio.dueDate")}: {f.date(fo.dueDate)}</p> : null}
          </Card>
          <Card>
            <CardHeader title={t("folio.invoices")} />
            <div className="p-2">
              {fo.invoices.length ? (
                fo.invoices.map((i) => (
                  <div key={i.id} className={cn("flex items-center gap-2 px-2 py-1.5 text-sm", i.voidedAt && "line-through opacity-60")}>
                    <span className="flex-1">{i.number}</span>
                    <span className="num">{f.money(i.total)}</span>
                    <Button size="xs" variant="ghost" onClick={() => void openPdf(`/invoices/${i.id}/pdf`).catch(errorToast)}>
                      A4
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => void openPdf(`/invoices/${i.id}/pdf?format=80mm`, { print: true, thermal: true }).catch(errorToast)}>
                      80mm
                    </Button>
                  </div>
                ))
              ) : (
                <p className="text-xs text-muted p-2">{t("folio.noInvoices")}</p>
              )}
            </div>
          </Card>
        </div>
      </div>
      <ChargeDialog open={charge} onClose={() => setCharge(false)} folioId={fo.id} onDone={refresh} />
      <PaymentDialog type={pay} onClose={() => setPay(null)} folioId={fo.id} balance={bal} onDone={refresh} />
      <SplitDialog open={split} onClose={() => setSplit(false)} folioId={fo.id} onDone={(nid) => (refresh(), router.push(`/folios/${nid}`))} />
      <RoutingDialog folio={routing ? fo : null} onClose={() => setRouting(false)} onDone={refresh} />
      <CityLedgerDialog open={cl} onClose={() => setCl(false)} folio={fo} onDone={refresh} />
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span className={cn("num", bold && "font-bold")}>{value}</span>
    </div>
  );
}

function ChargeDialog({ open, onClose, folioId, onDone }: { open: boolean; onClose: () => void; folioId: string; onDone: () => void }) {
  const t = useT();
  const codes = useChargeCodes();
  const withApproval = useWithApproval();
  const [v, setV] = useState({ chargeCode: "", amount: "", quantity: "1", description: "", reason: "", allowance: false });
  const [busy, setBusy] = useState(false);
  const code = codes.data?.find((c) => c.code === v.chargeCode);
  const list = (codes.data ?? []).filter((c) => c.active && (v.allowance ? true : !["DEPOSIT", "CANCELLATION", "OPENING_BALANCE"].includes(c.category)));
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("folio.postCharge")}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!v.chargeCode || !toPoisha(v.amount) || (v.allowance && v.reason.trim().length < 3)}
            onClick={async () => {
              setBusy(true);
              try {
                const amt = toPoisha(v.amount)!;
                await withApproval((approval) => post(`/folios/${folioId}/charges`, { chargeCode: v.chargeCode, amount: v.allowance ? -Math.abs(amt) : amt, quantity: Number(v.quantity) || 1, description: v.description, reason: v.reason, approval }));
                toast.success(t("common.saved"));
                setV({ chargeCode: "", amount: "", quantity: "1", description: "", reason: "", allowance: false });
                onDone();
                onClose();
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("folio.post")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Checkbox checked={v.allowance} onChange={(e) => setV({ ...v, allowance: e.target.checked })} label={t("folio.allowance")} />
        <Field label={t("folio.chargeCode")}>
          <Select value={v.chargeCode} onChange={(e) => {
            const c = codes.data?.find((x) => x.code === e.target.value);
            setV({ ...v, chargeCode: e.target.value, amount: c?.defaultAmount ? fromPoisha(c.defaultAmount) : v.amount });
          }}>
            <option value="">—</option>
            {CATEGORIES.map((cat) => (
              <optgroup key={cat} label={t(`category.${cat}`)}>
                {list.filter((c) => c.category === cat).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </optgroup>
            ))}
            <optgroup label={t("category.OTHER")}>
              {list.filter((c) => !CATEGORIES.includes(c.category)).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} · {c.name}
                </option>
              ))}
            </optgroup>
          </Select>
        </Field>
        <div className="grid grid-cols-[1fr_90px] gap-2">
          <Field label={v.allowance ? t("folio.allowanceAmount") : t("folio.unitAmount")} hint={code && !code.taxable ? t("folio.notTaxable") : t("folio.taxAdded")}>
            <MoneyInput value={v.amount} onChange={(x) => setV({ ...v, amount: x })} autoFocus />
          </Field>
          <Field label={t("folio.qty")}>
            <Input inputMode="numeric" value={v.quantity} onChange={(e) => setV({ ...v, quantity: e.target.value.replace(/\D/g, "") })} />
          </Field>
        </div>
        <Field label={t("folio.description")}>
          <Input value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder={code?.name} />
        </Field>
        {v.allowance || code?.category === "ADJUSTMENT" ? (
          <Field label={t("common.reason")} required hint={t("folio.adjustHint")}>
            <Input value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
          </Field>
        ) : null}
      </div>
    </Modal>
  );
}

function PaymentDialog({ type, onClose, folioId, balance, onDone }: { type: null | "PAYMENT" | "REFUND" | "DEPOSIT"; onClose: () => void; folioId: string; balance: number; onDone: () => void }) {
  const t = useT();
  const pms = usePaymentMethods();
  const hotel = useHotel();
  const withApproval = useWithApproval();
  const [v, setV] = useState({ method: "CASH", amount: "", reference: "", notes: "", usd: "" });
  const [busy, setBusy] = useState(false);
  const [print, setPrint] = useState(true);
  const m = pms.data?.find((x) => x.code === v.method);
  const needsRef = m && ["CARD", "MOBILE", "BANK"].includes(m.type) && type !== "REFUND";
  const suggested = type === "REFUND" ? -balance : balance;
  return (
    <Modal
      open={!!type}
      onOpenChange={(o) => !o && onClose()}
      title={type ? t(`payType.${type}`) : ""}
      size="sm"
      footer={
        <>
          <Checkbox className="mr-auto" checked={print} onChange={(e) => setPrint(e.target.checked)} label={t("folio.printReceipt")} />
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!toPoisha(v.amount) || (needsRef && !v.reference)}
            onClick={async () => {
              setBusy(true);
              try {
                const usdCents = Math.round(Number(v.usd) * 100) || 0;
                const p = await withApproval((approval) => post<{ id: string }>(`/folios/${folioId}/payments`, { type, method: v.method, amount: toPoisha(v.amount), reference: v.reference, notes: v.notes, currency: usdCents ? "USD" : "BDT", foreignAmount: usdCents, approval }));
                toast.success(t("common.saved"));
                onDone();
                onClose();
                setV({ method: "CASH", amount: "", reference: "", notes: "", usd: "" });
                if (print) void openPdf(`/payments/${p.id}/receipt/pdf`, { print: true, thermal: true }).catch(errorToast);
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("common.save")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <div className="grid grid-cols-3 gap-1.5">
          {pms.data?.filter((x) => x.active && x.type !== "CITY_LEDGER").map((x) => (
            <button key={x.code} onClick={() => setV({ ...v, method: x.code })} className={cn("rounded-md border px-2 py-2 text-xs touch-target", v.method === x.code ? "border-accent bg-surface-2 font-semibold" : "border-line")}>
              {x.name}
            </button>
          ))}
        </div>
        <Field label={t("folio.amount")} hint={suggested > 0 ? <button className="underline" onClick={() => setV({ ...v, amount: fromPoisha(suggested) })}>{t("folio.useBalance", { amount: fromPoisha(suggested) })}</button> : undefined}>
          <MoneyInput value={v.amount} onChange={(x) => setV({ ...v, amount: x })} autoFocus />
        </Field>
        {hotel.data?.showUsd && hotel.data.usdRate ? (
          <Field label={t("folio.paidInUsd")} hint={t("folio.usdRate", { rate: (hotel.data.usdRate / 100).toFixed(2) })}>
            <Input inputMode="decimal" value={v.usd} onChange={(e) => setV({ ...v, usd: e.target.value, amount: e.target.value ? fromPoisha(Math.round(Number(e.target.value) * hotel.data!.usdRate)) : v.amount })} />
          </Field>
        ) : null}
        <Field label={m?.type === "MOBILE" ? t("folio.trxId") : t("folio.reference")} required={!!needsRef}>
          <Input value={v.reference} onChange={(e) => setV({ ...v, reference: e.target.value })} />
        </Field>
        <Field label={t("common.notes")}>
          <Input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

function SplitDialog({ open, onClose, folioId, onDone }: { open: boolean; onClose: () => void; folioId: string; onDone: (id: string) => void }) {
  const t = useT();
  const companies = useCompanies(open);
  const [v, setV] = useState({ name: "", routing: ["ROOM"] as string[], companyId: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("folio.split")}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!v.name.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                const nf = await post<{ id: string }>(`/folios/${folioId}/split`, { name: v.name, routing: v.routing, companyId: v.companyId || null });
                toast.success(t("common.saved"));
                onClose();
                onDone(nf.id);
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("common.create")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <p className="text-xs text-muted">{t("folio.splitHelp")}</p>
        <Field label={t("common.name")}>
          <Input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} placeholder={t("folio.splitPlaceholder")} />
        </Field>
        <Field label={t("folio.billTo")}>
          <Select value={v.companyId} onChange={(e) => setV({ ...v, companyId: e.target.value, name: v.name || (companies.data?.find((c) => c.id === e.target.value)?.name ?? "") })}>
            <option value="">{t("folio.guestSelf")}</option>
            {companies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <RoutingPicker value={v.routing} onChange={(r) => setV({ ...v, routing: r })} />
      </div>
    </Modal>
  );
}

function RoutingPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const t = useT();
  return (
    <Field label={t("folio.routeCategories")}>
      <div className="grid grid-cols-2 gap-1.5">
        {[...CATEGORIES, "*"].map((c) => (
          <Checkbox key={c} checked={value.includes(c)} onChange={(e) => onChange(e.target.checked ? [...value, c] : value.filter((x) => x !== c))} label={c === "*" ? t("folio.allCharges") : t(`category.${c}`)} />
        ))}
      </div>
    </Field>
  );
}

function RoutingDialog({ folio, onClose, onDone }: { folio: Folio | null; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const [r, setR] = useState<string[] | null>(null);
  if (!folio) return null;
  const val = r ?? folio.routing;
  return (
    <Modal
      open
      onOpenChange={(o) => !o && (setR(null), onClose())}
      title={t("folio.routing")}
      size="sm"
      footer={
        <Button
          variant="primary"
          onClick={async () => {
            try {
              await put(`/folios/${folio.id}/routing`, { routing: val });
              toast.success(t("common.saved"));
              setR(null);
              onDone();
              onClose();
            } catch (e) {
              errorToast(e);
            }
          }}
        >
          {t("common.save")}
        </Button>
      }
    >
      <RoutingPicker value={val} onChange={setR} />
    </Modal>
  );
}

function CityLedgerDialog({ open, onClose, folio, onDone }: { open: boolean; onClose: () => void; folio: Folio; onDone: () => void }) {
  const t = useT();
  const f = useFmt();
  const companies = useCompanies(open);
  const [companyId, setCompanyId] = useState(folio.companyId ?? "");
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={t("folio.toCityLedger")}
      size="sm"
      footer={
        <Button
          variant="primary"
          loading={busy}
          disabled={!companyId}
          onClick={async () => {
            setBusy(true);
            try {
              await post(`/folios/${folio.id}/city-ledger`, { companyId });
              toast.success(t("common.saved"));
              onDone();
              onClose();
            } catch (e) {
              errorToast(e);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("folio.transfer")}
        </Button>
      }
    >
      <div className="grid gap-3 text-sm">
        <p>
          {t("folio.amount")}: <b>{f.money(folio.balance.balance)}</b>
        </p>
        <Field label={t("res.company")}>
          <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">—</option>
            {companies.data?.filter((c) => c.cityLedger).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.creditLimit ? `(${t("company.limit")} ${f.money(c.creditLimit)})` : ""}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}
