# recommendationTransportLab（仅实验）

本目录记录搭搭 Day 推荐首卡的 HTTP/SSE transport spike。函数代码位于
`apps/miniapp/cloudfunctions/recommendationTransportLab`，只能作为 CloudBase **Web
Function** 部署，函数名建议固定为 `recommendationTransportLab`。

它只发送四个定时 SSE 事件（约 50/500/1500/3000ms）和 `complete`，不导入
`generateOutfit`，不调用 Qwen，不写数据库、不写 cache，也不接入 Today 或 P1-P3。

## 官方能力核验（仅腾讯官方资料）

- [CloudBase HTTP 云函数调用方式](https://docs.cloudbase.net/cloud-function/function-calls/)
  明确支持小程序 `wx.cloud.callHTTPFunction`；基础库要求为 **3.15.1 及以上**，因此
  当前项目 `project.config.json` 的 **3.16.0** 满足要求。
- 同一文档明确 `enableChunked: true` 开启流式传输，并以 `onHeadersReceived` 和
  `onChunkedReceived` 接收响应头/二进制 chunk；SSE 服务端应返回
  `text/event-stream`，并在客户端自行按 SSE 分隔符解析 chunk。
- [SCF SSE 协议支持](https://cloud.tencent.com/document/product/583/90617)
  说明 SSE 默认支持，且一次 SSE 连接生命周期等同于一次函数调用；函数实例与连接
  一一对应。正常完成应由服务端结束响应，客户端关闭则服务端应清理定时器并停止写入。
- [SCF 函数概述](https://cloud.tencent.com/document/product/583/19805) 与
  [创建函数 API](https://cloud.tencent.com/document/product/583/18586) 均说明执行超时
  默认 **3 秒**、可配置 **1-900 秒**。因此 3000ms 事件不能用默认值作结论；实验部署须
  把执行超时提高到至少 10 秒。`callHTTPFunction` 的 `timeout` 是客户端等待参数，不能
  代替服务端函数执行超时，官方资料未将二者混为同一语义。
- [CloudBase 小程序调用说明](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
  说明 `cloud.getWXContext()` 的 `OPENID/APPID/UNIONID` 由基础库全链路透传，不能由请求
  字段伪造；[CloudBase usage flow](https://docs.cloudbase.net/en/integration/usage) 说明
  `callHTTPFunction` 会自动注入 `x-wx-openid`/`x-wx-appid`，无需额外 token。实验不把
  身份写入事件 payload，仅记录是否存在身份头即可。

## 小程序侧最小调用片段（不接生产入口）

```js
const startedAt = Date.now();
const marks = { requestSent: startedAt };
let buffer = '';

wx.cloud.callHTTPFunction({
  name: 'recommendationTransportLab',
  path: '/sse',
  method: 'GET',
  timeout: 10000,
  enableChunked: true,
  onHeadersReceived(res) {
    marks.headers = Date.now();
  },
  onChunkedReceived(res) {
    marks.firstChunk ??= Date.now();
    // Decode res.data as UTF-8, append to buffer, then parse complete \n\n frames.
  },
  success() {
    marks.completed = Date.now();
    console.log({ marks, elapsed: Date.now() - startedAt });
  },
  fail(error) {
    console.error({ marks, error });
  },
});
```

## 部署与 stop-loss

1. 在微信开发者工具打开 `apps/miniapp`，确认基础库 3.16.0 与 CloudBase 环境。
2. 将 `recommendationTransportLab` 作为 **Web Function** 部署，开启 HTTP 访问，执行超时
   设置至少 10 秒；不要把它部署为现有事件函数。
3. 用上面的片段仅在实验页面/控制台执行，记录 headers、first chunk、四个目标事件、
   complete、断连/错误。
4. 允许一个明确的基础设施修复并 retry 一次；第二次仍被 DevTools/CloudBase transport
   阻塞，记录 `TRANSPORT_SPIKE_BLOCKED` 并停止工具治理。

## 当前结果

截至本记录提交时，仓库已准备好 lab-only Web Function 与测量片段；当前会话没有可控的
微信开发者工具窗口/真实 CloudBase 部署凭据，因此未宣称真实 spike 成功：

```text
SSE_SPIKE_DEPLOYED=false
SSE_CONNECTION_STABLE=UNMEASURED
SSE_3S_EVENT_RECEIVED=UNMEASURED
SSE_CONNECT_MS=UNMEASURED
SSE_FIRST_EVENT_MS=UNMEASURED
BLOCKERS=TRANSPORT_SPIKE_BLOCKED (DevTools/CloudBase live execution unavailable)
```

本实验不改变生产 transport、Today、Recommendation Runtime、P1-P3、cache、prompt 或
model。
