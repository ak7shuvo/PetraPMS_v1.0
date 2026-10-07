// Prisma client factory. One codebase, two providers, selected by configuration only:
//   DATABASE_PROVIDER=sqlite   (default, on-premise)  → node:sqlite driver adapter, file in the data folder
//   DATABASE_PROVIDER=postgres (cloud / VPS)          → @prisma/adapter-pg with DATABASE_URL
// Both generated clients expose the same model API; the SQLite client's types are used as the canonical type.
import { PrismaClient as SqliteClient } from "../generated/sqlite/client";
import { PrismaNodeSqlite } from "./adapter-node-sqlite";
import type { Provider } from "./migrate";

export type Db = SqliteClient;
export type Tx = Omit<SqliteClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

export interface DbConfig {
  provider: Provider;
  sqliteFile?: string;
  databaseUrl?: string;
}

export async function createDb(cfg: DbConfig): Promise<Db> {
  if (cfg.provider === "postgres") {
    if (!cfg.databaseUrl) throw new Error("DATABASE_URL is required when DATABASE_PROVIDER=postgres");
    const [{ PrismaClient: PgClient }, { PrismaPg }] = await Promise.all([import("../generated/postgres/client"), import("@prisma/adapter-pg")]);
    const adapter = new PrismaPg({ connectionString: cfg.databaseUrl, max: 10 });
    return new PgClient({ adapter }) as unknown as Db;
  }
  if (!cfg.sqliteFile) throw new Error("sqliteFile is required for the SQLite provider");
  return new SqliteClient({ adapter: new PrismaNodeSqlite(cfg.sqliteFile) });
}
