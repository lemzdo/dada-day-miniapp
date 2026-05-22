// ============================================================
// 字典 API 端点
// ============================================================

import { apiClient } from './client';
import type { CategoryNode, SceneDictItem, StyleDictItem } from '@starter-template/types';

/** 获取衣服分类树 */
export function getCategories() {
  return apiClient.get<CategoryNode[]>('/dict/categories');
}

/** 获取场景列表 */
export function getScenes() {
  return apiClient.get<SceneDictItem[]>('/dict/scenes');
}

/** 获取风格标签列表 */
export function getStyles() {
  return apiClient.get<StyleDictItem[]>('/dict/styles');
}
