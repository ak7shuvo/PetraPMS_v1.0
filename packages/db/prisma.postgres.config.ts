// Prisma CLI config (PostgreSQL, generated schema).
import { defineConfig } from "prisma/config";
export default defineConfig({
  engine: "js",
  experimental: { adapter: true },
  schema: "prisma/schema.postgres.prisma",
  adapter: async () => {
    const { PrismaPg } = await import("@prisma/adapter-pg");
    return new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "postgresql://localhost/petrapms" });
  },
} as never);
