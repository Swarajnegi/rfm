# Enterprise Readiness Plan

## Current Boundary

The app is a Capacitor shell around a browser-only Alpine application. Portfolio data, API keys, price-sync state, and AI responses are stored in device localStorage. Market quotes are requested from public internet endpoints directly by the client.

That model is acceptable for a single-device prototype. It is not an enterprise architecture: it cannot provide account recovery, multi-device consistency, durable audit records, provider-grade quote reliability, server-side secrets, or support operations for millions of users.

## Product Direction

The primary experience should be a financial timeline, not a collection of forms.

- Home: current net worth, quote freshness, daily valuation history, cash runway, and the next one or two decisions.
- Portfolio: grouped holdings with source, last successful quote, cost basis, valuation, and an explicit stale-price state.
- Planning: goals, recurring contributions, tax preparation milestones, and a scenario view.
- Insights: evidence-backed planning observations with a clear distinction between facts, assumptions, and questions for a licensed adviser.

Never invent a chart point, quote time, market context, or data source. A partial sync must show which holdings failed and retain the last verified value with its timestamp.

## Target Architecture

```text
Android / iOS / Web clients
        |
API gateway + authenticated session
        |
Portfolio service ---- Market-data service ---- Licensed quote vendors
        |                     |
Ledger and valuation store  Quote cache and freshness policy
        |
Planning and insights service ---- Model gateway ---- Approved AI providers
        |
Audit log, notifications, analytics, support tooling
```

The portfolio service owns holdings, transactions, cost basis, and valuations. The ledger is append-only: corrections create new events rather than mutating history. The market-data service normalizes symbols, applies provider limits, caches prices, records source timestamps, and exposes a consistent quote contract to clients.

The model gateway holds provider credentials server-side, enforces user consent and rate limits, redacts unnecessary information, validates structured output, and records non-sensitive request telemetry. It must never depend on a client-stored API key for a consumer product.

## Non-Negotiable Production Controls

- Use authenticated accounts, encrypted server-side data, device-session management, and account recovery.
- Store an immutable transaction and valuation history; local caches are read-through replicas, not the record of truth.
- Use licensed market-data providers with entitlement checks, retries, circuit breakers, and published freshness targets.
- Keep AI provider keys on the server. Apply per-user quotas, abuse controls, schema validation, evaluation suites, and prompt/version observability.
- Treat generated financial content as educational decision support unless regulated advice, suitability checks, required disclosures, and the relevant licensed entity are in place.
- Add consent records, export/delete workflows, audit events, monitoring, error tracking, backups, and disaster recovery before public launch.

## Delivery Sequence

1. Stabilize the client: truthful valuation history, quote freshness, actionable errors, accessible mobile sheets, and no hidden data mutation.
2. Introduce account identity, a portfolio transaction ledger, API gateway, and a migration from localStorage.
3. Move quote retrieval and AI requests to backend services with provider abstraction, caching, and observability.
4. Add cross-device sync, reconciliation, reporting, notifications, support workflows, load testing, security review, and compliance review.

## Acceptance Metrics

- Portfolio valuation updates within the documented freshness target and identifies any stale holdings.
- A sync result shows updated, skipped, and failed holdings without losing the last good value.
- No user data is silently seeded, overwritten, or changed during app launch.
- A selected AI model either completes with validated JSON or reports the exact model and provider failure.
- Mobile navigation and sheets remain usable within the safe area on supported screen sizes.
