// Prisma CLI config (SQLite). Uses the JS/WASM engines only: no native binaries are downloaded.
import { defineConfig } from "prisma/config";
export default defineConfig({
  engine: "js",
  experimental: { adapter: true },
  schema: "prisma/schema.prisma",
  adapter: async () => {
    const { PrismaNodeSqlite } = await import("./src/adapter-node-sqlite.ts");
    return new PrismaNodeSqlite(process.env.PETRA_SQLITE_FILE ?? ":memory:");
  },
} as never);
