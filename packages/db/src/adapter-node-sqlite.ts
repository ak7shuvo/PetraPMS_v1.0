// Prisma driver adapter for the SQLite engine built into Node.js / Electron (`node:sqlite`).
// Ported from @prisma/adapter-better-sqlite3 (Apache-2.0) so that PetraPMS ships without any native module:
// the same server bundle runs in Node 22, inside Electron (ELECTRON_RUN_AS_NODE) and in a Windows Service,
// and a Windows installer can be cross-built from any OS.
import {
  ColumnTypeEnum,
  DriverAdapterError,
  type ArgType,
  type ColumnType,
  type IsolationLevel,
  type SqlDriverAdapter,
  type SqlDriverAdapterFactory,
  type SqlQuery,
  type SqlResultSet,
  type Transaction,
  type TransactionOptions,
} from "@prisma/driver-adapter-utils";

type SqliteRow = unknown[];
interface StatementSync {
  all(...args: unknown[]): unknown[];
  get(...args: unknown[]): unknown;
  run(...args: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  columns(): { name: string; type: string | null }[];
  setReturnArrays(v: boolean): void;
  setReadBigInts(v: boolean): void;
}
export interface DatabaseSync {
  exec(sql: string): void;
  prepare(sql: string): StatementSync;
  close(): void;
}
type SqliteModule = { DatabaseSync: new (file: string, opts?: Record<string, unknown>) => DatabaseSync };

export function loadNodeSqlite(): SqliteModule {
  const p = process as unknown as { getBuiltinModule?: (id: string) => unknown };
  const mod = p.getBuiltinModule?.("node:sqlite") as SqliteModule | undefined;
  if (!mod?.DatabaseSync) throw new Error(`This runtime (${process.version}) has no built-in SQLite (node:sqlite). Node 22.13+ or Electron 35+ is required.`);
  return mod;
}

/** Opens the database file with the PetraPMS pragmas (WAL, foreign keys, busy timeout, full sync). */
export function openSqlite(file: string, opts: { readOnly?: boolean } = {}): DatabaseSync {
  const { DatabaseSync } = loadNodeSqlite();
  const db = new DatabaseSync(file, opts.readOnly ? { readOnly: true } : {});
  if (!opts.readOnly) db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;");
  db.exec("PRAGMA foreign_keys=ON; PRAGMA busy_timeout=10000;");
  return db;
}

// ---------- simple mutex (serialises transactions on the single connection) ----------
class Mutex {
  private chain: Promise<void> = Promise.resolve();
  acquire(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.chain;
    this.chain = prev.then(() => next);
    return prev.then(() => release);
  }
}

// ---------- type conversion (same rules as the official better-sqlite3 adapter) ----------
function mapDeclType(declType: string | null): ColumnType | null {
  if (declType === null) return null;
  switch (declType.toUpperCase()) {
    case "":
      return null;
    case "DECIMAL":
      return ColumnTypeEnum.Numeric;
    case "FLOAT":
      return ColumnTypeEnum.Float;
    case "DOUBLE":
    case "DOUBLE PRECISION":
    case "NUMERIC":
    case "REAL":
      return ColumnTypeEnum.Double;
    case "TINYINT":
    case "SMALLINT":
    case "MEDIUMINT":
    case "INT":
    case "INTEGER":
    case "SERIAL":
    case "INT2":
      return ColumnTypeEnum.Int32;
    case "BIGINT":
    case "UNSIGNED BIG INT":
    case "INT8":
      return ColumnTypeEnum.Int64;
    case "DATETIME":
    case "TIMESTAMP":
      return ColumnTypeEnum.DateTime;
    case "TIME":
      return ColumnTypeEnum.Time;
    case "DATE":
      return ColumnTypeEnum.Date;
    case "TEXT":
    case "CLOB":
    case "CHARACTER":
    case "VARCHAR":
    case "VARYING CHARACTER":
    case "NCHAR":
    case "NATIVE CHARACTER":
    case "NVARCHAR":
      return ColumnTypeEnum.Text;
    case "BLOB":
      return ColumnTypeEnum.Bytes;
    case "BOOLEAN":
      return ColumnTypeEnum.Boolean;
    case "JSONB":
      return ColumnTypeEnum.Json;
    default:
      return null;
  }
}

function inferColumnType(value: unknown): ColumnType {
  switch (typeof value) {
    case "string":
      return ColumnTypeEnum.Text;
    case "bigint":
      return ColumnTypeEnum.Int64;
    case "boolean":
      return ColumnTypeEnum.Boolean;
    case "number":
      return ColumnTypeEnum.UnknownNumber;
    case "object":
      if (value instanceof ArrayBuffer || value instanceof Uint8Array) return ColumnTypeEnum.Bytes;
      throw new Error(`unexpected value of type object`);
    default:
      throw new Error(`unexpected value of type ${typeof value}`);
  }
}

function getColumnTypes(declared: (string | null)[], rows: SqliteRow[]): ColumnType[] {
  const types = declared.map(mapDeclType);
  types.forEach((t, i) => {
    if (t !== null) return;
    for (const row of rows) {
      if (row[i] !== null && row[i] !== undefined) {
        types[i] = inferColumnType(row[i]);
        return;
      }
    }
    types[i] = ColumnTypeEnum.Int32;
  });
  return types as ColumnType[];
}

function mapRow(row: SqliteRow, columnTypes: ColumnType[]): unknown[] {
  const out: unknown[] = [];
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) {
      out[i] = Array.from(v instanceof Uint8Array ? v : new Uint8Array(v));
      continue;
    }
    if (typeof v === "number" && (columnTypes[i] === ColumnTypeEnum.Int32 || columnTypes[i] === ColumnTypeEnum.Int64) && !Number.isInteger(v)) {
      out[i] = Math.trunc(v);
      continue;
    }
    if ((typeof v === "number" || typeof v === "bigint") && columnTypes[i] === ColumnTypeEnum.DateTime) {
      out[i] = new Date(Number(v)).toISOString();
      continue;
    }
    if (typeof v === "bigint") {
      out[i] = v.toString();
      continue;
    }
    out[i] = v === undefined ? null : v;
  }
  return out;
}

function mapArg(arg: unknown, argType: ArgType): unknown {
  if (arg === null || arg === undefined) return null;
  if (typeof arg === "string" && argType.scalarType === "int") return Number.parseInt(arg);
  if (typeof arg === "string" && (argType.scalarType === "float" || argType.scalarType === "decimal")) return Number.parseFloat(arg);
  if (typeof arg === "string" && argType.scalarType === "bigint") return BigInt(arg);
  if (typeof arg === "boolean") return arg ? 1 : 0;
  if (typeof arg === "string" && argType.scalarType === "datetime") arg = new Date(arg);
  if (arg instanceof Date) return arg.toISOString().replace("Z", "+00:00");
  if (typeof arg === "string" && argType.scalarType === "bytes") return Buffer.from(arg, "base64");
  if (Array.isArray(arg) && argType.scalarType === "bytes") return Buffer.from(arg as number[]);
  return arg;
}

// node:sqlite errors carry the extended result code in `errcode` and the message text.
const EXT = { BUSY: 5, UNIQUE: 2067, PRIMARYKEY: 1555, NOTNULL: 1299, FOREIGNKEY: 787, TRIGGER: 1811 } as const;
function convertDriverError(error: unknown) {
  const e = error as { code?: string; errcode?: number; message?: string };
  if (typeof e?.message !== "string") throw error;
  const msg = e.message;
  const fields = () =>
    msg
      .split("constraint failed: ")
      .at(1)
      ?.split(", ")
      .map((f) => f.split(".").pop() as string);
  const base = { originalCode: String(e.errcode ?? e.code ?? ""), originalMessage: msg };
  switch (e.errcode) {
    case EXT.BUSY:
      return { ...base, kind: "SocketTimeout" as const };
    case EXT.UNIQUE:
    case EXT.PRIMARYKEY: {
      const f = fields();
      return { ...base, kind: "UniqueConstraintViolation" as const, constraint: f ? { fields: f } : undefined };
    }
    case EXT.NOTNULL: {
      const f = fields();
      return { ...base, kind: "NullConstraintViolation" as const, constraint: f ? { fields: f } : undefined };
    }
    case EXT.FOREIGNKEY:
    case EXT.TRIGGER:
      return { ...base, kind: "ForeignKeyConstraintViolation" as const, constraint: { foreignKey: {} } };
  }
  if (msg.startsWith("no such table")) return { ...base, kind: "TableDoesNotExist" as const, table: msg.split(": ").at(1) };
  if (msg.startsWith("no such column")) return { ...base, kind: "ColumnNotFound" as const, column: msg.split(": ").at(1) };
  if (msg.includes("has no column named ")) return { ...base, kind: "ColumnNotFound" as const, column: msg.split("has no column named ").at(1) };
  throw error;
}

class Queryable {
  readonly provider = "sqlite" as const;
  readonly adapterName = "@petra/adapter-node-sqlite";
  constructor(protected client: DatabaseSync) {}

  async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const { columnNames, declaredTypes, values } = this.performIO(query);
    const columnTypes = getColumnTypes(declaredTypes, values);
    return { columnNames, columnTypes, rows: values.map((r) => mapRow(r, columnTypes)) as SqlResultSet["rows"] };
  }

  async executeRaw(query: SqlQuery): Promise<number> {
    try {
      const args = query.args.map((a, i) => mapArg(a, query.argTypes[i]));
      const r = this.client.prepare(query.sql).run(...args);
      return Number(r.changes);
    } catch (e) {
      throw new DriverAdapterError(convertDriverError(e));
    }
  }

  protected performIO(query: SqlQuery): { columnNames: string[]; declaredTypes: (string | null)[]; values: SqliteRow[] } {
    try {
      const args = query.args.map((a, i) => mapArg(a, query.argTypes[i]));
      const stmt = this.client.prepare(query.sql);
      const columns = stmt.columns();
      if (columns.length === 0) {
        stmt.run(...args);
        return { columnNames: [], declaredTypes: [], values: [] };
      }
      stmt.setReturnArrays(true);
      stmt.setReadBigInts(true);
      return { columnNames: columns.map((c) => c.name), declaredTypes: columns.map((c) => c.type), values: stmt.all(...args) as SqliteRow[] };
    } catch (e) {
      throw new DriverAdapterError(convertDriverError(e));
    }
  }
}

class NodeSqliteTransaction extends Queryable implements Transaction {
  constructor(
    client: DatabaseSync,
    readonly options: TransactionOptions,
    private unlock: () => void,
  ) {
    super(client);
  }
  async commit(): Promise<void> {
    this.unlock();
  }
  async rollback(): Promise<void> {
    this.unlock();
  }
}

class NodeSqliteAdapter extends Queryable implements SqlDriverAdapter {
  private mutex = new Mutex();

  // There is one SQLite connection. A statement issued outside a transaction must wait until any open
  // interactive transaction finishes, otherwise it would silently become part of (and roll back with) it.
  override async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
    const release = await this.mutex.acquire();
    try {
      return await super.queryRaw(query);
    } finally {
      release();
    }
  }
  override async executeRaw(query: SqlQuery): Promise<number> {
    const release = await this.mutex.acquire();
    try {
      return await super.executeRaw(query);
    } finally {
      release();
    }
  }
  async executeScript(script: string): Promise<void> {
    try {
      this.client.exec(script);
    } catch (e) {
      throw new DriverAdapterError(convertDriverError(e));
    }
  }
  async startTransaction(isolationLevel?: IsolationLevel): Promise<Transaction> {
    if (isolationLevel && isolationLevel !== "SERIALIZABLE") throw new DriverAdapterError({ kind: "InvalidIsolationLevel", level: isolationLevel });
    const release = await this.mutex.acquire();
    try {
      this.client.prepare("BEGIN IMMEDIATE").run();
    } catch (e) {
      release();
      throw new DriverAdapterError(convertDriverError(e));
    }
    return new NodeSqliteTransaction(this.client, { usePhantomQuery: false }, release);
  }
  async dispose(): Promise<void> {
    this.client.close();
  }
}

export class PrismaNodeSqlite implements SqlDriverAdapterFactory {
  readonly provider = "sqlite" as const;
  readonly adapterName = "@petra/adapter-node-sqlite";
  constructor(
    private file: string,
    private onOpen?: (db: DatabaseSync) => void,
  ) {}
  async connect(): Promise<SqlDriverAdapter> {
    const db = openSqlite(this.file);
    this.onOpen?.(db);
    return new NodeSqliteAdapter(db);
  }
  async connectToShadowDb(): Promise<SqlDriverAdapter> {
    return new NodeSqliteAdapter(openSqlite(":memory:"));
  }
}
