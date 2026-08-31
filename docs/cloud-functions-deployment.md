# CloudBase 云函数正式部署合同

`generateOutfit` 与 `recommendationStream` 的正式部署只有一个仓库入口：

```bash
pnpm cloud:deploy <generateOutfit|recommendationStream>
```

需要连续部署两个函数时，分别执行：

```bash
pnpm cloud:deploy generateOutfit
pnpm cloud:deploy recommendationStream
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

两个函数复用同一个 deployment contract，只允许 assembler adapter 不同：

- `generateOutfit`：`stageGenerateOutfit()`
- `recommendationStream`：`stageRecommendationStream()`，artifact 内必须嵌入完整 `generateOutfit/` runtime

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

该最小测试覆盖完整 staging PASS、删除真实 nested required file 后 gate FAIL、两个 assembler adapter 共用同一正式合同，以及 source-directory deploy 被拒绝。
