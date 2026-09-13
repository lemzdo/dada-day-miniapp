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

## Production 6s attribution and allocation fix (2026-09-10)

The follow-up five-sample attribution covered 99.935% of the 256 MB production
wall time. It proved one Core/generation/eligibility/scoring execution per
request and measured `PURE_CORE_PROD=5,001.287ms` P50. The function was then
found to have only 0.2 CPU at 256 MB. Raising the allocation to 1024 MB / 0.8 CPU
without changing Architecture 2.2 or candidate budgets reduced
`SERVER_RESPONSE_READY` P50 from 5,765.054ms to 1,661.491ms and pure Core P50 to
1,062.614ms. Five-sample min/max were 1,304.206/1,865.156ms; max is a sample-max
proxy, not a statistical P95. Full phase, DB, duplicate-work, warm-instance and
commit attribution is recorded in `production-6s-attribution.md`.

## Final user-visible Today acceptance (2026-09-10)

Architecture 2.2 remains frozen. The final acceptance reused the existing
`today-ttui-runtime-v2` DevTools automator and stopped after its first bounded
warm attempt failed, as required by the acceptance contract; no replacement
paint harness or server optimization was started.

The attempt did complete a real Today refresh and moved from batch
`v2-batch:2026-09-10T06:34:50.258Z:vbvh283r` to a new eight-card batch. The
diagnostics bridge observed a first-card title and reason in client state, but
the correlated transport record was absent and `observedUsableAt` remained
zero. The source ledger declares `firstCardMounted`, `firstImageLoadStart` and
`firstImageLoaded`, but the current Today renderer does not emit those stages.
Consequently neither state presence nor an image node may be reported as a
native paint measurement.

Evidence:

- bounded attempt:
  `artifacts/today-ttui-runtime-v2/B/ttui-B-failed-20260910063518-592aa296/measurement.json`
- command:
  `node apps/miniapp/scripts/today-ttui-runtime-v2.js --scenario=B --samples=3 --skip-build=true --expect-runtime-v2=true`
- stop reason: `TTUI_SCENARIO_INVARIANT_FAILED` on sample 1; samples 2 and 3
  were intentionally not attempted.

| metric | final accepted value |
|---|---|
| `SERVER_RESPONSE_READY` | five-sample min / P50 / max = 1,304.206 / 1,661.491 / 1,865.156ms; strict reused-warm median = 1,398.155ms |
| `CLIENT_RESPONSE_RECEIVED` | `NOT_OBSERVED` for the bounded Today attempt |
| `STATE_COMMIT` | `NOT_OBSERVED`; the new batch was present in client state, but no correlated commit timestamp was emitted |
| `FIRST_CARD_CONTENT_VISIBLE` | `FIRST_CARD_VISIBLE_MANUAL_ACCEPTANCE_REQUIRED`; min / median / max = `NOT_OBSERVED` |
| `IMAGE_READY` | `NOT_OBSERVED` |
| `FIRST_CARD_IMAGE_VISIBLE` | `FIRST_CARD_VISIBLE_MANUAL_ACCEPTANCE_REQUIRED`; min / median / max = `NOT_OBSERVED` |
| automated paint | `NO` |
| client primary bottleneck | `NOT_DETERMINED`; the failed observer cannot distinguish state/render, image resolver, download/cache, hydration or React rerender |

The earlier `serverTotalMs=1831` / `coldTtuiMs=3026` observation is retained as
a different request and timing boundary; it is not mixed into this acceptance.
Because the required content threshold and image-visible range were not
measured, the earlier `PRODUCT_PERFORMANCE_RESULT=FAIL` was semantically wrong:
the correct result was `PENDING_MANUAL_ACCEPTANCE`, not a demonstrated
user-visible regression.

### Automated visible-timing follow-up (2026-09-10)

The client now retains diagnostic-only instrumentation for one correlated
monotonic timeline per request: `REQUEST_START`, `CLIENT_RESPONSE_RECEIVED`,
`STATE_COMMIT`, `FIRST_CARD_CONTENT_VISIBLE`, `FIRST_CARD_IMAGE_LOAD`, and
`FIRST_CARD_IMAGE_VISIBLE`. Content visibility requires `wx.nextTick`, a real
SelectorQuery result, matching batchId/outfitKey, and non-zero dimensions. The
image milestone additionally starts from the first card's first rendered
garment Image `onLoad` and repeats the same nextTick/node validation. Each
milestone emits a `[RecommendationVisibleTiming:<stage>]` record, completion
also emits the legacy `[RecommendationVisibleTiming]` record, and every bounded
failure path emits `[RecommendationVisibleTiming:failure]` with a stable reason.
The diagnostics bridge only reads retained records and is not required for
collection or console output. No visual or server behavior changed.

The narrow `today-first-card-visible-acceptance` script reuses the existing
DevTools automator and the existing CLS audit reader so each client auditId can
be joined to its actual server `SERVER_RESPONSE_READY`. The Taro watcher
compiled successfully at 2026-09-10 15:29:13 Asia/Shanghai and remained in
watch mode; `build:weapp` was not run.

Two bounded runs both stopped before sending any sample request because the
DevTools automator page continued to expose the pre-build diagnostics bridge,
including after one forced Today reLaunch. Per the two-failure stop rule, no
third attempt or alternate runner was started:

- `artifacts/today-first-card-visible-acceptance/visible-20260910072944-5dc9cec5/report.json`
- `artifacts/today-first-card-visible-acceptance/visible-20260910073106-4fa1a938/report.json`
- stop reason: `VISIBLE_TIMING_BRIDGE_UNAVAILABLE`
- `STATUS=TEST_INFRA_BLOCKED`
- valid samples: 0; all requested timing statistics remain `NOT_OBSERVED`

This is an infrastructure block, not a client performance failure.
`PRODUCT_PERFORMANCE_RESULT=PENDING_MANUAL_ACCEPTANCE`, but no human timing,
recording, or manual second counting is requested. The next admissible action
is to restore DevTools loading of the watcher-produced bundle and rerun the
same automatic three-sample acceptance. Architecture 2.2 and the server remain
frozen; `PERFORMANCE_PROJECT=OPEN`.

## Homepage AI-first reason budget and ledger pre-acceptance snapshot (2026-09-12)

This section records the Homepage AI-first delivery boundary. It does not reopen
Recommendation Core, Candidate Pool, the Beijing dedicated endpoint, or the
closed Today Runtime 2.2 performance project.

The accepted warm Today samples supplied at Goal start are:

| sample | content visible | server ready | observed transport/client-render tail |
|---:|---:|---:|---:|
| 1 | 1,756.200ms | 748.647ms | 1,007.553ms |
| 2 | 1,913.000ms | 936.562ms | 976.438ms |
| 3 | 2,205.300ms | 910.505ms | 1,294.795ms |

The tail budget is the observed maximum rounded up to 1,295ms. With a 100ms
explicit safety margin, the absolute server response deadline is:

```text
SERVER_RESPONSE_DEADLINE = 3000 - 1295 - 100 = 1605ms
```

This is an absolute request-start deadline, not 1,605ms added after Home Light.
When `HOME_READY` occurs first, the runtime waits for AI only until the remaining
portion of that deadline. The previous fixed 2,300ms server deadline is removed.

Every valid production sample must correlate one client observation and one
server audit by the same `auditId`, and retain at least these stages/fields:
`REQUEST_START`, `FINAL_OUTFIT_READY`, `PLAN0_READY`, `FINGERPRINT_READY`,
`CANONICAL_LOOKUP_START/END`, `PROVIDER_START`, `PROVIDER_HEADERS`,
`FIRST_VALIDATED`, `PROVIDER_COMPLETE`, `HOME_READY`, `AI_WAIT_START/END`,
`SERVER_RESPONSE_READY`, `CLIENT_RESPONSE_RECEIVED`,
`FIRST_CARD_CONTENT_VISIBLE`, `COPY_SOURCE`, and `FALLBACK_REASON`.

The real Today runner is `pnpm today:ai-first:accept -- --mode <mode>`. It always
collects exactly three valid counted samples and supports three explicit modes:

- `observed` records the naturally occurring production source without mutation;
- `hit` performs one uncounted warm-up, waits for its Copy Job to become terminal,
  then requires every counted sample to be `CANONICAL_HIT` with Provider calls = 0;
- `miss` establishes the exact first-card cache identity with one uncounted Today
  request, then uses the existing fail-closed CAS cleanup for each counted sample.
  Before removing at most one exact cache document it writes a private recovery
  artifact, rechecks user/job/fingerprint ownership and all related terminal
  states, and verifies absence. Every counted MISS must call Provider exactly once.

The counted page card must also agree with the correlated server decision:
`CANONICAL_HIT` and `PROVIDER_FRESH` require page `ai_cache/ready`; `SAFE_COPY`
requires page `safe` plus exactly one permitted fallback reason. Reports retain
only the first-visible reason SHA-256 rather than raw copy.

Metric definitions:

- `AI_REASON_FIRST_VISIBLE_RATE` = valid samples whose first painted reason came
  from `CANONICAL_HIT` or `PROVIDER_FRESH` / all valid samples.
- `SAFE_COPY_FALLBACK_RATE` = valid samples whose first painted reason came from
  `SAFE_COPY` / all valid samples.
- each Safe reason rate uses the same all-valid-sample denominator; the three
  permitted reasons are `SAFE_DEADLINE`, `SAFE_PROVIDER_ERROR`, and
  `SAFE_VALIDATION_FAILED`.
- `PLAN0_TO_PROVIDER_START` and `PROVIDER_START_TO_FIRST_VALIDATED` are computed
  only for correlated MISS samples where both endpoints exist.

At this pre-acceptance checkpoint, the fixed race runner was
`apps/miniapp/scripts/homepage-first-card-model-race/runner.js`. It compares
`qwen3.7-max` with the existing `qwen-flash` candidate using the same real
Narrative Plans, production compressed-v2 request and production validator. It
records First Validated and Complete P50/P95, validator/provider error rates,
raw review copies, token use, and observed cost per call. Its public list-price
reference was checked on 2026-09-12; actual billing still follows the account
and deployment region. At that checkpoint no production route change was valid
until the live artifact and human language review were complete.

The working-tree gates at that checkpoint were: Recommendation Runtime tests
887/887 PASS; Today tests 177/177 PASS. The deterministic Today runner and its
source-correlation tests were then added; their final gate counts belong in the
delivery report. Real model-race, deployed MISS/HIT and real Today paint values
were intentionally left unclaimed at this historical pre-acceptance checkpoint.

## Final Homepage AI-first production acceptance (2026-09-13)

The production homepage renderer is now `qwen-flash` with the
`compressed-v2 production-4` prompt contract. Commit `c02df19` contains the
production runtime switch; the following `b8c3016` commit adds only acceptance
tests, safety tooling and the final QA report, without changing deployed runtime
code.

| metric | Flash canonical HIT | Flash deterministic MISS |
|---|---:|---:|
| `AI_REASON_FIRST_VISIBLE_RATE` | 100% | 100% |
| `PROVIDER_FRESH_RATE` | 0% | 100% |
| `SAFE_DEADLINE_RATE` | 0% | 0% |
| `CONTENT_VISIBLE P50` | 1,797.6ms | 2,314.4ms |
| `CONTENT_VISIBLE max` | 2,030.8ms | 2,531.4ms |

For deterministic MISS, `PLAN0_TO_PROVIDER_START` P50 was 53.915ms and
`PROVIDER_START_TO_FIRST_VALIDATED` P50 was 548.054ms. In the final model race,
the Max control First Validated P50/P95 was 1,204.181/1,265.003ms, while Flash
was 370.962/397.348ms. The current server performance and homepage AI-reason
content-visibility result are PASS.

Image `onLoad` did not fire in the Flash HIT/MISS acceptance, so the final image
visibility metric is `NOT_EVALUATED_THIS_RUN`. No image-visible PASS is claimed.
The authoritative evidence is
[`../qa/homepage-ai-first-reason-acceptance.md`](../qa/homepage-ai-first-reason-acceptance.md).
