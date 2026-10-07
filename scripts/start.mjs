// pnpm start — run the production build (no Electron). PORT, HOSTNAME and PETRA_DATA_DIR are honoured.
import { run, standaloneWeb, stageStandalone, root } from "./_util.mjs";
import path from "node:path";
stageStandalone();
await run(process.execPath, [path.join(standaloneWeb, "server.js")], { cwd: standaloneWeb, env: { PETRA_DATA_DIR: process.env.PETRA_DATA_DIR || path.join(root, ".data"), PORT: process.env.PORT || "3000", HOSTNAME: process.env.HOSTNAME || "127.0.0.1", NODE_ENV: "production" } });
