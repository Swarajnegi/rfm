# INV-008 — Financial calculations, AI research and recommendations

Updated: 2026-10-14 (Asia/Calcutta). State: **Queued**. Depends on: INV-007 closed. Research owner: Codex; decision owner: product owner. [Tracker](../product-plan.md).

## Decision to establish

Which financial questions and personalised research/recommendations Corpus can support from accepted data, how calculations and suitability are checked, and how the AI explains evidence and uncertainty under the requirements established by reopened INV-002. Full recommendation ambition under DEC-015 is distinct from measured capability.

## Research questions

- Map every proposed output to required holdings, dated transactions, cash flows, prices and FX (currency conversion) history. Identify unavailable or incomplete inputs rather than calculating from invented values.
- Decide return measures and their interpretation: absolute gains, XIRR (annualised return from dated cash flows), time-weighted returns if justified, dividends/fees, corporate actions and benchmark comparisons.
- Establish USD and INR reporting, historical cost conversion and contribution/market/currency decomposition. Define when insufficient history prevents attribution.
- Establish duplicate detection, transfers, ownership, account reconciliation, corrections, source precedence, as-of time and estimated values.
- Treat existing tax calculations as unverified estimates; establish applicable periods, sources, validation and launch scope before making tax promises.
- Define supported AI questions, evidence references, uncertainty, stale/incomplete-data responses, model costs and personal-data minimisation. Compare rules-only explanations with AI; correctness cannot depend on fluent prose.
- Apply DEC-015's full contextual recommendation target and INV-002's resulting prerequisites; DEC-013's analytics-only restriction is superseded. Define allowed outputs and explicit unsupported cases, and carry actual output/prompt/marketing review to LR1. Delivery is app/AI, with no hired-adviser feature.
- Specify research tools and dated primary evidence for markets, policies/schemes, inflation, instrument terms and company results/filings. News summaries are leads, not verified investment facts. Distinguish facts, estimates and inference; expose conflicting/stale sources, citations and as-of dates.
- Define suitability evidence using risk capacity/tolerance, liquidity, horizon, concentration, currency, fees, eligibility, planned budget and actual spending. Explain alternatives and goal/budget consequences; age, favourable headlines and model confidence alone are insufficient. Do not promise investment returns or wealth growth.
- Define minimal initial context, user correction, material-change follow-up and re-evaluation behaviour under DEC-019. Assess research depth/cost against the paid-AI proposition, and require missing-input handling rather than silent guesses.

## Evidence required

Accepted provider data matrices; current primary calculation/tax references where applicable; hand-worked examples and expected results; independent checks of candidate outputs. Inspect the existing engine when active; do not infer correctness from feature presence.

## Validation scenarios to specify

Partial history, missing cost, fractional holdings, repeated imports, transfers, dividends/splits, stale quotes, multi-owner records, FX changes, unavailable provider, malformed AI output and an AI answer unsupported by its inputs. Tax examples use the actual accepted period/jurisdiction. Add T001 with missing spending or delayed inflow; incorrect/hallucinated citations; old/conflicting policies; unsupported eligibility; illiquid/high-risk products; company claims unsupported by filings; corrected risk/goals; and recommendations that conflict with the emergency buffer. Specify expected refusal/clarification and alternatives when evidence is insufficient.

## Closure and next action

Close with accepted output definitions, required inputs, missing-data policy, reconciliation and correctness criteria, research and suitability criteria, permitted AI boundaries and explicitly deferred reports. Hand implementation a calculation specification, not an approved framework choice.

Outcome: none. External dependency: independent financial/regulatory review if needed. Next action: after INV-007 closes, build the question-to-data matrix from the selected product benefit and provider evidence.

Planning alignment, 2026-10-14: incorporated DEC-015–DEC-019; State remains Queued. Questions and scenarios are requirements to investigate, not completed research, tests or approvals.
