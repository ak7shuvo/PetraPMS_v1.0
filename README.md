# PetraPMS

Property management system for 3-star hotels (30–150 rooms) in Bangladesh — sibling of PetraPOS.
Windows installer (standalone or LAN server + terminals), portable ZIP, or Docker + PostgreSQL. English + বাংলা. Works fully offline.

| Folder | Contents |
|---|---|
| `apps/web` | Next.js (App Router, standalone) UI + API (single catch-all route table) |
| `apps/desktop` | Electron shell: windows, tray, Windows Service, firewall, silent print, auto-update, NSIS |
| `packages/core` | Pure domain logic: money (poisha), tax, rates, availability, cancellation, folio, night audit, permissions, licensing |
| `packages/db` | Prisma schema (SQLite default, PostgreSQL), migrations, runtime migrator |
| `packages/ui` | Shared design tokens |
| `tools/license-keygen` | Vendor-only licence key generator (never shipped) |
| `docker/` | Dockerfile + compose (PostgreSQL) |
| `docs/` | Guides, decisions, QA report, release checklist |

## Commands (Node ≥ 22.13, pnpm 10; same in PowerShell/cmd/bash)
```
pnpm install
pnpm dev            # http://localhost:3000, data in ./.data
pnpm test           # Vitest (domain + API integration)
pnpm build          # production build + staging for the installer
pnpm start          # run the production build
pnpm e2e            # Playwright against the production build
pnpm build:win      # Windows NSIS installer  -> dist/   (run on Windows)
pnpm build:portable # Windows portable ZIP    -> dist/   (run on Windows)
pnpm db:seed        # demo hotel on a running server
pnpm keygen ...     # licence keys (vendor machine only)
```
Environment: `PETRA_DATA_DIR`, `DATABASE_PROVIDER=sqlite|postgres`, `DATABASE_URL`, `PORT`, `HOSTNAME`, `PETRA_MODE`, `PETRA_BACKUP_DIR`, `PETRA_REALTIME=postgres`, `PETRA_SCHEDULER=off`.

## Documentation
[QUICKSTART](docs/QUICKSTART.md) · [INSTALL](docs/INSTALL.md) · [ADMIN-GUIDE](docs/ADMIN-GUIDE.md) · [USER-GUIDE](docs/USER-GUIDE.md) · [TROUBLESHOOTING](docs/TROUBLESHOOTING.md) · [LICENSE-TERMS](docs/LICENSE-TERMS.md) · [DECISIONS](docs/DECISIONS.md) · [PRIVACY & SECURITY](docs/PRIVACY-SECURITY.md) · [CODE-SIGNING](docs/CODE-SIGNING.md) · [RELEASE-CHECKLIST](docs/RELEASE-CHECKLIST.md) · [QA-REPORT](docs/QA-REPORT.md) · [CHANGELOG](docs/CHANGELOG.md)

## Before your first sale
1. `pnpm keygen init --write-app` on **your** vendor machine → creates *your* licence key pair and embeds the public key. Back up `the private key in %USERPROFILE%\\.petra-license-manager` offline. (Any key pair shipped inside a source archive is for development only.)
2. Build and test the installer on a clean Windows 10 **and** 11 VM (see RELEASE-CHECKLIST).
3. Get a code-signing certificate (CODE-SIGNING.md).
4. Have a lawyer review LICENSE-TERMS.md and an accountant confirm the Mushak invoice fields.
