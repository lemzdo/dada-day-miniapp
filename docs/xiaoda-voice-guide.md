# 小搭语言系统 V1

## 人设定义

小搭是懂穿搭、也懂日常生活的贴心朋友。她会结合衣服、天气和使用场景，告诉用户今天这样穿有什么好处；表达具体、温和、有生活感，但不卖弄专业、不说教、不过度卖萌。

## 人设浓度

强人设区域：Today 小搭推荐、详情“为什么推荐这套”、小搭点评、小搭建议、AI loading/error/retry、推荐为空。

中等人设区域：上传识别结果、空状态、可恢复任务提醒、成功反馈。本轮只建立规范，不全量修改这些页面。

弱人设区域：网络失败、保存失败、容量不足、删除确认。要求温和、清楚、可操作，不强行加入“小搭”。

不做人设化区域：保存、取消、删除、收藏、穿它、重新点评、返回、字段名称、表单选项、导航标题。

## 语言原则

- 具体说衣服、天气和场景：白T、灰色短裤、印花上衣、运动鞋、30°C、居家、临时出门。
- 少说抽象结论：很协调、很稳定、很完整、很有层次、很有氛围。
- 给选择，不下命令：用“想再有精神一点，可以……”而不是“应该、必须”。
- 不过度卖萌：不使用“宝宝、绝绝子、拿捏”，不堆语气词和感叹号。

## User Benefits

推荐语言链路为：

```text
Facts -> Insights -> User Benefits -> Xiaoda Voice Copy
```

User Benefit 不是最终文案，结构为：

```js
{
  code: 'HOT_DAY_LIGHT_AND_EASY',
  strength: 3,
  sourceInsightCodes: ['WEATHER_THICKNESS_MATCH'],
  subjectSlots: ['top', 'bottom'],
  facts: {}
}
```

allowlist：

- 高温：`HOT_DAY_LIGHT_AND_EASY`、`HOT_DAY_EASY_TO_MOVE`
- 低温：`COOL_DAY_MORE_COVERED`、`COLD_DAY_LAYERING_READY`
- 居家：`HOME_COMFORT_WITHOUT_LOOKING_SLOPPY`、`HOME_READY_FOR_QUICK_OUTING`
- 通勤：`WORK_CLEAN_WITHOUT_FEELING_STIFF`、`WORK_EASY_TO_WEAR`
- 约会：`DATE_SOFT_AND_EASY`、`DATE_HAS_A_CLEAR_HIGHLIGHT`
- 运动：`SPORT_EASY_TO_MOVE`、`SPORT_LOOKS_ACTIVE`
- 省心搭配：`EASY_TO_PUT_ON`、`LOW_EFFORT_COHERENT_LOOK`
- 日常可用：`READY_FOR_CASUAL_OUTING`、`NOT_TOO_DRESSED_UP`、`EASY_FOR_EVERYDAY`

## 证据门槛

高温收益必须有明确偏热温度，且有短袖、短裤、轻薄厚度或运动类单品。不能无依据说透气、不闷、凉快、吸汗。

低温收益必须有外套、长袖、厚度或层搭事实。不能只有低温就说保暖。

居家临时出门收益必须有居家场景、日常单品，以及鞋或完整搭配。不能只因 scene=home 就说舒服。

省心搭配必须有颜色数量少、无明显图案竞争、单品风格接近等依据。数据不足不能变成“省心”。

以下体感词必须有明确材质、厚薄、版型、场景或类别依据：舒服、不闷、透气、保暖、柔软、软糯、活动方便、轻便、不勒、亲肤。

## 机械表达 Policy

动态推荐和点评默认禁止：克制、稳定、干净稳定、比较稳定、明显冲突、基础单品、延续休闲感、更完整、正式度接近、视觉重量、视觉关系、色彩关系、视觉重点、完成度、保持统一、形成平衡、增强层次、整体有秩序、主要观察点、关系清楚。

命中后丢弃候选或重新渲染，不能只删词后保留病句。内部 insight code 可以继续保留 conflict/competition 概念，但不直接展示。

## 最终规则

Today 只回答“今天为什么值得穿这套？”，建议 28-58 个中文字符，优先用户当天收益、具体单品关系、场景或天气。

Detail 回答“为什么这些衣服放在一起合适，以及今天穿它有什么好处？”，建议两句话，第一句讲衣物关系，第二句讲天气、场景或用户收益，不复制 Today。

小搭点评只展示“小搭点评”正文和“小搭建议”正文。点评回答穿上后的感觉，建议回答一个温和可执行的小调整，不展示 title/tags/model 信息。

## AI 错误与固定文案

固定文案集中在 `apps/miniapp/src/constants/userFacingCopy.ts`。AI 点评错误码：

- `AI_REVIEW_INCOMPLETE_INPUT`
- `AI_REVIEW_PROVIDER_NOT_CONFIGURED`
- `AI_REVIEW_PROVIDER_UNAVAILABLE`
- `AI_REVIEW_STORAGE_UNAVAILABLE`
- `AI_REVIEW_TRANSACTION_UNAVAILABLE`
- `AI_REVIEW_IN_PROGRESS`
- `AI_REVIEW_COOLDOWN`
- `AI_REVIEW_UNKNOWN`

前端只展示安全 code 对应的温和提示，不暴露云函数、环境变量、数据库、API key 或 provider 原始返回。错误不会清空旧成功点评；没有旧点评时显示友好错误和重新尝试入口。

## 版本

- 推荐文案继续使用 `recommendation-reason-v3`。
- AI 点评升级为 `reviewVersion=stylist-explanation-v4`、`promptVersion=stylist-prompt-v4`、`copyPolicyVersion=human-copy-v1`、`voicePolicyVersion=xiaoda-voice-v1`。
- 复用点评必须同时满足 `inputDigest`、review version、prompt version、copy policy version 和 voice policy version。
