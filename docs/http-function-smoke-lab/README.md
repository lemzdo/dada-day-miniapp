# httpFunctionSmokeLab（仅控制实验）

这是独立的 CloudBase HTTP Function control，不导入或修改
`recommendationTransportLab`，不接入 Recommendation Runtime、数据库、Qwen 或生产入口。

部署目标：环境 `cloud1-d8gl3k1vkdf0b7f05`，函数名 `httpFunctionSmokeLab`，使用官方
`tcb fn deploy --httpFn`，timeout 至少 10 秒。函数行为：

- `GET /`：`200 HTTP_SMOKE_OK`
- `GET /sse`：`text/event-stream`，立即 `hello`，约 500ms `half`，约 1600ms `late`，约 3100ms `complete` 后关闭连接
- 其他路径/方法：404

## ROOT 人工门禁

仅在 Root 真人环境执行：

```js
wx.cloud.callHTTPFunction({
  name: 'httpFunctionSmokeLab',
  config: { env: 'cloud1-d8gl3k1vkdf0b7f05' },
  path: '/',
  method: 'GET',
  success: console.log,
  fail: console.error,
});
```

本轮只负责部署就绪，不宣称 name-based HTTP Function 已被真人验证；SSE 测试代码必须等
Root 对 `/` 的 name-based 调用成功后再准备。

## 当前事实

```text
SSE_TEST_READY=DEPLOYMENT_READY_ROOT_GATE_REQUIRED
HUMAN_RETEST_REQUIRED=yes
```
