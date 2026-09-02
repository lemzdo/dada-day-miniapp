# CloudBase Deployment Contract v2

全部生产函数使用仓库唯一入口，不再依赖 DevTools/source deploy：

```bash
pnpm cloud:deploy all
pnpm cloud:deploy confirmClothesDrafts
```

默认环境为 `cloud1-d8gl3k1vkdf0b7f05`，其他环境显式传 `--env-id <envId>`。

## Manifest 与范围

`apps/miniapp/scripts/cloud-function-manifests.json` 为每个函数记录生产属性、事件/HTTP 类型、关键文件、vendor、动态依赖和嵌套函数。入口固定为 `index.js`，元数据为 `package.json`。

- 26 个生产函数：`all` 全选，含维护函数。
- 2 个实验函数：`httpFunctionSmokeLab`、`recommendationTransportLab` 纳入全量 dry-run，不包含在生产部署中；实验函数部署需单独明确授权。
- `shared/` 为库目录，审计其动态依赖，不作为函数部署。
- 远端 `voiceRendererLatencyLab` 为没有 canonical source 的历史实验，显式排除生产迁移；不能用下载包冒充源码部署。

源码目录与 manifest 双向核对。远端清单每页 100 条，读取至末页；未知函数或缺失生产函数会阻止部署，不能只检查 CLI 默认前 20 条。

## 成功定义

```text
canonical source + function manifest
→ disposable artifact root
→ local/dynamic/external dependency closure PASS
→ required files + hashes + no symlink/junction
→ fresh-process isolated boot PASS
→ full canonical source comparison PASS
→ ALL selected artifacts PASS before any upload
→ artifact-root code update
→ wait for remote Active
→ download actual remote artifact
→ exact manifest hash + all file hashes + closure PASS
→ installed external dependency resolution + isolated boot PASS
→ DEPLOYMENT_SUCCESS
```

合同版本为 `cloudbase-deployment-contract-v2`。每个 artifact 都有 `artifact-manifest.json`，记录合同 hash、文件字节数与 SHA-256、运行时闭包、动态目标及外部依赖。根 manifest 同时覆盖嵌套 manifest。

现有三个 assembler 和原有 required-file、closure、boot gate 保留：

- `generateOutfit`：`stageGenerateOutfit()`。
- `recommendationStream`：`stageRecommendationStream()`，从 canonical `generateOutfit` 生成嵌套副本。
- `processUploadImage`：`stageProcessUploadImage()`，包含 wardrobeAssetPipeline、thumbnail、segmentationIntegrity 和 garment-assets。

其他函数使用通用 builder，从 index 递归收集本地依赖及 manifest 额外文件。`confirmClothesDrafts` 明确要求 wardrobeCapacity/capacityGate 等文件；`cleanupDeletedClothes/config.json` 保留在包内。

嵌套 drift 检查覆盖整个 runtime/vendor，不再仅检查两个 renderer。即使旧副本自行重算 manifest，也无法通过 canonical source 核对。

Vendor 仅复制 workspace package 的 package.json 和 src，排除测试、缓存和日志。workspace 引用仅在 artifact 元数据中转换为已有合同的 `file:vendor/...`，源码 package.json 保持 `workspace:*`。

## 动态依赖

TypeScript AST 扫描 require、require.resolve、module.require、动态 import 和静态 import/export，不把注释误判为依赖，一次列出全部缺失边。动态表达式必须匹配 manifest 中的 importer、表达式和有限目标；未声明表达式、缺文件、未声明外部包、失效声明都 FAIL。

| 使用方 | 动态表达式 | 目标 |
| --- | --- | --- |
| generateOutfit/services/deployPackageResolver.js | packageName | @d1d/ai-core、@d1d/garment-assets |
| 同上 | vendorParts.join('/') | ../vendor/ai-core、../vendor/garment-assets |
| recommendationStream/generateOutfit | 继承上述声明 | 嵌套 artifact 内的同一组目标 |
| processUploadImage/shared/thumbnail.js | 数组 join 后 require | ../vendor/garment-assets |
| backfillClothesThumbnails/shared/thumbnail.js | 数组 join 后 require | ../vendor/garment-assets |

loadDeployPackage 的调用点和字面量实参也受校验。

## 隔离启动边界

Artifact 复制到独立临时目录，在全新 Node 子进程中加载；清空 NODE_PATH，不携带 workspace 或远端 node_modules。禁用 workspace 包别名以强制验证 vendor fallback，同时加载延迟模块和有限动态目标。事件函数必须导出 main，HTTP wrapper 必须导出 handler；实验 HTTP server 仅记录 listen，不打开端口。

这是模块加载和闭包验证。SDK 初始化使用明确 stub，业务 handler 不调用，外部网络请求被拦截，不代表业务 E2E 或真人 smoke。远端另行检查实际安装的第三方依赖是否能在 artifact 内解析，避免 stub 掩盖缺少安装依赖。

## 命令与证据

```bash
# 全部 cloudfunctions 的本地 dry-run
pnpm cloud:deploy:audit --output artifacts/cloudbase-v2-audit

# 同时下载迁移前远端包，列出全部缺失文件和差异
pnpm cloud:deploy:audit --remote --output artifacts/cloudbase-v2-baseline

# 复用已下载快照，只读重算报告
pnpm cloud:deploy:audit --remote-from artifacts/cloudbase-v2-baseline/before --output artifacts/cloudbase-v2-recheck

# 选定生产函数的本地 preflight，不访问云端
pnpm cloud:deploy all --dry-run --output artifacts/cloudbase-v2-preflight

# 全量生产部署，并保存下载包和 remote verify 结果
pnpm cloud:deploy all --output artifacts/cloudbase-v2-release

# 重新生成 canonical 包并下载现有远端包复验，不上传
pnpm cloud:deploy all --verify-only --output artifacts/cloudbase-v2-verify

pnpm cloud:deploy:test
pnpm cloud:deploy:lint
```

输出目录的 staged 子目录必须为空，避免覆盖证据。audit.json 包含每个函数的完整 missingFiles、changedFiles、markerOnlyFiles、contentDriftFiles、dynamicDependencies 与 externalDependencies。preflight.json 和 deployment-report.json 记录本地/远端 gate、manifest hash 与验证时间。失败保存 `complete: false`、已验证项和失败位置。证据存放于 Git 忽略的 artifacts，不提交下载包、日志或构建产物。

底层从 artifact 根目录执行 `tcb fn code update <name> --dir . --deployMode cos`。CloudBase CLI 3.8.1 代码更新会安装 package.json 依赖；代码更新保留已有运行时、超时、内存、环境变量和触发器配置。上传返回后等待 Active 再下载，因为上传成功时依赖安装可能仍在进行。

只有全部选定函数的 remote verify PASS，才输出 DEPLOYMENT_SUCCESS。CLI 上传成功、Active 或本地测试成功都不能替代远端验收。

旧 PowerShell wrapper 继续转发 canonical command；deployment-contract-lite.js 的兼容清单覆盖全部函数，正式审计使用 cloud:deploy:audit。禁止微信 DevTools Deploy/inc-deploy、从 source directory 上传、手工复制 runtime/services/vendor、只上传不下载校验。

本次迁移不修改业务逻辑、推荐算法和 AI prompt，不进行真人 smoke。
