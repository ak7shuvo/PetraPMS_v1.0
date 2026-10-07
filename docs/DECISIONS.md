# Decisions (defaults chosen where the brief left room)

1. **Auth is custom, not Auth.js cookie sessions.** The requirement "several users in several windows on one computer" needs per-window sessions; cookies are shared by all windows of a browser profile. Credentials + argon2 (pure-JS `@noble`, no native build) with bearer tokens kept in `sessionStorage` per window, `X-Petra-Window` / `X-Petra-Terminal` headers, hashed session rows server-side, lockout, idle lock, PIN switching. SSE authenticates with a short-lived `?token=`.
2. **Pages are client-rendered** (the session token lives in the browser), the API is server-side. Next standalone output is used as the shipped server.
3. **One catch-all API route + route table** (`route(method, path, {auth, perm, module, allowReadOnly})`) so permissions, licence/read-only gating, validation (zod), audit and the {ok,data}/{ok:false,error} envelope are enforced in one place; OpenAPI for the POS API is generated from it.
4. **SQLite via Node's built-in `node:sqlite`** behind a Prisma driver adapter (single connection + mutex, WAL, FK on, busy timeout) — avoids native modules (better-sqlite3) that complicate Electron/Windows builds. PostgreSQL uses a generated schema + migrations embedded in code and a runtime migrator with a pre-migration backup. **Requires Node ≥ 22.13** (Electron ≥ 38 bundles it).
5. **Overbooking prevention:** all inventory writes run in a transaction under an in-process mutex plus a PostgreSQL advisory lock; availability is recomputed inside the lock per room type per night (half-open date ranges).
6. **Money = integer poisha everywhere.** Tax: service charge 10% on net, VAT 15% on net + SC (compound), inclusive pricing back-calculates. Rounding per line, residue to the last tax.
7. **Idempotency:** night-audit room charges (`room:<stay>:<date>`) and POS postings (`pos:<OUTLET>:<check>`) use unique `sourceRef`s.
8. **Realtime = SSE** with topic invalidation of TanStack Query caches; PostgreSQL LISTEN/NOTIFY fans out in multi-instance cloud mode.
9. **Desktop shell in plain CommonJS (no TypeScript build step)** to keep the Electron main process tiny and auditable; it contains no business logic. Server runs as a child process using Electron's own Node (`ELECTRON_RUN_AS_NODE`). Windows Service uses WinSW (bundled by `node-windows`), firewall rule limited to private/domain profiles.
10. **Data location** `%ProgramData%\PetraPMS` (shared by the app and the service); the installer grants Users modify rights. Uninstall keeps data.
11. **Update safety:** the server takes a *pre-migration backup* the first time a new version starts; updates come only from a feed URL the customer/vendor configures (no telemetry, no phoning home).
12. **Licensing:** Ed25519-signed `PETRA1.<payload>.<sig>` keys verified offline; fingerprint-bound or floating; 14-day trial then read-only (HTTP 423 for writes); clock-rollback detection via a monotonic high-water mark; private key only in `tools/license-keygen` (git-ignored, excluded from installers).
13. **i18n:** next-intl with in-code message catalogs (EN/BN, parity enforced by a test); Bangla digits and lakh grouping are per-user formatting options, not translations. Avoid ASCII apostrophes in strings (ICU escape).
14. **Fonts bundled** (JetBrains Mono + Noto Sans Bengali, OFL) for UI and PDFs — no CDN.
15. **Mushak-style invoice** is a layout option modelled on common practice, not a certified NBR format.
16. **Notification providers** (SMS/email) are generic HTTP templates because Bangladeshi gateways differ; secrets stay server-side and are never returned to the browser or logged.
17. **Scope notes:** no channel-manager/OTA sync, no payment-gateway integration, no door-lock integration in v1 (extension points: POS API, notification templates).
18. **Licence key pair in source archives is for development.** Generate your own with `pnpm keygen init --write-app`; archives handed out for review exclude `tools/license-keygen/keys`.
