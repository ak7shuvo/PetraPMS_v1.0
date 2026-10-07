// Serialisation of inventory-affecting work (booking, room assignment, check-in, payments, night audit).
// Two layers:
//   1. an in-process async mutex (all requests of this server instance)
//   2. inside the database transaction: SQLite BEGIN IMMEDIATE (via the adapter) / PostgreSQL advisory xact lock
//      (covers several app instances sharing one Postgres in cloud mode).
// The availability check and the write happen inside the same lock + transaction, so overbooking is impossible.
import type { Db, Tx } from "./db";
import { env } from "./env";

class Mutex {
  private chain: Promise<void> = Promise.resolve();
  private waiting = 0;
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.chain;
    this.chain = prev.then(() => next);
    this.waiting++;
    await prev;
    this.waiting--;
    try {
      return await fn();
    } finally {
      release();
    }
  }
  get queued() {
    return this.waiting;
  }
}

const g = globalThis as unknown as { __petraLocks?: Map<string, Mutex> };
g.__petraLocks ??= new Map();

function mutex(name: string) {
  let m = g.__petraLocks!.get(name);
  if (!m) g.__petraLocks!.set(name, (m = new Mutex()));
  return m;
}

const ADVISORY: Record<string, number> = { inventory: 727401, folio: 727402, audit: 727403 };

/** Runs fn in a serialized transaction. `name` = "inventory" for anything touching room availability. */
export function lockedTx<T>(db: Db, fn: (tx: Tx) => Promise<T>, name: keyof typeof ADVISORY = "inventory"): Promise<T> {
  return mutex(name).run(() =>
    db.$transaction(
      async (tx) => {
        if (env().provider === "postgres") await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${ADVISORY[name]})`);
        return fn(tx as Tx);
      },
      { timeout: 60_000, maxWait: 30_000 },
    ),
  );
}

/** Plain transaction (no global lock) for unrelated writes. */
export function tx<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.$transaction(async (t) => fn(t as Tx), { timeout: 60_000, maxWait: 30_000 });
}
