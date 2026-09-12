# Recommendation Runtime Architecture 2.2

> **Current canonical architecture source.** This document is the single source of truth for the
> Recommendation Runtime. It reflects commits `eccbd66` (Phase 1 scaling/oracles), `992b398` (hierarchical
> bounded core), `d521c51` (candidate-pool cache fill and first-card path), and `baca6aa` (Phase 4 boundaries,
> production smoke lifecycle, and evidence-authorized selection). It describes source-controlled
> contracts; it does not claim unmeasured production latency or CloudBase control-plane state.

## Runtime boundary

The request remains one interactive deployment unit:

```text
Today / HTTP-SSE or callable adapter
  -> Recommendation Orchestrator / runtime lifecycle
    -> Recommendation Core
      -> Home Light response projection
```

Recommendation Core and first-card AI share the interactive process. There is no synchronous
Function-to-Function RPC, AI gateway hop, microservice split, or heavyweight queue in this architecture.
The orchestrator owns request lifecycle, canonical coordination, cache policy, required persistence and
response assembly. `runtime/inputSnapshotService.js` is the only recommendation-input loader and identity
builder; `runtime/recommendationCacheCoordinator.js` is the only candidate-pool read coordinator;
`runtime/recommendationResult.js` defines the exact six-field Core result. Core owns deterministic
snapshot-to-outfit computation and does not own HTTP/SSE, provider lifecycle, candidate-pool DB lifecycle,
response projection or batch persistence.

## Recommendation Core

After InputSnapshotService and the cache coordinator have completed, the production Core builds one
request-local item-facts context, calls
`hierarchicalOutfitSearch` (`hierarchical-outfit-search-v2`), creates candidate cores, applies final
wearability/scene eligibility, scores accepted candidates, performs diversity selection, and materializes
selected cards. The bounded search stages are:

1. role buckets and cheap weather/scene pre-filter;
2. bounded skeleton search (`top+bottom+shoes`, `top+skirt+shoes`, `dress+shoes`, `onepiece+shoes`, with home variants);
3. structural completion (outerwear, socks, gloves, scarf, hat where policy requires or permits);
4. accessory beam completion with an explicit NONE option;
5. full candidate eligibility and scoring;
6. diversity-aware reservoir selection.

The budget is derived from target batch size, qualified batch count, role opportunities and optional
reservoir capacity. It provides skeleton, structural, accessory and hard-candidate limits. This is bounded
search, not a full Cartesian product followed by `slice()`.

Every item that survives into a full outfit must remain present in item identity, eligibility, scoring,
evidence authorization and materialization. Missing wardrobe roles are not synthesized.

## Input identity and refresh

Candidate-pool identity includes user hash, wardrobe fingerprint, scene, weather mode/fingerprint, profile
fingerprint, time of day and engine version. A changed identity is a cache miss. The Today client carries
cumulative `excludedOutfitKeys` for the active scene/input namespace; refresh must exclude all previously
shown keys for that unchanged identity. If the pool is missing, expired, invalid or exhausted, the runtime
recomputes and applies the same exclusions. A pool hit only reuses compact scored candidates; it does not
become business source of truth.

## Candidate Pool cache

Candidate Pool version is `candidate-pool-v3-full-ensemble`. It is a performance cache with explicit
fail-open cache-fill policy. The pool stores compact candidate identity, role/item references, compact
eligibility/reason codes and score/ranking fields. It does not store deep facts, full debug/QA, narrative,
AI renderer payloads or presentation-heavy card data.

Cache fill is prepared without starting a DB write. The runtime obtains measured budget inputs and calls
`decideCandidatePoolCacheFill`; it awaits a write only when the remaining foreground budget covers measured
save P95 plus margin. Otherwise it skips/fails open and returns `candidatePoolId: null`. A failed or timed-out
fill cannot fail the current recommendation response or leak an unsaved pool id.

## First-card and Home Light

Home Light is the minimal renderer boundary. Card 0 identity and selected items are fixed before first-card
AI admission. The homepage critical path is:

```text
FINAL_OUTFIT_READY -> PLAN0_READY -> FINGERPRINT_READY
  -> CANONICAL_LOOKUP_START/END
    -> HIT: CANONICAL_HIT, Provider calls = 0
    -> MISS: PROVIDER_START -> PROVIDER_HEADERS -> FIRST_VALIDATED
```

The final outfit boundary is deliberately before Narrative Plan creation: outerwear, accessories and every
other displayed item are already part of identity and evidence. Card 0 renderer-entry and fingerprint work
is performed once. Cards 1–7 Narrative Plans/renderer preparation, candidate-pool save, optional overlay,
detail payload, optional persistence and analytics are not first-card AI admission prerequisites.

Canonical lookup is the MISS admission boundary. On MISS the Provider may run concurrently with the durable
Copy Job reservation, but a fresh copy is not authoritative until the existing canonical-correctness join
confirms its plan id and render-input fingerprint. On HIT the durable result is joined before returning the
copy, preserving the provider-zero-call contract. Canonical persistence after a validated fresh result is a
bounded server-tail concern and does not replace an already valid first-visible AI copy with Safe Copy.

The first-visible source precedence is fixed:

1. `CANONICAL_HIT`;
2. `PROVIDER_FRESH`;
3. `SAFE_COPY` only with `SAFE_DEADLINE`, `SAFE_PROVIDER_ERROR`, or `SAFE_VALIDATION_FAILED`.

`HOME_READY` is not a fallback reason. After Home Light is ready, the orchestrator waits only for the
remaining absolute server-response budget. The current deadline is **1,605ms from request start**, derived
from the accepted real Today samples: 3,000ms visible budget − 1,295ms measured worst client/transport tail
− 100ms explicit safety margin. The derivation and metric definitions live in
[`../performance/recommendation-baseline.md`](../performance/recommendation-baseline.md).

The production homepage renderer remains `qwen3.7-max` until the fixed production-contract model race has
real Provider evidence. `apps/miniapp/scripts/homepage-first-card-model-race/runner.js` changes only model
and fingerprint route while retaining the real Narrative Plans, production prompt, streaming parser and
validator. A faster route may replace Max on the homepage only when real latency and quality gates pass;
Max remains available for Detail and deeper AI work. No model is selected from local stubs.

Real page acceptance uses the Today diagnostics bridge and the same correlated server audit. Its explicit
`hit` mode warms the canonical record before three counted Provider-zero samples. Its explicit `miss` mode
uses the production smoke safety contract to remove only the exact first-card cache document after a private
backup and fresh ownership/terminal-state checks; it never accepts a request flag or alternate cache identity
as proof of MISS. Each counted page source and AI state must agree with the server `COPY_DECISION`.

## Evidence and verification

The Phase 1 baseline is in [`../performance/recommendation-baseline.md`](../performance/recommendation-baseline.md).
It records local fixture results and explicitly labels legacy estimates, bounded-engine measurements and
unmeasured production values. The dual test oracles are in
`apps/miniapp/cloudfunctions/generateOutfit/services/recommendationOracle.js`: a legacy core oracle and a
small full-ensemble exhaustive oracle. The latter, not the legacy optional-item behavior, is the reference
for full accessory correctness.

Production verification at `baca6aa` passed deployment artifact checks and three
canonical HIT attribution samples with zero added Provider calls. It also
verified a full MISS path after an exact single-cache reset; the canonical cache
and batch job were restored to completed state. The measured server response
median was 6,013.856ms, above the product target and the 4,856.585ms historical
median. This is an observed CloudBase runtime bottleneck, not an architecture
contract change; the next performance pass must be separately approved rather
than silently reducing bounded-search quality. Candidate Pool DB save latency
was not observed because no save stage was emitted, so local serialization
numbers remain non-production evidence.

The permanent regression gate is split deliberately: the lightweight Node tests enforce 30/100/300/500
expansion, final-evaluation, reservoir and heap-observation contracts, while the local/release benchmark
records multi-sample latency and memory. Full-ensemble oracle, four-scene and cumulative refresh tests are
required quality companions; a fast count gate alone is not an acceptance result.

## Superseded history

The following documents remain valuable historical records but are not current architecture authority:

- [`backend-runtime-audit.md`](backend-runtime-audit.md) — superseded for the current Recommendation Runtime boundary;
- [`../recommendation-candidate-pool-v5.md`](../recommendation-candidate-pool-v5.md) — historical V5 pool behavior, superseded by the 2.2 cache contract;
- QA and first-card audit documents under `docs/qa/` — evidence snapshots, not architecture definitions.

They are intentionally not deleted.
