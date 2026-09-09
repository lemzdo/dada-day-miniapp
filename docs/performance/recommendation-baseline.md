# Recommendation Runtime Scaling Baseline

> Architecture target: Recommendation Runtime 2.2  
> Captured: 2026-09-10
> Commit: `baca6aa` (Phase 4 boundary/runtime verification follow-up)
> Node: `v24.15.0`  
> Runtime: legacy `buildOutfitCandidatesV1` + `applyWearabilityAndSceneEligibility`; benchmark `recommendation-scaling-v1`.

## Scope and method

The benchmark is `apps/miniapp/cloudfunctions/generateOutfit/scripts/recommendationScalingBenchmark.js`.
It runs three samples per size. Sizes 30 and 100 execute the legacy full candidate/eligibility path;
300 and 500 use the required allocation-free count-only probe. Their counts are complexity estimates,
not materialized candidates. `heapPeakBytes` is process `heapUsed` high-water mark, not an allocation
delta. GC was unavailable (`--expose-gc` was not enabled), so no GC trend is claimed.

## Scaling results

| wardrobe | role counts (top/bottom/skirt/onepiece/shoes/outerwear/accessory) | raw combinations | actual candidates | weather eval | scene eval | hard rejects | accepted | scoring | selected | core P50/P95 ms | eligibility P50/P95 ms | heap peak |
|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 30 | 7/6/3/2/5/3/4 | 325 | 325 | 325 | 325 | 0 | 325 | 325 | 8 | 4.963/4.963 | 102.697/102.697 | 27,095,488 |
| 100 | 24/20/10/6/16/10/14 | 11,616 | 11,616 | 11,616 | 11,616 | 0 | 11,616 | 11,616 | 8 | 127.290/127.290 | 2,841.053/2,841.053 | 267,239,384 |
| 300 | 72/60/30/18/48/30/42 | 311,904 | 311,904 (count-only) | 311,904 (count-only) | 311,904 (count-only) | N/A | N/A | N/A | 8 | 0.020/0.020 (probe) | N/A | 267,484,872* |
| 500 | 120/100/50/30/80/50/70 | 1,442,400 | 1,442,400 (count-only) | 1,442,400 (count-only) | 1,442,400 (count-only) | N/A | N/A | N/A | 8 | 0.027/0.027 (probe) | N/A | 267,879,904* |

`*` The 300/500 heap values are inherited process high-water observations; because the probe does not
materialize candidates they must not be interpreted as memory cost for those objects.

## Complexity and memory risk

The current work-scene role model computes `top × (bottom + skirt) × shoes + onepiece × shoes`.
Measured fixture estimates grow from 325 to 11,616 to 311,904 and 1,442,400 combinations. This is the
current O(N^3)-shaped risk. Legacy fixed role slices and a final candidate cap mean observed 30/100
numbers do not prove quality equivalence or safe behavior at 300/500. Full 300/500 materialization is
intentionally not run until memory safety is established.

Search-budget inputs for Phase 2: role counts, raw combination estimate, cheap pre-filter reject counts,
target batch size 8, scene/weather, reservoir capacity policy, and per-stage expansion/eligibility/scoring
budgets. Fixed `slice()` truncation is not accepted as the new search policy.

## Oracle status

- Legacy Core Oracle: `services/recommendationOracle.js`; core skeletons `top+bottom+shoes`,
  `top+skirt+shoes`, `dress+shoes`, stable score/key ordering for home/work/date/sport.
- Small Full-Ensemble Exhaustive Oracle: same module, tested by `recommendationOracle.test.js`; includes
  outerwear, socks, hat, necklace, bracelet and bag, NONE slots, callbacks, and complete item identity.
- Bounded-search quality comparison: not run; this is a Phase 1 baseline with no Phase 2 engine.

## Reproduction

```powershell
node apps/miniapp/cloudfunctions/generateOutfit/scripts/recommendationScalingBenchmark.js
node --test apps/miniapp/cloudfunctions/generateOutfit/scripts/recommendationScalingBenchmark.test.js
node --test apps/miniapp/cloudfunctions/generateOutfit/services/recommendationOracle.test.js
```

## Verification rerun (2026-09-09)

The command was also rerun with `node --expose-gc` at the HEAD recorded above.
This run reported `gcTrend=available; invoke with --expose-gc for controlled
runs`; the benchmark only observes `heapUsed` and does not call `global.gc()`,
so no controlled GC trend is claimed. The rerun values were:

| wardrobe | mode | raw / actual | hard reject / accepted / scoring | selected | core P50/P95 ms | eligibility P50/P95 ms | heap peak bytes |
|---:|---|---:|---|---:|---:|---:|---:|
| 30 | legacy-full | 325 / 325 | 0 / 325 / 325 | 8 | 5.403 / 5.403 | 102.426 / 102.426 | 27,003,120 |
| 100 | legacy-full | 11,616 / 11,616 | 0 / 11,616 / 11,616 | 8 | 132.697 / 132.697 | 2,769.220 / 2,769.220 | 267,328,448 |
| 300 | count-only | 311,904 / 311,904 | N/A / N/A / N/A | 8 | 0.020 / 0.020 (probe) | N/A | 267,573,952* |
| 500 | count-only | 1,442,400 / 1,442,400 | N/A / N/A / N/A | 8 | 0.028 / 0.028 (probe) | N/A | 267,968,960* |

The fixture's worst-case role distribution (top/bottom/shoes concentrated) has
raw work estimates of 910 (30), 31,500 (100), 850,500 (300), and 3,937,500
(500). These are count-only estimates and were not full-materialized.

The small full-ensemble oracle is implemented in
`services/recommendationOracle.js` and covered by
`services/recommendationOracle.test.js`; bounded-search quality comparison is
not yet run. Therefore Phase 1 status remains baseline-only: correctness and
oracle fixtures are available, but Phase 2 quality/scaling gates are not yet
passed.

## Phase 2 hierarchical bounded-search baseline

Captured 2026-09-09 from the Phase 2 working tree based on `eccbd66`, runtime
`hierarchical-outfit-search-v2` / `candidate-core-v2`. Five samples per fixture
were executed through the real `generateRuleRecommendations` production Core
path, including final wearability/scene eligibility, production scoring,
diversity reservoir, and eight-card batch selection. The command used
`node --expose-gc`, with GC between samples. Heap peak is process `heapUsed`;
heap delta is the largest after-minus-before sample observation, not retained
heap.

The production policy derives capacity from six qualified TARGET_8 batches:
reservoir 96, final-evaluation headroom 8× reservoir (768), accessory expansion
120 across 48 evenly distributed seeds. These values are formulas from the
batch target, not wardrobe-size truncation.

| wardrobe | raw skeleton / skeleton work | structural / accessory expansions | full eligibility / accepted / scoring | reservoir / selected | core P50/P95 ms | eligibility P50/P95 ms | scoring P50/P95 ms | heap peak / delta bytes |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 30 | 223 / 659 | 3,840 / 120 | 768 / 768 / 768 | 96 / 8 | 195.031 / 238.814 | 34 / 46 | 5 / 9 | 55,545,432 / 42,328,544 |
| 100 | 328 / 888 | 3,850 / 120 | 768 / 768 / 768 | 96 / 8 | 210.386 / 212.411 | 31 / 35 | 4 / 7 | 83,587,720 / 70,162,216 |
| 300 | 348 / 928 | 3,915 / 120 | 768 / 768 / 768 | 96 / 8 | 246.221 / 247.652 | 30 / 36 | 4 / 5 | 39,726,472 / 25,757,272 |
| 500 | 348 / 928 | 3,915 / 120 | 768 / 768 / 768 | 96 / 8 | 269.582 / 277.158 | 31 / 33 | 4 / 5 | 88,214,784 / 73,746,080 |

The legacy 500-item count-only estimate is 1,442,400 raw combinations (worst
role concentration: 3,937,500); the production bounded engine fully evaluated
768 candidates. From 300→500, skeleton, structural, accessory, eligibility,
scoring, and reservoir counts stay flat; only O(N) indexing/prefilter work grows.

Quality gates pass: small core-only output is set-equivalent to the frozen
Legacy Core Oracle; a small full ensemble selects the same unique best outfit
as the exhaustive oracle; home/work/date/sport production fixtures remain
eligible; and an initial batch plus five pool refreshes yields 48 unique cards
with every pool HIT exactly matching a full recompute under cumulative
exclusions. Optional structural/accessory tests verify that every selected item
participates in identity, final eligibility, score, and evidence materialization.

## Phase 3 compact candidate-pool and runtime baseline

Captured 2026-09-09 at commit `d521c51`, pool runtime
`candidate-pool-v3-full-ensemble`. The local benchmark uses the real 96-entry
production reservoir and storage projection. It measures serialization and
hydration only; it does not emulate or claim CloudBase database latency.

| candidates | source bytes | compact bytes / ratio | manifest / chunks bytes | serialization P50/P95 ms | heap peak bytes | hydrate / refresh |
|---:|---:|---:|---:|---:|---:|---:|
| 96 | 7,230,290 | 175,148 / 2.42% | 1,240 / 173,908 | 1.462 / 1.462 | 42,701,664 | 96 / 8 |

Hydrated candidates preserve final item ids and roles, ranking inputs and pool
identity. The refresh sample excludes the previous batch and returns eight new
cards. The full regression additionally covers pool missing, expired, corrupt,
save-failure, exhaustion and identity-change paths, plus 48 unique cards across
the initial batch and five cumulative refreshes.

The cache write plan is lazy: preparation does not start serialization or a DB
write. A production request awaits cache fill only when measured save P95 fits
the remaining 3,000ms product budget after the 2,300ms server deadline and the
client reserve. Otherwise it fails open with `candidatePoolId: null`. Required
batch persistence remains ordered before the optional cache fill.

## Production verification (2026-09-10)

CloudBase CLI authentication was restored and both `generateOutfit` and
`recommendationStream` passed the remote artifact contract at commit `baca6aa`:
dependency closure empty, required files, isolated boot, manifest integrity,
embedded-runtime drift, symlink/junction, and installed-dependency checks all
passed. The existing canonical smoke produced three valid HIT samples with the
same render fingerprint `62978c...8a7e3`, HTTP 200, `recommendation.ready` plus
`complete`, and `providerStarts=0`. The HTTP smoke intentionally records page
visibility as unavailable; it cannot prove a pixel was painted.

| sample | mode | SERVER_RESPONSE_READY ms | Core/CORE_READY ms | eligibility ms | required batch persistence ms | pool save | provider added calls |
|---|---|---:|---:|---:|---:|---|---:|
| hit-1 (`01-23-33`) | canonical HIT | 6,013.856 | 5,500.331 | 4,287.506 | 6,012.335 | not observed | 0 |
| hit-2 (`01-23-33`) | canonical HIT | 6,225.543 | 5,703.068 | 4,602.429 | 6,223.672 | not observed | 0 |
| hit-1 (`01-29-08`) | canonical HIT | 5,334.735 | 5,040.055 | 3,836.837 | 5,333.827 | not observed | 0 |

The three-sample `SERVER_RESPONSE_READY` median is **6,013.856ms** (P95/max
6,225.543ms), **+1,157.271ms** versus the historical authoritative 4,856.585ms
median. A full baseline → exact one-cache deletion → MISS run returned valid SSE
ready/complete frames; its delayed audit later showed `CACHE_LOOKUP_DONE=miss`,
`CORE_READY=5,394.343ms`, `ELIGIBILITY_DONE=4,104.137ms`,
`runtime:batchPersistenceDone=5,868.058ms`, `recommendationReady=5,870.045ms`,
and `PROVIDER_START=5,881.156ms`. The cache reappeared as
`recommendation-canonical-copy-cache-v2.0` and the MISS batch job reached
`completed`; the smoke timeout was only an audit-tail window failure.

Production Candidate Pool save P50/P95 remains **NOT_OBSERVED**: no
`runtime:candidatePoolPersistenceStart/Done` stage was emitted in the smoke
requests, so the local 1.462ms compact serialization number must not be called a
CloudBase DB save measurement. The explicit policy therefore remains fail-open
and never claims an unsaved pool id.

The dominant production bottleneck is full-compute execution on the CloudBase
runtime: candidate construction/hydration and especially final eligibility run
several seconds before response assembly. Per the frozen Goal contract, this
result is recorded as a performance risk and no third micro-optimization pass is
started automatically. Existing Today cold telemetry also recorded
`serverTotalMs=1831` and `coldTtuiMs=3026`; the current smoke has no page paint
observer, so `FIRST_CARD_VISIBLE<3000ms` is not claimed (and the observed cold
TTUI is slightly above target).
