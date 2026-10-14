# INV-003 — Indian mutual fund connections

Updated: 2026-10-14 (Asia/Calcutta). State: **Queued** — paused following INV-002 reopening under DEC-015/DEC-016. Depends on: INV-002 closed after expanded-scope assessment. Research owner: Codex; decision owner: product owner. [Tracker](../product-plan.md).

## Decision to establish

Choose initial mutual fund acquisition and update routes, provider coverage, user consent flow, refresh policy and a specifically accepted fallback.

Initially activated 2026-10-14; returned to Queued after DEC-015 reopened INV-002. The personal-project status and AI recommendation target do not establish commercial data-access eligibility. No provider contact, contract, paid trial or live account access has occurred.

## Initial evidence and coverage matrix

Three Exa workstreams, five results each (15 search results reviewed); selected primary pages fetched 2026-10-14. Unofficial API copies/scrapers and affiliate instructions were excluded as access-authorisation evidence. No consumer statement was requested, account connected or provider contacted. Source dates are unknown unless stated; retrieval date is not publication date.

| ID | Source | Observation and limit |
|---|---|---|
| E301 | [MFCentral ecosystem description](https://www.mfcentral.com/careers.html), retrieved for INV-002 on 2026-10-14 | Portfolio/CAS/API partnerships exist; public description does not specify Corpus eligibility, cost or usage rights. |
| E302 | [MProfit MFCentral CAS terms](https://www.mprofit.in/mfcentral-cas-api-terms/) | Its own service retrieves transaction data through an AMFI-registered distributor subsidiary, with recorded consent and commercial terms. This is one documented arrangement, not permission for Corpus or proof all API customers must use that exact structure. |
| E303 | [AMFI CAS instructions](https://www.amfiindia.com/online-center/download-cas) | Registered-email mailback statements through CAMS/KFintech; MFCentral summary/detailed options. Its described detailed MFCentral period is capped at 365 days; full-history availability must be established separately rather than assumed. |
| E304 | [KFintech CAS request description](https://mfs.kfintech.com/investor/General/ConsolidatedAccountStatement) | Describes registered-email delivery and a user-chosen PDF password. Folio email mapping affects coverage; no statement request submitted. |
| E305 | [CAMS CAS page](https://www.camsonline.com/Investors/Statements/Consolidated-Account-Statement) | Fetch returned a loading shell, so form choices/actual delivery were not verified. AMFI links to this route; absence of extractable content proves no feature absence. |
| E306 | [MFapi provider page](https://www.mfapi.in/) | Advertises scheme information and historical NAV JSON without authentication. Those are scheme prices, not an investor's units/transactions. Advertised availability/free access is not a commercial reuse licence or measured SLA. |
| E307 | [AMFI NAV file](https://portal.amfiindia.com/spages/NAVAll.txt), search-reviewed header/sample | Scheme identifiers, NAV and dates are public valuation inputs. No investor holdings or transaction data shown. Publication/reuse terms still need review. |
| E308 | Local `web/parser.js` / `web/app.js`, inspected 2026-10-14 | CAMS/KFintech parsing and MFapi quote refresh exist. Normalisation in `normalizeToInvestments` assigns an empty transaction array; the prototype is not evidence of a full historical ledger import. Password handling exists, but actual format/coverage accuracy was not tested. |

| Route | Holding discovery | Transaction updates/history | Price refresh | Current evidence status |
|---|---|---|---|---|
| Direct/permitted MFCentral API | Possible; full field/folio coverage unknown | Transaction retrieval exists in E302's service; Corpus history/update rights unknown | Separate valuation requirement | Commercial eligibility, field contract, fees and rights unresolved. |
| Guided registrar/MFCentral statement sharing | Consumer route described in E303/E304; confirm covered folios/format | Depends on detailed statement/range; requires new statements after new transactions | Separate NAV feed after units imported | Candidate fallback, not accepted or tested. Consumer request rights do not establish every downstream processing right. |
| MFapi / AMFI NAV data | None established | None established | Scheme NAV/date data | Valuation-only candidate; identifier mapping, rights and reliability unverified. |

## Findings and outstanding decisions

- Automatic portfolio access and NAV lookup are separate capabilities. Daily NAV updates cannot reveal a new purchase or changed units.
- A commercial API route is credible but not established for an unregistered personal-project developer. Technical reachability and another app's arrangement do not grant Corpus permission.
- A guided statement route can avoid entering every holding individually; it still imposes request/share/password/reconciliation steps. No usability result or acceptance of that fallback is claimed.
- Summary balances and detailed history need separate validation. Multiple statements/date windows, duplicate events, missing folios and shared emails/owners require explicit rules in INV-008. Do not promise lifetime returns from a current balance snapshot.
- Existing parser code cannot substitute for a schema/accuracy trial. No UI/code changes made; a future synthetic/consented sample trial must establish fields, units and history retention.

## Specific external dependencies

**Commercial route:** obtain official developer/onboarding terms or a written response describing eligible entity/role, supported holdings/transactions, history range, recurring consent/authentication, pricing/minimums, sandbox availability and retention/export/onward-AI rights. No verified commercial contact or response is recorded yet; do not send to a guessed address or treat a careers email as onboarding approval.

**Fallback:** owner decision on whether guided statement sharing is acceptable for initial MF coverage if commercial automatic access is unavailable, plus permitted format/accuracy and privacy evidence. Current preference remains per-provider evaluation (DEC-005), not blanket fallback approval.

State history: Investigating → Awaiting evidence/decision on 2026-10-14 after initial desk research. No provider approvals/prices, live portfolio or import-trial results are available.

## Research questions

- Evaluate MFCentral/CAMS/KFintech directly and permitted intermediaries. The owner's Groww mutual funds are an initial workflow example, not proof of compatibility.
- Separately establish initial folio/holding discovery, dated transaction history and continuing transaction updates; identify balances-only limitations. Evaluate price/NAV refresh as its own capability.
- Determine covered holding formats, direct/regular plans, joint ownership, multiple PANs and sources of duplicates across statements/brokers.
- Establish commercial eligibility and private/public use terms, permitted storage/use for contextual AI recommendations, onward AI restrictions, prices/minimum commitments, production access and availability of a free sandbox.
- Capture authentication and user participation, recurring consent, refresh cadence, revocation and recovery. Compare the real effort of a guided consolidated account statement (CAS) import when access is unavailable.

## Evidence required

Dated provider specifications/terms and written clarification for unknown commercial questions; data-field and coverage matrix; permitted free trial results if available; sample structure using synthetic or properly consented evidence outside tracked personal files. Competitor flows in INV-001 are examples of existing offerings, not permission for Corpus.

## Prepared provider questions

Can this entity/use case access the service commercially? Which holding/transaction fields and history are supplied? What user actions and refresh limits apply? What are fees and minimums? May data be retained, exported and processed by an AI service? Which sandbox and failure/revocation semantics are documented?

## Closure and next action

Close with decisions on supported MF coverage, acquisition/update/valuation separation, cost, consent, limitations and provider-specific fallback or deferral. An undocumented price or usage right stays unresolved rather than becoming zero/free/permitted.

Outcome: none. **Next action:** after reopened INV-002 closes, resume retained questions, find official commercial onboarding/specifications and prepare a concrete permission/field/cost inquiry; then obtain authorised clarification or choose an evidenced fallback/deferral. **External dependencies:** actual entity eligibility, terms, fees, field coverage and a fallback decision. No request was sent or cost authorised. INV-004 remains queued.

State history addition, 2026-10-14: Awaiting evidence/decision → Queued because INV-002 reopened for expanded recommendation scope. Earlier MF sources, unknowns and prepared questions remain preserved; no provider response or additional research claimed.
