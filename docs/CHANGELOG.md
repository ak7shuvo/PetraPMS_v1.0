# Changelog

## 1.0.0 (release preparation)
Release guard (`pnpm release:check`, first step of `pnpm build:win`): refuses development license key, placeholder update feed / homepage, unapproved icon, mismatched versions, development overrides and secrets; production-key workflow in the License Manager (`--production`, `write-app-key`); update feed baked in at release time and validated (https, no placeholders); server version now correct in Windows Service mode; production stage pruned of sources, configs and source maps; `pnpm stage-check`.

## 1.0.0
First release: dashboard, room rack & tape chart, rates/seasons/policies, reservations (groups, waitlist, deposits), front desk (check-in/out, room move, walk-in, shift notes), guest CRM with foreign-guest/police report fields, folio & billing (VAT/SC, split folios, city ledger, invoices with QR), housekeeping, maintenance, night audit (idempotent, rollback), POS integration API + OpenAPI + simulator, 17 reports (Excel/CSV/PDF), SMS/email notification queue, Data Import & Seeding Center (wizard, dry-run, undo, round-trip export, config export/import, backup/restore with optional AES-256, demo data), offline Ed25519 licensing with trial/read-only, English + Bangla UI, multi-window multi-user desktop shell, Windows installer / portable ZIP / Docker + PostgreSQL.
