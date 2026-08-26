# recommendationTransportLab（仅实验）

本目录记录搭搭 Day 推荐首卡的 HTTP/SSE transport spike。函数代码位于
`apps/miniapp/cloudfunctions/recommendationTransportLab`，只能作为 CloudBase **Web
Function** 部署，函数名建议固定为 `recommendationTransportLab`。

它只发送四个定时 SSE 事件（约 50/500/1500/3000ms）和 `complete`，不导入
`generateOutfit`，不调用 Qwen，不写数据库、不写 cache，也不接入 Today 或 P1-P3。

## 官方能力核验（仅腾讯官方资料）

- [CloudBase HTTP 云函数调用方式](https://docs.cloudbase.net/cloud-function/function-calls/)
  明确支持小程序 `wx.cloud.callHTTPFunction`，该页写基础库要求为 **3.15.1 及以上**；
  另一篇官方 [CloudBase 使用流程](https://docs.cloudbase.net/integration/usage) 写的是
  **3.15.2 及以上**。官方资料存在一个 patch 版本差异，但当前项目
  `project.config.json` 与 `project.private.config.json` 均为 **3.16.0**，满足两者。
- 同一文档明确 `enableChunked: true` 开启流式传输，并以 `onHeadersReceived` 和
  `onChunkedReceived` 接收响应头/二进制 chunk；SSE 服务端应返回
  `text/event-stream`，并在客户端自行按 SSE 分隔符解析 chunk。
- [SCF SSE 协议支持](https://cloud.tencent.com/document/product/583/90617)
  说明 SSE 默认支持，且一次 SSE 连接生命周期等同于一次函数调用；函数实例与连接
  一一对应。正常完成应由服务端结束响应，客户端关闭则服务端应清理定时器并停止写入。
- [SCF 函数概述](https://cloud.tencent.com/document/product/583/19805) 与
  [创建函数 API](https://cloud.tencent.com/document/product/583/18586) 均说明执行超时
  默认 **3 秒**、可配置 **1-900 秒**。因此 3000ms 事件不能用默认值作结论；实验部署须
  把执行超时提高到至少 10 秒。`callHTTPFunction` 页同时给出 SSE 长连接示例，并在参数表
  把客户端 `timeout` 描述为“小于 1500ms”；官方资料没有解释该限制对 1-3 秒 SSE 的真实
  计时边界，也没有说明它是只约束建连、首 chunk 还是整段连接。该疑点必须由真实 spike
  解决，本记录不推断其语义，也不把服务端函数执行超时与客户端 `timeout` 混为一谈。
- [CloudBase 小程序调用说明](https://docs.cloudbase.net/recipes/add-cloud-function-wechat-miniprogram)
  说明 `cloud.getWXContext()` 的 `OPENID/APPID/UNIONID` 由基础库全链路透传，不能由请求
  字段伪造；[CloudBase usage flow](https://docs.cloudbase.net/integration/usage) 说明
  `callHTTPFunction` 会自动注入 `x-wx-openid`/`x-wx-appid`，无需额外 token。实验不把
  身份写入事件 payload，仅记录是否存在身份头即可。

## 小程序 Console 测试代码（不接生产入口）

```js
const requestStartedAt = Date.now();
const marks = { requestStartedAt };
console.log('requestStartedAt', requestStartedAt);
let buffer = '';
const decoder = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;

function decodeChunk(arrayBuffer) {
  if (decoder) return decoder.decode(arrayBuffer, { stream: true });
  const bytes = new Uint8Array(arrayBuffer);
  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
  try { return decodeURIComponent(escape(binary)); } catch (_) { return binary; }
}

function consumeFrames(text) {
  buffer += text;
  const frames = buffer.split(/\r?\n\r?\n/);
  buffer = frames.pop() || '';
  frames.filter(Boolean).forEach((frame) => {
    const elapsed = Date.now() - requestStartedAt;
    console.log('sse.frame', { text: frame, elapsed });
    if (frame.includes('event: complete')) console.log('complete', { elapsed });
  });
}

wx.cloud.callHTTPFunction({
  name: 'recommendationTransportLab',
  path: '/sse',
  method: 'GET',
  enableChunked: true,
  onHeadersReceived(res) {
    marks.headersAt = Date.now();
    marks.headersElapsed = marks.headersAt - requestStartedAt;
    console.log('headers', { res, elapsed: marks.headersElapsed });
  },
  onChunkedReceived(res) {
    marks.firstChunkAt ??= Date.now();
    marks.firstChunkElapsed ??= marks.firstChunkAt - requestStartedAt;
    consumeFrames(decodeChunk(res.data));
  },
  success() {
    console.log('success', { marks, elapsed: Date.now() - requestStartedAt });
  },
  complete(res) {
    console.log('complete', { res, marks, elapsed: Date.now() - requestStartedAt });
  },
  fail(error) {
    console.error('fail', { marks, error, elapsed: Date.now() - requestStartedAt });
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

本地 loopback 只验证 lab handler 确实按顺序分帧、保持连接并正常结束，不代表 CloudBase 或
微信链路性能。最终复验为 HTTP 200、headers 约 85ms，四个 chunk 约
`86/532/1543/3036ms`，约 3083ms 正常完成；另一轮在第二个 chunk 后主动 abort，客户端约
546ms 收到 `AbortError`，服务端连接关闭清理路径未继续写入。

CloudBase CLI 已将函数部署到环境 `cloud1-d8gl3k1vkdf0b7f05`，详情确认类型为 HTTP、
Runtime 为 Nodejs20.19、执行超时为 10 秒。CLI 创建了 `/sse` 路由；从当前 shell 直接
请求该 service link 返回网关 `FUNCTIONS_PARAM_INVALID`，尚未取得小程序
`callHTTPFunction` 真实 chunk 结果，因此不宣称 transport spike 成功：

```text
SSE_SPIKE_DEPLOYED=true
LAB_FUNCTION=recommendationTransportLab
HTTP_FUNCTION=https://cloud1-d8gl3k1vkdf0b7f05.service.tcloudbase.com/sse
FUNCTION_TIMEOUT=10s
SSE_CONNECTION_STABLE=UNMEASURED
SSE_3S_EVENT_RECEIVED=UNMEASURED
SSE_CONNECT_MS=UNMEASURED
SSE_FIRST_EVENT_MS=UNMEASURED
BLOCKERS=TRANSPORT_SPIKE_BLOCKED (direct gateway request returned FUNCTIONS_PARAM_INVALID; Console test pending)
```

`AUTH_CONTEXT_AVAILABLE` 目前仅有官方文档证据：小程序调用会注入
`x-wx-openid`/`x-wx-appid`；本轮未在真实 lab 请求中观测这些 header。相同地，服务端正常
结束与客户端断连清理已有官方生命周期说明和本地行为验证，但当前 CloudBase/DevTools
链路的具体错误回调、半途断连和 3 秒 chunk 稳定性仍是 `UNMEASURED`。

本实验不改变生产 transport、Today、Recommendation Runtime、P1-P3、cache、prompt 或
model。
