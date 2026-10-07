# Windows validation matrix (to be run on a real Windows 10/11 machine)

Everything below could **not** be verified in the Linux build environment. Mark each line PASS / FAIL with the date and tester.
Nothing in this file has been executed yet.

| # | Area | What to verify | Result |
|---|---|---|---|
| 1 | Installer | `PetraPMS-Setup-<v>.exe` compiles/installs per-machine, choose directory, Start Menu + desktop shortcut, publisher "PETRA" in Programs & Features | |
| 2 | UAC | Installer asks for elevation once; the app itself runs without elevation (asInvoker); service actions prompt UAC | |
| 3 | First launch | Welcome → mode choice → setup wizard (9 steps) → dashboard; `%ProgramData%\PetraPMS` created | |
| 4 | License | Request code shown; key from License Manager activates; wrong/expired/suspended/revoked key behaviour; clock rollback | |
| 5 | Service install | Server mode installs service `PetraPMS`, starts (LocalService, or LocalSystem fallback), data-folder ACL hardened (`icacls`) | |
| 6 | Service restart | Kill the process → restarts in 10 s; stop/start from services.msc | |
| 7 | Windows reboot | Service starts automatically; app reconnects; data intact | |
| 8 | Firewall | Rule "PetraPMS Server" present (private/domain only); removed on uninstall | |
| 9 | LAN terminal | Second PC/tablet opens `http://<server>:38080`, signs in, terminal limit enforced, server-off message in Bangla/English | |
| 10 | Upgrade | Install 1.0.0, add data, install newer build over it: service stopped → files replaced → service refreshed → migration → data intact, `PRE_UPDATE`/pre-migration backup present, version shown correctly | |
| 11 | Uninstall | Program, service, firewall rule, shortcuts removed; `%ProgramData%\PetraPMS` (DB, backups, config, license) kept | |
| 12 | Reinstall | Reinstall finds existing data and license, no re-setup | |
| 13 | A4 printer | Invoice, folio, registration card, reports on a real A4 printer (margins, Bangla text) | |
| 14 | 80 mm thermal | Receipt/pro-forma on a real thermal printer; silent print; one page; paper cut | |
| 15 | PDF preview | Electron preview window; "open in system PDF reader" fallback; wrong printer name message | |
| 16 | Updater | Real feed: check → download → SHA-512 verified → "Back up and install update" → installs → restarts; HTTPS-only; bad feed ignored | |
| 17 | Signing | Installer and `PetraPMS.exe` signed; SmartScreen reputation; antivirus scan | |
| 18 | Backup/restore | Backup to USB/NAS folder, restore on a second PC (encrypted + recovery key) | |
| 19 | Disk / storage | Unplug the backup USB mid-backup; full disk; read-only folder → friendly errors, no data loss | |
| 20 | Crash recovery | Power-off during use → next start OK; Electron render crash / server child auto-restart | |
| 21 | Windows names | Backup folder named `CON`, `NUL`, `COM1`, trailing dot/space, long path, non-ASCII (Bangla) path | |
| 22 | Standalone vs server mode | Switching mode keeps data; Standalone binds to 127.0.0.1 only | |
