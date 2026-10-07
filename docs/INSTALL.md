# PetraPMS — Installation

## Requirements
Windows 10 or 11 (64-bit), 4 GB RAM, 1 GB free disk (+ space for backups), a modern display (1366×768 or larger). No internet is needed to run PetraPMS.

## A. Single computer (Standalone)
1. Run `PetraPMS-Setup-<version>.exe` (per-machine install, needs administrator rights).
2. Start **PetraPMS** from the desktop shortcut → choose **Single computer**.
3. Data lives in `C:\ProgramData\PetraPMS` (database, uploads, backups, logs). Uninstalling does **not** delete it.

## B. Server + terminals (LAN)
On the server PC (always on, ideally with a UPS):
1. Install and choose **Server for other computers**. Approve the administrator prompt: this installs the **PetraPMS Windows Service** (starts at boot, restarts on failure) and a **firewall rule** for TCP port 38080 (private/domain networks only).
2. Open **Settings → This computer**: it shows the address for other devices, e.g. `http://192.168.1.10:38080`, and a QR code.
3. On each front-desk PC: install PetraPMS → **Terminal** → type the server address. Tablets/phones: open the address in a browser (you can "Install app" from the browser menu).
4. Give the server a fixed IP (router DHCP reservation) so addresses never change.
5. Each terminal counts against your license's **terminal limit** (Settings → License).

Check the service: `sc query PetraPMS`. Logs: `C:\ProgramData\PetraPMS\logs`.

## C. Cloud (Docker + PostgreSQL)
```bash
cd docker && cp .env.example .env     # set POSTGRES_PASSWORD
docker compose up -d --build
```
Put Caddy/nginx/Traefik with HTTPS in front (do not expose port 3000 directly). Open the site → Quick setup. Data: Docker volumes `pgdata` (database) and `appdata` (uploads/backups). Back up both.

## D. Portable ZIP
Extract anywhere, run `PetraPMS.exe`. Set the environment variable `PETRA_DATA_DIR` to keep data on the same drive.

## Upgrading
Run the new installer over the old one. On first start the app takes a **pre-upgrade backup** automatically, then migrates the database. If anything fails the old data is untouched.

## Uninstalling
*Settings → Apps → PetraPMS → Uninstall.* The service and firewall rule are removed; `C:\ProgramData\PetraPMS` is kept. Delete that folder manually only when you are sure you do not need the data.

## Building from source (developers)
Node ≥ 22.13, pnpm 10. `pnpm install` · `pnpm dev` · `pnpm test` · `pnpm build` · `pnpm e2e` · `pnpm build:win` (on Windows; produces `dist/*.exe`) · `pnpm build:portable`.
