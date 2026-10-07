"use client";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { addDays } from "@petra/core";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Button, Field, Input, Modal, Select, Textarea, errorToast, toast } from "../ui";

export const RACK_COLORS: Record<string, string> = {
  VACANT_CLEAN: "var(--st-vacant-clean)",
  VACANT_DIRTY: "var(--st-vacant-dirty)",
  OCCUPIED: "var(--st-occupied)",
  RESERVED: "var(--st-reserved)",
  OUT_OF_ORDER: "var(--st-ooo)",
  MAINTENANCE: "var(--st-maintenance)",
};


export function BlockDialog({ room, businessDate, onClose }: { room: { id: string; number: string } | null; businessDate: string; onClose: () => void }) {
  const t = useT();
  const qc = useQueryClient();
  const [v, setV] = useState({ type: "OUT_OF_ORDER", startDate: businessDate, endDate: addDays(businessDate, 1), reason: "" });
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open={!!room}
      onOpenChange={(o) => !o && onClose()}
      title={t("rooms.blockTitle", { room: room?.number ?? "" })}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>{t("common.cancel")}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={v.reason.trim().length < 3 || v.endDate <= v.startDate}
            onClick={async () => {
              setBusy(true);
              try {
                await post("/blocks", { roomId: room!.id, ...v });
                toast.success(t("common.saved"));
                void qc.invalidateQueries({ queryKey: ["rack"] });
                void qc.invalidateQueries({ queryKey: ["tape"] });
                onClose();
              } catch (e) {
                errorToast(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("rooms.block")}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <Field label={t("common.type")}>
          <Select value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>
            {["OUT_OF_ORDER", "MAINTENANCE", "HOUSE_USE", "BLOCK"].map((x) => (
              <option key={x} value={x}>
                {t(`blockType.${x}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label={t("common.from")}>
            <Input type="date" value={v.startDate} min={businessDate} onChange={(e) => setV({ ...v, startDate: e.target.value })} />
          </Field>
          <Field label={t("rooms.until")} hint={t("rooms.untilHint")}>
            <Input type="date" value={v.endDate} min={addDays(v.startDate, 1)} onChange={(e) => setV({ ...v, endDate: e.target.value })} />
          </Field>
        </div>
        <Field label={t("common.reason")} required>
          <Textarea value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}
