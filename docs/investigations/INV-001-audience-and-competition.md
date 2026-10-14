# INV-001 — Audience, competing products and user interviews

Updated: 2026-10-14 (Asia/Calcutta). State: **Closed** — founder-led audience/product direction; external demand validation deferred by DEC-012. Research owner: Codex. Decision owner: product owner.

Depends on: [DEC-001–DEC-012 and DEC-015–DEC-019](../decisions.md). Next investigation: INV-002, reopened and active. [Tracker](../product-plan.md).

## Question and completed work

For Indian investors using multiple providers, what recurring problem is insufficiently solved, why would they choose Corpus, and what first experience could become worth paying for?

Completed: repository baseline inspection; three Exa search workstreams (INDmoney, Kuvera, Value Research), five results each; 15 search results reviewed and seven unique primary pages fetched on 2026-10-14; one partial owner workflow interview (P001). These are a scoped competitor sample, not an exhaustive market census. Older marketing, third-party commentary and duplicate pages were not used to infer current quality or demand. No competitor account was connected and no completed participant interview, account-level test, purchase or conversion experiment was performed.

State history: Queued → Investigating on 2026-10-14; → Awaiting evidence/decision after desk research/interview preparation; → Closed on 2026-10-14 after DEC-008–DEC-012 settled founder scope, context, inputs, interaction and the external-validation deferral. Independent validation remains a PV1 dependency before public launch.

## Evidence register

All external pages retrieved 2026-10-14. Source dates below are publisher-displayed where available; undated means publication date unknown. Provider-authored material establishes advertised behaviour, not independently measured reliability, commercial integration rights or satisfaction.

| ID | Source / source date | Observation and limitation |
|---|---|---|
| E001 | [INDmoney net-worth product](https://www.indmoney.com/networth), undated | Advertises external investment consolidation, personal/family views, benchmarking and goals. Breadth is a provider claim; no institution-by-institution coverage or sync reliability was measured. |
| E002 | [INDmoney MCP](https://www.indmoney.com/mcp), undated | Documents a read-only portfolio/market-data connection for Claude with provider sign-in and consent. AI portfolio explanations already have an incumbent offering. Corpus eligibility and commercial use are unestablished; investigate in INV-005. |
| E003 | [Kuvera external MF import](https://kuvera.freshdesk.com/support/solutions/articles/82000924581-how-do-i-import-my-existing-mutual-fund-investments-), modified 2026-04-07 | Describes a user-triggered MFCentral verification/refresh flow. This does not prove uninterrupted background transaction sync. |
| E004 | [Kuvera family access](https://kuvera.freshdesk.com/support/solutions/articles/82000926249-how-can-i-access-my-family-account-s-), modified 2026-05-20 | Documents separately verified family accounts and incremental rollout. Family views alone cannot establish unique positioning for Corpus. Actual availability was not tested. |
| E005 | [Kuvera future-transaction import](https://kuvera.freshdesk.com/support/solutions/articles/82000703533-will-future-sip-or-lumpsum-transactions-get-imported-automatically-), modified 2024-03-14 | Older guidance says external transactions need periodic import. Treat as historical context; the later refresh guide means current behaviour needs an account-level check, not a blanket claim that Kuvera lacks automation. |
| E006 | [Value Research upload flow](https://www.valueresearchonline.com/my-investments/uploads/), undated | Public interface describes Gmail statement acquisition for registrar/depository statements, multiple-PAN mapping and reconnection states. Portfolio updates follow received statements, not necessarily the instant a transaction occurs. No live import was tested. |
| E007 | [Value Research portfolio overview](https://www.valueresearchonline.com/stories/224343/track-analyse-investments-value-research-portfolio-manager-tool/), published 2025-05-05 | Advertises broad asset tracking, return measures, overlap, benchmarks and a free portfolio tool. Historical product claims; current tier boundaries and calculation quality were not verified. |
| E008 | Owner product discussion, 2026-10-14 | Owner uses INDmoney for US investments and is concerned that manual portfolio entry/export is difficult for ordinary users. Directional seed from one founder; not a measured audience-wide result or completed interview. |
| E009 | Local checkout `6b336c0`, inspected 2026-10-14 | Current Corpus has portfolio/planning screens, optional remote AI, statement parsing and local storage. Current user satisfaction, correctness and release readiness are untested. |
| E010 | Owner response to workflow interview request, 2026-10-14 | Owner identifies US stocks/ETFs, Groww Indian MFs and EPF in UMANG/passbook; also describes a parent's Wint Wealth bonds and another parent's Paytm digital gold/bank FD. Provider inventory is evidence; review difficulty, missing answers and household launch preference were not yet supplied. |
| E011 | Owner scope follow-up, 2026-10-14 | Owner explicitly selected one person first and family portfolios later (DEC-008). Owner also requested clarification of the recent-review question; it was clarified as the current method outside Corpus. No actual review/pain answer has yet been provided. |
| E012 | Owner consolidation experience, 2026-10-14 | Owner reports successfully bringing Groww MFs and EPF transactions/portfolio into INDmoney alongside US holdings already there. Owner also says INDmoney can connect bank accounts; no personal bank-connection trial or result was described. Time of the original connection, effort, update mechanism and remaining difficulties are unknown. |
| E013 | Five owner-supplied INDmoney screenshots, received 2026-10-14 | Image 1 shows a personal aggregate and US stock/MF/EPF categories; images 2–3 show an EPF balance, last-update label, retirement projection and passbook PDF upload; images 4–5 show aggregate family and individual-member wealth/asset allocation. These establish visible functionality in this example, not correctness, API permissions, universal coverage or continuous refresh. Raw attachments remain outside Git; balances, names and employer details are not transcribed. |
| E014 | Owner unmet-need interview response, 2026-10-14 | INDmoney largely meets the owner's needs, but syncing Indian stocks from Groww was difficult. Owner repeatedly supplies portfolio snapshots, questions and goals to Claude/Codex to obtain planning help, and describes the responses as conservative/general. Desired help analyses existing wealth and future investments in the context of goals and monthly budget. Exact failed stock-sync behaviour, recurring question, answer-quality criteria and willingness to pay are not established. This describes the owner's experience, not a claim that INDmoney has no AI integration or that all such models answer poorly. |
| E015 | Owner concrete planning example and clarification, 2026-10-14 | Owner asked about temporarily pausing investments to fund a near-term computer purchase while building an emergency buffer and anticipating a dated future lump sum. Owner was fairly satisfied with the answer; the missing input was monthly budgeting/spending habits. Desired product provides continuity and knows the user over time. Exact personal amounts are omitted from tracked notes. This narrows E014's broad answer-quality criticism: the concrete deficit is context, not demonstrated poor investment reasoning. |
| E016 | Owner budget/spending requirement answer, 2026-10-14 | Owner explicitly requires both the planned budget and actual spending over time for the first planning experience (DEC-010). This settles information scope, not a transaction acquisition channel, institution coverage, automatic monitoring or production feasibility. |
| E017 | Owner first-output decision, 2026-10-14 | Owner directs Corpus to ask each user which result they want and deliver accordingly (DEC-011), rather than fixing goal/cash-flow, portfolio review or combined review as the universal first output. |
| E018 | Owner participant-availability answer, 2026-10-14 | Owner has no investors available for interviews. No independent participant recruitment, interview or willingness-to-pay evidence has occurred. The availability constraint alone does not explicitly select founder-only closure or establish a deferral. |
| E019 | Owner validation-strategy decision, 2026-10-14 | Owner explicitly accepts proceeding founder-first and deferring broader demand validation to a required checkpoint before public launch (DEC-012). This supplies the deferral decision missing in E018; it does not supply independent user/payment evidence. |
| E020 | Owner full-AI clarification, 2026-10-14 | Owner wants personalised research/recommendations using news, markets, policies, inflation, risk, finances and portfolio, spanning securities, bonds, deposits and government/post-office schemes. This supersedes the analytics-only target (DEC-015), not regulatory or provider prerequisites. |
| E021 | Owner audience and paid-value clarification, 2026-10-14 | Eventual app should be simple across ages/backgrounds; paying enables useful contextual AI. DEC-017/DEC-018 adopt direction, not proven demand, prices or universal eligibility. |
| E022 | Agreed onboarding direction, confirmed in approved documentation plan, 2026-10-14 | Short initial profile plus gradual learning and purposeful follow-up questions (DEC-019). Specific fields, cadence, data channels and retention are not selected. |
| E023 | Owner-approved staged plan, 2026-10-14 | Private prototype first; public release later subject to evidence and readiness (DEC-016). Does not authorise live data, spend or exempt private processing from applicable requirements. |

## Later product clarification

DEC-015–DEC-019 refine the founder-led direction while retaining this report's scoped closure. The desired paid companion should remember user-correctable financial context and research suitable options; aggregation alone is not demonstrated differentiation. The owner's largely satisfactory previous AI answer remains counterevidence to claiming poor reasoning: missing budget/spending context and repeated handoff are the concrete deficits. Broader audience intent and more ambitious AI are not independent interview, willingness-to-pay or quality evidence.

A short initial profile followed by gradual learning is accepted. Detailed profile fields and question timing remain for INV-008/INV-010/INV-011 and G4. Individual-first scope and PV1 remain unchanged. INV-002 is reopened for recommendation prerequisites; no new external research or participant interview occurred in this documentation update.

## Initial comparison and implications

| Alternative | Advertised overlap with Corpus | Question to test with users |
|---|---|---|
| INDmoney | Consolidated wealth, family view, goals, performance and AI connection (E001/E002). | Which specific review task remains difficult despite an existing consolidated product? |
| Kuvera | External MF acquisition/refresh and family account management (E003/E004). | Where does ongoing maintenance become burdensome, especially outside MF holdings? |
| Value Research | Statement-based acquisition, portfolio analysis and multiple-investor mapping (E006/E007). | What useful recurring explanation or workflow is missing from their current setup? |
| Spreadsheet / checking apps separately | Alternative workflow to examine; no claim about its prevalence. | Why do participants retain it, and what would persuade them to change? |

**Finding:** consolidation, family tracking and AI explanations are established advertised features in this sample. A generic feature checklist does not substantiate a reason to switch or pay.

**Participant/visual counterevidence (E012/E013):** the founder has already achieved personal consolidation in INDmoney; screenshots also show family and per-member views, allocation and an EPF projection. This narrows the open question from whether consolidation is useful to what unresolved task makes a separate paid product worthwhile. It does not settle demand for other investors, but it contradicts assuming this participant needs Corpus merely to obtain a combined total.

**Unmet needs reported by P001 (E014/E015):** (1) difficulty syncing Groww Indian stocks into the existing consolidator, and (2) a repeated handoff to a separate AI, including re-supplying holdings and goals, to seek planning guidance grounded in a monthly budget. E015 clarifies that the concrete answer was fairly satisfactory; it lacked budget/spending context. These are distinct candidate problems: provider-specific acquisition reliability, and continuity/completeness of contextual planning. The stock difficulty is an unreproduced competitor experience, not a confirmed Corpus bug. A single founder's experience establishes a candidate problem for that participant, not broad demand or paid conversion.

The EPF screenshot displays a last-update date of 16 September 2026 and an upload-passbook-PDF sheet. The receipt date is known; capture date, update history and trigger are not. A manual upload route is visibly offered, but that neither proves manual-only acquisition nor an automatic background connection. The projected retirement value is a projection; its assumptions and correctness cannot be assessed from the provided screens. Do not manufacture a competitor bug or dissatisfaction from a screenshot.

**Hypotheses to test:** (H1) uncertainty about completeness and freshness is a recurring problem; (H2) a grounded monthly account of contributions, market and currency movement is valuable; (H3) avoiding repeated import/reconciliation work is worth paying for; (H4) understandable controls and exports increase adoption; (H5) retaining current portfolio, goals and budget context reduces repeated AI handoff effort and enables useful ongoing planning. E014 supports the existence of handoff effort for P001, but does not validate a paid solution, the architecture or answer quality. None is accepted as the differentiator. Any decomposition depends on the available transaction history and INV-008 correctness decisions.

**Initial recommendation (subsequently adopted/refined by DEC-009–DEC-012 and DEC-015–DEC-019):** test persistent portfolio-and-goal planning grounded in the user's monthly budget, with trustworthy consolidation as its input. Retain the monthly wealth review as another candidate rather than pretending it was the user's requested planning task. Define concrete questions and useful answer criteria before choosing outputs. Do not promise all institutions, continuous updates, family sharing, automatic budgets or regulated advice from this report.

E015 qualifies the earlier “conservative/general” assessment: the owner was fairly satisfied with the concrete response and identified missing budgeting/spending context. Do not retain a claim that this answer was unsatisfactory or equate usefulness with taking more investment risk or offering higher-return guarantees. Candidate trust criteria to investigate include traceable input figures, explicit assumptions, scenario calculations, alternatives/tradeoffs, missing-data handling and remembered goals/preferences with correction controls. Personalised recommendations remain subject to INV-002; data and calculation/model evaluation remain subject to INV-008. Current provider/context-storage decisions are still open.

## Concrete first-task candidate (T001)

**Owner task:** evaluate a temporary pause in investment contributions to fund a near-term purchase while preserving an emergency buffer, accounting for monthly budget/spending and an expected future lump sum. This is a product research case, not financial advice or an accepted recommendation for the owner's investments.

**Known from E015:** the owner has a purchase goal/time window, wants an emergency fund, anticipates a future inflow and received an answer they largely liked. **Missing for an actual calculation:** cash/liquid funds, income dates, planned budget, observed spending/variability, commitments, current contributions, desired buffer, goal flexibility and confidence in the expected inflow. Existing holdings alone cannot supply those facts.

**Input requirement accepted in E016/DEC-010:** both planned budget and actual spending history belong in the intended experience. Compare them without treating either as a complete forecast: identify recurring commitments, variance and irregular spending with coverage/as-of dates visible. A spending history with missing cash/accounts or unclassified transfers must not be described as complete. Acquisition channels and feasible history depth remain for later investigations; no live data or permissions were obtained by this choice.

**Candidate useful-answer requirements, awaiting acceptance:**

- Describe the inputs/as-of dates used and request essential missing facts instead of assuming spending or guaranteed future income.
- Compare a contribution pause with alternatives using an explicit month-by-month cash-flow projection and the user's stated buffer/goal constraints; identify any unfunded period or dependency.
- Show what changes if spending is higher or the expected inflow is delayed, using disclosed assumptions. Investment growth is a scenario assumption, not a guaranteed funding source.
- Preserve user-confirmed goals/budget and prior plan assumptions, allow corrections, and re-evaluate when material inputs change. Proactive monitoring/reminders are a separate later design decision.
- Explain calculations and tradeoffs in terms of the actual question. Any permitted recommendation behaviour is determined by INV-002, and calculation/AI verification by INV-008.

DEC-009 accepts contextual continuity, DEC-010 requires planned budget plus actual spending and DEC-011 requires asking the user what result they want. T001 remains a concrete case for the goal-planning route, not a universal report to produce by default. Detailed output calculations and accuracy measures remain for INV-008; the interface for G4. DEC-015 now adopts personalised research/recommendations as the target; this is still not proof of capability or legal clearance. INV-002 is reopened for its enabling requirements.

### Accepted first-interaction direction (DEC-011)

Ask the user what they want help with, then respond to that purpose using the relevant retained context. Goal/cash-flow planning, portfolio review or both are candidate choices; allow the actual question to clarify the intended result. Ask only for essential missing inputs, state limitations/assumptions and trace the answer to known records. A desired result may remain unsupported if its data or permissible recommendation scope is unresolved. Acquisition feasibility and detailed financial outputs are later decisions, not settled by this interaction rule.

## Interview preparation

Suggested initial discovery sample: **8–12 interviews**, expanding if answers remain inconsistent. This is a research recommendation, not a statistical claim or an approved release success metric. Include Indian-only and Indian-plus-US investors, people using incumbent consolidators and people using statements/spreadsheets; do not recruit only enthusiastic friends. Seek recent behaviour rather than agreement with the app idea. No participant recruitment or outreach has occurred.

**Availability update (E018):** the owner has no interview pool. Do not represent the suggested sample as an available resource or require repeated requests for the same unavailable contacts. Founder evidence and the dated competitor sample are available. Public feedback can add problem hypotheses but cannot substitute for an independent observed trial or payment evidence.

**Accepted closure alternative (E019/DEC-012):** adopt the stated founder-led product direction for feasibility research now and defer external audience/payment validation. Exclude claims of representative demand, willingness to pay and proven differentiation. Reopen INV-001 when consenting independent beta users become available or before public launch, whichever comes first. PV1 is a required external validation checkpoint; define sample, usage/return measures, payment evidence and acceptance criteria with INV-009/INV-011. No independent participant was interviewed, and this decision authorises no external messages.

Eligible candidate: an Indian investor with investments at two or more providers who has recently attempted a portfolio review. Record providers and workflow without requesting credentials, account identifiers, balances or raw statements. Explain note-taking and obtain consent; recordings are optional and require separate consent. Store only anonymised summaries in Git; raw personal evidence belongs outside tracked files.

### Interview guide

1. Which providers do you use, for which asset categories, and which tools do you use to see the combined position?
2. Describe the last actual attempt to review all investments. What prompted it, what steps did you take, and how much effort did it require?
3. What was missing, stale or inconsistent? How did you discover and resolve it?
4. What useful question could your current tools not answer? What did you do instead?
5. After a new purchase, sale or SIP, how do you keep the combined view correct? What happened the last time it was not updated?
6. Have you tried a consolidator, spreadsheet or statement import? What made you continue, abandon or distrust it?
7. Which permissions or import steps would stop you? What would make you comfortable connecting a provider?
8. Which financial tools do you already pay for, and what do you use repeatedly? What would justify another expense?
9. Only after discovering problems, describe the candidate recurring review without claiming unbuilt capabilities. Ask what would remain missing and what would prevent use.
10. Ask whether they would join a later private trial. Distinguish interest from actual willingness to pay; no money is collected during these interviews.

Do not infer recurring transactions from market-price updates, lead participants toward a preferred answer, or treat “sounds useful” as a payment commitment.

## Participant record template and evidence ledger

For each participant record: anonymous ID (`P001` onward); interview date and consent/note-taking status; audience segment; providers/asset categories; last real task and effort; existing alternative; concrete pain and workaround; trust/onboarding concerns; recurring benefit sought; existing paid-tool behaviour; stated price reaction if discussed; contrary evidence; interpretation confidence. Keep participant statements separate from researcher interpretations. Quotes require permission and de-identification.

| Participant | Date / consent | Segment / workflow evidence | Pain / counterevidence | Payment evidence |
|---|---|---|---|---|
| P001 (owner; partial) | 2026-10-14; owner supplied notes/screenshots in response to interview requests, no recording | Consolidation works largely in INDmoney; Groww stock sync is difficult. T001 provides a real contextual planning task. DEC-010 requires planned/actual inputs; DEC-011 makes the first result user-selected. | Missing repeated budget/spending context is evidenced for the owner. Specific sync reproduction, task cadence/effort and permission tolerance remain open. E018 reports no independent interview pool. | None; no price question or commitment answered. |

### P001 partial findings and follow-up

- INDmoney is explicitly confirmed as the existing consolidator in E012, alongside the earlier US-provider identification (E008). No balances, accounts, raw statements or credentials are transcribed into this report; supplied screenshots remain outside Git.
- The FD bank is unspecified. Wint Wealth/Paytm/UMANG are access interfaces named by the owner; actual record holders and integration eligibility are for INV-006 to establish.
- Multiple asset categories and multiple people are present in the example. DEC-008 selects one person first and defers family portfolios. Relatives' assets are future/category research context; their inclusion is not household-account consent.
- The clarified outside-Corpus workflow question received a success report: the owner used INDmoney to consolidate MFs, existing US holdings and EPF. This answers the method/success question but supplies no unresolved pain, effort or date. The bank-account connection is described as available, not personally verified by this response.
- E014 answers the missing-value question with reported Groww stock-sync difficulty and a recurring separate-AI planning workflow. Successful consolidation remains counterevidence to assuming a broadly broken incumbent; screenshots alone establish no dissatisfaction.
- E015 supplies the actual planning question and corrects the interpretation of answer quality. DEC-009 records ongoing context; DEC-010 settles planned/actual inputs; DEC-011 accepts user-selected first results. E019/DEC-012 closes founder-led discovery with an external validation checkpoint. Acquisition routes remain separate; sync details, task cadence/effort, permission tolerance and payment evidence remain unknown, to investigate where needed in provider/economics/UI work and reopened discovery.

Summarise completed interviews with sample size, differences across segments and rejected hypotheses. A later behavioural/private-beta payment experiment belongs in INV-009/INV-011; an interview alone does not establish conversion.

## Closure decisions and deferred validation

| Question | Evidence needed | Responsible / next action |
|---|---|---|
| Which problem drives adoption and repeated use? | Founder evidence E014/E015 and the explicit narrower scope in E019. | Adopt contextual continuity as founder-led direction (DEC-009/DEC-012). Broader demand/adoption evidence is deferred to PV1; no adoption claim is made. |
| Personal-first or household-first? | E011 owner direction. | Resolved for the first useful experience by DEC-008: personal-first; family portfolios deferred. Revisit only through the decision's reopening conditions. |
| Why choose Corpus over a current consolidator? | Founder workflow gap E014/E015 and competitor counterevidence E001–E007/E012/E013. | Adopt contextual planning as the proposition to test (DEC-009/DEC-012). Superiority and other users' preference remain unvalidated and deferred to PV1. |
| What does the first useful session deliver? | Owner direction for interaction and inputs; detailed calculation/data contracts are later work. | DEC-009–DEC-011 establish retained context, planned/actual inputs and asking the user's purpose. T001 is a goal-route case. Provider routes, exact outputs and regulated scope remain subject to later investigations. |
| What will validate demand and willingness to pay later? | Explicit E019 validation decision. | DEC-012 defers external demand/payment validation and requires PV1 before public launch; define the experiment in INV-009/INV-011 and reopen discovery when independent beta participants exist. |

Closure criterion met for the explicitly accepted narrower founder-led scope: evidence is synthesised, all five questions map to DEC-008–DEC-012 and broader validation has an excluded-claims statement plus reopening trigger/PV1. INV-002 is the next active investigation. The competitor sample challenges novelty but does not settle market demand; future independent evidence can reopen this report.

**Closure outcome:** adopt personal-first scope (DEC-008), contextual continuity (DEC-009), planned/actual inputs (DEC-010) and user-selected outputs (DEC-011); adopt founder-led discovery and defer broader validation under DEC-012. **Next action:** INV-002 eligibility/behaviour research. **Deferred dependency:** PV1 external evidence before public launch; reopen INV-001 when independent beta users become available or before launch. No independent interview, payment or competitor account test is claimed.

State history addition, 2026-10-14: kept Closed under founder-first DEC-012; recorded later owner direction E020–E023 and DEC-015–DEC-019. PV1 remains deferred/mandatory before public launch; no independent validation added.
