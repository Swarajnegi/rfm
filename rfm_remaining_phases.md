# Retired RFM phase handoff

Updated: 2026-10-14. This file is retained as a navigation pointer. Its previous phase list described an obsolete UI/build stack, machine-specific paths and work already present in the prototype. Recover that historical text from Git if needed; do not use it as implementation instructions.

## Current records

- [Corpus product plan](docs/product-plan.md) — agreed direction, investigation order, gates, next action and bug backlog.
- [Decision log](docs/decisions.md) — accepted and superseded choices.
- [Active investigation: eligibility and regulatory boundaries](docs/investigations/INV-002-eligibility-and-boundaries.md) — reopened for personalised AI recommendations.
- [Architecture/readiness options](docs/enterprise-readiness.md) — requirements to investigate, not an accepted stack.
- [Archived UI shells](docs/legacy/README.md) — historical references, not shipped screens.

## Baseline and outstanding work

The live prototype uses Capacitor 8, Alpine.js, custom `src/corpus.css` compiled into `web/corpus.css`, local assets and localStorage, with optional remote AI. Full personalised research, automatic provider connections, correct transaction histories and public release readiness are not established by the current source.

The agreed first stage is a private prototype, leading toward a simple portfolio app with paid contextual AI research and planning. Complete evidence and decisions before UI/application rebuilding. INV-002 is the sole active investigation; existing MF findings are retained in queued INV-003. G1–G3 remain open and G4–G5 have not started.

Runtime defects reported by the owner still need specific reproduction steps. The committed APK predates the redesign; a fresh Android build and device validation remain future work. Documentation reconciliation does not close those issues or establish a release date.
