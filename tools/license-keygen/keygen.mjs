#!/usr/bin/env node
// PetraPMS License Manager (vendor only — NEVER shipped to customers, never committed).
//
// The private signing key and the licence ledger live in the vendor's own folder, outside the source tree:
//   %USERPROFILE%\.petra-license-manager   (override with PETRA_KEYGEN_DIR)
//
//   init [--write-app] [--encrypt]            create the Ed25519 key pair (once). --encrypt protects private.pem with PETRA_KEY_PASSPHRASE
//   pool --count 500 [--edition STANDARD]     pre-generate AVAILABLE activation references (vendor ledger only — nothing is shipped)
//   issue --customer C --hotel H --rooms N [--ref PETRA-…] [--request PETRAREQ1.…] [--edition E] [--plan ANNUAL]
//         [--terminals 3] [--installations 1] [--expires YYYY-MM-DD] [--support YYYY-MM-DD] [--grace 14]
//         [--status-max-age 90] [--modules a,b] [--hotel-id HTL-…]
//   activate <PETRAREQ1…> --ref PETRA-…       record an activation request (binds an installation, enforces the installation limit)
//   lookup <PETRA-ref | LIC-id>               show a licence and its history
//   list [--state AVAILABLE|ACTIVATED|EXPIRED|SUSPENDED|REVOKED|TRANSFERRED]
//   suspend|revoke|reinstate <id|ref> --reason "…"      then run publish-status
//   publish-status [--out license-status.txt]  signed status list for customers (import in the app or host next to the update feed)
//   transfer <transfer-code> --key <current key>        move a licence to a new computer
//   renew <id|ref> [--expires D] [--support D] [--rooms N] [--terminals N] [--plan P]   re-sign for the same computer
//   verify <key>
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createPrivateKey, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { EDITION_MODULES, MODULES, PRODUCT, REF_PATTERN, generateKeyPair, newActivationRef, parseActivationRequest, parseTransferRequest, signLicense, signStatusList, verifyLicense } from "@petra/core/license";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP_KEY_FILE = path.join(here, "..", "..", "apps", "web", "src", "server", "license-public-key.ts");
const today = () => new Date().toISOString().slice(0, 10);
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

export class ManagerError extends Error {}
const fail = (m) => {
  throw new ManagerError(m);
};

export function defaultDir() {
  return process.env.PETRA_KEYGEN_DIR ? path.resolve(process.env.PETRA_KEYGEN_DIR) : path.join(os.homedir(), ".petra-license-manager");
}

/**
 * Writes the PUBLIC key into the app. `channel` marks it "development" (default) or "production"; the release build
 * (scripts/release-guard.mjs) refuses anything but "production" and any key listed in release/dev-license-keys.json.
 */
export function writeAppKey(pem, file = APP_KEY_FILE, channel = "development") {
  if (!["development", "production"].includes(channel)) fail("channel must be development or production");
  fs.writeFileSync(file, `// Ed25519 public key used to verify license keys offline (PUBLIC key only). Written by the PetraPMS License Manager.\n// The matching private key never leaves the vendor's machine.\nexport const LICENSE_KEY_CHANNEL: "development" | "production" = ${JSON.stringify(channel)};\nexport const LICENSE_PUBLIC_KEY = ${JSON.stringify(pem.trim() + "\n")};\n`);
}

export function createManager(dir = defaultDir()) {
  // The private key must live outside the source tree so it can never be committed, archived or packaged.
  const repo = path.resolve(here, "..", "..");
  const rel = path.relative(repo, path.resolve(dir));
  if (!rel.startsWith("..") && !path.isAbsolute(rel) && process.env.PETRA_ALLOW_REPO_KEYS !== "1") fail(`the key folder ${dir} is inside the source tree. Use a folder outside it (default: ${defaultDir()}).`);
  const PRIV = path.join(dir, "private.pem");
  const PUB = path.join(dir, "public.pem");
  const DB = path.join(dir, "licenses.json");

  const loadDb = () => (fs.existsSync(DB) ? JSON.parse(fs.readFileSync(DB, "utf8")) : { version: 1, statusSeq: 0, licenses: {} });
  const saveDb = (db) => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(DB + ".tmp", JSON.stringify(db, null, 2), { mode: 0o600 });
    fs.renameSync(DB + ".tmp", DB);
  };
  const privateKey = () => {
    if (!fs.existsSync(PRIV)) fail(`no private key in ${dir}. Run: init`);
    const pem = fs.readFileSync(PRIV, "utf8");
    if (pem.includes("ENCRYPTED")) {
      if (!process.env.PETRA_KEY_PASSPHRASE) fail("private.pem is encrypted: set PETRA_KEY_PASSPHRASE");
      return createPrivateKey({ key: pem, passphrase: process.env.PETRA_KEY_PASSPHRASE });
    }
    return createPrivateKey(pem);
  };
  const publicKey = () => (fs.existsSync(PUB) ? fs.readFileSync(PUB, "utf8") : fail(`no public key in ${dir}. Run: init`));
  const find = (db, q) => db.licenses[q] ?? Object.values(db.licenses).find((l) => l.ref === q) ?? fail(`unknown license ${q}`);
  const note = (l, action, text = "") => l.history.push({ at: new Date().toISOString(), action, note: text });
  const stateOf = (l) => (l.state !== "SUSPENDED" && l.state !== "REVOKED" && l.state !== "TRANSFERRED" && l.expiresAt && l.expiresAt < today() ? "EXPIRED" : l.state);

  function init({ writeApp = false, encrypt = false, force = false, production = false } = {}) {
    if (fs.existsSync(PRIV) && !force) fail(`key pair already exists in ${dir} (use --force — every issued key becomes invalid!)`);
    fs.mkdirSync(dir, { recursive: true });
    const kp = generateKeyPair();
    let priv = kp.privateKeyPem;
    if (encrypt) {
      if (!process.env.PETRA_KEY_PASSPHRASE || process.env.PETRA_KEY_PASSPHRASE.length < 12) fail("--encrypt needs PETRA_KEY_PASSPHRASE (12+ characters) in the environment");
      priv = createPrivateKey(kp.privateKeyPem).export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase: process.env.PETRA_KEY_PASSPHRASE }).toString();
    }
    fs.writeFileSync(PRIV, priv, { mode: 0o600 });
    fs.writeFileSync(PUB, kp.publicKeyPem);
    if (writeApp) writeAppKey(kp.publicKeyPem, undefined, production ? "production" : "development");
    return { dir, publicKeyPem: kp.publicKeyPem };
  }

  const blank = (o) => ({
    id: `LIC-${today().replace(/-/g, "")}-${randomBytes(3).toString("hex").toUpperCase()}`,
    ref: newActivationRef((n) => randomBytes(n)),
    state: "AVAILABLE",
    edition: String(o.edition ?? "STANDARD").toUpperCase(),
    createdAt: new Date().toISOString(),
    installations: [],
    history: [],
    key: null,
  });

  function pool(count, o = {}) {
    if (!Number.isInteger(count) || count < 1 || count > 5000) fail("--count must be 1..5000");
    const edition = String(o.edition ?? "STANDARD").toUpperCase();
    if (!EDITION_MODULES[edition]) fail(`edition must be one of ${Object.keys(EDITION_MODULES).join(", ")}`);
    const db = loadDb();
    const out = [];
    for (let i = 0; i < count; i++) {
      const l = blank({ edition });
      note(l, "pooled");
      db.licenses[l.id] = l;
      out.push(l.ref);
    }
    saveDb(db);
    return out;
  }

  function activeInstallations(l) {
    return l.installations.filter((i) => i.state === "ACTIVE");
  }

  function issue(o) {
    const db = loadDb();
    let l;
    if (o.ref) {
      if (!REF_PATTERN.test(o.ref)) fail("--ref must look like PETRA-XXXX-XXXX-XXXX-XXXX");
      l = find(db, o.ref);
      if (l.state !== "AVAILABLE" || l.key) fail(`${l.ref} is ${stateOf(l)} and already issued`);
    } else {
      l = blank(o);
      db.licenses[l.id] = l;
    }
    const edition = String(o.edition ?? l.edition ?? "STANDARD").toUpperCase();
    if (!EDITION_MODULES[edition]) fail(`edition must be one of ${Object.keys(EDITION_MODULES).join(", ")}`);
    const modules = o.modules ? String(o.modules).split(",").map((m) => m.trim()) : [...EDITION_MODULES[edition]];
    for (const m of modules) if (!MODULES.includes(m)) fail(`unknown module ${m} (known: ${MODULES.join(", ")})`);
    if (!modules.includes("core")) modules.unshift("core");
    const rooms = Number(o.rooms);
    const terminals = Number(o.terminals ?? 3);
    const installations = Number(o.installations ?? 1);
    if (!Number.isInteger(rooms) || rooms < 1 || rooms > 2000) fail("--rooms must be 1..2000");
    if (!Number.isInteger(terminals) || terminals < 1 || terminals > 200) fail("--terminals must be 1..200");
    if (!Number.isInteger(installations) || installations < 1 || installations > 20) fail("--installations must be 1..20");
    if (!o.customer || !o.hotel) fail("--customer and --hotel are required");
    for (const k of ["expires", "support"]) if (o[k] && !isDate(o[k])) fail(`--${k} must be YYYY-MM-DD`);
    const graceDays = o.grace != null ? Number(o.grace) : 0;
    const maxAge = o["status-max-age"] != null ? Number(o["status-max-age"]) : null;
    if (!Number.isInteger(graceDays) || graceDays < 0 || graceDays > 90) fail("--grace must be 0..90");
    if (maxAge !== null && (!Number.isInteger(maxAge) || maxAge < 7 || maxAge > 730)) fail("--status-max-age must be 7..730");
    const hotelId = o["hotel-id"] ? String(o["hotel-id"]).toUpperCase() : `HTL-${randomBytes(3).toString("hex").toUpperCase()}`;
    let fingerprint = o.fingerprint ? String(o.fingerprint).toUpperCase() : null;
    let req = null;
    if (o.request) {
      req = parseActivationRequest(String(o.request));
      if (fingerprint && fingerprint !== req.fingerprint) fail("--fingerprint does not match the activation request");
      fingerprint = req.fingerprint;
    }
    const payload = {
      v: 2,
      product: PRODUCT,
      id: l.id,
      ref: l.ref,
      hotelId,
      customer: String(o.customer),
      hotel: String(o.hotel),
      edition,
      plan: String(o.plan ?? (o.expires ? "ANNUAL" : "PERPETUAL")).toUpperCase().slice(0, 24),
      maxRooms: rooms,
      maxTerminals: terminals,
      maxInstallations: installations,
      modules,
      features: [],
      issuedAt: today(),
      expiresAt: o.expires ? String(o.expires) : null,
      supportUntil: o.support ? String(o.support) : null,
      fingerprint,
      graceDays,
      statusMaxAgeDays: maxAge,
    };
    const key = signLicense(payload, privateKey());
    Object.assign(l, { ...payload, key, edition, state: "AVAILABLE" });
    note(l, "issued", `${payload.customer} / ${payload.hotel}`);
    if (req) recordActivation(l, req);
    saveDb(db);
    return { payload, key, state: stateOf(l) };
  }

  function recordActivation(l, req) {
    const existing = l.installations.find((i) => i.fingerprint === req.fingerprint && i.state === "ACTIVE");
    if (!existing) {
      const limit = l.maxInstallations ?? 1;
      if (activeInstallations(l).length >= limit) fail(`installation limit (${limit}) reached for ${l.ref}. Use transfer to move it.`);
      l.installations.push({ fingerprint: req.fingerprint, hotel: req.hotel, appVersion: req.appVersion, activatedAt: new Date().toISOString(), state: "ACTIVE" });
    }
    if (l.state === "AVAILABLE") l.state = "ACTIVATED";
    note(l, "activated", `${req.fingerprint} (${req.hotel}, v${req.appVersion}, ${req.rooms} rooms)`);
  }

  function activate(requestCode, refOrId) {
    const req = parseActivationRequest(requestCode);
    const db = loadDb();
    const l = find(db, refOrId);
    if (!l.key) fail(`${l.ref} has not been issued yet (use issue)`);
    if (l.state === "SUSPENDED" || l.state === "REVOKED") fail(`${l.ref} is ${l.state}`);
    if (l.fingerprint && l.fingerprint !== req.fingerprint) fail("this licence is bound to another computer — use transfer");
    recordActivation(l, req);
    saveDb(db);
    return l;
  }

  function setState(q, state, reason) {
    const db = loadDb();
    const l = find(db, q);
    if (state === "REINSTATE") {
      if (l.state !== "SUSPENDED") fail(`only a suspended licence can be reinstated (${l.ref} is ${l.state}; revocation is permanent)`);
      l.state = l.installations.some((i) => i.state === "ACTIVE") ? "ACTIVATED" : "AVAILABLE";
      note(l, "reinstated", reason);
    } else {
      if (l.state === "REVOKED") fail(`${l.ref} is already revoked`);
      if (!reason) fail("--reason is required");
      l.state = state;
      note(l, state.toLowerCase(), reason);
    }
    db.statusSeq += 1;
    l.statusChangedAt = today();
    saveDb(db);
    return l;
  }

  /** Signed list of every SUSPENDED/REVOKED licence. `seq` increases with every change and every publication. */
  function publishStatus() {
    const db = loadDb();
    db.statusSeq += 1;
    const entries = Object.values(db.licenses)
      .filter((l) => l.state === "SUSPENDED" || l.state === "REVOKED")
      .map((l) => ({ id: l.id, status: l.state, reason: (l.history.filter((h) => h.action === l.state.toLowerCase()).pop()?.note ?? "").slice(0, 120), at: l.statusChangedAt ?? today() }));
    const doc = signStatusList({ v: 1, seq: db.statusSeq, issuedAt: today(), entries }, privateKey());
    saveDb(db);
    return { doc, seq: db.statusSeq, entries: entries.length };
  }

  function transfer(code, currentKey) {
    const req = parseTransferRequest(code);
    const cur = verifyLicense(currentKey, publicKey());
    if (cur.id !== req.licenseId) fail(`transfer code is for ${req.licenseId}, key is ${cur.id}`);
    const db = loadDb();
    const l = db.licenses[cur.id] ?? fail(`${cur.id} is not in this ledger`);
    if (l.state === "SUSPENDED" || l.state === "REVOKED") fail(`${l.ref ?? l.id} is ${l.state}; it cannot be transferred`);
    for (const i of l.installations) if (i.fingerprint === req.oldFp && i.state === "ACTIVE") i.state = "TRANSFERRED";
    const payload = { ...cur, fingerprint: req.newFp };
    const key = signLicense(payload, privateKey());
    l.fingerprint = req.newFp;
    l.key = key;
    l.installations.push({ fingerprint: req.newFp, hotel: cur.hotel, appVersion: "", activatedAt: new Date().toISOString(), state: "ACTIVE" });
    if (l.state === "TRANSFERRED") l.state = "ACTIVATED";
    note(l, "transferred", `${req.oldFp || "(unbound)"} → ${req.newFp}`);
    saveDb(db);
    return { payload, key };
  }

  /** Renewal / upgrade: same licence id and computer, new dates or limits. Not allowed for suspended/revoked licences. */
  function renew(q, o) {
    const db = loadDb();
    const l = find(db, q);
    if (!l.key) fail(`${l.ref} has not been issued yet`);
    if (l.state === "SUSPENDED" || l.state === "REVOKED") fail(`${l.ref} is ${l.state}; reinstate it first (revoked licences cannot be renewed)`);
    const cur = verifyLicense(l.key, publicKey());
    for (const k of ["expires", "support"]) if (o[k] && !isDate(o[k])) fail(`--${k} must be YYYY-MM-DD`);
    const payload = { ...cur, v: 2, product: PRODUCT, issuedAt: today() };
    if (o.expires) payload.expiresAt = String(o.expires);
    if (o.support) payload.supportUntil = String(o.support);
    if (o.rooms) payload.maxRooms = Number(o.rooms);
    if (o.terminals) payload.maxTerminals = Number(o.terminals);
    if (o.plan) payload.plan = String(o.plan).toUpperCase().slice(0, 24);
    if (o.grace != null) payload.graceDays = Number(o.grace);
    if (!Number.isInteger(payload.maxRooms) || payload.maxRooms < 1 || payload.maxRooms > 2000 || !Number.isInteger(payload.maxTerminals) || payload.maxTerminals < 1) fail("invalid rooms/terminals");
    l.key = signLicense(payload, privateKey());
    Object.assign(l, payload);
    note(l, "renewed", `expires ${payload.expiresAt ?? "never"}, rooms ${payload.maxRooms}`);
    saveDb(db);
    return { payload, key: l.key };
  }

  function list(state) {
    return Object.values(loadDb().licenses)
      .map((l) => ({ id: l.id, ref: l.ref, state: stateOf(l), edition: l.edition, customer: l.customer ?? "", hotel: l.hotel ?? "", hotelId: l.hotelId ?? "", rooms: l.maxRooms ?? "", expiresAt: l.expiresAt ?? "", installations: activeInstallations(l).length }))
      .filter((r) => !state || r.state === state.toUpperCase());
  }

  return { dir, pubFile: PUB, init, pool, issue, renew, activate, setState, publishStatus, transfer, list, lookup: (q) => find(loadDb(), q), verify: (k) => verifyLicense(k, publicKey()), stateOf };
}

function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : true;
    else out._.push(a);
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const o = args(argv);
  const cmd = o._[0];
  const m = createManager();
  const need = (i, what) => o._[i] ?? fail(`${what} required`);
  switch (cmd) {
    case "init": {
      m.init({ writeApp: !!o["write-app"], encrypt: !!o.encrypt, force: !!o.force, production: !!o.production });
      console.log(`Key pair created in ${m.dir}.\nBACK UP private.pem SECURELY (offline, two copies). It must never be copied to a customer PC, installer or Git.`);
      if (!o["write-app"]) console.log("Run again with --write-app, or paste public.pem into apps/web/src/server/license-public-key.ts, then rebuild.");
      return;
    }
    case "write-app-key": {
      // Deploy an EXISTING vendor public key into the app (e.g. on a new build machine). Reads public.pem only.
      if (!fs.existsSync(m.pubFile)) fail(`no public key in ${m.dir}; run init first`);
      writeAppKey(fs.readFileSync(m.pubFile, "utf8"), undefined, o.production ? "production" : "development");
      console.log(`Public key written to apps/web/src/server/license-public-key.ts (channel: ${o.production ? "production" : "development"}). Commit that file; never commit private.pem.`);
      return;
    }
    case "pool": {
      const refs = m.pool(Number(o.count), o);
      console.log(`${refs.length} AVAILABLE activation references stored in ${m.dir}\\licenses.json (vendor machine only).`);
      return;
    }
    case "issue": {
      const r = m.issue(o);
      console.log(JSON.stringify(r.payload, null, 2));
      console.log(`\nState: ${r.state}\nActivation reference: ${r.payload.ref}\n\nLICENSE KEY (send to the customer):\n${r.key}\n`);
      return;
    }
    case "activate": {
      const l = m.activate(need(1, "activation request"), String(o.ref ?? fail("--ref required")));
      console.log(`${l.ref} → ${l.state}; installations: ${l.installations.filter((i) => i.state === "ACTIVE").length}/${l.maxInstallations ?? 1}`);
      return;
    }
    case "lookup":
      console.log(JSON.stringify({ ...m.lookup(need(1, "reference or id")), key: undefined }, null, 2));
      return;
    case "list":
      for (const r of m.list(typeof o.state === "string" ? o.state : undefined)) console.log(`${r.state.padEnd(11)} ${r.ref}  ${r.id}  ${r.edition.padEnd(8)} rooms=${r.rooms} inst=${r.installations} exp=${r.expiresAt || "never"}  ${r.hotel}`);
      return;
    case "suspend":
    case "revoke":
    case "reinstate": {
      const l = m.setState(need(1, "license"), cmd === "suspend" ? "SUSPENDED" : cmd === "revoke" ? "REVOKED" : "REINSTATE", typeof o.reason === "string" ? o.reason : "");
      console.log(`${l.ref ?? l.id} is now ${l.state}. Run publish-status and send/host the file so customers pick it up.`);
      return;
    }
    case "publish-status": {
      const r = m.publishStatus();
      const out = path.resolve(typeof o.out === "string" ? o.out : "license-status.txt");
      fs.writeFileSync(out, r.doc);
      console.log(`Status list #${r.seq} (${r.entries} entries) written to ${out}\nHost it at <update feed>/license-status.txt (apps refresh it automatically when online) or give it to the customer to import.`);
      return;
    }
    case "renew": {
      const r = m.renew(need(1, "license"), o);
      console.log(`Renewed ${r.payload.id} (expires ${r.payload.expiresAt ?? "never"}).\n\nNEW LICENSE KEY:\n${r.key}\n`);
      return;
    }
    case "transfer": {
      const r = m.transfer(need(1, "transfer code"), String(o.key ?? fail("--key <current license key> required")));
      console.log(`Transferred ${r.payload.id} to ${r.payload.fingerprint}.\n\nNEW LICENSE KEY:\n${r.key}\n`);
      return;
    }
    case "verify":
      console.log(JSON.stringify(m.verify(need(1, "key")), null, 2));
      return;
    default:
      console.log(fs.readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 25).map((l) => l.replace(/^\/\/ ?/, "")).join("\n"));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (e) {
    console.error(`error: ${e.message}`);
    process.exit(1);
  }
}
