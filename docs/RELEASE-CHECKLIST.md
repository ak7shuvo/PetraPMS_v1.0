# Release checklist

**Before building**
- [ ] Production license key: `pnpm license init --write-app --production` (or `write-app-key --production`) done on the vendor machine; **only** `apps/web/src/server/license-public-key.ts` committed; private key backed up offline (two copies) and never in the repo or build context.
- [ ] `release/release.config.json`: real `updateUrl` (https) and `homepage`, `iconApproved: true` after the approved logo replaced `apps/desktop/build/icon.png`. No `__SET_` placeholder left.
- [ ] `pnpm release:check` prints `RELEASE GUARD: OK` (it also runs automatically inside `pnpm build:win`).
- [ ] Version bumped in root, `apps/web`, `apps/desktop` `package.json`; CHANGELOG updated.
- [ ] `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e` all green.
- [ ] Code-signing certificate available (`CSC_LINK` / `CSC_KEY_PASSWORD`, see CODE-SIGNING.md).
- [ ] Windows validation matrix (docs/WINDOWS-VALIDATION.md) scheduled on a clean Windows 10/11 machine.

**Build (Windows machine/CI)**
- [ ] `pnpm build:win` (runs the release guard, builds, stages, packages) → `dist/PetraPMS-Setup-<v>.exe`; `pnpm build:portable` → ZIP; both **signed**.
- [ ] Publish `latest.yml` + installer to the update feed.

**Clean-VM acceptance (Windows 10 and Windows 11, no Node installed, offline)**
- [ ] Install per-machine; shortcuts created; first-run chooser appears.
- [ ] Standalone: setup wizard, demo data, sign-in, booking → check-in → payment → check-out → night audit.
- [ ] Server mode: UAC prompt, service `PetraPMS` running after reboot, firewall rule present, second PC/tablet connects via LAN URL/QR, terminal limit enforced.
- [ ] Printing: A4 invoice and 80 mm receipt, silent print to the real printers.
- [ ] Bangla UI + Bangla digits + PDF Bangla text render correctly.
- [ ] Backup to USB, restore on a second PC (incl. encrypted + recovery key).
- [ ] Licence: trial banner, activate key, expiry warning, read-only after expiry, clock rollback.
- [ ] Upgrade over previous version keeps data (pre-upgrade backup created).
- [ ] Uninstall removes program, service and firewall rule but keeps `%ProgramData%\PetraPMS`.
- [ ] Docker: `docker compose up` on a clean host, setup, backup/restore with PostgreSQL.
- [ ] Antivirus scan / SmartScreen check of the signed installer.

**After**
- [ ] Tag `vX.Y.Z`; archive build artefacts, source and SBOM; note known issues in the release notes.
