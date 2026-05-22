# d1d 当前项目状态

更新时间：2026-05-19

## 技术栈
项目是 `pnpm workspace` monorepo，编排用 `TurboRepo`。Web 端是 `Next.js 15 + React 19 + TailwindCSS v3`，小程序端是 `Taro 4 + React 18 + SCSS + Zustand`。共享层拆成 `packages/types / api / utils / hooks / auth / ai / ui`。数据层使用 `PostgreSQL + Drizzle ORM + postgres.js`。AI 识别已接入 `SiliconFlow`，并保留 `Mock` fallback；`DeepSeek` 目前仍是未完成桩。

## 已完成
衣物上传链路已经跑通：本地文件存储、上传接口、AI 识别、衣物入库都已实现。衣橱管理已具备列表、详情、编辑、自定义字段、归档/删除和容量读取。穿搭链路已有基础：规则推荐引擎、推荐 BFF、推荐结果落库、收藏切换、确认穿着、历史记录和满意度更新接口都已存在，推荐保存已增加基础复用/去重控制。天气与字典接口已经提供，但当前仍是 mock。小程序已有 `today / wardrobe / profile / clothing-detail / clothing-form / outfit-detail / outfit-history / favorite-outfits` 页面，且 `WeatherCard`、`ClothingGrid` 两个组件已可复用。

## 未完成
真实微信 `code2Session` 登录尚未接入，当前登录与鉴权仍是临时 token / mock 逻辑。真实天气 API、天气缓存和推荐侧用户偏好驱动还没完成。`wardrobe-analysis / reminders / share` 等页面与接口仍缺失或未做完整。测试、CI、E2E 也还没有建立。

## 关键目录
`apps/web/src/lib/db/schema.ts` 是数据库模型定义，`apps/web/src/lib/db/repositories/` 是数据访问层。`apps/web/src/app/api/v1/` 放全部 BFF 路由。`apps/web/src/lib/recommend/engine.ts` 是当前穿搭规则引擎。`packages/ai/src/` 放 AI provider。`packages/api/src/` 是前后端共享接口客户端。`apps/miniapp/src/pages/` 是小程序页面，`apps/miniapp/src/components/` 是小程序复用组件。

## 当前风险
最大风险是鉴权不够真实，用户隔离现在依赖临时 token 解析。第二个风险是推荐幂等和“换一套”语义仍处于基础实现阶段，需要继续用真实数据验证边界。第三个风险是天气、AI 分析、分享、提醒都还没有形成稳定生产链路。再往后是页面和接口覆盖不完整，当前主链路能跑，但离完整 MVP 还有空白。

## MVP 下一步优先级
1. 统一登录与鉴权：补真实 `code2Session`，统一 token 注入和校验。
2. 打通今日推荐闭环：完善 `today` 页交互，减少竞态，稳定推荐/收藏/确认穿着。
3. 补齐穿搭详情与历史页：把推荐结果、历史记录和满意度串成完整体验。
4. 接入真实天气并启用缓存。
5. 补测试与 CI，先保住核心链路再扩展分析、分享和提醒。

## 2026-05-19 Development Update

- Added miniapp outfit detail page: `apps/miniapp/src/pages/outfit-detail/`.
- Registered `pages/outfit-detail/index` in miniapp app config.
- Today page outfit cards now navigate to outfit detail while action buttons keep their existing behavior.
- Outfit detail supports independent loading, empty/error fallback, outfit items, weather snapshot, scores, score explanations, favorite toggle, and confirm-wear action.
- Verified with `cmd /c pnpm --filter @starter-template/miniapp typecheck` and `cmd /c pnpm --filter @starter-template/api typecheck`.

## 2026-05-19 Outfit History Update

- Added miniapp outfit history page: `apps/miniapp/src/pages/outfit-history/`.
- Registered `pages/outfit-history/index` in miniapp app config.
- Profile page now links to outfit history.
- Outfit history supports loading, pull-to-refresh, pagination, empty/error fallback, detail navigation, and satisfaction rating updates.
- Verified with `cmd /c pnpm --filter @starter-template/miniapp typecheck` and `cmd /c pnpm --filter @starter-template/api typecheck`.

## 2026-05-19 Profile Data Update

- Profile page now loads real user profile, capacity, clothes count, outfit count, and history-day stats from existing API clients.
- Added pull-to-refresh and partial-failure fallback for profile summary data.
- Kept unfinished entries such as wardrobe analysis and reminders as non-destructive "coming soon" prompts.
- Verified with `cmd /c pnpm --filter @starter-template/miniapp typecheck` and `cmd /c pnpm --filter @starter-template/api typecheck`.

## 2026-05-19 Style Preferences Update

- Added miniapp style preferences page: `apps/miniapp/src/pages/style-preferences/`.
- Registered `pages/style-preferences/index` in miniapp app config.
- Profile page now links to style preferences and refreshes after returning from the preferences page without duplicating the initial request.
- Style preferences page loads style dictionary and current user profile, supports multi-select, and saves `styleProfile.preferredStyles` while preserving other profile fields.
- Verified with `cmd /c pnpm --filter @starter-template/miniapp typecheck` and `cmd /c pnpm --filter @starter-template/api typecheck`.

## 2026-05-19 Favorite Outfits Update

- Added miniapp favorite outfits page: `apps/miniapp/src/pages/favorite-outfits/`.
- Registered `pages/favorite-outfits/index` in miniapp app config.
- Profile page now links to favorite outfits instead of showing a coming-soon prompt.
- Favorite outfits supports loading, pull-to-refresh, pagination, empty/error fallback, detail navigation, and cancel-favorite action.
- Verified with `cmd /c pnpm --filter @starter-template/miniapp typecheck` and `cmd /c pnpm --filter @starter-template/api typecheck`.

## 2026-05-19 Auth Hardening Update

- Added server-signed auth tokens with expiry in `apps/web/src/lib/auth.ts`.
- `wechat-login` now resolves WeChat `code2Session` when `WECHAT_APP_ID` and `WECHAT_APP_SECRET` are configured, with a dev fallback for local/mock codes.
- Miniapp boot now obtains a real `Taro.login()` code before calling the shared login API, and clears invalid stored tokens before retrying login.
- Protected core clothes, outfits, user, and outfit-history routes now return 401 for auth errors instead of falling through as internal errors.
- Outfit and clothing detail reads now enforce owner checks, matching update/delete behavior.
- Verified with `cmd /c pnpm --filter @starter-template/web typecheck`, `cmd /c pnpm --filter @starter-template/miniapp typecheck`, and `cmd /c pnpm --filter @starter-template/api typecheck`.

## 2026-05-19 Today Loop Stability Update

- Hardened `apps/miniapp/src/pages/today/` request sequencing so scene changes and refreshes do not overwrite newer recommendations.
- Split page loading from outfit operations, with independent busy states for refresh, favorite, and confirm-wear actions.
- Today page now syncs the current outfit after returning from detail, keeping favorite and worn-today state fresh.
- Confirm-wear now sends outfit scene, time of day, and weather snapshot when available.
- Added visible retry/error feedback and disabled action styling.
- Verified with `cmd /c pnpm --filter @starter-template/miniapp typecheck` and `cmd /c pnpm --filter @starter-template/api typecheck`.

## 2026-05-19 Weather Cache Update

- Added `apps/web/src/lib/db/repositories/weather.ts` for valid-cache reads and upserts against the existing `weather_cache` table.
- Added `apps/web/src/lib/weather/service.ts` with current weather, forecast, and outfit weather snapshot helpers.
- Weather routes now use the cache service instead of inline mock constants.
- Recommendation generation now stores weather snapshots from the same cache-backed service used by the weather API.
- `QWEATHER_API_KEY` enables live QWeather calls; missing keys or provider failures fall back to stable mock data and still populate cache.
- Verified with `cmd /c pnpm --filter @starter-template/web typecheck`, `cmd /c pnpm --filter @starter-template/api typecheck`, and `cmd /c pnpm --filter @starter-template/miniapp typecheck`.

## 2026-05-19 Core Tests Update

- Added a lightweight `@starter-template/web` test script using Node `node:test` with an esbuild bundle step, avoiding new test dependencies.
- Added auth tests for signed token validation, tamper rejection, and legacy dev-token compatibility.
- Refactored weather service with `createWeatherService` dependency injection so cache/provider behavior can be tested without a database or network.
- Added weather tests for cache hits, fallback cache writes, and QWeather forecast response mapping.
- Added `.test` to `.gitignore` for bundled test output.
- Verified with `cmd /c pnpm --filter @starter-template/web test`, `cmd /c pnpm --filter @starter-template/web typecheck`, `cmd /c pnpm --filter @starter-template/api typecheck`, and `cmd /c pnpm --filter @starter-template/miniapp typecheck`.

## 2026-05-19 Quality Gate Update

- Added root `test` script backed by Turbo so package-level tests can run through `cmd /c pnpm test`.
- Added root `verify` script: `pnpm typecheck && pnpm lint && pnpm test`.
- Added Turbo `test` task with empty outputs and preserved existing typecheck/lint tasks.
- Added `.test` to ESLint and Prettier ignore lists so bundled test artifacts do not pollute checks.
- Verified with `cmd /c pnpm test` and full `cmd /c pnpm verify`.
- Current full lint passes with warnings only; warning cleanup remains a follow-up engineering hygiene task.
