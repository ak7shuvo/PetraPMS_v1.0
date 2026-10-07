# PetraPMS 1.0.0 — Windows hand-off

This archive is the source tree prepared on Linux. It contains **no** private signing key, license ledger, license keys, customer
data, `.env`, database or build output. Nothing here has been run on Windows yet.

1. Install Node ≥ 22.13 and pnpm 10 (`corepack enable`), then in the project folder: `pnpm install --frozen-lockfile`.
2. Fill in the vendor configuration (see `docs/RELEASE.md`):
   * production license **public** key → on the vendor machine `pnpm license init --write-app --production`
     (or `pnpm license write-app-key --production`); commit only `apps/web/src/server/license-public-key.ts`;
   * `release/release.config.json`: real `updateUrl`, `homepage`, and `iconApproved: true` after replacing `apps/desktop/build/icon.png`;
   * code-signing certificate in `CSC_LINK` / `CSC_KEY_PASSWORD`.
3. `pnpm release:check` — must print `RELEASE GUARD: OK`. It currently FAILS on purpose until step 2 is done.
4. `pnpm lint`, `pnpm typecheck`, `pnpm test`.
5. Only after separate approval: `pnpm build:win` (Phase 14) → `dist\PetraPMS-Setup-1.0.0.exe`.
6. Run `docs/WINDOWS-VALIDATION.md` on a clean Windows 10/11 machine.

Keep the License Manager data folder (`%USERPROFILE%\.petra-license-manager`) off this machine's repo and backed up offline.
