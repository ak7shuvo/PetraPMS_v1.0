# Configuration matrix

**Rule:** development data (`.env*`, `./.data`, SQLite files, seed/demo data, test keys) never reaches an installer. `scripts/build.mjs` fails the build if it finds any in the staged package. The shipped app does not read `.env` files.

Where production settings live: **(1)** real environment variables (cloud/Docker, Windows Service), **(2)** `%ProgramData%\PetraPMS\config.json` (machine settings), **(3)** the database `Setting` table (hotel settings edited in the app).

## Runtime environment variables
| Variable | Default | Set by / when | In installer? | Hotel admin can change? | Notes |
|---|---|---|---|---|---|
| `PETRA_DATA_DIR` | `%ProgramData%\PetraPMS` | Vendor/IT, rarely (portable/USB, tests) | No | Via IT only | Holds DB, uploads, backups, logs, exports, config |
| `PORT` | 3000 (desktop uses `config.json` port, default 38080) | Desktop/service launcher | No | Via `config.json` | 1–65535, validated |
| `HOSTNAME` | `127.0.0.1` (standalone) / `0.0.0.0` (server) | Launcher decides from mode | No | By choosing mode | |
| `PETRA_MODE` | `standalone` | Launcher / compose | No | By choosing mode | `standalone`, `server`, `cloud` |
| `DATABASE_PROVIDER` | `sqlite` | Cloud deployer | No | No | `sqlite` (LAN, recommended) or `postgres` (cloud/large) |
| `DATABASE_URL` / `DATABASE_URL_FILE` | — | Cloud deployer at deploy time | **Never** | No | **Secret.** Prefer `_FILE` (Docker secret). Required when provider=postgres |
| `PETRA_BACKUP_DIR` | `<data>\backups` | IT; hotel admin normally uses Settings → Backup folder | No | Yes (in-app) | |
| `PETRA_REALTIME` | in-process | Cloud, multi-instance | No | No | `postgres` = LISTEN/NOTIFY |
| `PETRA_SCHEDULER` | on | Cloud, multi-instance | No | No | `off` on all but one instance |
| `PETRA_APP_VERSION` | from package | Desktop launcher | No | No | |
| `PETRA_ASSETS_DIR` | auto | Launcher | No | No | Fonts for PDFs |
| `PETRA_WEB_DIR` | auto | Desktop dev only | No | No | |
| `NODE_ENV` | `production` in shipped build | Build/launcher | No | No | Enables production-only protections |

## Developer/test-only (ignored when `NODE_ENV=production`)
| Variable | Why it is disabled in production |
|---|---|
| `PETRA_LICENSE_PUBKEY` | Would let anyone swap the verification key and mint licences. To use your own key, run `pnpm keygen init --write-app` and rebuild. |
| `PETRA_FINGERPRINT` | Would let a customer spoof the machine ID of a machine-bound licence. |
| `PETRA_KEYGEN_DIR`, `PETRA_SQLITE_FILE`, `PG_TEST_URL`, `PETRA_URL` | Tooling/tests only. |

## Build-time
`NODE_ENV=production`, `CSC_LINK` / `CSC_KEY_PASSWORD` (code signing, CI secrets only), `NEXT_*` Next.js settings. The licence **public** key is compiled into `server/license-public-key.ts`; the **private** key exists only under `tools/license-keygen/keys` on the vendor machine.

## Secrets
| Secret | Stored | Never in |
|---|---|---|
| Database URL/password (Postgres) | env or `_FILE` secret | repo, image layers, installer, logs |
| User passwords / PINs | argon2 hashes in DB | logs, exports |
| Session tokens, POS API keys | SHA-256 hashes in DB (shown once) | logs, exports |
| SMS/email provider tokens | `Setting` table; masked in the UI/API/audit | support bundle, config export, logs |
| Backup recovery key | DB (shown to authorised users only) | logs |
| Licence private key | vendor machine only | repo, installer, customer PC |

## Startup validation
`server/env.ts` refuses to start with a clear message for: invalid `DATABASE_PROVIDER`/`PETRA_MODE`/`PORT`, Postgres without `DATABASE_URL`, unreadable `*_FILE`.
