# INV-004 — Indian stock connections

Updated: 2026-10-14 (Asia/Calcutta). State: **Queued**. Depends on: INV-003 closed. Research owner: Codex; decision owner: product owner. [Tracker](../product-plan.md).

## Decision to establish

Select initial brokers/depository routes and accepted limitations on holdings, transactions, original cost and ongoing updates.

## Product context

DEC-015 includes researched Indian stock suggestions in the target; the recommendation prerequisites remain for reopened INV-002. This investigation establishes permitted acquisition, not suitability or authority to recommend. E014's Groww sync difficulty prioritises coverage questions but is unreproduced competitor experience, not a Corpus defect.

## Research questions

- Let audience evidence determine initial brokers; compare approved broker APIs, depository statements and permitted aggregation. Do not assume an exchange quote endpoint reveals an investor's holdings.
- Distinguish overnight/demat holdings, intraday positions and transaction history; decide which belong to initial scope.
- Establish identifiers, holdings discovery, transaction history, acquisition cost, corporate actions and refresh rights. If cost is absent, identify what reports cannot be calculated reliably.
- Establish data reuse/onward-AI permissions for contextual recommendations in the private/public stages; read-only holdings access alone does not grant all research/processing rights.
- Compare account authentication/re-authentication, revoked access, supported history, charges, commercial terms and free evaluation options.
- Identify duplicates when broker and consolidated depository statements cover the same securities; preserve account/owner attribution.

## Evidence required

Primary broker/depository documentation and contractual permissions; broker coverage/data matrix; written responses for gaps; permitted trial observations where available. Record imported statement timestamp separately from current quote timestamp.

## Prepared provider questions

Is third-party read-only portfolio aggregation permitted? Which accounts, holding types and transaction periods are exposed? How is cost basis represented? Are corporate actions included? What refresh/retention/export restrictions, authentication lifetime and fees apply?

## Closure and next action

Close with linked decisions for initial broker coverage, update routes, missing-history behaviour, freshness and source precedence requirements, commercial limits and accepted fallbacks. Resolve all promises before handing calculation requirements to INV-008.

Outcome: none. External dependency: identify approved access and provider questions after activation. Next action: after INV-003 closes, rank candidate brokers against INV-001's audience evidence and prepare the coverage matrix.

Planning alignment, 2026-10-14: incorporated DEC-015–DEC-019; State remains Queued. Questions and scenarios are requirements to investigate, not completed research, tests or approvals.
