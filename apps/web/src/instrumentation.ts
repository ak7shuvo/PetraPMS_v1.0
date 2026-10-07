// Next.js server start hook: crash logging, open the database (runs migrations) and start background jobs.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getDb, closeDb } = await import("./server/db");
  const { startScheduler } = await import("./server/scheduler");
  const { env } = await import("./server/env");
  const { log, errText } = await import("./server/log");

  // Crash & shutdown logging (once per process). A fatal exception is logged first, then the process exits so the
  // Windows Service (WinSW) or the desktop shell restarts it; nothing is left half-running.
  const g = globalThis as { __petraCrashHooks?: boolean };
  if (!g.__petraCrashHooks) {
    g.__petraCrashHooks = true;
    process.on("uncaughtException", (e) => {
      log("error", "crash", `uncaught exception: ${errText(e, 12)}`);
      setTimeout(() => process.exit(1), 100).unref();
    });
    process.on("unhandledRejection", (e) => {
      log("error", "crash", `unhandled promise rejection: ${errText(e, 12)}`);
    });
    const stop = (sig: string) => {
      log("info", "server", `received ${sig}, shutting down`);
      const t = setTimeout(() => process.exit(0), 5000);
      t.unref();
      closeDb().finally(() => process.exit(0));
    };
    process.once("SIGTERM", () => stop("SIGTERM"));
    process.once("SIGINT", () => stop("SIGINT"));
  }

  let e: ReturnType<typeof env> | null = null;
  try {
    e = env();
    log("info", "server", `PetraPMS ${e.appVersion} starting (mode ${e.mode}, database ${e.provider}, port ${e.port}, node ${process.versions.node}, ${process.platform})`);
  } catch (err) {
    log("error", "server", `configuration error: ${errText(err)}`);
  }
  try {
    await getDb();
    log("info", "server", "database ready");
  } catch {
    /* reported by /api/status and logged; the UI shows a database error page */
  }
  if (process.env.PETRA_REALTIME === "postgres" && e?.provider === "postgres" && e.databaseUrl) {
    const { startPgBridge } = await import("./server/events");
    await startPgBridge(e.databaseUrl).catch((err) => log("error", "database", `realtime bridge failed: ${errText(err)}`));
  }
  startScheduler();
}
