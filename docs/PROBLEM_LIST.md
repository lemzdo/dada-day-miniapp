# PROBLEM_LIST.md - 搭搭 day 当前存在的问题

> 最后更新：2026-05-22  
> 用途：记录还未解决的问题。



- 穿搭需要可以自定义名称并展示，不然全叫 居家简约搭配等，用户自己也分不清哪套是哪套了 --待开发
- 整体数据加载还是很慢--待优化
- 图片经常加载不出来或者加载比较慢，穿搭的图片，穿搭详情的图片，衣柜的图片，衣服详情的图片等
- 多个场景同一套穿搭，不会共享收藏和穿他标志。重新生成穿搭，刷到同一套了也不会显示收藏和穿搭标志。刷来刷去都是那三套，没变化的，是衣服太少了？
- 一双鞋，会识别为两只鞋。还会有重复识别的现象







衣服上传流程：

上传图片
  ↓
创建 batch / sourceImage
  ↓
图片预处理
  ↓
Image Router
  ├─ 真人/模特穿着图
  │    ↓
  │  aitryon-parsing-v1 解析上衣/下装/裙子
  │    ↓ 失败
  │  VL bbox 兜底
  │    ↓
  │  配饰用 VL bbox 补充
  │
  └─ 非真人图
       ↓
     VL bbox 检测多件衣服/鞋包
       ↓
     bbox 失败则整图兜底 needs_review

统一进入：
  ↓
每件 item 单独 crop
  ↓
按品类调用 SegmentCloth / 商品分割
  ↓
生成 cleanImageUrl，失败则用 cropImageUrl
  ↓
基于 clean/crop 做属性识别
  ↓
qualityScore
  ↓
ready / needs_review / failed
  ↓
生成草稿
  ↓
用户确认
  ↓
保存正式衣柜