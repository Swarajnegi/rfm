# INV-006 — Deposits, bonds, retirement and other assets

Updated: 2026-10-14 (Asia/Calcutta). State: **Queued**. Depends on: INV-005 closed. Research owner: Codex; decision owner: product owner. [Tracker](../product-plan.md).

## Decision to establish

Practical private-prototype and eventual public coverage for fixed/recurring deposits, bonds, retirement assets and manually recorded assets, including upkeep, record completeness and explicit limits. DEC-015 also targets suitable government/post-office schemes; recommendation requirements remain for INV-002.

## Research questions

- Initial owner-reported examples are EPF viewed through UMANG/passbook, Wint Wealth bonds, Paytm digital gold and an FD at an unspecified bank. Identify underlying institution and statement/access route rather than treating each app as a guaranteed API provider.
- Evaluate permitted holdings/transaction discovery, statement import and assisted entry for each category. Identify which fields need periodic owner confirmation.
- Distinguish face value, current valuation, accrued interest, cash payouts, maturity proceeds, contribution balances and owner estimates. Determine which categories lack a reliable market value.
- Establish data freshness, permissions, institution coverage, pricing and update burden. Include recurring deposits, NPS/PPF or other assets only if audience scope supports them.
- Preserve DEC-008 individual-first scope; family/delegated access is deferred. Relatives' examples are asset-category context, not consent to connect their accounts.
- For schemes/deposits/bonds, identify eligibility, issuer/credit and guarantee terms, rates/as-of dates, maturity, lock-in, liquidity, fees and tax treatment from primary sources. Acquisition, valuation and suitability are separate questions; do not equate a provider listing or an advertised return with safety.

## Evidence required

Primary institution/platform documentation, permitted statement structures or trial results, per-category field/freshness matrix and demonstrated/manual workflow effort. Research into these providers has not begun.

## Prepared provider questions

Which underlying accounts and instruments are accessible to a third-party read-only app? Is statement sharing supported? What balance, contribution, interest/payout and maturity data is available, and when? What consent, usage rights, fees and limitations apply?

## Closure and next action

Close with per-category adopt/reject/defer decisions, valuation assumptions visibly labelled, owner attribution and maintenance/fallback requirements. Deferral names the excluded category and reopening trigger.

Outcome: none. External dependency: underlying institutions and eligibility to establish after activation. Next action: after INV-005 closes, apply the accepted individual-first scope and map priority assets to actual record holders.

Planning alignment, 2026-10-14: incorporated DEC-015–DEC-019; State remains Queued. Questions and scenarios are requirements to investigate, not completed research, tests or approvals.
