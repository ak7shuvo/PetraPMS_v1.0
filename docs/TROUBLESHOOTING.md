# PetraPMS — Troubleshooting

| Problem | Fix |
|---|---|
| App says "cannot reach the server" (terminal) | Is the server PC on? Open the address in a browser on the terminal. Check the firewall rule (`netsh advfirewall firewall show rule name="PetraPMS Server"`) and the service (`sc query PetraPMS`). Press Ctrl+R. |
| Server address changed | Give the server a fixed IP; update the address on terminals (re-run first-run setup by deleting `%ProgramData%\PetraPMS\config.json` on that terminal). |
| Port 38080 in use | Edit `port` in `%ProgramData%\PetraPMS\config.json`, restart the app/service, reinstall the firewall rule (re-select Server mode). |
| "Conflict — someone else changed this" | Another user saved first. Choose *Reload latest data* and redo your change. |
| "License is read-only" | Trial ended or license expired → Settings → License → paste a new key. Data is safe; view/export work. |
| "Terminal limit reached" | Sign out unused terminals (Users → Signed-in windows) or upgrade the license. |
| Forgot admin password | Another admin resets it (Users → Reset). If none, use a backup-restore on a copy, or contact support — passwords cannot be recovered, only reset. |
| Forgot backup recovery key | Encrypted backups from that key cannot be opened. Create a new key and back up again now. |
| Nothing prints silently | Settings → This computer: choose printers and enable *Print without dialog* (desktop app only). Check the printer's own driver. |
| Bangla text shows boxes in PDFs | Fonts are bundled; if you replaced the install, reinstall. |
| Night audit blocked | Resolve overdue departures (or change the setting), then run again. |
| Slow on a big hotel | Keep the database on an SSD; reduce kept logs; run Data center → Backup folder on a different disk. |
| Disk full | Delete old backups (Data center → Backups) and exports; move the backup folder. |

**Logs:** `%ProgramData%\PetraPMS\logs`, rotated at 2 MB × 5 per file:
`application.log` · `error.log` (every error) · `security.log` (failed sign-ins, lockouts, forbidden actions) · `license.log` · `backup.log` · `update.log` · `database.log` · `server.log`; `petrapms.log` has everything in one place. `desktop.log` (app shell: crashes, server restarts), `server-stdio.log` (raw output of the server process), `service-setup.log` (service install). Passwords, PINs, tokens, API/private/license/recovery keys, e-mail addresses and phone numbers are masked before anything is written; database errors never include guest data.
**Support file:** Settings → Devices → *Download support file* (versions, storage/backup/license state and the last 200 lines of each log). Send it to PETRA support.
**Automatic recovery:** the Windows Service restarts the server 10 s / 30 s after a crash; the desktop app restarts a crashed server up to 3 times in 2 minutes and reloads its windows; a window that crashes is reloaded; terminals show an offline page and reconnect by themselves; after a database restart the next request works again without restarting PetraPMS.
