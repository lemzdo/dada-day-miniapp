# Production 6s attribution

> Date: 2026-09-10
> Frozen baseline: `1db932b54275f53d34bed42716b432ad7ff0c597`
> Runtime: Recommendation Runtime Architecture 2.2

## Result

The production slowdown was primarily a CloudBase compute-allocation problem,
not an Architecture 2.2 duplicate-work or candidate-budget regression.
`recommendationStream` was provisioned with 256 MB and 0.2 CPU. Raising only
the function memory allocation to 1024 MB raised the reported CPU allocation to
0.8 CPU and reduced five-sample `SERVER_RESPONSE_READY` P50 from 5,765.054 ms to
1,661.491 ms. `PURE_CORE_PROD` P50 fell from 5,001.287 ms to 1,062.614 ms.

The Architecture 2.2 boundaries, search/beam/reservoir budgets, output quality,
canonical correctness join, UI, request identity and renderer fingerprint were
not changed. Both runs were canonical HIT-only, used fingerprint
`62978c...8a7e3`, made zero added Provider calls and deleted no cache documents.

Evidence:

- before: `artifacts/production-first-card-smoke/2026-09-10T02-21-59-349Z/report.json`
- after: `artifacts/production-first-card-smoke/2026-09-10T02-36-37-488Z/report.json`
- attribution instrumentation: `90f633e8a7004bdc6a96410c406150524f96b840`
- compute allocation declaration: `a97473a7e0d6cf179a66d5bc2f72cd911bdec861`

## Sampling and clock boundary

All phase entries use `process.hrtime` and one handler origin per request. The
attribution uses interval union and a priority sweep, so overlapping work is
never added twice. `PURE_CORE_PROD` is raw `CORE` wall time minus the measured
canonical cache/job intervals overlapping that Core interval.

CloudBase changed instances inside the five after requests. Raw logs show
`MODULE_READY` relative to the runtime handler as -5.977, -67,081.159,
-133,354.454, -199,109.057 and -5.643 ms. Therefore hit-2/3/4 are strict reused
warm samples; hit-1/5 loaded a new module immediately before the runtime handler.
The five-request maximum prevented obtaining five strict warm samples without
breaking the sampling cap. This is reported as a sampling limitation, not hidden
by relabeling cold instances. Module loading happens before the
`SERVER_RESPONSE_READY` runtime clock origin, so the five Core/Runtime ledgers
remain comparable for the allocation change. Strict-warm after values were
1,304.206 / 1,398.155 / 1,823.314 ms for server response and 816.694 /
856.042 / 1,247.297 ms for pure Core.

## Before and after distribution

With five observations, the maximum is reported as a sample-max P95 proxy, not
as a statistically meaningful P95.

| metric | 256 MB / 0.2 CPU min | P50 | sample max | 1024 MB / 0.8 CPU min | P50 | sample max |
|---|---:|---:|---:|---:|---:|---:|
| SERVER_RESPONSE_READY | 5,235.735 | 5,765.054 | 7,123.921 | 1,304.206 | 1,661.491 | 1,865.156 |
| PURE_CORE_PROD | 4,532.079 | 5,001.287 | 5,668.859 | 816.694 | 1,062.614 | 1,247.297 |
| accounted wall time | 5,232.647 | 5,761.310 | 7,116.686 | 1,302.122 | 1,655.042 | 1,858.102 |
| unaccounted | 1.941 | 3.744 | 85.649 | 1.732 | 2.121 | 7.054 |
| accounted percent | 98.435% | 99.935% | 99.967% | 99.612% | 99.840% | 99.884% |

The allocation change recovered 4,103.563 ms at server P50 and 3,938.673 ms at
pure-Core P50.

## Mutually attributable stage medians

The following are raw span medians. Nested spans describe their parent and must
not be summed into a second total.

| stage | before ms | after ms | response relation |
|---|---:|---:|---|
| INPUT_SNAPSHOT | 183.184 | 127.002 | required |
| CACHE_COORDINATOR | 0.370 | 0.256 | required |
| CANDIDATE_POOL_LOOKUP | 0.141 | 0.106 | required; no requested pool id |
| CORE raw wall | 5,202.458 | 1,265.445 | required; includes canonical overlap |
| ITEM_FACTS | 194.102 | 30.906 | nested Core |
| GENERATION | 1,391.775 | 318.064 | nested Core |
| SKELETON_GENERATION | 9.191 | 2.703 | nested generation |
| STRUCTURAL_COMPLETION | 109.469 | 20.564 | nested generation |
| ACCESSORY_COMPLETION | 4.823 | 2.511 | nested generation |
| CANDIDATE_CORE_BUILD | 717.663 | 104.108 | nested Core |
| FULL_ELIGIBILITY | 1,609.611 | 322.097 | nested Core |
| SCORING_PASS | 292.502 | 78.302 | nested Core |
| RESERVOIR | 205.638 | 66.124 | nested Core |
| FULL_MATERIALIZATION | 406.475 | 306.535 | nested Core |
| CANONICAL_CACHE_LOOKUP | 47.140 | 66.118 | required, overlaps Core |
| COPY_JOB_RESERVATION | 147.940 | 141.005 | required, overlaps Core |
| CANONICAL_CORRECTNESS_JOIN | 271.077 | 196.655 | required correctness boundary; four before records |
| FAVORITE_WORN | 157.684 | 58.532 | required; reads are parallel |
| HOME_LIGHT_PROJECTION | 0.413 | 0.731 | required |
| BATCH_PERSIST | 166.532 | 143.535 | required |
| RESPONSE_ASSEMBLY | 369.586 | 209.136 | required parent span |

The before canonical overlap with Core was 201.171 ms P50; after it was 212.013
ms. This integration wait is visible, but it cannot explain the four-second
allocation-sensitive Core reduction and cannot be removed without replacing the
already-proven canonical correctness boundary.

## Duplicate-work audit

Every observed request reported the same work counts (one after record was
dropped by log ingestion, while the surrounding stage counts remained intact):

| counter | value |
|---|---:|
| CORE_EXECUTION_COUNT | 1 |
| CANDIDATE_GENERATION_COUNT | 1 |
| FULL_ELIGIBILITY_PASS_COUNT | 1 |
| SCORING_PASS_COUNT | 1 |
| FULL_OUTFIT_MATERIALIZATION_COUNT | 8 |
| NARRATIVE_PLAN_BUILD_COUNT | 8 |
| CARD0_RENDERER_ENTRY_BUILD_COUNT | 1 |
| CANDIDATE_POOL_HYDRATE_COUNT | 0 |
| CACHE_COORDINATOR_COUNT | 1 |

There is no Core double execution, hydrate-then-full-eligibility path,
materialize-then-rescore path, primary/fallback double work, cache-coordinator
double load, card-0 double preparation or response-time full candidate rebuild.

## Input and database audit

Current five-sample medians contain nine database operations and 526.179 ms of
database service time, with a 125.554 ms largest individual operation. Database
service time is additive diagnostic service time and is not wall time: profile
and clothes load concurrently, as do favorite and worn status.

| collection/action | calls | median service ms | median rows |
|---|---:|---:|---:|
| users/query | 1 | 57.798 | 1 |
| clothes/query | 1 | 125.554 | 34 |
| recommendation_canonical_copy_cache_v2/doc_get | 1 | 66.032 | 1 |
| recommendation_copy_jobs_v2/doc_get | 1 | 32.814 | 0 |
| recommendation_copy_jobs_v2/doc_set | 1 | 44.656 | 1 |
| favorite_outfits/query | 1 | 46.940 | 0 |
| outfit_history/query | 1 | 57.261 | 0 |
| recommendation_batches_v2/query | 1 | 33.400 | 0 |
| recommendation_batches_v2/add | 1 | 43.000 | 1 |

Clothes are read once in one page; user/profile is read once and in parallel.
There is no N+1 query. The clothes query currently has no field projection and
therefore transfers full garment documents, including facts/assets that Core
uses; this is a bandwidth opportunity, not the measured root cause, because the
complete concurrent input wall median is only 127.002 ms. No projection change
was made in this task.

## Candidate Pool and canonical boundaries

The requests supplied no pool id, so lookup cost was 0.106 ms, hydrate did not
run, and cache-fill policy returned `budget_inputs_missing`. Serialization and
save were explicitly marked `NOT_ON_CRITICAL_PATH`; no production pool DB save
occurred. Consequently `POOL_DB_SAVE_P50/P95=NOT_OBSERVED` remains the honest
answer, and the local 1.462 ms serialization baseline is not reused as a cloud
DB measurement.

Canonical HIT performs one cache read, one job read and one idempotent job set.
It returns `initialCopies` from cache and waits for
`CANONICAL_CORRECTNESS_READY`; overlay/persistence do not enter this response's
critical path and Provider added calls remain zero. The correctness join is
`REQUIRED_FOR_RESPONSE`, not an avoidable optimization target.

## Commit attribution

- `e25e51d -> eccbd664` changes tests, documentation, oracles and benchmarks;
  it adds no production runtime work.
- `eccbd664 -> 992b398` introduces the bounded production Core.
- `992b398 -> d521c51` introduces candidate-pool/cache-fill and first-card
  policy work.
- `d521c51 -> 1db932b` establishes the Architecture 2.2 snapshot/cache/Core/
  result boundaries and preserves the existing synchronous work.
- The synchronous wait between card-0 materialization and continuation of the
  remaining batch is attributable to `37a34c9`. It explains the measured
  canonical overlap but is not the primary four-second regression.
- The production staging config was created at `c797820` without an explicit
  memory allocation, leaving CloudBase at its 256 MB / 0.2 CPU default. None of
  the four requested Architecture 2.2 milestones introduced that environment
  allocation. The allocation omission is therefore the primary root-cause
  origin, while later CPU-heavy bounded work exposed it.

## Client metric boundary

The earlier Today `coldTtuiMs=3026` observation used a page/client timer and a
different request observation (`serverTotalMs=1831`). The production smoke uses
authenticated `wx.cloud.callHTTPFunction`, measures final server response
readiness for full compute, and has no page render observer. Client timing can
also stop on a different UI milestone than the final SSE/response boundary.
Those values must not be combined. `FIRST_CARD_VISIBLE` remains
`NOT_AUTOMATED`.
