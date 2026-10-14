# INV-005 — US investment connections

Updated: 2026-10-14 (Asia/Calcutta). State: **Queued**. Depends on: INV-004 closed. Research owner: Codex; decision owner: product owner. [Tracker](../product-plan.md).

## Decision to establish

Whether and how Corpus can commercially acquire the initial audience's US stocks/ETFs, beginning with INDmoney, and which alternatives or guided imports are acceptable.

## Product context

US stock/ETF research and personalised suggestions are part of DEC-015's target. INV-002 assesses applicable recommendation requirements; this report must establish permitted holdings/history and market/fundamental data access separately. Young age or favourable news alone is insufficient suitability evidence. No US brokerage account or commercial API rights are assumed from the owner's INDmoney use.

## Research questions

- INV-001 E002 documents an INDmoney AI connection. Refresh its specifications and establish permitted Corpus use, application registration, commercial terms and unattended update rights. Availability to an AI client does not grant redistribution/commercial rights.
- Separate US holding quantities, fractional shares, transactions/dividends, cost basis and USD/INR price refresh. Establish precision, historical depth and excluded account types.
- Examine ownership/account mapping, consent, session expiration, revocation and import from broker/custodian statements without assuming the user has a direct brokerage API account.
- Compare alternative brokers only where audience evidence supports them; do not promise universal broker coverage.
- Establish private/public eligibility, pricing, limits, free sandbox availability and retention/onward AI rights for researched recommendations; distinguish portfolio access from quotes, company filings/fundamentals and news licensing.

## Evidence required

Primary integration and account documentation; current commercial eligibility/usage terms; written clarification for unsupported rights; holdings/transactions/quotes coverage matrix; permitted trials or documented statement examples. No live financial account was accessed in tracker setup.

## Prepared provider questions

Can a paid portfolio app register a client and access these tools? May it synchronise in the background and retain/export records? Which US accounts, holdings, fractional quantities, historical transactions and original costs are available? What consent/session behaviour, rate limits, fees and onward-processing restrictions apply?

## Closure and next action

Close with an accepted INDmoney route, another supported route, or an explicit import/deferral decision including exclusions and reopening trigger. Record historical FX requirements for INV-008; a current FX quote does not establish historical invested INR.

Outcome: none. External dependency: commercial access clarification. Next action: after INV-004 closes, refresh the official integration terms and enumerate missing rights/data questions.

Planning alignment, 2026-10-14: incorporated DEC-015–DEC-019; State remains Queued. Questions and scenarios are requirements to investigate, not completed research, tests or approvals.
