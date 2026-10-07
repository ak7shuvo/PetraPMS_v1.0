# PetraPMS — Release configuration and Windows build

This page is for the **vendor / release engineer**. Customers never need it.

## 1. What the vendor must supply (nothing is invented in the repository)

| Item | Where | Status in the repo |
|---|---|---|
| Production license **public** key | `apps/web/src/server/license-public-key.ts` (written by the License Manager) | development key committed — **release is refused** |
| Update feed URL (https) | `release/release.config.json` → `updateUrl` (or env `PETRA_UPDATE_URL`) | `__SET_…__` placeholder — **release is refused** |
| Website URL (https) | `release/release.config.json` → `homepage` (or env `PETRA_HOMEPAGE`) | `__SET_…__` placeholder — **release is refused** |
| Approved logo | replace `apps/desktop/build/icon.png` (≥ 512×512 PNG), then set `iconApproved: true` | development placeholder — **release is refused** |
| Code-signing certificate | environment `CSC_LINK`, `CSC_KEY_PASSWORD` (see `CODE-SIGNING.md`) | not in the repo (never commit) |

The **release guard** (`pnpm release:check`, also the first step of `pnpm build:win`) fails with one line per problem. It checks:
the license key is Ed25519, marked `production` and not listed in `release/dev-license-keys.json`; update feed and homepage are real
`https://` public hosts (no `.invalid`, `example.*`, `localhost`, IP, credentials, placeholder); icon approved; no placeholder in
`electron-builder.yml` / `apps/desktop/package.json`; root, web and desktop versions identical (desktop = installer version) and
publisher `PETRA`; no development override variables in the environment (`PETRA_LICENSE_PUBKEY`, `PETRA_FINGERPRINT`,
`PETRA_ALLOW_REPO_KEYS`, `PETRA_TEST_PG`, `PETRA_TRUST_PROXY`, `NODE_ENV=development|test`); and no private key, license ledger,
`.env`, database or `.petrabak` anywhere in the source tree. Development builds (`pnpm build`, `pnpm dev`) never call it.

## 2. Production license key (vendor machine only)

```powershell
pnpm license init --write-app --production     # first time: creates private.pem + public.pem in %USERPROFILE%\.petra-license-manager
# or, if the key pair already exists:
pnpm license write-app-key --production        # re-embeds public.pem into license-public-key.ts
git add apps/web/src/server/license-public-key.ts   # ONLY this file. Never the key folder.
```
The private key stays in `%USERPROFILE%\.petra-license-manager` (outside the repo; the tool refuses a folder inside it). Back it up
offline, twice. If a *development* key is ever committed on purpose, add its fingerprint to `release/dev-license-keys.json`.

## 3. Build on Windows (after approval of the Windows stage)

Requirements: Windows 10/11 x64, Node ≥ 22.13, pnpm 10, internet for the first `pnpm install` (Electron binary).

```powershell
pnpm install --frozen-lockfile
pnpm lint ; pnpm typecheck ; pnpm test         # PostgreSQL suite optional on Windows
pnpm release:check                             # must print RELEASE GUARD: OK
$env:CSC_LINK = "C:\secure\petra-cert.pfx" ; $env:CSC_KEY_PASSWORD = "…"   # signing (omit only for an unsigned test build)
pnpm build:win                                 # guard → build → stage scan → electron-builder
# result: dist\PetraPMS-Setup-<version>.exe  (+ latest.yml for the update feed)
```
`pnpm build:win` refuses to package on non-Windows systems and refuses a stage that was not produced in release mode.
Then publish `latest.yml` + the installer (and `license-status.txt` when you suspend/revoke) to the update feed, and run
`docs/WINDOWS-VALIDATION.md`.

## 4. Versioning
`apps/desktop/package.json` `version` is the installer version and is passed to the server (also in Windows Service mode, where no
Electron shell exists). Keep root and `apps/web` equal to it (the guard checks). Database migrations are forward-only; an older app
refuses a database created by a newer one, and a SQLite copy is taken before any pending migration.
