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
AI admission. AI provider/model/prompt contracts are outside Core and remain frozen by the current runtime
implementation. Canonical copy coordination and required persistence remain orchestrator concerns; a
canonical hit must preserve its provider-zero-call contract.

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
