# PetraPMS deployment & database recommendation

| Scenario | Mode | Database | Why |
|---|---|---|---|
| One reception PC | Single computer | SQLite | Zero setup, one file, easy backup |
| 3–4★ hotel, 2–10 terminals on one LAN (30–150 rooms) | Server + Terminals | **SQLite (recommended default)** | Terminals only call the server's HTTP API; only the server process opens the DB. WAL + one writer is far above the load of a 150-room front desk. Proven by `pnpm crash-test` and `concurrency.test.ts` |
| Multi-property, remote access, >15 concurrent staff, or HA wishes | Cloud/Docker | **PostgreSQL** | Advisory locks, network clients, point-in-time recovery |

Terminals never connect to the database directly, in either mode.

## Server mode (Windows)
- `config.json` (`%ProgramData%\PetraPMS`): `port` (default 38080), `bindHost` (default `0.0.0.0`; set the server's LAN IP to restrict), `serviceAccount` (`LocalService` default, `LocalSystem` fallback).
- Installer registers Windows Service `PetraPMS` (auto start, restart on failure after 10 s / 30 s) and a firewall rule for **Private/Domain** profiles only.
- Terminal: enter `http://<server-ip>:38080`. If the server is down the terminal shows a Bangla/English offline page and retries every 5 s; live updates (SSE) reconnect automatically.
- Behind a reverse proxy only: set `PETRA_TRUST_PROXY=1` so `X-Forwarded-For` is believed. Otherwise it is ignored.
- Give the server a fixed IP (DHCP reservation) and use a UPS; the database survives power loss (SQLite WAL, `crash-test`), but the OS may not.

## PostgreSQL
`DATABASE_PROVIDER=postgres`, `DATABASE_URL=postgresql://user:pass@host:5432/petra` (or `DATABASE_URL_FILE`). Bad credentials / unreachable host return a friendly 503 `DB_UNREACHABLE` (Bangla message) and log the technical error; the API recovers on its own when the database returns.
