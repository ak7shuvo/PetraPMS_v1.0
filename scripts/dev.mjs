// pnpm dev — web app with hot reload; data in ./.data (never touches %ProgramData%).
import { run, pnpm, webDir, root } from "./_util.mjs";
import path from "node:path";
await run(pnpm, ["--filter", "@petra/db", "generate"]);
await run(pnpm, ["exec", "next", "dev", "--port", process.env.PORT || "3000"], { cwd: webDir, env: { PETRA_DATA_DIR: process.env.PETRA_DATA_DIR || path.join(root, ".data") } });
