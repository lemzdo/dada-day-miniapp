# voiceRendererLatencyLab

完全独立的 lab-only 凭据 smoke 函数。Today、`generateOutfit`、生产 Renderer、Recommendation Runtime 和 provider 默认路由均不引用此目录。

函数已具备后续真实 benchmark 能力，但本轮不执行真实调用。它只从 `BAILIAN_API_KEY`（fallback `DASHSCOPE_API_KEY`）读取运行时凭据；缺少凭据时在网络请求前返回 `LAB_CREDENTIAL_MISSING`。只有显式 `execute:true` 才会调用 DashScope compatible endpoint；请求固定 non-thinking、structured output、模型白名单和 prompt，响应经 JSON contract 与 validator 后只返回脱敏统计字段，绝不返回或记录 Key。

## Event

```json
{
  "caseId": "primary-pattern-focus",
  "model": "flash",
  "promptVariant": "compressed",
  "input": "由 apps/miniapp/scripts/voice-renderer-v2-lab/core.js 的 buildRendererInput 生成的单条 input",
  "execute": true
}
```

`model` 仅允许 `max` / `flash`，映射 `qwen3.7-max` / `qwen3.7-flash`；`promptVariant` 仅允许 `current` / `compressed` / `compressed-v2`；`caseId` 必须是既有 Gold case。`execute:false` 只做凭据/契约 ready 检查；真实 benchmark 才使用 `execute:true`。

CloudBase 可能自动注入 `tcbContext` / `userInfo`；函数只允许并忽略这两个平台字段，不把它们传给模型或返回客户端。

## 部署与 smoke

从 miniapp 项目根目录只部署此函数目录：

```bash
cloud functions deploy --env <environment> --paths cloudfunctions/voiceRendererLatencyLab --remote-npm-install --report --project .
```

缺凭据 smoke event 使用 `execute:false` 的 JSON，预期返回：

```json
{
  "benchmarkOnly": true,
  "action": "voiceRendererLatencyLab",
  "status": "failed",
  "errorCode": "LAB_CREDENTIAL_MISSING"
}
```

生产 `generateOutfit` 的函数私有环境变量不会自动复制到新函数。需要在 CloudBase 控制台为本函数手动配置 `BAILIAN_API_KEY` 后再显式执行 benchmark；不要把 Key 发给 Codex。
