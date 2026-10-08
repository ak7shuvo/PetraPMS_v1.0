// Extracts the `## <version>` section of CHANGELOG.md for the release notes of a draft GitHub Release.
// Usage: node scripts/extract-changelog.mjs <version> <out-file>
import fs from "node:fs";
import { root } from "./_util.mjs";
import path from "node:path";

const [version, outFile] = process.argv.slice(2);
if (!version || !outFile) {
  console.error("Usage: node scripts/extract-changelog.mjs <version> <out-file>");
  process.exit(1);
}
const md = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
const escaped = version.replace(/\./g, "\\.");
const m = md.match(new RegExp(`^## ${escaped}[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`, "m"));
fs.writeFileSync(outFile, (m ? m[1].trim() : "(no CHANGELOG entry found for this version)") + "\n");
