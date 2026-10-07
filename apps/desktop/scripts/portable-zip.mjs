// Portable ZIP: electron-builder "dir" target zipped, plus a README. Run after `pnpm build` on Windows.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
execFileSync("npx", ["electron-builder", "--win", "dir", "--x64", "--config", "electron-builder.yml"], { cwd: root, stdio: "inherit", shell: true });
const dist = path.resolve(root, "../../dist");
const unpacked = path.join(dist, "win-unpacked");
fs.writeFileSync(path.join(unpacked, "README-PORTABLE.txt"), "PetraPMS portable\r\n1. Extract this folder anywhere.\r\n2. Run PetraPMS.exe.\r\nSet environment variable PETRA_DATA_DIR to keep data next to the app (e.g. a USB drive); otherwise data is in %ProgramData%\\PetraPMS.\r\n");
const zip = path.join(dist, `PetraPMS-${JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version}-portable-win-x64.zip`);
execFileSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${unpacked}\\*' -DestinationPath '${zip}' -Force`], { stdio: "inherit" });
console.log("Created", zip);
