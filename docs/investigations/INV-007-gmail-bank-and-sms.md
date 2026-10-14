# INV-007 — Gmail, bank feeds and SMS

Updated: 2026-10-14 (Asia/Calcutta). State: **Queued**. Depends on: INV-006 closed. Research owner: Codex; decision owner: product owner. [Tracker](../product-plan.md).

## Decision to establish

The role and permitted scope of each acquisition/update channel for planned-versus-actual finances and ongoing AI context. DEC-010 already requires actual spending history; decide automatic acquisition, coverage and fallback per channel without silently removing that input requirement.

## Research questions

- Compare deliberately shared/forwarded statements, Gmail acquisition and permitted bank feeds against direct connections selected earlier. Explain exactly what permission and financial data each route needs.
- Establish current Gmail verification/security-assessment and use requirements for the actual processing architecture. A filtered search inside an inbox does not imply a narrowly restricted mailbox permission.
- Evaluate Account Aggregator eligibility/partner roles from INV-002, provider coverage, permitted purpose and refresh rights; do not assume a technology contract bypasses eligibility.
- Evaluate Google Play SMS exceptions, consent, on-device handling, background behaviour and iOS limitations from primary platform documentation.
- Test duplicate alerts, own-account transfers, card repayments, refunds, cash/missing transactions and uncertain merchant/category classification. Near-immediate message arrival is not a complete ledger.
- Decide an accepted way to obtain actual spending history and update context with minimal user effort. Assess automation versus permitted statement/manual fallbacks and their completeness; actual spending is required information, while SMS/Gmail/bank methods are unchosen. Recorded spending/remaining allowance is distinct from changing the user's chosen budget.
- Support short onboarding and optional purpose-specific permissions (DEC-019); expose missing coverage. No continuous monitoring, inbox-wide collection or real-time completeness is approved merely because ongoing planning needs history.

## Evidence required

Dated Google/Apple and provider rules, permitted data-flow examples, audience need and a cost/coverage comparison. No inbox, SMS, bank connection or device permission has been accessed during tracker setup.

## Prepared clarification questions

Which scopes and reviews apply to this proposed architecture? Is commercial financial-message processing permitted? What purpose, retention, sharing and background-update limits apply? What portion of transactions can the route reliably cover?

## Closure and next action

Close with channel-specific choices, permissions, limitations, fallback/deferral triggers and an explicit spending-scope decision. Feed findings into INV-008/INV-010; keep eligibility gaps visible.

Outcome: none. External dependency: reviews/provider responses to identify after activation. Next action: after INV-006 closes, map the remaining acquisition gaps before adding a channel.

Planning alignment, 2026-10-14: incorporated DEC-015–DEC-019; State remains Queued. Questions and scenarios are requirements to investigate, not completed research, tests or approvals.
