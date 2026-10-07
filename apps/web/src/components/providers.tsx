"use client";
import React, { useState, useEffect } from "react";
import { Toaster } from "sonner";
import { SessionProvider } from "@/lib/session";
import { I18nProvider } from "@/lib/i18n";
import { DataProvider, makeQueryClient } from "@/lib/realtime";
import { useQueryClient } from "@tanstack/react-query";
import { useT } from "@/lib/i18n";
import { ApprovalProvider, Button, ConfirmProvider, Modal } from "./ui";

/** Optimistic-locking conflict: another user saved this record first. Offers to reload the latest data. */
function ConflictDialog() {
  const t = useT();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setOpen(true);
    window.addEventListener("petra:conflict", on);
    return () => window.removeEventListener("petra:conflict", on);
  }, []);
  return (
    <Modal
      open={open}
      onOpenChange={setOpen}
      title={t("conflict.title")}
      size="sm"
      footer={
        <>
          <Button onClick={() => setOpen(false)}>{t("conflict.keep")}</Button>
          <Button
            variant="primary"
            onClick={() => {
              void qc.invalidateQueries();
              setOpen(false);
            }}
          >
            {t("conflict.reload")}
          </Button>
        </>
      }
    >
      <p className="text-sm">{t("conflict.text")}</p>
    </Modal>
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(makeQueryClient);
  useEffect(() => {
    if ("serviceWorker" in navigator && location.protocol !== "file:" && process.env.NODE_ENV === "production") navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }, []);
  return (
    <SessionProvider>
      <I18nProvider>
        <DataProvider client={client}>
          <ConfirmProvider>
            <ApprovalProvider>
              {children}
              <ConflictDialog />
              <Toaster position="bottom-right" richColors closeButton toastOptions={{ style: { fontFamily: "var(--font-sans)" } }} />
            </ApprovalProvider>
          </ConfirmProvider>
        </DataProvider>
      </I18nProvider>
    </SessionProvider>
  );
}
