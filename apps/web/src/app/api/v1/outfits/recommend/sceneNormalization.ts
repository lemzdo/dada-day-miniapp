// ============================================================
// 穿搭推荐 · 场景归一化
// 纯解析模块：无副作用，无 Next/React 依赖，可被 route handler 与测试共同导入。
// ============================================================

import type { SceneTag } from '@starter-template/types';

// 复用项目现有归一化逻辑：与 cloudfunctions/generateOutfit/services/sceneEligibilityV3.js
// 的 normalizeScene 保持映射表一致；SCENE_KEY_TO_TAG 与 apps/miniapp/src/pages/today/index.tsx
// 的 SCENE_TAGS 保持一致。不另立第三套场景映射。
//
// 与 cloud function 的差异：未知非空场景值在此返回 { valid: false }，调用方应返回
// HTTP 400 INVALID_SCENE，而非静默回退到 home；仅请求确实缺失场景时才使用既有默认值。

export type RecommendSceneKey = 'home' | 'work' | 'date' | 'sport';

export const SCENE_KEY_TO_TAG: Record<RecommendSceneKey, SceneTag> = {
  home: '居家',
  work: '上班',
  date: '约会',
  sport: '运动',
};

export interface RecommendSceneResolved {
  valid: true;
  sceneKey: RecommendSceneKey;
  /** 传给 generateRecommendations 的 scene，以及写回响应 body.scene 的 SceneTag */
  sceneTag: SceneTag;
}

export interface RecommendSceneInvalid {
  valid: false;
}

export type RecommendSceneResolution = RecommendSceneResolved | RecommendSceneInvalid;

/**
 * 归一化请求 body.scene：
 * - 缺失/null/空串/纯空白 → 默认 home（sceneTag=居家）
 * - 已知中英文场景词 → home|work|date|sport + 对应 sceneTag
 * - 未知非空值 → { valid: false }，调用方应返回 HTTP 400 INVALID_SCENE
 */
export function resolveRecommendScene(scene: string | undefined | null): RecommendSceneResolution {
  const raw = (scene ?? '').trim().toLowerCase();
  if (!raw) {
    return { valid: true, sceneKey: 'home', sceneTag: SCENE_KEY_TO_TAG.home };
  }
  let key: RecommendSceneKey | null = null;
  if (raw === 'home' || raw === '居家') key = 'home';
  else if (raw === 'work' || raw === '上班' || raw === '通勤' || raw === '正式' || raw === '开会') key = 'work';
  else if (raw === 'date' || raw === '约会') key = 'date';
  else if (raw === 'sport' || raw === 'sports' || raw === '运动') key = 'sport';
  if (!key) return { valid: false };
  return { valid: true, sceneKey: key, sceneTag: SCENE_KEY_TO_TAG[key] };
}
