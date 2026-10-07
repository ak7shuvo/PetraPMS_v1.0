// pnpm db:generate — derives the PostgreSQL schema and generates both Prisma clients.
import { prisma, read, toPostgres, write } from "./lib.mjs";

write("prisma/schema.postgres.prisma", toPostgres(read("prisma/schema.prisma")));
prisma(["generate", "--config", "prisma.sqlite.config.ts"]);
prisma(["generate", "--config", "prisma.postgres.config.ts"]);
console.log("Prisma clients generated (sqlite + postgres)");
