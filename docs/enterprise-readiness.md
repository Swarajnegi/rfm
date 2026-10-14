# Corpus architecture and readiness notes

Updated: 2026-10-14. These are requirements and options to assess in INV-010, not an approved stack or implemented production architecture. The [product plan](product-plan.md) and [decision log](decisions.md) govern delivery and investigation order.

## Current prototype

Corpus is a Capacitor Android shell around an Alpine.js client with custom local CSS and bundled assets. Portfolio records, price-sync state, optional AI configuration and responses are stored in localStorage. The client requests market data and optional AI from remote services. A SQL schema in the repository does not establish a deployed backend.

Local rendering and records support a single-device prototype. They do not demonstrate secure credential custody, durable transaction history, account recovery, cross-device consistency, licensed data access or reliable public operations. Current runtime, financial correctness and Android readiness remain unverified; the committed APK predates the redesign.

## Agreed product direction

The first development stage is a private prototype for the owner. The intended public product is a simple portfolio app with paid personalised AI research and planning, using portfolio, goals, risk, financial status, planned budget and actual spending history. Individual portfolios come first; family access is deferred.

Start with a short profile and learn gradually from authorised data, reported changes and corrections. Ask the user's purpose and a few useful follow-up questions when necessary. Research should cite dated sources and explain suitability, uncertainty, alternatives and material risks. Do not promise returns or infer suitability from age or favourable news alone.

User-facing service is software/AI; no hired-adviser service is selected. INV-002 is reopened for the full recommendation scope. Private use and AI delivery do not establish exemption, provider permission or public readiness. LR1 and PV1 remain mandatory before public launch.

## Requirements to establish before implementation

| Area | Private-prototype question | Public-product question |
|---|---|---|
| Acquisition | Which permitted owner-data connections or accepted imports provide holdings and history? | Which entities, contracts, consents, commercial rights and provider coverage permit customer data access? |
| Financial records | How are original records, cost, cash flows, corrections, currencies and missing history represented? | What reconciliation, audit, export and retention obligations apply at the accepted scale? |
| AI and research | Which tools, sources, calculations and evaluation cases establish usefulness for the owner's questions? | What suitability, disclosure, legal responsibility, quality controls, quotas and cost limits are required? |
| Privacy and recovery | Where is sensitive context stored, what leaves the device, and how can the owner correct/delete/export/restore it? | Are accounts/sync required, and what consent, deletion, recovery, encryption and incident controls follow? |
| Operations | How are stale data, failed connections and incomplete answers made understandable? | What freshness, support, monitoring, provider entitlement and reliability targets are affordable? |

Each private-stage data source still needs permission. Neither column is an automatic exception or an assertion that a particular architecture is sufficient.

## Architecture options for INV-010

Compare local storage with explicit backup, local storage plus selected remote services, and authenticated account/synchronisation designs against accepted rights, recovery needs, costs and operating requirements. No database, backend vendor, append-only ledger or multi-service architecture is selected here.

If remote portfolio/quote/AI services are needed, evaluate separation of records, market data, research and model access; secure credentials; consent/purpose enforcement; source timestamps; retries/rate limits; non-sensitive telemetry; and export/deletion. A paid consumer AI design must resolve credential custody rather than copy the current localStorage pattern. A service diagram alone establishes neither reliability nor permission.

Migration must preserve existing `rfm_v1` data and relevant history/preferences through a reviewed backup, validation and recovery process. Decide event history and correction rules in INV-008/INV-010 before choosing persistence technologies.

## Delivery and readiness

Follow INV-001–INV-011 sequentially, with INV-002 currently active. G1 product requirements, G2 permitted feasibility and G3 architecture precede G4 UI specification; G5 implementation starts after those gates close. UI design must cover short onboarding, optional permissions, stale/incomplete portfolios, connection failures, correction and recovery in accessible language.

Private-prototype acceptance will assess the chosen planning question, input completeness, calculations, researched claims and recommendations, persistence, failure handling and owner usability. Criteria are to be specified in INV-008/INV-011; none have passed from this document.

Public launch additionally requires independent demand/payment evidence under PV1, actual output/prompt/marketing/regulatory review under LR1, provider permissions under G2, accepted privacy/operations requirements and application/browser/Android validation. No deadline, paid engagement or deployment is authorised by these notes.
