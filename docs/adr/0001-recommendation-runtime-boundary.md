# ADR 0001: Recommendation Runtime Boundary

- Status: Accepted
- Date: 2026-09-09
- Supersedes: implicit/monolithic runtime descriptions in older backend audits

## Decision

Keep Today transport, Recommendation Orchestrator, Recommendation Core, first-card AI and Home Light in
one interactive deployment unit. Core is a provider-independent deterministic computation boundary; the
orchestrator owns lifecycle, canonical coordination, cache policy, persistence and response assembly.
There is no synchronous Function-to-Function RPC, remote AI gateway or physical microservice split.

## Consequences

The first-card path avoids a new network hop and retains rule fallback. Boundary tests can invoke Core
without HTTP, SSE, database or provider lifecycle. Further extraction is justified only when it lowers
latency, change, import or test coupling.
