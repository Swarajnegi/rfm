# Corpus decision log

Updated: 2026-10-14 (Asia/Calcutta). Product owner accepts product choices; Codex researches options and maintains the record.

Planning entry point: [product plan](product-plan.md). Investigation evidence is linked from that tracker.

These decisions were accepted by the owner in the 2026-10-14 product discussion and explicit instruction to implement the product-planning process. They establish direction, not provider contracts or proof of demand. Reconsideration preserves the old decision and links a replacement; it does not silently rewrite the history.

## Accepted decisions

### DEC-001 — Adopt multi-provider investors as the initial audience

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner selected “Multi-app investors” during product discovery, then approved the implementation plan.
- Choice: serve Indian investors holding investments across multiple providers; research Indian and US holdings.
- Alternatives considered: everyday budgeters; families and retirees as the primary audience.
- Consequence: INV-001 evaluates consolidation and recurring understanding first. Audience size, acquisition economics and willingness to pay are unvalidated.
- Reopen when: discovery shows a different segment has substantially stronger unmet need and willingness to adopt, or the owner changes direction.

### DEC-002 — Adopt the wealth-consolidation goal

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner approved the goal in the implementation plan.
- Choice: minimise portfolio upkeep and explain progress toward goals. Automatic connections are a product objective; supported providers and fallbacks are undecided.
- Alternatives considered: fully manual portfolio manager; a spending/budget application as the core product.
- Consequence: measure onboarding and maintenance burden as well as analytical value. Spending automation awaits INV-007; investment advice awaits INV-002/INV-008.
- Reopen when: INV-001 invalidates the recurring problem, or feasible access cannot support the goal at acceptable cost.

### DEC-003 — Adopt a lean paid-product approach without a publication deadline

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner selected “Lean paid product” and stated there is no rush to publish on Play Store.
- Choice: validate value and business sustainability before expanding. Release timing follows evidence and quality gates.
- Alternatives considered: funded broad fintech launch; personal/family app as the only initial objective.
- Consequence: research commercial packaging in INV-009. INR 149/month and INR 1,499/year remain hypotheses; no exact price, free limits or forecast is approved. DEC-017 later selects paid AI, without settling these details.
- Reopen when: the owner changes financing strategy or customer evidence supports a different commercial approach.

### DEC-004 — Adopt free research and sandboxes first

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner selected “Free research first” and approved that constraint in the plan.
- Choice: start with public documentation and provider-authorised free evaluation environments. Paid services, trials and recurring costs require a separate cost decision before purchase.
- Alternatives considered: a pre-set trial budget; evaluating cost only after feasibility.
- Consequence: capture prices, minimum commitments and cost uncertainty rather than silently buying access. No recurring budget has been specified.
- Reopen when: the owner accepts a specific priced option and cost ceiling.

### DEC-005 — Adopt provider-specific coverage decisions

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner selected “Decide per provider” and approved the plan.
- Choice: compare permitted automatic connections, alternative sources, guided import and deferral for each provider/asset category.
- Alternatives considered: automation required for every category; guided import automatically acceptable everywhere.
- Consequence: guided import is available for evaluation but is not approved for any particular provider yet. Record coverage and maintenance limitations.
- Reopen when: new access, pricing or user evidence changes the chosen provider outcome.

### DEC-006 — Adopt sequential evidence-based investigation closure

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner's instruction to close investigations and decisions one by one; approved eleven-investigation sequence.
- Choice: keep one active investigation, use stable identifiers, dated evidence and explicit adopt/reject/defer outcomes. Keep external dependencies open unless supported evidence or an explicit alternative resolves them.
- Alternatives considered: simultaneous implementation/research; marking uncertain capabilities feasible from marketing pages.
- Consequence: INV-001 remains open for participant evidence. Later investigations are queued. Closure requires an accepted decision for every closure question; deferral states exclusions and reopening trigger.
- Reopen when: the owner explicitly changes the sequence or evidence process; record dependency effects before moving work.

### DEC-007 — Adopt requirements and feasibility gates before UI/application work

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner's request to establish the plan and trackers, then work on UI/code; explicit approval of G1–G5.
- Choice: establish product requirements, feasibility and architecture; complete the UI specification; then implement and validate privately before deciding publication.
- Alternatives considered: redesign first; repairing unspecified runtime bugs before establishing their expectations.
- Consequence: log existing bugs, retain reproduction status and keep release readiness unverified. Existing architecture notes are proposals to investigate, not accepted implementation choices.
- Reopen when: the owner explicitly requests an exception for a defined urgent repair or changes the gates.

### DEC-008 — Adopt one-person-first scope; defer family portfolios

- Accepted: 2026-10-14. Outcome: adopt personal-first; defer family portfolios. Evidence: owner selected “One person first; family portfolios later” in the INV-001 scope follow-up.
- Choice: the first useful experience consolidates one person's investments. Family/household views and delegated access are later work.
- Alternatives considered: a combined household view with ownership separated from the beginning.
- Consequence: Groww MFs, US stocks/ETFs and EPF are the owner's initial personal workflow examples. Parents' Wint Wealth bonds, Paytm digital gold and bank FD remain asset-category/future-audience research context; they do not expand the first experience or grant access to relatives' accounts.
- Excluded now: household aggregation, family sharing and delegated account permissions in the first useful experience. Any later inclusion requires its own product/access decision.
- Reopen when: the owner requests a family phase or validated audience evidence supports considering it after the personal workflow is established. Record the renewed scope and consent/ownership requirements before implementation.

### DEC-009 — Adopt continuity of portfolio, goals and budget context as product direction

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner describes Corpus's desired value as an ongoing companion that knows the user over time; concrete interview E015 identifies absent monthly budget/spending context in an otherwise satisfactory planning answer.
- Choice: Corpus's intended planning experience carries forward relevant, user-correctable portfolio, goal and budget context as circumstances change. This refines DEC-002's goal; it does not remove the consolidation requirement.
- Alternatives considered: a portfolio snapshot dashboard; stateless AI requiring repeated context entry; making less conservative responses the primary value.
- Consequence: investigate a repeatable planning task and answer criteria. Planned budget versus actual-spending requirements, acquisition methods, retention/consent and architecture remain undecided. Broader demand, willingness to pay and demonstrated quality remain unvalidated.
- Original boundary: the personal-adviser analogy initially established continuity, not recommendation scope. DEC-015 later adopts the full personalised recommendation target, subject to reopened INV-002 and INV-008. Guaranteed growth is never accepted.
- Reopen when: discovery does not support ongoing contextual planning, users reject the necessary context handling, or access/economics cannot support the intended experience.

### DEC-010 — Require both planned budget and actual spending history

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner explicitly selected “Both my planned budget and actual spending over time” in the INV-001 input-requirement question (E016).
- Choice: the intended initial planning experience uses the user's declared monthly budget and observed spending over time as separate inputs, alongside portfolio/goal context.
- Alternatives considered: planned budget and user-reported changes first; actual income/spending history with a suggested budget.
- Consequence: assess planned-versus-actual differences and variability when evaluating a goal. Preserve the user's plan instead of silently replacing it with inferred spending; expose history coverage, dates and missing transactions. These are requirements to specify and validate, not measured capabilities of the current app.
- Boundary: no SMS, Gmail, bank-feed, institution coverage, spending category scheme, monitoring cadence or storage technology is chosen by this decision. INV-007 evaluates acquisition and automation; INV-008 evaluates reconciliation/calculations; INV-010 evaluates retention, consent and architecture.
- Reopen when: provider/privacy/cost evidence cannot support the accepted experience, or user research warrants a narrower scope; any fallback requires an explicit decision.

### DEC-011 — Ask the user which result they want

- Accepted: 2026-10-14. Outcome: adopt. Evidence: owner answered the first-output question with “It should ask the user this question then deliver accordingly” (E017).
- Choice: the first useful interaction asks what the user wants to achieve and routes the response accordingly. Goal/cash-flow scenarios, portfolio reviews and a combined review are candidate choices from the question; a free-form question can express the actual need. Do not force all users into the founder's computer-purchase scenario or generate every report by default.
- Alternatives considered: a fixed goal-plan-first experience; a fixed portfolio-review-first experience; a mandatory combined report.
- Consequence: T001 remains a concrete goal-planning acceptance case, not the only entry point. Reuse relevant portfolio, goals, planned budget and actual-spending context; ask for essential missing inputs and make the assumptions/evidence of the selected answer visible. Detailed output definitions remain for INV-008 and interface design for G4.
- Boundary: this interaction choice does not approve all financial recommendations or ensure all requested outputs are supported. Explain unavailable data/unsupported questions and apply the behaviour boundaries determined in INV-002.
- Reopen when: discovery or usability evidence shows that the question creates confusion, or feasible/permitted outputs require narrowing the initial choices.

### DEC-012 — Proceed founder-first; defer external demand validation to a required launch checkpoint

- Accepted: 2026-10-14. Outcome: adopt founder-led product discovery now; defer broader demand/payment validation. Evidence: owner explicitly selected “Proceed founder-first; defer broader demand validation to a required checkpoint before public launch” (INV-001 E019).
- Choice: use the documented owner workflow and dated competitor sample to settle the present audience/product-direction stage and proceed to feasibility investigations. This is a scoped discovery conclusion, not market validation.
- Alternatives considered: independent interviews before closing INV-001; additional public-feedback research before closure. The owner currently has no interview pool (E018).
- Consequence: INV-001 closes with DEC-008–DEC-012. Establish PV1, a required external-user validation checkpoint before public launch; define its sample, behavioural measures, payment evidence and acceptance criteria in INV-009/INV-011.
- Excluded/deferred: claims of representative demand, demonstrated willingness to pay, proven competitor superiority, conversion or retention. No independent interview or beta has occurred; the proposed interview sample is not a completed requirement.
- Reopen when: consenting independent beta users become available or the project approaches public launch, whichever comes first. Reopen INV-001 and evaluate the proposition; PV1 cannot pass on founder feedback alone. Do not publish until the external evidence and the owner's go/no-go decision are recorded.

### DEC-013 — Start with software-only analytics/scenarios; defer personal securities recommendations

**Superseded by DEC-015 on 2026-10-14.** The original choice and evidence below are preserved as history. The analytics-only restriction is no longer the product target. The no-hired-adviser delivery preference and unresolved legal/provider prerequisites remain.

- Accepted: 2026-10-14. Outcome: adopt initial analytics/scenario scope; defer personalised securities recommendations; reject a hired-adviser service as the current product model.
- Evidence: owner selected initial analytics/user-controlled scenarios with personal securities recommendations deferred, subsequently requested simpler wording, and specified that all user-facing service comes from the app or AI, with no adviser hired (INV-002 E210/E211).
- Choice: present facts, explanations and comparisons of plans the user chooses. Do not prescribe personal buy/sell/switch instructions, security allocations or which securities contributions to stop within this initial scope. No adviser consultation or hired-adviser partnership is included.
- Alternatives considered: a registered-adviser partnership; own adviser registration. Neither is chosen or funded now.
- Consequence: define/test actual outputs in INV-008 and review them before public launch. Software delivery does not establish exemption, business/provider eligibility or permission to process data. Any required professional/regulatory review is a readiness prerequisite, not a user-facing adviser feature or authorised expenditure.
- Excluded/deferred: prescriptive personal securities advice and associated adviser-service marketing. A disclaimer, free access or AI generation is not proof of permission.
- Reopen when: the owner wants prescriptive outputs or review finds the actual service crosses this boundary; resolve applicable requirements before enabling them.

### DEC-014 — Keep actual legal classification and data permissions as open gates

- Recorded: 2026-10-14. Outcome: adopt prerequisite tracking. Basis: approved investigation/gate process, DEC-013 and INV-002 evidence E201–E207. This is a research constraint derived from the plan, not provider approval or a legal opinion.
- Original choice: close INV-002 for initial scope policy only. That closure is reopened by DEC-015/DEC-016; the prerequisite policy remains accepted. Require LR1, a documented review of actual outputs, prompts, marketing and applicable rules before public launch. Carry per-feed entity/role, use/retention/AI rights and consent prerequisites to INV-003–INV-007/G2.
- Alternatives considered: assuming an analytics label, reachable endpoint or software supplier establishes permission. None is accepted.
- Consequence: affected capabilities remain unverified until prerequisites are evidenced. A feed's business/recipient requirements may need a permitted technical relationship or explicit fallback; this is distinct from an adviser feature. Paid review/outreach still needs separate authorisation.
- Reopen when: actual output review or provider evidence conflicts with current scope/business assumptions. LR1 cannot pass from desk research alone.

### DEC-015 — Adopt the full personalised AI research and recommendation target

- Accepted: 2026-10-14. Decision owner: product owner. Outcome: adopt product direction; supersede DEC-013's analytics-only restriction. Evidence: owner clarification in INV-001 E020 and INV-002 E212; approved documentation plan.
- Choice: research and suggest suitable schemes, bonds, Indian/US stocks, ETFs, MFs, deposits and government/post-office options in context of the user's portfolio, goals, risk, budget, actual spending and financial status. Explain evidence, assumptions, suitability, material risks and effects on goals.
- Alternatives considered: descriptive analytics/user-controlled scenarios only; user-facing hired-adviser service. Neither is the chosen complete product model.
- Consequence: reopen INV-002 as the sole active investigation, pause INV-003 as Queued and define research/calculation/model quality in INV-008. App/AI delivery establishes neither exemption nor permission. Do not promise wealth growth or recommendations unsupported by current evidence.
- Unresolved: enabling regulatory/entity/qualified-role requirements, data rights, research tools, accepted instruments and measured quality. Trade execution is outside the read-only direction and requires a separate decision.
- Reopen when: evidence makes the intended scope unavailable or an explicitly accepted operating/scope change is needed.

### DEC-016 — Develop a private prototype before public release

- Accepted: 2026-10-14. Decision owner: product owner. Outcome: adopt staged delivery. Evidence: approved plan and INV-001 E023 / INV-002 E213.
- Choice: establish requirements and feasibility, then implement/evaluate the intended full capability privately for the owner before considering public paid release. No publication deadline.
- Alternatives considered: immediate public paid launch; restricting the long-term goal to a personal app.
- Consequence: distinguish private acceptance from later independent beta/payment evidence. G1–G4 still precede implementation; private use does not automatically waive legal, privacy or provider requirements. No live-data access, purchase or deployment is authorised by this decision.
- Deferred: public distribution/revenue collection until accepted readiness, PV1 and LR1 evidence. Reopen at documented private acceptance and resolution of public requirements; independent beta availability also reopens discovery under DEC-012.

### DEC-017 — Make personalised AI the paid feature direction

- Accepted: 2026-10-14. Decision owner: product owner. Outcome: adopt paid AI direction. Evidence: owner paid-AI clarification in INV-001 E021; approved documentation plan.
- Choice: the eventual paid feature is the useful contextual AI companion with research, planning and explanation. Portfolio free/paid boundaries remain for INV-009.
- Alternatives considered: a free AI offering; charging only for basic manual consolidation; commissions/advertising. No alternative revenue channel is selected.
- Consequence: investigate willingness to pay, research/model/data costs, fair limits and sustainable margins. Prior INR 149/month or INR 1,499/year suggestions remain hypotheses. Paid capability is not implemented or validated by this choice.
- Unresolved: exact price, trial/usage limits, cancellations, packaging and payment route. No expenditure or payment collection authorised.
- Reopen when: external demand or operating-cost evidence does not support the paid value proposition.

### DEC-018 — Design for broad eventual usability, personal portfolios first

- Accepted: 2026-10-14. Decision owner: product owner. Outcome: adopt inclusive product intent. Evidence: owner all-ages/backgrounds and simplicity clarification in INV-001 E021; approved plan.
- Choice: keep Corpus simple and understandable across ages and backgrounds. DEC-001's multi-provider investors remain the initial discovery segment; DEC-008's individual-first scope remains.
- Alternatives considered: keeping only experienced investors as the eventual audience; starting with family portfolios.
- Consequence: investigate accessible language, meaningful permission explanations and progressive disclosure in INV-011/G4. Broad audience intent does not establish demand, universal coverage or entitlement for minors; eligibility/age-specific requirements must be resolved before promising those users support.
- Deferred: family/delegated portfolios under DEC-008; universal provider/age coverage until evidence and an explicit scope decision exist.
- Reopen when: usability/demand or eligibility evidence requires a narrower first supported audience.

### DEC-019 — Start with a short profile and learn gradually

- Accepted: 2026-10-14. Decision owner: product owner. Outcome: adopt interaction direction. Evidence: agreed combination and approved documentation plan, INV-001 E022.
- Choice: gather a short initial financial profile, learn from authorised data and user-confirmed changes, and ask a few purposeful questions when answers materially change a plan. Ask the user's desired result under DEC-011; use planned and actual spending separately under DEC-010.
- Alternatives considered: exhaustive upfront onboarding; relying on silent inference; stateless repeated context uploads.
- Consequence: expose missing/stale context and make retained information inspectable/correctable. Distinguish confirmed facts from inferences. Specify minimum fields, follow-up timing, permission controls and retention in INV-008/INV-010/INV-011/G4 rather than inventing them now.
- Unresolved: profile/data model, update cadence and implementation. Contextual learning is not permission for unrestricted collection or background monitoring.
- Reopen when: permitted data availability, privacy or usability evidence requires a different information-gathering flow.

## Pending choices

INV-001 remains closed for founder-led direction under DEC-012, with refinements DEC-015–DEC-019. INV-002 is reopened and Investigating for full personalised recommendations and private/public prerequisites. INV-003 is Queued until that closes; retained MF research remains valid evidence with unresolved questions. Exactly one investigation is active.

PV1 requires independent audience/payment validation and LR1 actual output/prompt/marketing/regulatory review before public launch. Provider permissions, prices, specific free/paid boundaries, architecture and measurable AI quality remain unresolved. Private-first development and software-only delivery are not clearance.

For a new entry record: stable DEC identifier, acceptance date, outcome, decision owner, linked investigation and dated evidence, choice, alternatives, consequences, excluded scope for a deferral, reopening trigger, and any superseded decision. Rejected and deferred options remain visible in the log. Consequences describing earlier investigation states are historical; the tracker and this pending section state current position.
