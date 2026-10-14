# Corpus product plan and tracker

Updated: 2026-10-14 (Asia/Calcutta). Owner: product owner. Research and record maintenance: Codex.

This is the entry point for product planning. [Decisions](decisions.md) record accepted choices; [investigation reports](investigations/INV-001-audience-and-competition.md) contain evidence. The existing app is a prototype, not proof of release readiness. This plan takes precedence over older phase lists and proposed architecture where they conflict.

## Product brief

**Goal (DEC-015):** build a simple portfolio app with a paid personalised AI companion that understands the user over time, consolidates wealth with minimal upkeep and researches suitable ways to plan, preserve and grow it. Recommendation quality must follow from evidence and the user's circumstances; no wealth growth is guaranteed.

**Financial context (DEC-009/DEC-010):** use the portfolio, goals, risk profile, financial status, income/commitments, planned budget and actual spending history. Retain relevant, user-correctable context. Keep declared plans separate from observed spending, and expose missing history and uncertain future inflows.

**Research and recommendations (DEC-015):** the target includes suitable schemes, bonds, Indian/US stocks, ETFs, MFs, deposits and post-office/government schemes. Research current news, markets, policies, inflation, eligibility and instrument fundamentals; use company results/backlog only where relevant and evidenced. Explain dated sources, assumptions, suitability, alternatives, liquidity/lock-in, fees, material risks and effects on goals/budget. Age or favourable news alone cannot establish suitability. This supersedes DEC-013's analytics-only target; permitted behaviours and enabling requirements remain unresolved in reopened INV-002.

**Interaction and learning (DEC-011/DEC-019):** ask what the user wants help with, then deliver accordingly. Start with a short financial profile and learn gradually from authorised data, user-confirmed changes and a few purposeful follow-up questions when they materially affect a plan. Let users inspect/correct context; distinguish confirmed facts, inferences and unknowns. Avoid a long mandatory form or repetitive questioning. Detailed flows, cadence and architecture remain for investigation/design.

**Audience (DEC-001/DEC-008/DEC-018):** eventual usability across ages and backgrounds, beginning with one person's portfolio. Multi-provider Indian investors remain the initial discovery segment; Indian/US investments are priorities, not promised integration coverage. Family portfolios remain deferred. Relatives' asset examples are category/future research context, not account-access consent. Broader demand is unvalidated.

**Stage and delivery (DEC-016):** a private prototype for the owner comes first, including evaluation of the intended full AI capability after requirements/permission gates. No public launch date is set. All user-facing functionality comes from software/AI; no hired-adviser service is selected. Private use, AI delivery or manual imports do not establish exemption, data permission or legal clearance (DEC-014).

**Business (DEC-017):** paid AI is the accepted commercial direction for the eventual product. Exact free/paid boundaries, prices, trial/usage limits and sustainable margins remain for INV-009. Previously suggested INR 149/month or INR 1,499/year are untested hypotheses. No payment or subscription capability is claimed implemented.

**Constraints:** free documentation and authorised sandboxes first; spending requires a separate cost decision. Choose permitted automatic access, guided import or deferral separately for each provider. Investigations and decisions precede UI/application work. External messages and live financial-account access require their own authorisation.

**First-value case:** T001 asks about pausing contributions for a near-term purchase while preserving an emergency buffer and considering a future inflow. The owner liked the prior AI answer but lacked budget/spending context. This is one validation case; the user's chosen question determines the first result. Groww stock-sync difficulty is separate. No current prototype, provider or AI quality claim follows from the example.

**Unsettled:** supported providers/assets, data history/freshness, spending automation, personalised recommendation prerequisites, user-profile details, retention, accounts/cloud, architecture, costs, pricing and measurable success criteria. Accepted ambition is not proof of feasible access or compliant delivery.

## Current position and next action

- Current phase: evidence gathering; G1–G3 are open, G4–G5 have not started.
- **INV-001 remains Closed** for founder-led discovery under DEC-012. Later owner direction E020–E023 refines the product without supplying independent demand/payment evidence; PV1 remains required before public launch.
- **INV-002 — Investigating** is the sole active investigation. Reopened on 2026-10-14 under DEC-015/DEC-016 because full personalised research/recommendations replace DEC-013's initial restriction. Earlier research and closure remain in the history; actual legal classification and data rights are unresolved.
- Next action: map the intended personalised outputs across asset types to applicable private/public requirements, responsible entity/qualified roles and permitted data processing; prepare exact questions and required evidence where public documentation cannot resolve them. Do not assume a hired-adviser feature is necessary or that excluding it removes obligations. No outreach or spend authorised.
- **INV-003 — Queued**, paused pending reopened INV-002. Existing MF research, provider questions and unknowns are preserved. INV-004–INV-011 remain queued; do not bypass an unresolved active dependency.
- Code baseline inspected: `6b336c016a4313b5a70945b820801d14e939b6ca`, September 17, 2026. Documentation/metadata changes do not rebuild the app; runtime/Android release readiness is unverified.

## Operating rules

Stable identifiers: `INV-001` onward for investigations, `DEC-001` onward for decisions, `BUG-001` onward for defects. Never reuse an identifier.

Investigation states: **Queued → Investigating → Awaiting evidence/decision → Closed**. Record a reason and next action at each transition. New evidence can reopen a closed investigation; preserve its previous outcome and decision history.

Keep one active investigation at a time. It can await evidence or a decision; other work remains queued. A product-level change to this sequence must be recorded in the decision log rather than silently bypassing a dependency.

A report closes only with evidence and linked decisions for all of its closure questions. Outcomes are **adopt**, **reject** or **defer**. A deferral names the excluded capability, consequences and a concrete reopening trigger. An external dependency stays open until evidence arrives or an explicit supported alternative/deferral resolves it.

Classify findings as owner direction, repository observation, provider claim, observed trial, participant evidence or hypothesis. Date external sources and distinguish advertised capabilities from measured behaviour. Public documentation alone does not establish Corpus's eligibility, commercial rights, price or production reliability.

For every connection distinguish **holding discovery**, **transaction updates** and **price refresh**. Unknown fields stay unknown; quote updates do not prove quantities or purchase history are current.

When a provider response is required, record the provider, unanswered questions, evidence needed, responsible person and next action in its report. Prepare outreach questions; this tracker does not authorise external messages, paid services or financial-account access.

## Ordered investigation tracker

| Order / ID | Investigation and report | State | Depends on | Required decision / next action |
|---|---|---|---|---|
| 1 / INV-001 | [Audience, competitors and interviews](investigations/INV-001-audience-and-competition.md) | Closed | DEC-001–DEC-012 | Founder direction adopted; external demand/payment deferred to PV1. Reopen at independent beta availability or before public launch. |
| 2 / INV-002 | [Eligibility and regulatory boundaries](investigations/INV-002-eligibility-and-boundaries.md) | Investigating | INV-001 closed; DEC-014–DEC-016 | Reopened for full personalised recommendations; assess private/public prerequisites and unresolved responsible roles/data permissions. |
| 3 / INV-003 | [Indian mutual funds](investigations/INV-003-indian-mutual-funds.md) | Queued | INV-002 closed after reopening | Resume retained commercial/CAS findings only after INV-002 closes; fees, permissions, tested history and fallback remain unresolved. |
| 4 / INV-004 | [Indian stocks](investigations/INV-004-indian-stocks.md) | Queued | INV-003 closed | Select initial broker/depository routes and holdings/transaction/cost-basis coverage. |
| 5 / INV-005 | [US investments](investigations/INV-005-us-investments.md) | Queued | INV-004 closed | Establish INDmoney commercial access and alternatives; choose coverage/fallback. |
| 6 / INV-006 | [Other assets](investigations/INV-006-other-assets.md) | Queued | INV-005 closed | Decide practical coverage for deposits, bonds, retirement and manually recorded assets. |
| 7 / INV-007 | [Gmail, bank feeds and SMS](investigations/INV-007-gmail-bank-and-sms.md) | Queued | INV-006 closed | Decide acquisition/update channels and include/defer/exclude automatic spending. |
| 8 / INV-008 | [Financial calculations and AI](investigations/INV-008-calculations-and-ai.md) | Queued | INV-007 closed | Agree calculation/data requirements, reconciliation, contextual learning and researched recommendation quality within INV-002 requirements. |
| 9 / INV-009 | [Revenue and operating costs](investigations/INV-009-revenue-and-costs.md) | Queued | INV-008 closed | Define paid AI packaging, pricing experiment, research/refresh limits and viable margins. |
| 10 / INV-010 | [Privacy and architecture](investigations/INV-010-privacy-and-architecture.md) | Queued | INV-009 closed | Choose storage/accounts/recovery/consent architecture and migration requirements. |
| 11 / INV-011 | [Initial release requirements](investigations/INV-011-release-requirements.md) | Queued | INV-010 closed | Agree private-prototype acceptance and later public coverage, simple onboarding, quality, support and beta/launch criteria. |

An investigation's detailed questions and evidence checklist are in its report. Do not duplicate report findings here; update the state, dependency and next action.

## Gates before UI and code

| Gate | State | Evidence required to close |
|---|---|---|
| G1 — Product requirements agreed | Open | INV-001–INV-009 and INV-011 decisions specify audience, first-use experience, coverage, commercial model and exclusions. |
| G2 — Feasibility established | Open | Every promised connection has an approved permitted route or explicitly accepted fallback; provider evidence and costs are linked. |
| G3 — Architecture agreed | Open | INV-010 decisions follow the accepted data, financial correctness, privacy and migration requirements; INV-011 confirms operational needs. |
| G4 — UI specification completed | Not started | After G1–G3, specify and review onboarding, connection failures, incomplete portfolios, stale data, accessibility and recovery flows. |
| G5 — Implementation begins | Not started | G1–G4 closed; implement against agreed requirements, resolve scoped bugs and validate the private owner prototype first. Independent beta and publication remain subsequent evidence/release decisions. |

User interviews and provider-approved free feasibility trials are evidence gathering, not a UI rebuild. A technical trial must be isolated, separately scoped and permitted by the provider. The current setup performs no such trial.

## Required public-launch checkpoints

**PV1 — External audience/demand validation: Deferred; required before public launch (DEC-012).** Reopen INV-001 when consenting independent beta users become available or before launch, whichever comes first. Define participant/sample requirements, observable use/return measures, payment evidence and acceptance criteria in INV-009/INV-011. Founder satisfaction alone cannot close PV1. Public launch requires documented external evidence and an owner go/no-go decision; no independent interview, measured conversion or willingness to pay is currently established.

**LR1 — Actual output/marketing/regulatory review: Open; required before public launch (DEC-014).** Review implemented outputs, AI prompts, marketing, relevant data flows and launch-date requirements; obtain qualified clarification where classification is unresolved. Resolve conflicts through an explicit supported scope/operating-route decision; INV-002 is already reopened for full recommendations. Desk research and an analytics label cannot pass LR1. Paid engagement needs separate cost approval. This readiness gate does not create a user-facing adviser service.

## Bug and documentation backlog

States: Reported → Needs reproduction → Confirmed → Planned → Fixed → Verified. Documentation/release observations can be Confirmed without claiming a runtime reproduction. Severity is untriaged until impact is established.

| ID | Summary | Evidence / state | Expected behaviour | Next action / gate |
|---|---|---|---|---|
| BUG-001 | Owner reports that some app behaviour is not working properly; details unspecified. | Reported, 2026-10-14 owner message. No steps, screenshots or affected version provided. | Accepted workflows behave reliably. Specific expectation is pending the report. | Capture each concrete symptom as a child bug with device/build, steps, expected/actual result and frequency; reproduce before assigning cause. Repairs follow G4. |
| BUG-002 | Committed APK predates the Corpus redesign. | Confirmed release observation: `RFM_DadFinanceApp_Latest.apk` last changed in `707eda9`, 2026-09-07; redesign/polish commits are 2026-09-16–17. Installed-device state and binary behaviour unverified. | A distributed APK identifies and contains the intended source revision. | After implementation gates, rebuild, verify bundled assets/build identity and validate on Android; never equate the filename with release readiness. |
| BUG-003 | Old phase handoff contained retired UI/CDN instructions and already-present phases. | Verified documentation fix, 2026-10-14: retired handoff replaced; canonical links and custom-CSS baseline reviewed. | Historical instructions cannot be mistaken for the current build plan. | Closed for documentation only. Runtime readiness is separate; preserve the original handoff in Git history. |
| BUG-004 | README had obsolete Tailwind outputs and an inaccurate local-only privacy claim. | Verified documentation fix, 2026-10-14: setup/build descriptions checked against package scripts; optional remote AI flow checked against source. | Setup and privacy descriptions accurately state custom CSS and optional remote processing. | Closed for documentation only. Financial/runtime/privacy controls remain for INV-008/INV-010. |

For each concrete runtime bug add affected version/device, minimal reproduction, expected/actual behaviour, evidence location, severity, dependency, fix revision and verification result. Do not place credentials, financial statements or identifying portfolio data in tracked evidence.

## Maintenance and handoff

At each investigation session: read this tracker and accepted decisions; work only on the active report; add dated evidence and distinguish conclusions from assumptions; record user decisions; update status and next action. Close the report before activating its successor. Never record an interview, trial, provider approval or payment that did not occur.

Existing [enterprise readiness notes](enterprise-readiness.md) are proposed architecture to evaluate in INV-010. The old phase handoff is historical. Repository source remains the evidence for what currently exists.

### Change history

- 2026-10-14: established the brief, DEC-001–DEC-007, eleven ordered reports, five gates and BUG-001–BUG-004. Opened INV-001, reviewed competitor documentation, then moved it to Awaiting evidence/decision for user discovery. No UI/application changes or release verification performed.
- 2026-10-14: recorded P001's provider inventory and household asset examples; requested the missing recent-task evidence and personal/household scope choice. INV-001 remains open; later reports remain queued.
- 2026-10-14: accepted DEC-008 (one person first; family portfolios later). Clarified that P001's recent-review question concerns the current workflow outside Corpus; response pending.
- 2026-10-14: recorded E012 (successful INDmoney consolidation) and E013 (five screenshots) as counterevidence to assumed aggregation-only differentiation. Raw screenshots/personal financial values were not copied into Git. INV-001 remains open pending unmet-task and broader user evidence.
- 2026-10-14: recorded E014: reported Groww Indian stock-sync difficulty, repeated portfolio/goal context handoff to Claude/Codex and dissatisfaction with general planning answers. Updated the candidate benefit to persistent contextual planning; no provider, architecture, paid-demand or regulated-advice decision inferred.
- 2026-10-14: recorded E015/T001 and DEC-009. Corrected the earlier broad criticism: owner liked the concrete AI answer; it lacked budget/spending context. Context continuity is accepted direction; actual-spending inputs, output criteria, broader demand and regulated scope remain open.
- 2026-10-14: recorded E016/DEC-010: both planned budget and actual spending history are required. Acquisition and automation remain for later investigation; next decisions concern first-use output and wider discovery.
- 2026-10-14: recorded E017/DEC-011: ask each user which result they want. E018 records unavailable interview participants. Prepared a founder-led discovery/deferral alternative with an external validation checkpoint; awaiting a strategy choice, not fabricating market evidence.
- 2026-10-14: accepted E019/DEC-012, closed INV-001 within founder-led scope and established required PV1 external validation before public launch. Activated INV-002; all build gates remain open.
- 2026-10-14: initial INV-002 source/behaviour review completed; owner confirms personal-project status without a registered business/adviser partner. Awaiting the operating-route choice and qualified/provider evidence; no legal clearance inferred.
- 2026-10-14: DEC-013 records app/AI-only analytics/scenarios and deferred personal securities recommendations. DEC-014 retains LR1/provider gates. Closed INV-002 for scope policy and activated INV-003; no clearance/access permission claimed.
- 2026-10-14: INV-003 initial commercial/CAS/valuation review recorded. Existing parser normalises holdings with empty transaction arrays; full-history import is unverified. Provider eligibility/terms and a concrete fallback decision remain open.

- 2026-10-14: owner approved full personalised AI research, private-prototype-first development, paid AI, broad eventual usability and short-profile/gradual-learning direction (DEC-015–DEC-019). DEC-013 superseded; INV-002 reopened as sole active investigation and INV-003 returned to Queued with evidence preserved. Reconciled README, architecture notes and retired handoff; documentation link/state/identifier and whitespace checks passed. BUG-003/BUG-004 verified for documentation only. No new regulatory/provider research, application tests or Android build performed.

Documentation review, 2026-10-14: checked 42 local Markdown links, eleven report states against the tracker, DEC-001–DEC-019 uniqueness/order, JSON metadata and agreement with inspected package/source. Exactly one active investigation. Application code/assets/dependencies unchanged; BUG-001/BUG-002 and all build/launch gates remain unresolved. These checks do not validate external source freshness, financial calculations, provider rights or Android behaviour.
