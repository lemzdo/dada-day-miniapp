# CloudBase Deployment Contract v2 全量迁移验收

环境：`cloud1-d8gl3k1vkdf0b7f05`。最后远端验证时间（UTC）：2026-09-02T02:23:04.540Z。

26/26 个生产函数完成 artifact 构建、本地 isolated boot、部署后远端下载、manifest/file hash、完整闭包、实际安装依赖解析和 remote isolated boot。28/28 个源码函数完成 dry-run。

业务源码、推荐算法、AI prompt 无修改；未调用业务函数，未进行真人 smoke。现有三个 artifact contract 保留。

## 迁移前完整审计

本次下载的远端快照中，processUploadImage 的 wardrobeAssetPipeline 和 confirmClothesDrafts 的 wardrobeCapacity 已存在。不能把历史报错当作当前缺文件；这次以全量合同防止重复发生。

运行时缺失文件：无。

缺少根 artifact-manifest.json 的完整清单：

- `archiveUserClothingMaterial/artifact-manifest.json`
- `backfillClothesThumbnails/artifact-manifest.json`
- `cleanupDeletedClothes/artifact-manifest.json`
- `confirmClothesDrafts/artifact-manifest.json`
- `createUploadBatch/artifact-manifest.json`
- `createUploadImage/artifact-manifest.json`
- `createUserClothingMaterial/artifact-manifest.json`
- `createUserClothingSubcategory/artifact-manifest.json`
- `deleteClothes/artifact-manifest.json`
- `discardClothesDraft/artifact-manifest.json`
- `discardUploadBatch/artifact-manifest.json`
- `getUserClothingMaterials/artifact-manifest.json`
- `getUserClothingSubcategories/artifact-manifest.json`
- `getWardrobe/artifact-manifest.json`
- `getWeather/artifact-manifest.json`
- `httpFunctionSmokeLab/artifact-manifest.json`
- `login/artifact-manifest.json`
- `recognizeClothAttributes/artifact-manifest.json`
- `recommendationTransportLab/artifact-manifest.json`
- `refreshLearnedStyleProfile/artifact-manifest.json`
- `segmentClothImage/artifact-manifest.json`
- `submitFeedback/artifact-manifest.json`
- `trackOutfitBehaviorEvents/artifact-manifest.json`
- `updateClothes/artifact-manifest.json`
- `updateUserProfile/artifact-manifest.json`

另有 generateOutfit、processUploadImage、recommendationStream 的旧 v1 manifest，本次全部升级 v2。

内容差异（移除已有 canonical-deploy 注释后）：

- `backfillClothesThumbnails/package.json`
- `recommendationStream/generateOutfit/artifact-manifest.json`
- `recommendationStream/generateOutfit/services/recommendationFirstCardRenderer.js`
- `recommendationStream/generateOutfit/services/recommendationVoiceRendererProductionV2.js`
- `recommendationTransportLab/scf_bootstrap`

recommendationStream 的两个 renderer 及嵌套 manifest 从 canonical 源码重建。backfill 的 package.json 差异为部署元数据。实验函数 bootstrap 差异仅记录，没有部署实验函数。旧 vendor 复制规则会带入 .turbo 日志，现已收紧为 package.json + src。

动态依赖完整清单：

| 函数 | importer:line | 表达式 | 有限目标 |
| --- | --- | --- | --- |
| backfillClothesThumbnails | shared/thumbnail.js:8 | `['..', 'vendor', 'garment-assets'].join('/')` | `../vendor/garment-assets` |
| generateOutfit | services/deployPackageResolver.js:5 | `packageName` | `@d1d/ai-core`、`@d1d/garment-assets` |
| generateOutfit | services/deployPackageResolver.js:8 | `vendorParts.join('/')` | `../vendor/ai-core`、`../vendor/garment-assets` |
| processUploadImage | shared/thumbnail.js:8 | `['..', 'vendor', 'garment-assets'].join('/')` | `../vendor/garment-assets` |
| recommendationStream | generateOutfit/services/deployPackageResolver.js:5 | `packageName` | `@d1d/ai-core`、`@d1d/garment-assets` |
| recommendationStream | generateOutfit/services/deployPackageResolver.js:8 | `vendorParts.join('/')` | `../vendor/ai-core`、`../vendor/garment-assets` |

shared/thumbnail.js:8 另有同一 garment-assets fallback；shared 是库目录，非独立函数。所有外部包及逐文件 hash 明细位于本地 artifacts/cloudbase-contract-v2/audit-final/audit.json。

## 生产远端验收

| 函数 | Remote artifact verify | manifest SHA-256 |
| --- | --- | --- |
| archiveUserClothingMaterial | PASS | `38e3b3e5367c675f13e6c860f4916e15af8515f2b5206a626282a0a18225df37` |
| backfillClothesThumbnails | PASS | `73d825f733858c9dcc77f703b0cc93d96419aad3f2f7bc661093dc383162e9ea` |
| cleanupDeletedClothes | PASS | `35c3d97370fbcacb9b603ac2ab6c97f498ed6adcae3701d1449e87304b42f476` |
| confirmClothesDrafts | PASS | `b7d6ff0b45659a01d8daf1dc2c8814c13e5e8d2d75d2c6500629dc86ba565077` |
| createUploadBatch | PASS | `67645dbd0b79aa1ea28481c864cc8ae369c7079d327fca3089ee7365c22b9855` |
| createUploadImage | PASS | `1bd6c6dfe3c5b0db62c834b65db7791a9b92a71ebf6a214a5ca592b66c035a7a` |
| createUserClothingMaterial | PASS | `9e9a5bcbb10f0e9d0eca0258acb99c62c25c393376668ff97f95c69ab43c3ae9` |
| createUserClothingSubcategory | PASS | `17a8254c217b6b5cb99d919424ee3ce424382ca2808489dba7f314dcad7ade52` |
| deleteClothes | PASS | `69d0d826bf9e5fe15bd772cf851f110a76a5c941fddd59a21b5c6e5968cdf9bc` |
| discardClothesDraft | PASS | `c820149db3702167425a649543a2d5dddbf99fc6e96d38e70dd5b2446eb13026` |
| discardUploadBatch | PASS | `f1fb5942740b484dcc9a77babc60bd06f8c48dba562e1923daa1e75269568dae` |
| generateOutfit | PASS | `c6c0dbc58c9e63770e9bc104a45665c66dfd0986f70153e46acafc06016ea918` |
| getUserClothingMaterials | PASS | `b27a761e326399f9f113db2b22a5b6c3ad81eed4a3a93a2920c172ce23ca0aa4` |
| getUserClothingSubcategories | PASS | `ed91ac3cc9660a748ada13be0b17fbfaf96286edf8097649d932d1446b4a7120` |
| getWardrobe | PASS | `f1859f45f144cc981ab4cf0a98985da3094b156ebc25141d4af2bca203352746` |
| getWeather | PASS | `4798fd6e91817967a0c3c5601f8f854fed22eda57b1081ff5b3ba79479a61e16` |
| login | PASS | `f804d496edb70b011065fa8cc94e59dcd987565513ef0a22cae4478a4351e9bf` |
| processUploadImage | PASS | `7444561e4e7225f665e940f31cbb79857aa96d117943740f40f1b8b3d0f6fbec` |
| recognizeClothAttributes | PASS | `29061e1bdc73759221933e312bc7659b2342a9c09b70ebec42193c0fad5f9435` |
| recommendationStream | PASS | `f0866e877b8a1bcccbc1c5ac95dafe858596b5ec8383dcfe8690e0339e9ec887` |
| refreshLearnedStyleProfile | PASS | `2d41dffdf546287a91c2d60cafd3160ec57d26ee5b3757bd1aa0242bed690051` |
| segmentClothImage | PASS | `3bf99881d66a25c843cfa487e3e659269a3ea2efcae095c183a94d08364c2659` |
| submitFeedback | PASS | `957e0e365ffee36e9c0141a4312181f62307f3e0ee073e99fb95b38e6ceddeff` |
| trackOutfitBehaviorEvents | PASS | `0ca1ec432c01e43d981628c160ff916eea864c8b007d98532b671ee7eaeb5b01` |
| updateClothes | PASS | `6ad813ec5a5ab5675728e576bfb489cb3e08a63c2fe52930541d6a367525c82e` |
| updateUserProfile | PASS | `56f0b727268d4dd6fb983fc5cefc651a06563f8dec5d8b37eba9dea74f2f1c51` |

2 个源码实验函数只做 dry-run 与迁移前远端审计，没有执行部署。自动审批拒绝包含实验函数的部署范围后，已按授权收窄为全部生产函数。voiceRendererLatencyLab 为无源码历史实验，清单显式排除。

## 检查与证据

- `cmd /c pnpm --filter @starter-template/miniapp typecheck`：PASS。
- `cmd /c pnpm cloud:deploy:test`：29/29 PASS。
- `cmd /c pnpm cloud:deploy:lint`：PASS。
- `pnpm cloud:deploy:audit --remote`：28/28 构建和隔离启动 PASS，全部迁移前远端包已下载。
- `pnpm cloud:deploy all --output artifacts/cloudbase-contract-v2/production-release`：26/26 remote verify PASS。
- `git diff --check`：PASS。

首次代码上传后的下载遇到 CloudBase Updating，流程正确失败；统一流程加入 Active 等待后完成全量生产部署。没有用 CLI 上传成功代替 remote verify。

完整证据保存在 artifacts/cloudbase-contract-v2/：baseline-v2/before、audit-final/audit.json、production-release/preflight.json、production-release/deployment-report.json、production-release/staged、production-release/remote、summary.json。下载包和日志不提交 Git。

## 修改文件清单

- `package.json`
- `eslint.config.mjs`
- `apps/miniapp/scripts/cloud-function-manifests.json`
- `apps/miniapp/scripts/cloud-artifact-contract.js`
- `apps/miniapp/scripts/cloud-artifact-boot.js`
- `apps/miniapp/scripts/cloud-dependency-audit.js`
- `apps/miniapp/scripts/cloud-deploy.js`
- `apps/miniapp/scripts/cloud-deploy-audit.js`
- `apps/miniapp/scripts/cloud-deploy-lint.js`
- `apps/miniapp/scripts/cloud-artifact-contract.test.js`
- `apps/miniapp/scripts/cloud-deploy.test.js`
- `apps/miniapp/scripts/deployment-contract-lite.js`
- `apps/miniapp/scripts/deployment-contract-lite.test.js`
- `apps/miniapp/scripts/stage-recommendation-artifacts.js`
- `docs/cloud-functions-deployment.md`
- `docs/cloud-functions.md`
- `docs/cloudbase-deployment-contract-v2-audit.md`
