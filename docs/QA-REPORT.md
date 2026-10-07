# QA report (build 1.0.0)

Honest status of what was **actually run** in the Linux build environment, and what was **not**.

## Verified (automated)
| Check | Result |
|---|---|
| `vitest` — domain logic, API integration (setup, auth/lockout/PIN, reservations & overbooking, front desk, folio/tax/city ledger, night audit idempotency + rollback, housekeeping, maintenance, import center incl. dry-run/undo/formula injection, backup/restore + encryption, POS API + licence gating, provider-secret masking, i18n parity) | 10 files, 74 tests passed, 1 skipped |
| `tsc --noEmit` (web) | clean |
| `eslint .` | 0 errors (10 warnings) |
| `next build` (production, standalone) | succeeds, 24 routes |
| Playwright e2e on the production build (Chromium): setup wizard → dashboard → front-desk check-in → folio payment → 15 pages render without client errors → switch to Bangla + Bangla digits | 5/5 passed |
| PDFs (A4 invoice, 80 mm Bangla receipt, registration card, report) rendered and visually inspected; PDF opens under the production CSP without violations | OK |
| `node --check` on all Electron main-process files | OK |

## Phase 2 additions (database & data safety)
* **PostgreSQL 16 live:** migrations + the whole API suite (38 tests: setup, booking/overbooking, folio, night audit, import, backup/restore, POS/licence) pass against a real PostgreSQL server (`PETRA_TEST_PG=postgresql://… pnpm vitest run apps/web/test --no-file-parallelism`).
* **Crash test (`pnpm crash-test`):** production server killed with SIGKILL three times in the middle of an 80-request booking storm; after each restart the server came back healthy, and the DB file passed `integrity_check`, `foreign_key_check`, zero overbooked nights, zero orphan rows.
* **Start-up integrity check:** SQLite `quick_check` runs before migrations; a damaged file stops start-up with a clear "restore a backup" error instead of writing to it.

## NOT verified here — must be tested before selling
* **Windows installer (NSIS), portable ZIP, Windows Service (WinSW), firewall rule, UAC flow, tray, auto-update, silent printing, multi-monitor workspaces.** These need Windows; they could not be built or executed in this environment, so they are **untested**. The code and configuration are in `apps/desktop`; follow `docs/RELEASE-CHECKLIST.md` on clean Windows 10 and 11 VMs.
* Electron runtime behaviour in general (the Electron binary was not run here).
* **PostgreSQL / Docker deployment**: Dockerfile, compose, runtime migrator and advisory locks are written but were not run against a live PostgreSQL in this environment.
* Real SMS/email gateways, real thermal/A4 printers, camera capture on real hardware.
* Load/performance with 150 rooms and many concurrent terminals; accessibility audit; Safari/Firefox; tablets.
* Mushak invoice fields vs. current NBR requirements (ask an accountant).

## Known gaps / ideas
* No guided onboarding tour (the Quick start doc and wizard cover first run).
* Tape-chart room-type filter label could be clearer.
* Update feed URL is a placeholder until you host one.

## Phase 3 — Windows filesystem
Changed: errors.ts (mapSystemError), api.ts, files.ts, backup.ts, scheduler.ts, env.ts (temp/updates dirs), ops.ts + dashboard (storage health banner), system.ts (folder validation), installer.nsh (ProgramData never deleted; ACL only on non-server installs), service.cjs (ACL hardening, LocalService with LocalSystem fallback), config.cjs (serviceAccount).
New: fsSafe.ts, scripts/verify-installer.mjs, fs-safety.test.ts, installer.test.ts.
Tests: 47/47 pass, tsc clean, eslint 0 errors, build + scanner OK.
UNTESTED (needs Windows): icacls/ACL result, LocalService start, uninstall data retention, portable mode.

## Phase 4 — Electron security
Audit result: nodeIntegration=false, contextIsolation=true, sandbox=true, webSecurity on, webview blocked — already correct.
Fixed: IPC argument validation (new apps/desktop/src/ipc-validate.cjs: PDF magic+size, filename/reserved names, bounds, workspace, route, URL), look-alike-origin permission bypass (startsWith → origin compare), added permission *check* handler, will-redirect guard, external URLs limited to http(s) without credentials, welcome-window IPC sender check + duplicate-handler fix, petra:boot trust check, print temp file moved to <data>/temp, print window navigation blocked, default deny window.open, Electron fuses configured (runAsNode kept: server child process needs it).
Tests: ipc.test.ts 8/8. UNTESTED: real Electron runtime, fuses applied by builder.

## Phase 5 — Server/Client, LAN
Fixed: spoofable X-Forwarded-For (now ignored unless PETRA_TRUST_PROXY=1; value validated), terminal offline page auto-retries every 5 s (bn+en), configurable bindHost. Documented DB recommendation (docs/DEPLOYMENT.md).
Tests: concurrency.test.ts 3/3 on SQLite and PostgreSQL (120 parallel requests, 24-way booking race → exactly 4 succeed). UNTESTED: real LAN, firewall rule, Windows Service restart.

## Phase 6 — Backup
Added: BackupStorageProvider (services/backupStorage.ts) with FolderProvider (second disk/NAS/USB) and S3Provider (AWS S3 / Cloudflare R2 / MinIO, SigV4 implemented in-house, no SDK); cloud copies require encryption and https; secret key masked in settings/audit; post-write verification of every backup; failed backups recorded with friendly bilingual error (disk full, unplugged drive); scheduled backup retries every 30 min (max 6/day); remote retention; remote list/test/inspect/restore; dashboard REMOTE_FAILED state; UI for second copy.
Bugs fixed on the way: dashboard crashed when backup folder was unavailable; failed backup to an unavailable drive was not recorded (error thrown outside try, cleanup threw ENOTDIR).
Tests: backup-providers 7/7 (incl. AWS SigV4 official test vector, fake S3 server). Full suite 65/65 SQLite, 63/63 PostgreSQL (2 SQLite-only skipped).
UNTESTED: real AWS/R2 endpoint, Google Drive (not implemented — add a provider class, interface is ready), restore on real Windows.

## Phase 7 — Commercial licensing
Payload v2 (product, hotelId, plan, ref, maxInstallations, graceDays, statusMaxAgeDays, features; v1 still accepted). Signed status list (PETRAS1, Ed25519, monotonic seq) for suspend/revoke — works offline, optional auto-refresh from <update feed>/license-status.txt. Offline grace after expiry, status-staleness policy, clock high-water mark now also in a file (restoring an old DB cannot roll the clock back), hotel-identity lock, product check, activation request code (PETRAREQ1, no secrets), PETRA-XXXX-XXXX-XXXX-XXXX reference is lookup-only.
Vendor License Manager (tools/license-keygen/keygen.mjs): init (optional passphrase-encrypted key), pool, issue, activate, renew, transfer, suspend/revoke/reinstate, publish-status, lookup, list; ledger with states AVAILABLE/ACTIVATED/EXPIRED/SUSPENDED/REVOKED/TRANSFERRED and history. Key folder is outside the source tree (refuses a folder inside the repo). Build scanner now also fails on private-key PEM content, licenses.json, .license-hwm.
Production hardening kept: PETRA_LICENSE_PUBKEY / PETRA_FINGERPRINT ignored in production.
Tests: license-manager.test.ts 10/10 + existing licensing tests. No licenses are embedded in app or installer.
UNTESTED: real-world online status refresh over https (logic only), UI on Windows. NOTE: embedded public key belongs to the DEVELOPMENT key pair — vendor must run `pnpm license init --write-app` with the real key before the final build.

## Phase 8 — Printing
Defects found & fixed:
1. Bangla conjuncts (ন্ট, ন্ড, স্ত …) printed garbled: Noto Sans Bengali builds them from offset glyphs which the PDF engine ignores → PDFs now use Hind Siliguri (OFL, single-glyph conjuncts; Noto kept as fallback). Verified visually (PNG render of invoice/thermal) and by glyph analysis.
2. 80 mm receipts used fixed/estimated heights and could spill onto a 2nd page → height now computed from content (wrapped lines); test asserts exactly 1 page for thermal invoice, pro-forma, receipt, test page in EN and BN with very long Bangla/English names.
3. Desktop "preview" opened the app home page (blob: URL passed through the window-open handler) → dedicated PDF preview window (IPC previewPdf).
4. Desktop printing: fixed 600 ms sleep replaced by did-finish-load wait; 20 s load / 90 s print timeouts; missing named printer gives a clear message; any print failure opens the PDF so the receptionist can print manually; "open in system PDF reader" fallback (IPC openPdfExternal). All IPC validated (PDF magic/size).
5. New printer test page (A4 / 80 mm, ruler, EN+BN text) with buttons in Settings → Devices.
Tests: print.test.ts 6 tests (all document types × EN/BN × A4/80 mm, reports, auth). 
UNTESTED (needs Windows + hardware): real thermal/A4 printers, silent print, margins/“actual size” on specific drivers, USB printer unplug, built-in PDF viewer inside Electron.
Known limitation: PDF labels stay English even when digits are Bangla (names/addresses in Bangla print correctly).

## Phase 9 — Logging & error handling
Eight log categories (application, error, security, license, backup, update, database, server) + combined petrapms.log, rotation 2 MB × 5 per file (server and desktop); desktop.log/update.log/error.log from the shell; server stdout/stderr capture now rotated (was unbounded).
Redaction: passwords, PINs, tokens, bearer, ppk_ keys, PEM private keys, license keys, activation requests, argon hashes, secret/access keys, recovery keys, e-mails, BD phone numbers. Prisma errors reduced to the final reason line (the payload with guest names/IDs used to be echoed) — bug found by test.
Crash handling: uncaughtException/unhandledRejection logged, fatal exit → WinSW restarts; SIGTERM/SIGINT graceful DB close; desktop: server child auto-restart (≤3 / 2 min), render-process-gone reload, crash dialog once, log-folder button. WinSW now honours bindHost.
Friendly errors: bn text for bad credentials/lockout/network/500 (with reference), DB outage → 503 DB_UNREACHABLE (pg "Connection terminated", P1001…, 57P01). Verified manually: PostgreSQL stopped (immediate) mid-session → 503 DB_UNREACHABLE; restarted → next request OK without restarting the app (was 500 INTERNAL before the mapping fix).
Support file endpoint /system/diagnostics + Settings button (no secrets, audited).
Tests: logging.test.ts 11 + desktop logger test; suite 94/94 SQLite, 92/92 PostgreSQL (2 SQLite-only skipped).
UNTESTED: Windows Service restart-on-failure, Electron render-process-gone/server auto-restart paths (logic reviewed, not executed).

## Phase 10 — Installer, first-run wizard, upgrade flow
First-run wizard (/setup) is now 9 steps: Hotel info → License (shows machine request code, key optional; Demo/trial otherwise) → Administrator (password policy) → Database check (provider, writable data dir, free space, SQLite file) → Floors & rooms → Room types & rates → Taxes → Backups (daily time, folder, AES-256) → Review/Create. Server/terminal choice is made in the desktop welcome window (existing). /setup/environment and /setup/request-code only work before first setup.
Installer (NSIS, per-machine, assisted, choose directory): Start Menu + desktop shortcut, uninstaller, publisher PETRA, copyright/trademark metadata, artifact `PetraPMS-Setup-<version>.exe`, runs as invoker (UAC only for service/firewall helper). Data folder is never deleted/overwritten (verify-installer.mjs enforces).
Upgrade flow: customInit stops the service → files replaced → `PetraPMS.exe --service refresh` re-registers the service on the new paths + starts it → server start applies pending migrations after an automatic pre-migration SQLite copy (backups/). Uninstall removes service + firewall rule, keeps data.
Defects found: test file with a literal PEM header was shipped in the staged bundle (Next tracing) → test/e2e dirs pruned from stage; logging test builds PEM string at runtime. E2E wizard spec updated (5/5 pass in Chromium against the standalone build).
Tests: 94/94 SQLite, tsc clean, eslint 0 errors, verify-installer OK.
UNTESTED (Windows needed): actual NSIS compile/installation, UAC prompt, service refresh, upgrade over an older install, PostgreSQL pre-migration backup (PG relies on the scheduled/PRE_UPDATE backup, not on migrate()).

## Phase 11 — Auto-update
Flow: check (start-up + every 6 h + manual) → download (electron-updater verifies sha512 from the feed; HTTPS-only feed enforced in config) → "downloaded" state shown in Settings → administrator presses "Back up and install update" → server writes a verified PRE_UPDATE backup (`POST /system/update/prepare`, perm data.backup, checksum re-read) → only if that succeeds the desktop runs the installer (`quitAndInstall`) → installer stops service, replaces files, refreshes service → server start migrates (pre-migration SQLite copy) → version change logged (update.log).
Safety decisions: autoInstallOnAppQuit=false (no silent install without a backup), no downgrades/prereleases, install IPC accepts only a downloaded update from the trusted window, a backup failure aborts the update and shows the error, a newer-schema database is refused by older builds (existing guard), first-start failure right after an update shows recovery instructions (restore "Before update" backup / reinstall previous version).
Tests: update.test.ts (auth, 403 for housekeeper, backup created+verified+listed, updater static safety, feed URL validation). Suite 101/101, tsc clean, eslint 0 errors.
UNTESTED: real electron-updater download/install against a feed, code-signature verification (needs a signed build), rollback of a failed installer on Windows.
Known limitation: no automatic DB rollback after a failed migration — recovery is the PRE_UPDATE backup via Data → Restore (documented).

## Phase 12 — Security audit
Method: code review + grep audit of every category, fixes with regression tests (security.test.ts, 10 tests).
| Area | Result |
|---|---|
| SQL injection | PASS — all data access via Prisma; the only raw SQL is constant text (SAVEPOINT, advisory lock with numeric constants). |
| XSS | PASS — no dangerouslySetInnerHTML/innerHTML/eval; React escaping; strict CSP (no external origins); SVG logo only inside `<img>`. |
| CSRF | N/A by design — bearer token in a header (sessionStorage), no cookies, no CORS headers. |
| AuthN | FIXED — added per-IP brake (20 failed sign-ins/10 min → 429) on top of per-account lockout; API-key hash compare is constant-time. |
| AuthZ / IDOR | FIXED — guest ID scans/photos (`id-*`, `photo-*`) now need guests.view or frontdesk.checkin (rooms.view alone used to be enough); maintenance tickets may no longer reference arbitrary upload names (could point at a guest ID scan). Route table check: only 9 public routes, asserted by test. |
| Information disclosure | FIXED — public `/auth/pin-users` no longer lists Super Admins; public `/status` no longer reveals the DB engine. Remaining public info: hotel name/logo/version/mode (needed for the login screen). |
| Path traversal / filesystem | PASS — `safeChild`/`assertRegularFile`, strict upload-name regex, backup paths from DB records only (tests). |
| Uploads | PASS — type allow-list, magic-number check, 5 MB cap, random names, served only via authenticated route with nosniff. |
| Request size / DoS | FIXED — Content-Length checked before reading: 1 MB cap on unauthenticated routes, 12 MB otherwise. |
| Command injection | PASS — no child_process in web/server code; desktop uses spawn with argument arrays only (netsh/icacls/winsw/powershell with constant scripts). |
| IPC | PASS — all handlers sender-checked and argument-validated (ipc.test.ts). |
| Secrets | PASS — no keys in repo/stage (build scanner), masked in settings API, redacted in logs. |
| License bypass | PASS (software level) — Ed25519 signatures, clock rollback HWM, status list; a determined attacker with local admin rights can always patch the app (documented). |
| Debug/test routes | PASS — none under /system/*; test endpoints (`/print/test`, `/notifications/test`, `/backups/remote/test`) are authenticated and permissioned. |
| Dependencies | FIXED uuid (override ≥11.1.1). OPEN: deepmerge-ts via Prisma CLI (build-time only, not shipped to runtime path). |
| Excessive permissions | Server mode ACL tightened (Phase 5); service runs as LocalService with LocalSystem fallback. |
Accepted/ documented: notification/SMS provider URLs may be http:// and are admin-configured (SSRF requires settings.manage); `/events` takes the token as a query parameter (EventSource limitation) — tokens are redacted in logs.
Tests: 111/111 SQLite, 109 + 2 skipped on PostgreSQL, tsc clean, eslint 0 errors, e2e 5/5.
UNTESTED: third-party penetration test, Windows-level ACL verification, DNS-rebinding on the standalone loopback server (mitigated by token auth).

## Phase 13 — Final production QA matrix (30 items)
Environment: Linux sandbox (Node 22, Chromium via Playwright, PostgreSQL 16). No Windows machine was available, so everything that needs the installer, Electron runtime, Windows Service, UAC, firewall or real printers is UNTESTED — not assumed.
Evidence: vitest 111/111 (SQLite), 109/111 (PostgreSQL, 2 SQLite-only skipped), Playwright e2e 5/5 against the production standalone build, `pnpm restart-check` (real server process: setup → SIGKILL → restart → SIGTERM → restart), tsc, eslint, build staging scanner, verify-installer.

| # | Test | Result | Evidence / note |
|---|---|---|---|
| 1 | Fresh installation | UNTESTED | NSIS installer not built/run (Windows). Fresh data-folder first start PASSED on Linux. |
| 2 | First launch | PASSED (web) / UNTESTED (Electron) | e2e wizard; Electron welcome window not run. |
| 3 | License activation | PASSED | request code → signed key v2 → activate; wrong product/identity refused (license-manager, pos-license tests). Desktop UI path UNTESTED. |
| 4 | Hotel setup | PASSED | e2e + api-flow setup. |
| 5 | Admin setup | PASSED | password policy + PIN, e2e. |
| 6 | Windows restart | UNTESTED | service start type = Automatic, not executed. |
| 7 | Application restart | PASSED (server process) / UNTESTED (Electron) | restart-check. |
| 8 | Server restart | PASSED | hard kill + orderly stop, data identical, backup works afterwards. |
| 9 | LAN terminal | UNTESTED (network) | terminal limit and multi-session logic PASSED in API tests; real LAN, firewall rule, bindHost not exercised. |
| 10 | PostgreSQL | PASSED | full suite on PG; outage/restart tested manually (503 DB_UNREACHABLE, auto-recovers). |
| 11 | SQLite | PASSED | default engine, full suite + e2e. |
| 12 | Migration | PASSED | fresh + pending migrations with pre-migration copy; newer-schema DB refused. No older released version exists to upgrade from. |
| 13 | Backup | PASSED | verify-after-write, encrypted, folder + S3-compatible, failure recording. |
| 14 | Restore | PASSED | inspect/restore tests incl. wrong key, newer version, PRE_RESTORE safety copy. |
| 15 | Upgrade | UNTESTED | installer flow written (stop service → files → refresh → migrate) and statically verified only. |
| 16 | Uninstall | UNTESTED | static check: data folder never touched. |
| 17 | Reinstall | UNTESTED | by design keeps %ProgramData%\PetraPMS; not executed. |
| 18 | Printer | PASSED (PDF output) / UNTESTED (hardware) | all documents EN/BN, A4 + 80 mm, 1-page thermal asserted; real printers/drivers not available. |
| 19 | Internet OFF | PASSED | all tests ran without internet; CSP `connect-src 'self'`; optional cloud features (update feed, status list, remote backup, SMS/e-mail) fail soft. |
| 20 | Wrong license | PASSED | bad signature/product/identity/computer refused. |
| 21 | Expired license | PASSED | offline grace, then read-only with data viewable. |
| 22 | Suspended license | PASSED | signed status list: suspend → read-only, reinstate → active, stale/forged lists refused. |
| 23 | Server unavailable (terminal) | UNTESTED | bilingual network error handling present in the client; not exercised end-to-end. |
| 24 | Database unavailable | PASSED | PostgreSQL stopped mid-session → 503 DB_UNREACHABLE, recovers without restart (manual run, Phase 9). |
| 25 | Disk full | PASSED (simulated) | ENOSPC mapped to DISK_FULL, failed backups recorded and cleaned; no real full disk. |
| 26 | Read-only storage | PASSED (simulated) | EROFS/EACCES/ENOTDIR mapping + start-up writable check; no real read-only volume. |
| 27 | Crash recovery | PASSED (server) / UNTESTED (Windows Service + Electron) | SIGKILL restart-check; WinSW restart-on-failure and Electron child auto-restart not executed. |
| 28 | Concurrent booking | PASSED | 120 parallel mixed requests no 5xx; racing terminals. |
| 29 | Double-booking prevention | PASSED | overlap rules + locked transactions, never overbooks (concurrency + api-flow). |
| 30 | License tampering | PASSED | altered payload, wrong key, clock rollback, restored old DB (HWM file) all rejected. |

Totals: 19 PASSED (#25 and #26 by simulation), 4 PARTIAL — logic PASSED, Windows/hardware half UNTESTED (#2, #7, #18, #27), 7 UNTESTED (#1, #6, #9, #15, #16, #17, #23). Every UNTESTED part needs a clean Windows 10/11 VM with a printer and a second LAN computer.

## Pre-Windows completion (NixOS side)
Fixed: release guard (`pnpm release:check`, first step of `pnpm build:win`) refuses a development license key (marker + fingerprint list), placeholder/empty/http/`.invalid` update feed or homepage, unapproved icon, mismatched versions/publisher, development env overrides and any secret/ledger/database in the source tree; production-key workflow (`pnpm license init --write-app --production`, `write-app-key --production`); update feed injected at release time (`release/release.config.json` → baked `release.json`, `${env.PETRA_UPDATE_URL}` in electron-builder.yml) and validated at run time; `PETRA_APP_VERSION` set by `server-launcher.cjs` from the desktop package (Windows Service mode) and `env.ts` no longer falls back to a literal "1.0.0"; staged bundle pruned (TypeScript sources, configs, tests, 28 source maps); `pnpm stage-check` runs the pruned stage through the real launcher; `dist-win.mjs` refuses non-Windows packaging and non-release stages.
Verified (this environment): vitest 177 passed / 1 skipped (SQLite, 23 files); PostgreSQL 135 passed / 2 skipped (SQLite-only); `pnpm typecheck` clean; eslint 0 errors (8 pre-existing warnings); build + scanner OK; stage-check 10/10; restart-check 7/7; crash-test passed; e2e 5/5; verify-installer OK; release guard correctly NOT READY (5 vendor-configuration items).
Remaining vendor configuration: production public key, update feed URL, website URL, approved logo, code-signing certificate. Windows items: docs/WINDOWS-VALIDATION.md.
