# PetraPMS License Manager (vendor only)

**Never ship, copy to a customer PC, or commit anything from this tool's data folder.**

* The private signing key and the licence ledger (`private.pem`, `public.pem`, `licenses.json`) live in
  `%USERPROFILE%\.petra-license-manager` (override: `PETRA_KEYGEN_DIR`) — **outside the source tree**. The tool refuses
  a folder inside the repo. Optional: `init --encrypt` protects `private.pem` with `PETRA_KEY_PASSPHRASE`.
* Back up that folder offline (two copies). Lost private key = you cannot issue/renew; leaked = anyone can forge.
* The app contains only the **public** key. `pnpm build` fails if private key material ends up in the package.
* No licences are shipped in the app or installer. The ledger is yours.

```powershell
pnpm license init --write-app --production          # once: create the PRODUCTION key pair, embed the PUBLIC key (channel "production")
pnpm license write-app-key --production             # same key pair, new build machine: re-embed the public key from public.pem
#   (without --production the key is marked "development": fine for testing, but `pnpm build:win` refuses it)
pnpm license pool --count 500 --edition STANDARD    # optional: pre-generate AVAILABLE activation references (ledger only)

# Sale: customer shows Settings → License → "Show request code" (PETRAREQ1.…)
pnpm license issue --ref PETRA-XXXX-XXXX-XXXX-XXXX --customer "Sea Pearl Ltd" --hotel "Hotel Sea Pearl" `
     --rooms 60 --terminals 6 --expires 2027-12-31 --grace 14 --request PETRAREQ1.xxxx
pnpm license lookup PETRA-XXXX-XXXX-XXXX-XXXX       # state, installations, history
pnpm license list --state ACTIVATED                 # AVAILABLE | ACTIVATED | EXPIRED | SUSPENDED | REVOKED | TRANSFERRED
pnpm license renew LIC-… --expires 2028-12-31
pnpm license transfer <code from customer's License page> --key <their current key>
pnpm license suspend LIC-… --reason "unpaid"        # also: revoke (permanent) / reinstate (suspended only)
pnpm license publish-status --out license-status.txt
```

**Lifecycle**: AVAILABLE → ACTIVATED → (EXPIRED derived from date) · SUSPENDED ⇄ ACTIVATED · REVOKED (permanent) ·
TRANSFERRED (old installation after a computer change).

**Suspend / revoke** work offline: `publish-status` writes a signed list. Customers import it (Settings → License) or, if the
app's update feed is set, it is fetched automatically from `<feed>/license-status.txt`. An older list is never accepted
(sequence numbers), so a stale "all clear" cannot be replayed. A suspended/revoked licence makes the app **read-only**;
data stays viewable and exportable.

**Activation reference** `PETRA-XXXX-XXXX-XXXX-XXXX` is only a lookup key into your ledger; it grants nothing.
**Payload (v2)** has no secrets: licence id, ref, hotel id, product, plan, edition, limits (rooms, terminals, installations),
dates, grace days, status-refresh policy, installation fingerprint, modules/features.
