# ExportFlow

Personal manager-assistant PWA for coordinating export Job Orders from intake to shipment.

- App: https://kareempalathingal.github.io/exportflow/
- Requirements and plans: [`docs/`](docs/) (Requirements v1.9, Technical Plan v1.3)
- Project rules for Claude Code: [`CLAUDE.md`](CLAUDE.md)

## Status

Phase 1 — Foundation: login, ACTUAL/DEMO workspaces, change history (audit log),
data-status labels, offline cache with sync / conflict tracking, installable PWA.

## Development

```bash
npm ci
npm run dev          # local dev server
npm run check        # typecheck + lint + unit tests + build
npm run test:rules   # Firestore security-rule tests (needs Java + emulator)
```

Firestore rules in `firestore.rules` are published manually from the Firebase console.
