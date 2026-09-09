# ADR 0004: Candidate Pool Cache & Refresh Contract

- Status: Accepted
- Date: 2026-09-09
- Current pool version: `candidate-pool-v3-full-ensemble`

## Decision

Candidate Pool is a performance cache, never durable business truth. It stores compact reconstructible
candidate data and is isolated by the full input identity. Missing, expired, corrupt, unsaved or exhausted
pools fail open to full recompute. An unsaved or failed write must never produce a pool id or fail the
interactive recommendation.

Refresh excludes cumulative previously seen outfit keys for the unchanged identity. Pool hits and fallback
recomputes share that no-repeat contract. Identity changes invalidate the old pool and start a new exclusion
namespace.

## Cache-fill policy

The runtime uses measured serialization/save inputs and a foreground budget decision. It may await a write
only within explicit remaining budget; otherwise it returns with `candidatePoolId: null`. Production DB save
P50/P95 must come from production smoke evidence, not local/mock benchmark claims.
