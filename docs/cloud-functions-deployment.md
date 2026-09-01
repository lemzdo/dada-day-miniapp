# CloudBase 云函数正式部署合同

`generateOutfit`、`recommendationStream` 与 `processUploadImage` 的正式部署只有一个仓库入口：

```bash
pnpm cloud:deploy <generateOutfit|recommendationStream|processUploadImage>
```

按需部署函数时，分别执行：

```bash
pnpm cloud:deploy generateOutfit
pnpm cloud:deploy recommendationStream
pnpm cloud:deploy processUploadImage
```

环境默认是 `cloud1-d8gl3k1vkdf0b7f05`；只有明确部署到其他环境时才使用 `--env-id <envId>`。

## 成功定义

正式合同固定为：

```text
SOURCE
→ stage-recommendation-artifacts.js canonical assembler
→ disposable staged artifact
→ dependency closure = []
→ reject symlink/junction
→ isolated boot PASS
→ manifest/hash integrity PASS
→ tcb artifact-root deploy
→ download actual remote artifact
→ remote closure/required-files/isolated-boot/manifest gate PASS
```

只有命令输出 `DEPLOYMENT_SUCCESS=<function>` 才表示部署成功。

```text
DEPLOYMENT_SUCCESS = local artifact PASS + CLI upload PASS + remote artifact PASS
```

`tcb` 上传命令退出成功不等于部署成功。远端 artifact 没有下载验证，或任一 remote gate 没有 PASS，都必须按 `DEPLOYMENT_FAILED` 处理，不得宣告完成。

三个函数复用同一个 deployment contract，只允许 assembler adapter 不同：

- `generateOutfit`：`stageGenerateOutfit()`
- `recommendationStream`：`stageRecommendationStream()`，artifact 内必须嵌入完整 `generateOutfit/` runtime
- `processUploadImage`：`stageProcessUploadImage()`，artifact 内必须包含 `services/wardrobeAssetPipeline.js`、完整本地依赖闭包与 vendored `@d1d/garment-assets`

`recommendationStream` 的本地和远端 gate 还会逐字核对以下 embedded runtime 与 `generateOutfit/services/` canonical source；任一不一致都按 drift 阻止部署：

- `recommendationFirstCardRenderer.js`
- `recommendationVoiceRendererProductionV2.js`

## Deployment Contract Lite

部署前运行：

```bash
pnpm cloud:deploy:audit
```

该命令只审计当前三个稳定化目标，输出函数名、正式部署入口、artifact contract 状态、动态 `require` 风险与 nested copy 风险。风险字段用于提示人工关注；artifact contract 缺失会令命令失败。它不是全量云函数 manifest。

## 禁止的正式路径

以下路径可以保留其开发工具本身，但不得用于生产或验收部署：

- 微信开发者工具 Cloud Function Deploy
- 微信开发者工具 `inc-deploy`
- 从 `apps/miniapp/cloudfunctions/<function>` source directory 直接执行 `tcb fn deploy`
- 手工复制 `runtime`、`services`、`vendor`
- 任何只检查本地 staging、没有下载并验证远端 artifact 的脚本

旧的 PowerShell 部署脚本只是 canonical command 的兼容转发器，不再拥有 packaging 或 upload 逻辑。旧 benchmark DevTools/inc-deploy 脚本已经 fail-closed，不能覆盖生产 artifact。

## 回归检查

```bash
pnpm cloud:deploy:test
```

该最小测试覆盖完整 staging PASS、`processUploadImage` isolated boot、删除真实 required file 后 gate FAIL、embedded renderer drift FAIL、三个 assembler adapter 共用同一正式合同，以及 source-directory deploy 被拒绝。

## 下一轮人工 smoke

1. 上传链路：在“衣橱”页点击“添新衣”，选择一张正常衣物照片并进入上传确认页。观察 `processUploadImage` 日志中出现 `[processUploadImage] pipeline v2 completed` 和 `[processUploadImage] image processed`，且不得再出现 `Cannot find module './services/wardrobeAssetPipeline'`。
2. 推荐链路：在“今日”页选择一个近期未用于当前衣橱组合的自然场景后刷新推荐；若首卡组合仍命中旧 fingerprint，再换一个自然场景或正常刷新一次，不删除缓存、不改数据库。观察同一请求的 `[RecommendationAudit]`：`CACHE_LOOKUP_DONE=miss`、`FIRST_CARD_AI_ADMITTED=admitted`，随后出现 `PROVIDER_START`、`PROVIDER_COMPLETE`、`VALIDATOR_COMPLETE=accepted`；快速完成时还会在响应 deadline 前出现 `CANONICAL_PERSISTED`，较慢时允许先出现 `DEADLINE_REACHED=timeout`，再由同一函数尾部完成 canonical persistence。若页面降级到 `generateOutfit` callFunction，再同时核对 `[RecommendationServerDone]` 的 `FIRST_CARD_AI_RESULT`、`FIRST_CARD_AI_MS`、`REQUEST_TO_RESPONSE_READY_MS` 与 `AI_LATE_DISCARDED=false`。再次以同一输入请求时应看到 `CACHE_LOOKUP_DONE=hit` 与 `FIRST_CARD_AI_RESULT=CACHE_HIT`。
