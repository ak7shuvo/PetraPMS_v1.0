# PetraPMS — Administrator guide

## Users and roles (Users & roles)
Nine built-in roles: Super Admin, General Manager, Front Desk Manager, Receptionist, Housekeeping Supervisor, Housekeeper, Accountant, Maintenance, Restaurant Cashier. Open the **Roles & permissions** tab to edit any role's permission matrix (Super Admin always has everything). Sensitive actions (discounts above a user's limit, voids, rollbacks, restores) ask for a **manager PIN/password** — the approver is recorded in the audit log.
* New users get a **temporary password** shown once; they must change it at first sign-in (min. 8 chars, letters + digits).
* **Quick PIN** (4–6 digits) lets a user unlock or switch quickly; weak PINs (1234, repeated digits) are refused.
* Accounts lock after repeated wrong passwords (Settings → Operations → Security). **Unlock** from the Users list.
* Windows lock after idle time; the user re-enters PIN/password.

## Several users, several monitors
Every window has its own signed-in user. **Open in a new window** (header) or *Settings → Workspaces* to save layouts such as "Front desk — two monitors". The header chip always shows *User · Role · Business date*.

## Rates and inventory
*Rooms & types* (types, rooms, blocks), *Rates* (plans, seasons/events such as Eid, calendar, cancellation policies, discount rules). Availability is counted per room type per night; the database transaction + lock makes overbooking impossible even with many terminals.

## Money and tax
All amounts are stored as integer **poisha**. Defaults: service charge 10% on net, VAT 15% on net + service charge; *Settings → Billing & taxes* changes rules, inclusive/exclusive pricing, invoice layout (standard / Mushak-6.3 style with QR), USD display rate.
> The Mushak-style layout follows common practice; confirm the exact fields required by your NBR circle with your tax adviser before relying on it.

## Night audit
Run daily. It posts room + tax charges once per stay-night (safe to retry), processes no-shows, and rolls the business date. A backup is taken first. **Rollback** is possible only until something is posted on the new date.

## Backup and restore (Data center)
* Automatic daily backup + one before each night audit/import/restore. Choose a folder on **another disk or USB** and keep 14+ days. Optional **AES-256 encryption**: write down the *recovery key* — without it an encrypted backup cannot be opened on another computer.
* **Restore**: choose a backup → *Check* → *Restore*. A safety backup of current data is taken first; everyone is signed out.
* Test a restore on a spare PC at least quarterly.

## Import / export
*Data center → Import*: rooms, room types, rates, companies, guests, charge codes, users, reservations, opening balances. 4 steps (file → match columns → check/dry-run → import), undo within 24 h. *Export* gives files in the same columns (round-trip). *Configuration* exports/imports taxes, payment methods, charge codes, policies, roles as JSON to clone a setup. Spreadsheet formula-injection is neutralised on import and export.

## POS integration
*Settings → POS integration*: create one **API key** per outlet (shown once, stored hashed). Endpoints (header `X-API-Key`): `GET /api/pos/v1/rooms`, `GET /api/pos/v1/rooms/{number}`, `POST /api/pos/v1/charges` (idempotent by `sourceRef`), `POST /api/pos/v1/charges/void`, spec at `/api/pos/v1/openapi.json`. Use the built-in simulator to test. PetraPOS posts here natively.

## Notifications (SMS / email)
*Settings → Notifications*: configure a provider URL, headers and body template (API tokens stay on the server). Messages are queued and retried; use *Send test*.

## License
*Settings → License* shows status, rooms, terminals, expiry and your **computer ID**. Send the ID to your vendor to receive a key; paste it to activate. A 14-day trial runs from first start; after expiry or trial end the system becomes **read-only** (view/export still work). Warnings appear 30, 7 and 1 days before expiry. Changing the system clock backwards is detected. To move to another computer use *Move license* and send the code to your vendor.

## Printing
Settings → Devices lets you choose the A4 printer and the 80 mm receipt printer for this computer, and **Print test page** (A4 / 80 mm, English + Bangla) checks margins and Bangla letters. With "Print without dialog" on, documents go straight to the chosen printer; if the printer is missing or fails, the PDF opens so you can print it by hand. In a web browser the normal print dialog is used.

## LAN terminals (Server mode)
Install on the main computer and choose **Server + terminals**; Windows asks for permission once (UAC) to install the PetraPMS service and open the firewall for private/domain networks. On other computers/tablets open the address shown in Settings → Devices → This computer (QR code available) or install PetraPMS and choose **Terminal**. If a terminal says the server is unavailable, check the server computer is on and on the same network. The licensed terminal limit applies.

## Updates
When an update is ready, Settings → Devices → This computer shows it. **Back up and install update** first makes a verified "Before update" backup; if that backup fails the update does not start. PetraPMS then restarts to install, applies database changes (a copy is kept first) and your data, backups, settings and license are never touched. Updates are never installed silently. If the new version cannot start, restore the "Before update" backup (Data center → Restore) or reinstall the previous version; details are in the logs folder (Settings → Support file).

## Support bundle
*Data center → Support bundle* creates a ZIP with system info, settings **without secrets** and recent logs — no guest data. PetraPMS sends no telemetry anywhere.

## Security notes
Passwords are stored only as argon2 hashes; API keys hashed; secrets are never written to logs. Use Windows BitLocker on the server disk, restrict physical access, keep Windows updated, and use HTTPS (reverse proxy) for cloud deployments.
