# voiceRendererLatencyLab

完全独立的 lab-only 凭据 smoke 函数。Today、`generateOutfit`、生产 Renderer、Recommendation Runtime 和 provider 默认路由均不引用此目录。

本提交是安全的 contract-only 版本：只验证 benchmark event 并检查运行时是否存在 `BAILIAN_API_KEY`（fallback `DASHSCOPE_API_KEY`），不向百炼发起请求、不打印或返回 Key。缺少凭据时返回 `status=failed`、`errorCode=LAB_CREDENTIAL_MISSING`；即使凭据存在，provider call 仍返回 `providerCall=disabled_by_safety_gate`，因此本轮不会发生真实模型调用。

## Event

```json
{
  "caseId": "primary-pattern-focus",
  "model": "flash",
  "promptVariant": "compressed",
  "input": "由 apps/miniapp/scripts/voice-renderer-v2-lab/core.js 的 buildRendererInput 生成的单条 input",
  "execute": false
}
```

`model` 仅允许 `max` / `flash`，映射 `qwen3.7-max` / `qwen3.7-flash`；`promptVariant` 仅允许 `current` / `compressed`；`caseId` 必须是既有 Gold case。正式请求 payload、non-thinking、structured output、validator 仍由现有 lab core/矩阵负责；该函数暂不承担 provider 请求。

## 部署与 smoke

从 miniapp 项目根目录只部署此函数目录：

```bash
cloud functions deploy --env <environment> --paths cloudfunctions/voiceRendererLatencyLab --remote-npm-install --report --project .
```

缺凭据 smoke event 使用上面的 JSON，预期返回：

```json
{
  "benchmarkOnly": true,
  "action": "voiceRendererLatencyLab",
  "status": "failed",
  "errorCode": "LAB_CREDENTIAL_MISSING"
}
```

生产 `generateOutfit` 的函数私有环境变量不会自动复制到新函数。需要在 CloudBase 控制台为本函数手动配置 `BAILIAN_API_KEY` 后，另行实现并审核 provider egress；不要把 Key 发给 Codex。
