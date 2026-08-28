# 搭搭 day Backend / Cloud Function Architecture Audit

> Audit baseline: `feat/ai-renderer-production` at `5d1469665b8edcfe01860824fa38250488e892bf` (`b247ed6^`)
>
> Audit date: 2026-08-27
>
> Scope: static, read-only source/configuration audit. No build, deployment, CloudBase mutation, latency benchmark, or real-user E2E was run.

## Executive summary

The repository contains **28 deployable Cloud Function directories**. The current backend is not suffering from a general synchronous Function-to-Function RPC mesh: no cloud function calls another through `cloud.callFunction()`. The only explicit function edge is an asynchronous SCF `InvocationType: Event` self-dispatch from `generateOutfit`; `recommendationStream` loads `generateOutfit` as local shared code and therefore does not add a remote serverless hop (`apps/miniapp/cloudfunctions/generateOutfit/services/scfAsyncEventDispatcher.js:9`, `apps/miniapp/cloudfunctions/recommendationStream/index.js:5`).

The main architectural risks are instead:

1. `generateOutfit` is a large shared latency and change domain for recommendation generation, detail queries, favorites, wear state, history, rename, and AI review (`apps/miniapp/src/lib/cloud.ts:1050`, `apps/miniapp/src/lib/cloud.ts:1064`, `apps/miniapp/src/lib/cloud.ts:1133`, `apps/miniapp/src/lib/cloud.ts:1202`, `apps/miniapp/src/lib/cloud.ts:1236`, `apps/miniapp/src/lib/cloud.ts:1297`).
2. Today normally enters through the independent HTTP/SSE `recommendationStream` runtime, with callable `generateOutfit` as the before-ready fallback. Both deployment units carry the recommendation runtime, so fallback and non-recommendation actions can occupy a separate cold-start domain (`apps/miniapp/src/lib/cloud.ts:938`, `apps/miniapp/src/lib/cloud.ts:953`, `apps/miniapp/src/lib/cloud.ts:1015`).
3. Upload is client-orchestrated across several deployment units before confirmation. Image processing, standalone segmentation, and standalone recognition are low-frequency but user-waiting, provider-heavy runtimes (`apps/miniapp/src/lib/cloud.ts:511`, `apps/miniapp/src/lib/cloud.ts:537`, `apps/miniapp/src/lib/cloud.ts:559`, `apps/miniapp/src/lib/cloud.ts:584`).
4. Production AI calls are duplicated across Web and Cloud Function boundaries. There is no task registry, unified provider policy, SecretProvider, Tencent SSM integration, per-instance secret cache, in-flight Promise dedupe, or P0 early secret prefetch (`packages/ai/src/index.ts:5`, `apps/miniapp/cloudfunctions/processUploadImage/services/wardrobeAssetPipeline.js:613`, `apps/miniapp/cloudfunctions/generateOutfit/index.js:1919`).
5. Image Asset Pipeline V2 fields exist, but current behavior remains a V1/V2 compatibility model with inconsistent display fallback, incomplete segmentation quality validation, and Today-only cloud URL hydration (`database/migrations/003_wardrobe_asset_pipeline_v2.sql:13`, `apps/miniapp/src/utils/mediaResolution.js:44`).
6. P2 closed important recommendation cache isolation and invalidation gaps, but Today favorite/wear mutations, saved snapshots, canonical-copy lifecycle, and CloudBase control-plane state still have gaps (`apps/miniapp/src/lib/cacheInvalidation.ts:66`, `apps/miniapp/src/pages/today/index.tsx:1277`).

## Autonomous mainline acceptance update (2026-08-27)

### M1 Recommendation real-cloud acceptance

- `DEPLOYED_COMMIT=64fbf21eb71621087c4b58180f35b298151cd330`.
- Local recommendation gates passed for the first-card renderer, Orchestrator, Runtime, both transport adapters, P2/P3 targeted regressions, miniapp typecheck and diff-check.
- `generateOutfit` and `recommendationStream` were updated successfully in CloudBase environment `cloud1-d8gl3k1vkdf0b7f05`; function info reported both units active after deployment.
- Feature-branch push was blocked by invalid local GitHub credentials. No token was requested or changed.
- The existing client runner stopped at `PRECONDITION_NOT_CLEAN` before a production request and remained blocked after its single allowed Today tab-round-trip repair. No stable unattended production sampler exists for the required six fresh plus five warm calls, and no safe production P2 mutation entry was found.
- Therefore fresh/warm latency, first-exposure AI quality and confirmed cold-start evidence are not claimed. `RECOMMENDATION_ARCHITECTURE=REMOTE_ACCEPTANCE_BLOCKED`; this is not a recommendation business regression or a warm-latency failure.

### M2 AI Core foundation

- Commit `f54de27` introduced the deployable shared CommonJS package `@d1d/ai-core` and migrated Recommendation first-card rendering to `xiaodaAI.execute('recommendation_reason', input, options)`.
- The task registry freezes `qwen3.7-max`, `compressed-v2`, the existing production prompt version, the production validator mapping, streaming mode and the current timeout/retry policy. The existing production request, parser, validator, copy and Orchestrator deadline behavior remain in place.
- Bailian/DashScope transport now has one provider primitive for endpoint/auth lookup, streaming/non-streaming calls, normalized errors, usage metadata, abort/deadline injection and fail-open telemetry.
- `SecretProvider` currently activates `LegacyEnvSecretSource` with `BAILIAN_API_KEY -> DASHSCOPE_API_KEY` compatibility. `EncryptedDbSecretSource` is implemented and locally verified for AES-256-GCM, tamper/wrong-key failures, instance cache, 2/5/10-way in-flight dedupe and clear/refresh, but remains inactive and contains no production secret migration.
- AI Core, SecretSource, Recommendation, P2/P3, deployment-staging, miniapp and full-workspace typecheck gates passed.

### M3 Wardrobe Image Asset Pipeline V2 foundation

- Commit `bb47afe` introduced the zero-runtime-dependency shared package `@d1d/garment-assets` with canonical `ORIGINAL`, `CROP`, `CLEAN`, `NORMALIZED`, `DISPLAY` and `THUMBNAIL` semantics, plus `LIST`, `CARD`, `DETAIL` and `SNAPSHOT` usage contracts.
- Durable original references are distinct from other fact references. Signed temporary HTTPS URLs and presentation aliases cannot be promoted to original/fact fields. Existing `assetStatus`, `qualityScore` and review flags map to `VALID`, `NEEDS_REVIEW` and `INVALID` without a database migration.
- Today, Outfit Detail, Favorite and History now enter the same resolver. Explicit compatibility profiles preserve each surface's previous visible URL priority, so `UI_VISIBLE_CHANGE=false` for this foundation slice.
- Outfit snapshot builders/readers retain legacy `imageUrl`, `displayImageUrl` and `thumbnailUrl` while adding durable original/fact references, asset version and canonical asset metadata. CloudBase deployment staging vendors the shared package without changing source `workspace:*` dependencies.
- Thumbnail generation is not connected to the primary upload pipeline, and P3 media prewarm remains an opt-in callable boundary: `THUMBNAIL_PIPELINE_NEXT=true`, `MEDIA_PREWARM_NEXT=true`.
- Resolver matrix, legacy compatibility, signed-URL rejection, quality mapping, snapshot roundtrip, four-surface targeted tests, media resolution, deployment staging, recommendation regressions and full-workspace typecheck passed.

### M4 Wardrobe Image Asset Pipeline V2 media completion

- `THUMBNAIL_PRIMARY_PIPELINE=PASS`: primary upload processing creates each draft thumbnail from the canonical durable clean/display/crop/original source boundary, reuses an existing durable thumbnail idempotently, and fails open. Confirmation only propagates `thumbnailUrl`, so no image processing was added to its critical path and no signed temporary URL becomes a durable fact.
- `MEDIA_PREWARM=PASS`: after a P3 successor reaches ready, only its returned cards (bounded by the existing target of eight) enter the canonical card resolver, existing media resolution boundary and image-session cache. Sources are deduplicated; resolution or preload failure is fire-and-forget and cannot change successor availability, promotion or count/exhaustion contracts.
- `DETERMINISTIC_INTEGRITY_GATE=PASS`: primary VIAPI/AITRYON segmentation and manual reprocessing share one Jimp-based deterministic gate for decode, dimensions, non-empty pixels, transparency/visible coverage, content bounds, blank output and tiny-subject output. Invalid output is not published as clean; durable crop/original or the existing clothing asset remains available. Semantic completeness and candidate consistency remain deferred.
- Compatibility profiles, snapshot durability and recommendation P2/P3 behavior are unchanged; `UI_VISIBLE_CHANGE=false`. Actual normalized generation, semantic/visual quality checks and general media-cache governance remain deferred.

## A. Cloud Function inventory

`U` means the repository does not declare the value and the CloudBase console was not queried. The count includes direct children of `apps/miniapp/cloudfunctions/` that contain `index.js`; `shared/`, service modules, tests, and scripts are not functions.

| Function | Entry / trigger | Runtime / memory / timeout | Callers | Downstream / data / storage | Main responsibility |
|---|---|---|---|---|---|
| `login` | `index.js:12`, callable | U / U / U | `src/lib/cloud.ts:469` | `users` | User bootstrap and login profile |
| `getWardrobe` | `index.js:27`, callable | U / U / U | `cloud.ts:479,491` | `clothes`, `users` | Wardrobe list/detail/filter/capacity |
| `updateClothes` | `index.js:113`, callable | U / U / U | `cloud.ts:614` | `clothes`, `user_clothing_materials` | Edit clothing metadata |
| `deleteClothes` | `index.js:15`, callable | U / U / internal repair budget 12s | `cloud.ts:628,644,657` | `clothes`, `outfits`, `favorite_outfits`, `outfit_history` | Inspect/soft-delete and repair references |
| `cleanupDeletedClothes` | `index.js:39`, timer/event | U / U / internal budget 15s | timer in `config.json:2` | Same reference collections; `cloud.deleteFile` | Retention cleanup and physical file deletion |
| `backfillClothesThumbnails` | `index.js:14`, callable/maintenance | U / U / U | No production miniapp caller found | `clothes`; remote fetch, Jimp, storage download/upload | Thumbnail backfill |
| `createUploadBatch` | `index.js:8`, callable | U / U / U | `cloud.ts:511,515,530` | `upload_batches`, `upload_images`, `clothes_drafts` | Create/query/recover upload batch |
| `createUploadImage` | `index.js:7`, callable | U / U / U | `cloud.ts:537`; `wardrobe/index.tsx:420` | `upload_batches`, `upload_images` | Register one source image |
| `processUploadImage` | `index.js:20`, callable | U / U / U | `cloud.ts:559`; `upload-confirm/index.tsx:279` | Bailian, Aliyun segmentation, remote fetch; upload/draft collections | Detect, crop, segment, recognize, quality-score drafts |
| `segmentClothImage` | `index.js:18`, callable | U / U / `SEGMENT_TIMEOUT_MS`, default 60s | `cloud.ts:499,576` | Aliyun `SegmentCloth`, remote fetch, Cloud Storage; drafts/clothes | Re-crop/re-segment draft or clothing |
| `recognizeClothAttributes` | `index.js:32`, callable | U / U / Qwen timeout, default 20s | `cloud.ts:505` | Bailian/DashScope; `clothes` | Re-recognize clothing attributes |
| `confirmClothesDrafts` | `index.js:31`, callable | U / U / U | `cloud.ts:584`; `upload-confirm/index.tsx:612` | upload/draft/clothes/users; storage download/upload | Capacity-controlled confirmation into wardrobe |
| `discardClothesDraft` | `index.js:10`, callable | U / U / U | `cloud.ts:601` | draft/batch/image collections | Discard a draft and repair batch state |
| `discardUploadBatch` | `index.js:7`, callable | U / U / U | `cloud.ts:610` | batch/draft collections | Discard a whole batch |
| `generateOutfit` | `index.js:227`, callable + async Event self-dispatch | U / U / U; per-AI timeouts | many actions in `cloud.ts:892,1050-1297` | Bailian; SCF Event; users/clothes/outfits/batches/favorites/history/review | Recommendation plus outfit query/mutation monolith |
| `recommendationStream` | `index.js:98,286`, HTTP/SSE | Node `>=20` / U / U | `cloud.ts:938-1045`, `/recommendations` | Locally imports recommendation runtime; transitive DB/Bailian | Streaming interactive recommendation adapter |
| `recommendationTransportLab` | `index.js:25,60`, HTTP/SSE | Node 20 bootstrap / U / comment requires >=10s | tests/lab only | none | Synthetic transport experiment |
| `httpFunctionSmokeLab` | `index.js:32`, HTTP/SSE | Node bootstrap / U / U | smoke/lab only | none | Synthetic HTTP/SSE smoke test |
| `getWeather` | `index.js:11`, callable | U / U / internal HTTP timeout | `cloud.ts:1339` | Amap; `weather_cache` | Weather lookup and cache |
| `getUserClothingMaterials` | `index.js:9`, callable | U / U / U | `cloud.ts:1430`; edit form | `user_clothing_materials` | List personal materials |
| `createUserClothingMaterial` | `index.js:24`, callable | U / U / U | `cloud.ts:1453`; edit form | `user_clothing_materials` | Create/restore personal material |
| `archiveUserClothingMaterial` | `index.js:9`, callable | U / U / U | `cloud.ts:1467`; edit form | `user_clothing_materials` | Archive personal material |
| `getUserClothingSubcategories` | `index.js:15`, callable | U / U / U | `cloud.ts:1392`; edit form/wardrobe | `user_clothing_subcategories` | List personal subcategories |
| `createUserClothingSubcategory` | `index.js:29`, callable | U / U / U | `cloud.ts:1418`; edit form | `user_clothing_subcategories` | Create personal subcategory |
| `updateUserProfile` | `index.js:7`, callable | U / U / U | profile/style preference pages | `users` | Update profile and recommendation preferences |
| `refreshLearnedStyleProfile` | `index.js:54`, callable/event background | U / U / U | No production miniapp caller found | local profile persistence | Rebuild learned style profile |
| `submitFeedback` | `index.js:7`, callable | U / U / U | `cloud.ts:1317`; feedback page | `user_feedback`; client uploads attachments | Persist feedback |
| `trackOutfitBehaviorEvents` | `index.js:6`, callable/event background | U / U / U | `cloud.ts:1129`; `outfitBehavior.ts` | event persistence module | Batch behavior telemetry |

Repository evidence for runtime configuration is incomplete: only the cleanup timer is project-configured, the two HTTP labs have bootstraps, and `recommendationStream/package.json` declares Node 20. Memory, platform timeout, deployed versions, and most triggers remain `UNKNOWN` from source.

## B. Call graph and execution chains

| User/system path | Current chain | Remote serverless hops | Notes |
|---|---|---:|---|
| App bootstrap | miniapp -> `login` | 1 | First-use authentication gate (`apps/miniapp/src/lib/cloud.ts:469`) |
| Today initial/scene/refresh | miniapp -> `recommendationStream` HTTP -> local recommendation runtime -> DB/provider | 1 | Callable `generateOutfit` is the before-ready fallback, not the next remote hop (`apps/miniapp/src/lib/cloud.ts:945-953`, `apps/miniapp/src/lib/cloud.ts:1015`) |
| Weather-triggered refresh | miniapp -> `getWeather`; client may then start recommendation | 2 deployment units, client-orchestrated | Weather completion can change recommendation input (`apps/miniapp/src/components/WeatherCard/index.tsx:188`, `apps/miniapp/src/pages/today/index.tsx:1330`) |
| Upload | miniapp -> `createUploadBatch` -> repeated `createUploadImage` -> `processUploadImage` -> `confirmClothesDrafts` | 4+ across the user flow | Calls are client-sequential, not function RPC (`apps/miniapp/src/lib/cloud.ts:511-596`) |
| Reprocess | miniapp -> `segmentClothImage` -> Aliyun/image processing | 1 function + provider | User waits (`apps/miniapp/src/lib/cloud.ts:576`) |
| Re-recognize | miniapp -> `recognizeClothAttributes` -> DashScope | 1 function + provider | User waits (`apps/miniapp/src/lib/cloud.ts:505`) |
| Delete | miniapp -> `deleteClothes(inspect)` -> confirmation -> `deleteClothes(delete)` | two invocations of one unit | Same unit may be warm; not guaranteed (`apps/miniapp/src/lib/cloud.ts:628-657`) |
| Outfit detail/favorite/wear/history | miniapp -> callable `generateOutfit(action=...)` | 1 | Many unrelated actions share the recommendation cold/change domain (`apps/miniapp/src/lib/cloud.ts:1050-1297`) |
| P2 work | recommendation runtime -> SCF API Event self-dispatch | async edge | `InvocationType: 'Event'`; request need not wait (`apps/miniapp/cloudfunctions/generateOutfit/services/scfAsyncEventDispatcher.js:9-37`) |
| Cleanup | timer -> `cleanupDeletedClothes` -> DB/storage | 1 background unit | Timer is source-controlled (`apps/miniapp/cloudfunctions/cleanupDeletedClothes/config.json:2`) |

### Function-to-function result

- `FUNCTION_TO_FUNCTION_SYNC_CALL=false` across the audited Cloud Functions.
- `recommendationStream -> generateOutfit` is a local module load, not a remote call (`apps/miniapp/cloudfunctions/recommendationStream/index.js:5`).
- `generateOutfit -> Event(self)` is asynchronous and is the only confirmed function edge (`apps/miniapp/cloudfunctions/generateOutfit/index.js:895`).

## C. P0 / P1 / background classification

Classification describes current user impact, not the target execution model.

| Class | Functions | Count |
|---|---|---:|
| P0 interactive | `login`, `getWardrobe`, `createUploadBatch`, `createUploadImage`, `processUploadImage`, `segmentClothImage`, `recognizeClothAttributes`, `confirmClothesDrafts`, `discardClothesDraft`, `discardUploadBatch`, `updateClothes`, `deleteClothes`, `updateUserProfile`, `generateOutfit`, `recommendationStream` | 15 |
| P1 interactive | `getWeather`, `getUserClothingMaterials`, `createUserClothingMaterial`, `archiveUserClothingMaterial`, `getUserClothingSubcategories`, `createUserClothingSubcategory`, `submitFeedback` | 7 |
| Background / maintenance | `trackOutfitBehaviorEvents`, `refreshLearnedStyleProfile`, `cleanupDeletedClothes`, `backfillClothesThumbnails` | 4 |
| Dev/test only | `recommendationTransportLab`, `httpFunctionSmokeLab` | 2 |

`processUploadImage`, segmentation, and recognition are P0 **today** because the UI waits. The target should make their long provider work resumable/background without pretending that the current UX already does so.

## D. Cold-start risk matrix

No millisecond estimate is made without a benchmark.

| Deployment unit | User path | Frequency | Impact | Static risk evidence | Risk |
|---|---|---|---|---|---|
| `recommendationStream` | Today first result/scene/refresh | High | blocks main result | Independent Node HTTP runtime loads recommendation runtime and provider path (`recommendationStream/index.js:5-27`) | HIGH |
| `generateOutfit` | fallback; detail, lists, favorite/wear/history, AI review | Mixed | blocks major results/actions | top-level imports multiple recommendation/render services; one entry handles many actions (`generateOutfit/index.js:1-20`, `cloud.ts:1050-1297`) | HIGH |
| `processUploadImage` | upload recognition | Medium | user waits | large pipeline with remote image, VL, segmentation, attribute and quality stages (`wardrobeAssetPipeline.js:537`, `wardrobeAssetPipeline.js:613`) | HIGH |
| `segmentClothImage` | manual reprocess | Low | user waits | independent 60s-capable image/provider runtime (`segmentClothImage/index.js:457`) | HIGH |
| `recognizeClothAttributes` | manual re-recognition | Low | user waits | independent provider runtime with 20s default timeout (`recognizeClothAttributes/index.js:16`, `recognizeClothAttributes/index.js:159`) | HIGH |
| `confirmClothesDrafts` | save upload | Medium | blocks completion | capacity lock, duplicate handling, DB and storage work (`confirmClothesDrafts/index.js:1-31`) | HIGH |
| `getWardrobe` | wardrobe/detail/profile count | High | blocks content | smaller SDK/DB entry, no external provider (`getWardrobe/index.js:1-27`) | MEDIUM |
| `getWeather` | weather card, then possible recommendation refresh | Medium | context update | independent external HTTP/cache runtime (`getWeather/index.js:8`, `getWeather/index.js:125`) | MEDIUM |
| dictionary/profile/simple mutations | low/medium | Low/medium | user waits for action | small independent SDK/DB entries | LOW-MEDIUM |
| background/maintenance | non-blocking | low/unknown | none on synchronous UX | independent by design | LOW for UX |

The main repeated cold domain is not a chain of three serverless functions. It is duplicated recommendation code across the HTTP primary and callable fallback, plus unrelated query/mutation actions inside `generateOutfit`. The largest real multi-unit wait chain is upload.

## E. AI usage matrix

Eight production AI task classes are currently identifiable. Generic unused adapters and mock fallbacks are listed separately and not counted as production tasks.

| Task | Owner / current unit | Provider / model | Prompt / validator | Timeout / retry / mode | Secret / direct call |
|---|---|---|---|---|---|
| Web clothing recognition | Web clothes route -> `packages/ai` | SiliconFlow / `Qwen2.5-VL-32B-Instruct` | `siliconflow.ts:48-71`; schema `:116-180` | no explicit timeout; structured call then text fallback; sync | `SILICONFLOW_API_KEY`; direct adapter HTTP (`siliconflow.ts:183`) |
| Standalone clothing re-recognition | `recognizeClothAttributes` | Bailian/DashScope / `qwen3-vl-flash` | `index.js:196-213`; normalize parser | default 20s; retry once; non-stream | `BAILIAN_API_KEY`; direct (`index.js:159-183`) |
| Upload image router | `processUploadImage` | Bailian / router model, fallback `qwen3-vl-flash` | pipeline router prompt | default 30s; one retry; non-stream | `BAILIAN_API_KEY`; direct (`wardrobeAssetPipeline.js:613`) |
| Garment detection/parsing | `processUploadImage` | Bailian VL plus Aitryon parsing | detection/parsing prompt builders | default 30s; one retry | same key; direct (`wardrobeAssetPipeline.js:613-675`) |
| Upload attribute enrichment | `processUploadImage` | Bailian attribute model | `buildAttributePrompt`, `wardrobeAssetPipeline.js:537` | default 30s; one retry | same key; direct |
| Stylist AI comment | `generateOutfit` | Bailian / default `qwen3.7-max` | `stylistExplanationV2`; domain validator | default 15s; up to 3 attempts; non-stream | `BAILIAN_API_KEY || DASHSCOPE_API_KEY`; direct (`generateOutfit/index.js:1919-1956`) |
| Production voice renderer | recommendation runtime | Bailian / `qwen3.7-max` | `voiceRendererV2Contract.js:1-30`; validator | default 25s; no retry; streamed provider response | same key aliases; direct (`recommendationVoiceRendererProductionV2.js:88-128`) |
| Shadow voice renderer | recommendation runtime | Bailian / same voice model | same contract; shadow checks | default 25s; no retry; non-stream | same key aliases; direct (`recommendationVoiceRendererShadowV2.js:324-345`) |

Additional provider capabilities:

- `packages/ai.generateStructuredText` wraps DashScope with fallback models, but no production caller was found (`packages/ai/src/providers/dashscope.ts:40-95`).
- `smartProvider` is a Web SiliconFlow-to-Mock fallback, not a system-wide AI gateway; recommendation, analysis, and copy methods still use Mock (`packages/ai/src/index.ts:35-74`).
- DeepSeek is a non-functional placeholder; its task methods throw not implemented (`packages/ai/src/providers/deepseek.ts:24`).
- Aliyun `SegmentCloth` is an external image AI dependency even though it is not a chat-model task (`apps/miniapp/cloudfunctions/segmentClothImage/index.js:457`).

## F. Secret and configuration current state

Current state:

- Bailian/DashScope credential lookup and default endpoint logic are repeated in `processUploadImage`, `recognizeClothAttributes`, `generateOutfit`, production/shadow renderers, and benchmark scripts (`wardrobeAssetPipeline.js:613`, `recognizeClothAttributes/index.js:159`, `generateOutfit/index.js:1919`).
- `BAILIAN_API_KEY` and `DASHSCOPE_API_KEY` are treated as aliases in some units but not all. `BAILIAN_BASE_URL`, models, prompts, prompt versions, timeout/retry, and JSON parsing policies are independently maintained (`docs/cloudfunctions-env.md:33-53`, `apps/miniapp/cloudfunctions/generateOutfit/index.js:211`).
- `.env.example` documents SiliconFlow, DeepSeek, DashScope, and Bailian keys (`.env.example:4-16`, `.env.example:35-44`). An ignored local Web env file contains a real-looking SiliconFlow value; the value is not reproduced here and must remain untracked.
- No source evidence exists for Tencent SSM, a `SecretProvider`, per-instance secret cache, in-flight Promise dedupe, or request-early async prefetch.

Target direction is frozen as:

```text
Tencent SSM (source of truth)
  -> SecretProvider
     -> per-instance memory cache
     -> in-flight Promise dedupe
     -> P0 request-early async prefetch
```

The first shared SSM secret consumers should be the real Bailian/DashScope runtimes: `recommendationStream`/shared recommendation runtime, callable `generateOutfit` while it remains, `processUploadImage`, and `recognizeClothAttributes`. SiliconFlow and future DeepSeek belong to separate secret namespaces.

**SSM latency spike target:** deploy the Phase 2 spike in the real `recommendationStream` deployment unit, because it is the primary Today P0 HTTP runtime, already executes the first-card recommendation/AI path, and is the most likely predecessor of Recommendation Interactive Service. Measure cold and warm secret reads, cached reads, Promise-deduped concurrent reads, and early-prefetch overlap there. Do not measure only in a synthetic lab or a future remote AI gateway.

## G. Image asset current state

`CURRENT_IMAGE_ASSET_MODEL=V2 fields present, MIXED runtime semantics`.

| Semantic asset | Current fields / behavior | Status |
|---|---|---|
| Original / fact asset | `upload_images.originalImageUrl/cloudFileId`, `clothes_drafts.originalImageUrl`, `clothes.originalImageUrl` (`createUploadImage/index.js:18-25`) | PRESENT |
| Crop | `cropImageUrl`, legacy `croppedImageUrl`; bbox crop persisted to storage (`wardrobeAssetPipeline.js:454-479`) | PRESENT, MIXED naming |
| Clean / segmented | `cleanImageUrl`, `aiSegmentImageUrl`; `maskImageUrl` mostly reserved (`wardrobeAssetPipeline.js:512-533`) | PRESENT, weak validation |
| Display | `displayImageUrl`, with `imageUrl` compatibility alias; resolver order differs by layer (`getWardrobe/index.js:360-379`, `clothingLabels.ts:141-169`) | PRESENT, MIXED resolution |
| Thumbnail | `clothes.thumbnailUrl`; independent backfill only (`backfillClothesThumbnails/index.js:62-80`) | PARTIAL |

### Image asset gaps

- Multi-item extraction handles person upper/lower/accessory merging, shoe pairing, and duplicate-clean reset, but has no general candidate-to-item visual consistency check (`wardrobeAssetPipeline.js:263-319`, `wardrobeAssetPipeline.js:1369-1397`).
- Segmentation success is accepted without post-checking dimensions, transparency, subject coverage, or semantic completeness. Manual reprocess can raise the minimum quality score to 80 (`segmentClothImage/index.js:134-155`, `segmentClothImage/index.js:288-302`).
- Low-quality results may remain as `needs_review`; quality scoring is not a strict publish gate (`wardrobeAssetPipeline.js:1327-1361`).
- `normalizedImageUrl` initially aliases the original image, so normalized is not yet an independent fact asset (`createUploadImage/index.js:18-29`).
- Thumbnail creation is not part of the primary upload pipeline.

### Media cache gaps

- Today alone has a batch cloud file ID -> temporary HTTPS resolver with in-memory resolved/pending caches (`apps/miniapp/src/utils/mediaResolution.js:44-113`).
- `SafeImage` caches image-session results and fallbacks but does not hydrate cloud IDs (`apps/miniapp/src/components/SafeImage/index.tsx:21-60`).
- Wardrobe, Detail, Favorite, and History have different fallback orders. Favorite/History use only `thumbnailUrl || imageUrl` in key paths (`favorite-outfits/index.tsx:491-503`, `outfit-history/index.tsx:426-435`).
- `preloadImageSession` exists, but Today next-batch prefetch only prefetches recommendation data; no P3 media prewarm call was found (`today/index.tsx:915-935`).
- Instrumentation records `media:start/done/error`, but the repository does not contain evidence tying a specific 884ms value to the current chain. That measurement remains `UNKNOWN` until E2E/telemetry review.

### Snapshot image gaps

- Recommendation snapshots persist `imageUrl`, `displayImageUrl`, and `thumbnailUrl` from clothing payloads; values can remain cloud file IDs, not durable CDN URLs (`generateOutfit/index.js:3423-3490`).
- Today hydrates its canonical snapshot before render (`todayRenderCommit.js:8-22`), while Detail/Favorite/History do not uniformly hydrate.
- Re-recognition/reprocessing does not update already saved `itemsSnapshot` records in favorites/history (`generateOutfit/index.js:3090-3132`).

## H. Cache and mutation coverage

| Concern | Identity / owner | Status | Evidence |
|---|---|---|---|
| Recommendation client cache user isolation | runtime user scope + namespace/request key | CLOSED_BY_P2 | `apps/miniapp/src/lib/cloud.ts:205-258` |
| Candidate pool isolation | user hash + wardrobe/weather/profile/time/version fingerprints | CLOSED_BY_P2 | `candidatePool.js:38-64`, `candidatePool.js:1351-1382` |
| Candidate pool atomic visibility | deterministic manifest/chunks, validate then ready | CLOSED_BY_P2 | `candidatePool.js:1101-1118`, `candidatePool.js:1458-1512` |
| P3 next batch stale promotion | identity/request-key single-slot coordinator | CLOSED_BY_P3 | `recommendationCoordinatorCore.js:71-100` |
| Preference save -> Profile/Today | page caches, profile version, Today snapshot/hard invalid, prebuild | CLOSED_BY_P2 | `cacheInvalidation.ts:125-143` |
| Wardrobe edit/re-recognize -> relevant page/recommendation caches | page invalidation + wardrobe version/fingerprint | CLOSED_BY_P2 | `cacheInvalidation.ts:66-84`, `candidatePool.js:1635-1643` |
| Detail favorite toggle -> Favorites/status | detail calls unified invalidator | CLOSED_BY_P2 | `outfit-detail/index.tsx:603-636` |
| Today favorite toggle -> Favorites | only updates Today V2 snapshot | STILL_MISSING | `today/index.tsx:1277-1297` |
| Today wear toggle -> History/Profile | only updates Today V2 snapshot | STILL_MISSING | `today/index.tsx:1302-1318` |
| Detail rename -> saved Favorite/History titles | client cache clears, server snapshots unchanged | STILL_MISSING | `generateOutfit/index.js:1400-1416`, `generateOutfit/index.js:2984-3020` |
| Re-recognize/reprocess -> saved item snapshots | page cache clears, stored snapshots unchanged | STILL_MISSING | `generateOutfit/index.js:3090-3132` |
| Canonical-copy cache lifecycle | openid + renderer version + input fingerprint; no expiry owner | STILL_MISSING | `recommendationCopyProductionJobV2.js:12-18`, `:402-416` |
| Temp media URL cache | global by file ID, no user scope/TTL | STILL_MISSING / risk bounded by opaque file ID | `mediaResolution.js:1-7` |
| Favorite -> Profile stats | no invalidation dependency today | NOT_APPLICABLE now; STILL_MISSING if stat is added | `cacheInvalidation.ts:84-92` |

P2 background scheduling is fail-open for the interactive response. Candidate pool chunks are persisted before the ready manifest and cleaned on partial failure (`generateOutfit/index.js:867-1018`). This should be preserved when extracting the Recommendation Orchestrator.

## I. Data, index, permission, and deployment gaps

| Area | Current source-controlled state | Audit result |
|---|---|---|
| Candidate pool identity/index contract | deterministic IDs, owner hash, TTL fields, documented lookup index | Code contract present; actual CloudBase index `UNKNOWN` (`docs/cloudbase/candidate-pool-v2-index-migration.md:18-36`) |
| TTL cleanup | code rejects expired reads | CloudBase TTL index/type/status `UNKNOWN` |
| CloudBase collection permissions | no deployable security-rules file found | `UNKNOWN`; `docs/WECHAT_CLOUD_MVP.md:88-105` is an operator instruction, not deployment evidence |
| Function runtime/memory/timeout/env | partial bootstrap/package/config only | mostly `UNKNOWN` |
| Deployed versions/environment | no local source of truth | `UNKNOWN` |
| PostgreSQL migrations | relational schema in `database/migrations` | not evidence for miniapp CloudBase collections, which use `wx-server-sdk` (`database/migrations/001_initial_schema.sql:1`, `candidatePool.js:3`) |

Before production freeze, collections, indexes, permissions, function settings, and environment variables need deployable configuration or a checked, versioned environment manifest. This audit does not claim the live console is wrong; it says the repository cannot prove its state.

## J. Current -> target function boundary mapping

The recommendation is based on latency domain, failure isolation, workload, timeout, dependency weight, security boundary, and expected scale. It is not a function-count minimization exercise.

| Current function | Recommendation | Target boundary / reason |
|---|---|---|
| `login` | KEEP_INDEPENDENT | Small auth/bootstrap security boundary; revisit only with a real backend session design |
| `getWeather` | KEEP_INDEPENDENT | External provider/cache/failure domain; start in parallel with recommendation input preparation where possible |
| `submitFeedback` | KEEP_INDEPENDENT | Low-frequency auxiliary flow with separate data/storage concerns |
| `recommendationStream` | MERGE_INTO_INTERACTIVE_SERVICE | Evolve this primary P0 HTTP unit into Recommendation Interactive Service |
| `generateOutfit` | MERGE_INTO_INTERACTIVE_SERVICE | Retire monolithic action switch; route P0 recommendation/detail/mutation operations through focused modules in the same interactive deployment unit |
| `getWardrobe` | MERGE_INTO_INTERACTIVE_SERVICE | Candidate for Wardrobe interactive routes in the same or second stable interactive backend |
| `updateClothes` | MERGE_INTO_INTERACTIVE_SERVICE | Same wardrobe latency/data domain |
| `deleteClothes` | MERGE_INTO_INTERACTIVE_SERVICE | Keep inspect/commit transactional module interactive; retention cleanup remains background |
| `updateUserProfile` | MERGE_INTO_INTERACTIVE_SERVICE | Profile/preferences directly invalidate Today and recommendation identity |
| `createUploadBatch` | MERGE_INTO_INTERACTIVE_SERVICE | Upload control-plane route, not the heavy worker |
| `createUploadImage` | MERGE_INTO_INTERACTIVE_SERVICE | Batch registration belongs to upload control plane |
| `confirmClothesDrafts` | MERGE_INTO_INTERACTIVE_SERVICE | Keep capacity/confirmation commit interactive; extract thumbnail/heavy media follow-up to worker |
| `discardClothesDraft` | MERGE_INTO_INTERACTIVE_SERVICE | Small upload-control mutation |
| `discardUploadBatch` | MERGE_INTO_INTERACTIVE_SERVICE | Small upload-control mutation |
| five material/subcategory functions | MERGE_INTO_INTERACTIVE_SERVICE | Consolidate as wardrobe dictionary routes/modules; avoid five low-frequency runtimes |
| `processUploadImage` | BACKGROUND_WORKER | Long AI/image pipeline, resumable status, independent timeout/failure scaling |
| `segmentClothImage` | BACKGROUND_WORKER | Provider-heavy, long timeout; interactive command should enqueue/check status |
| `recognizeClothAttributes` | BACKGROUND_WORKER | Provider-heavy; make re-recognition resumable while preserving user feedback |
| `trackOutfitBehaviorEvents` | BACKGROUND_WORKER | Fire-and-forget telemetry |
| `refreshLearnedStyleProfile` | BACKGROUND_WORKER | Derived profile rebuild; no synchronous UI requirement |
| `cleanupDeletedClothes` | BACKGROUND_WORKER | Timer/retention/storage failure domain |
| `backfillClothesThumbnails` | BACKGROUND_WORKER | Batch media maintenance; later share Image Asset Pipeline V2 modules |
| `recommendationTransportLab` | DEPRECATE_CANDIDATE | Synthetic completed experiment; preserve evidence/docs before undeploy/removal |
| `httpFunctionSmokeLab` | DEPRECATE_CANDIDATE | Synthetic lab, not a production capability |

The five dictionary functions are `get/create/archiveUserClothingMaterial` and `get/createUserClothingSubcategory`; no archive-subcategory function exists in the audited inventory.

### Target recommendation boundary

```text
Mini Program
  -> Recommendation Interactive Service  (one P0 deployment unit)
       -> Recommendation Orchestrator
            -> Recommendation Core
                 produces outfits, narrativePlans, identity, evidence
            -> @d1d/ai-core (shared module, same process)
                 Task Registry
                 Provider Adapter
                 Prompt Registry
                 Validator
                 timeout/retry/telemetry
                 SecretProvider
       -> DB / Storage / AI Provider

Background Event/Queue
  -> canonical-copy materialization where not required for first card
  -> candidate-pool persistence
  -> behavior/profile learning
```

`@d1d/ai-core` is a shared code boundary. A P0 request must not become `Function A -> aiGateway Function -> Provider`.

Recommendation plus first-card AI should live in the same interactive deployment unit. The first-card task may run bounded-concurrently with deterministic recommendation work after the orchestrator has enough authorized facts, while Recommendation Core remains provider-independent and preserves rule fallback.

If ordinary Cloud Functions cannot meet the production P0 cold SLA, move the small number of P0 interactive routes to Function Cloud Hosting / CloudBase Run with a positive minimum instance count. Do not buy provisioned concurrency per feature function. Provider-heavy image and maintenance workers remain independent serverless units.

## Explicit answers to the eleven architecture questions

1. **First entry cold risks:** `login`, `recommendationStream` (primary Today), callable `generateOutfit` fallback, `getWeather`, and `getWardrobe` if wardrobe/profile data is opened. Of these, recommendation runtime risk is highest; weather/wardrobe are smaller domains.
2. **Other low-frequency P0 independent runtimes like recommendationStream:** `processUploadImage`, `segmentClothImage`, `recognizeClothAttributes`, and `confirmClothesDrafts`. They are provider/storage-heavy and user-waiting, but belong to background-worker targets rather than the recommendation unit.
3. **Function -> Function serial calls:** none synchronously. One asynchronous self Event exists. P0 multi-unit sequences are client-orchestrated upload and weather-triggered recommendation refresh.
4. **Is `generateOutfit` overburdened?** Yes. Recommendation Core should own deterministic candidate/ranking/evidence/narrative-plan output; the Orchestrator should own concurrency, cache/lease/fallback and response staging; background workers should own deferred copy/candidate persistence. Detail/favorite/wear/history/rename should be focused interactive data modules rather than recommendation-core concerns.
5. **Recommendation + first-card AI boundary:** same Recommendation Interactive Service process, with shared `@d1d/ai-core`, no remote AI-gateway hop.
6. **AI distribution and Phase 1 coverage:** Web SiliconFlow recognition; upload router/detection/attribute; standalone recognition; recommendation comment; production/shadow voice rendering; plus Aliyun segmentation. First AI Core slice should cover Bailian secret/provider transport, task registry, model/prompt versions, validators, timeout/retry, and telemetry for recommendation first-card plus clothing recognition. Migrate other tasks gradually.
7. **Shared SSM secret readers:** recommendation primary/fallback runtimes, `processUploadImage`, and `recognizeClothAttributes` share Bailian/DashScope credentials. Web SiliconFlow is a separate secret.
8. **SSM spike target:** real deployed `recommendationStream`, because it is the current P0 Today unit and future interactive-service seed. Test cold/warm/cache/dedupe/prefetch there, not in a lab.
9. **Image asset missing pieces:** schema gaps are semantic aliases and snapshot durability; pipeline gaps are segmentation/content integrity gates, normalized asset, thumbnail production, and resumability; display/cache gaps are inconsistent resolver order, Today-only hydration, missing TTL/scope policy, and absent next-batch media prewarm.
10. **P2/P3 closure:** user-scoped recommendation/page cache, candidate identity/atomic visibility, stale next-batch prevention, preference/wardrobe/detail-favorite invalidation are closed. Today favorite/wear, stored rename/re-recognition snapshots, canonical cache lifecycle, media cache policy, and live CloudBase index/permission evidence remain.
11. **Future resident interactive backend:** recommendation, outfit query/mutations, wardrobe control plane, preferences, and upload control plane fit one or a small number of resident units. Image processing, segmentation, recognition jobs, telemetry, learned-profile refresh, cleanup, and thumbnail backfill remain independent workers.

## K. Prioritized development roadmap

| Phase | Deliverable | Exit criterion |
|---:|---|---|
| 0 | Clean up failed card0 experiment | Completed: feature baseline restored to `5d14696`; archive preserved locally |
| 1 | Backend / Cloud Function Architecture Audit | This document committed; no business logic changed |
| 2 | SSM Latency Spike | Stopped and archived; DB Secret latency lab was removed from the formal feature history |
| 3 | Recommendation target freeze | Completed for Recommendation Core, Orchestrator, transport, background and logical deployment boundaries; AI Core and SecretProvider remain deferred |
| 4 | Formal Recommendation Core / Orchestrator refactor | Slice 1 completed: Core emits the formal six-field result and both current transports enter one Orchestrator; physical deployment consolidation remains deferred |
| 5 | Recommendation + card0 AI bounded concurrency | First-card AI shares interactive unit, bounded and fail-open to deterministic result |
| 6 | Cold / warm / AI / mutation / P3 real-user E2E | Measured acceptance across Today and mutations; no synthetic-only sign-off |
| 7 | Gradual migration of other AI tasks | Task-by-task adoption of AI Core; no Big Bang migration |
| 8 | Wardrobe Image Asset Pipeline V2 | Original/fact, crop, clean, display, thumbnail semantics and lifecycle frozen |
| 9 | Image integrity/normalization/display/thumbnail/media cache/prewarm | Integrity gates, unified resolver, durable snapshots and next-batch media prewarm accepted |
| 10 | Cache isolation + mutation invalidation closure audit | Remaining Today/snapshot/canonical/media gaps closed with tests |
| 11 | Collections/indexes/permissions/core tests/docs closure | CloudBase control plane becomes versioned/verifiable; runtime settings documented |
| 12 | home/work/date/sport + Today/Detail/Favorite/History + Voice real-user acceptance | Full supported-scene and surface acceptance completed |
| 13 | Clothing relationship graph / knowledge graph / personalization learning | Start only after Phase 12; not current critical path |
| 14 | Virtual try-on MVP | Start only after Phase 13 readiness; not current critical path |

`NEXT_PHASE=Recommendation + first-card AI bounded concurrency`. That phase may connect `@d1d/ai-core`, SecretProvider and card0 AI to the Orchestrator; this refactor does not start that work.

## L. Recommendation Architecture Freeze

### CURRENT

`recommendationStream` and callable `generateOutfit` remain two physical transport adapters. Both enter the same process-local production seam, `runProductionRecommendationRuntime`, and no synchronous Function-to-Function RPC is introduced.

The former implicit Runtime lifecycle has been split at C2. Selection and deterministic narrative planning finish before candidate-pool writes, copy admission, required Batch Core persistence or Home Light response assembly begin.

### TARGET

```text
recommendationStream HTTP/SSE adapter ─┐
                                      ├─> runProductionRecommendationRuntime
generateOutfit callFunction adapter ──┘       -> Recommendation Orchestrator
                                                -> Recommendation Core
                                                -> CORE_RESULT_AVAILABLE
                                                -> parallel fail-open work admission
                                                -> required Batch Core persistence
                                                -> Light Response assembly
                                                -> recommendation.ready
```

This is one logical Recommendation Service with one Core and one Orchestrator. Physical deployment consolidation is deliberately deferred; Runtime, transport, deployment and AI are not changed in one step.

### Core responsibility

Recommendation Core owns normalized recommendation input, deterministic candidate-pool identity, current Exact/Refresh/Full Compute admission semantics, candidate/ranking and outfit selection order, evidence, deterministic narrative plans and execution state.

Its formal result reuses the current runtime models and has these required top-level fields:

```js
{
  identity,
  executionState,
  outfits,
  narrativePlans,
  evidence,
  metadata,
}
```

`identity` is the current candidate-pool identity; `outfits` is the existing ordered recommendations collection; `narrativePlans` is the existing deterministic styling-plan output; `executionState` preserves `full_compute`, `candidate_pool_hit` and `fallback_recompute` plus cache and availability/count state. The Core does not emit a wire response and does not own HTTP/SSE, wx transport, provider calls, first-card waiting, Event policy, UI staging or persistence.

### Orchestrator responsibility

Recommendation Orchestrator owns the single lifecycle used by both adapters:

1. Normalize input through the Core contract and execute the Core.
2. Publish `CORE_RESULT_AVAILABLE` through `onCoreResultAvailable`.
3. Admit the existing candidate-pool/copy/overlay work and preserve fail-open settlement.
4. Run the required atomic Batch Core persistence barrier.
5. Assemble the unchanged Home Light response and publish recommendation ready.

The existing `onNarrativePlansReady` notification remains only as a compatibility lifecycle notification for current SSE canonical-copy delivery. It is not an experiment boolean, capability patch or C2 feature switch. No first-card AI provider is connected in this slice.

### Transport responsibility

The HTTP/SSE adapter continues to own route/auth parsing, SSE headers, disconnect handling and event serialization. The callable adapter continues to own Cloud Function action dispatch and the `{ code, data, message }` envelope. Neither adapter owns candidate selection, ranking, Core result construction, required persistence ordering or duplicate recommendation flow.

### Background responsibility

Candidate-pool persistence, canonical-copy work and overlay reads remain post-Core fail-open work. Candidate Pool atomic visibility, Batch Core atomic persistence, P2 Event scheduling, P3 `TARGET_8`, partial `1..7`, `seenOutfitKeys`, diversity exhaustion and stale next-batch prevention retain their existing contracts. Remaining canonical copy and future P2/P3 work stay outside the Light Response durability barrier unless their current contract explicitly requires otherwise.

Freeze invariants for this slice:

- `SINGLE_CORE=true`
- `SINGLE_ORCHESTRATOR=true`
- `LIGHT_RESPONSE_PRESERVED=true`
- `SCREENSHOT_VISIBLE_CHANGE=false`
- `FIRST_CARD_AI_CONNECTED=false`
- `PHYSICAL_DEPLOYMENT_MERGED=false`

## Top 10 architecture findings

1. There are 28 Cloud Functions, but no synchronous Function-to-Function call graph.
2. Today primary recommendation is one HTTP/SSE deployment unit with local shared runtime; callable `generateOutfit` is fallback and the general outfit API.
3. `generateOutfit` is overburdened by recommendation, read models, mutations, history, and AI review.
4. Upload is the deepest user-waiting multi-unit flow and should become an interactive control plane plus background processing workers.
5. Recommendation + first-card AI belong in one interactive deployment unit; AI Core must remain a shared module.
6. Bailian/DashScope secret/provider/model/prompt/timeout logic is duplicated across real production runtimes.
7. The SSM spike belongs in `recommendationStream`, with instance cache, Promise dedupe, and early-prefetch measurements.
8. Image V2 fields exist, but semantic aliases, quality gates, thumbnails, hydration, snapshots, and media prewarm are incomplete.
9. P2/P3 closed substantial cache identity and invalidation work; Today mutations and stored snapshots are the main remaining functional gaps.
10. CloudBase indexes, permissions, deployment versions, memory, timeouts, and environment state are mostly not provable from the repository.
