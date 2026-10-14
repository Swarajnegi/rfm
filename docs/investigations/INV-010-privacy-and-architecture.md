# INV-010 — Privacy and architecture

Updated: 2026-10-14 (Asia/Calcutta). State: **Queued**. Depends on: INV-009 closed. Research owner: Codex; decision owner: product owner. [Tracker](../product-plan.md).

## Decision to establish

The storage/account architecture, recovery, consent/context lifecycle, offline experience and migration necessary for the private-first and eventual paid AI product. Choose requirements before technologies; full research/recommendation scope and regulatory/data prerequisites flow from INV-002/INV-008.

## Research questions

- Map each data flow: portfolio records, statements/messages, credentials/tokens, quotes and AI requests. Identify device/server/provider roles, retention and deletion.
- Compare local-only, local with optional backup and account-based synchronisation against actual connection and recovery requirements. Do not assume the older enterprise proposal is approved or scalable merely because it is diagrammed.
- Define owner identity for the private stage and whether public accounts/sync are needed. Individual portfolios are first; household/delegated access remains deferred under DEC-008.
- Map short-profile inputs, gradually acquired history, user-confirmed facts versus inferences, correction/re-evaluation, optional follow-up questions and context inspection/export/deletion. Explain collection purpose and keep learned context correctable; choose minimum fields and update cadence from INV-008/INV-011.
- Separate portfolio-record consent from external research/AI processing rights; map what is sent to each provider, retention, withdrawal, sensitive inference and deletion of cached context. Private development does not justify unrestricted collection.
- Establish credential protection, provider consent withdrawal, expired sessions, export/delete, backup/recovery, operational telemetry and incident response requirements.
- Preserve existing `rfm_v1` portfolio data and relevant history/preferences through an explicit migration with backup, validation and rollback. Determine the status of the unused SQL schema through code inspection rather than assuming a deployed database.
- Define backend requirements and quote/AI services from provider rights and cost limits. Choose technologies after requirements, compatibility and maintenance tradeoffs are assessed.

## Evidence required

Accepted earlier decisions; verified current data model and processing paths; provider constraints; applicable privacy/platform requirements; architecture options with operating cost and migration consequences. [Existing readiness notes](../enterprise-readiness.md) are a candidate, not accepted evidence of implementation.

## Validation scenarios to specify

Offline launch, expired/revoked connection, device loss, account deletion, cancelled consent, inaccessible provider, failed/incomplete migration, restoration on a new device and owner-access separation if included. Add corrected/stale user context, optional permission refusal, withdrawal of an AI-processing permission, deletion of inferred/cached context and missing spending-history coverage.

## Closure and next action

Close with a chosen architecture, data-flow/retention and consent decisions, recovery/migration contract, operating requirements and identified launch-critical reviews. G3 also depends on INV-011's acceptance of those operational needs.

Outcome: none. External dependency: review/provider clarifications if needed. Next action: after INV-009 closes, inspect current storage and map the accepted product data flows before choosing a stack.

Planning alignment, 2026-10-14: incorporated DEC-015–DEC-019; State remains Queued. Questions and scenarios are requirements to investigate, not completed research, tests or approvals.
