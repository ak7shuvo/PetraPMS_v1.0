import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@petra/core/license": path.resolve(__dirname, "packages/core/src/license.ts"),
      "@petra/core": path.resolve(__dirname, "packages/core/src/index.ts"),
      "@petra/db": path.resolve(__dirname, "packages/db/src/index.ts"),
      "@": path.resolve(__dirname, "apps/web/src"),
    },
  },
  test: {
    include: ["packages/**/test/**/*.test.ts", "apps/web/src/**/*.test.ts", "apps/web/test/**/*.test.ts", "tools/**/*.test.ts"],
    environment: "node",
    testTimeout: 30000,
    hookTimeout: 60000,
    pool: "forks",
  },
});
