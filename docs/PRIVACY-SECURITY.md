# Privacy & security

* **No telemetry.** The software never contacts the vendor. The only optional outbound traffic is (a) the update feed URL you configure and (b) SMS/email provider URLs you configure.
* **Data** stays on the hotel's computer/server (or your own cloud). It includes guest personal data (names, phones, NID/passport numbers and images). The hotel is the data controller; restrict access by role, back up with encryption, and delete data you no longer need.
* **Secrets:** passwords and PINs are hashed (argon2id); API keys and session tokens are stored hashed; provider headers/tokens live only in server settings, are masked on read, and are excluded from support bundles, exports and logs. No OAuth client secrets or refresh tokens are present in the repository or exposed to browser JavaScript.
* **Backups** can be AES-256-GCM encrypted; the recovery key is shown only to authorised users.
* **Desktop hardening:** context isolation, sandboxed renderer, no Node integration, validated IPC from our own origin only, navigation/new-window restrictions, permission handler (camera only), no `webview`.
* **Web hardening:** CSP and security headers, no external CDNs, formula-injection neutralisation in spreadsheets, input validation (zod) on every route, audit log with before/after.
* **Network:** LAN mode is HTTP on a private network; use a VPN or reverse proxy with HTTPS for anything beyond the hotel LAN.
* **Reporting a vulnerability:** [security contact — fill in].
