// ============================================================
// 搭一搭 · 穿搭 API 端点函数
// ============================================================

import type {
  Outfit,
  OutfitHistory,
  HistoryStats,
  RecommendRequest,
  RecommendResponse,
  ApiResponse,
  SceneTag,
  TimeOfDay,
} from '@starter-template/types';
import { apiClient } from './client';

// ── 推荐相关 ─────────────────────────────────────────────────

/** 获取穿搭推荐 */
export async function getRecommend(params: RecommendRequest) {
  return apiClient.post<RecommendResponse>('/outfits/recommend', params);
}

/** 刷新推荐（换一套） */
export async function refreshRecommend(params: RecommendRequest) {
  // 与 getRecommend 相同，但前端可以添加不同逻辑（如排除已推荐）
  return apiClient.post<RecommendResponse>('/outfits/recommend', params);
}

// ── 穿搭 CRUD ────────────────────────────────────────────────

export interface GetOutfitListParams {
  scene?: SceneTag;
  isFavorite?: boolean;
  page?: number;
  pageSize?: number;
}

/** 获取穿搭列表 */
export async function getOutfitList(params: GetOutfitListParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.scene) searchParams.set('scene', params.scene);
  if (params.isFavorite !== undefined) searchParams.set('isFavorite', String(params.isFavorite));
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));

  const query = searchParams.toString();
  return apiClient.get<{
    list: Outfit[];
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }>(`/outfits${query ? `?${query}` : ''}`);
}

/** 获取穿搭详情 */
export async function getOutfitDetail(id: string) {
  return apiClient.get<Outfit>(`/outfits/${id}`);
}

/** 更新穿搭信息（收藏/标题） */
export async function updateOutfit(id: string, data: { title?: string; isFavorite?: boolean }) {
  return apiClient.put<{ id: string; isFavorite: boolean | null }>(`/outfits/${id}`, data);
}

/** 删除穿搭 */
export async function deleteOutfit(id: string) {
  return apiClient.delete<{ id: string }>(`/outfits/${id}`);
}

/** 切换收藏状态 */
export async function toggleOutfitFavorite(id: string, isFavorite: boolean) {
  return updateOutfit(id, { isFavorite });
}

// ── 穿着确认 ─────────────────────────────────────────────────

export interface ConfirmWearParams {
  date?: string;
  timeOfDay?: TimeOfDay;
  scene?: SceneTag;
  weatherSnapshot?: Record<string, unknown>;
  notes?: string;
}

/** 确认穿着此搭配 */
export async function confirmWear(outfitId: string, params: ConfirmWearParams = {}) {
  return apiClient.post<OutfitHistory>(`/outfits/${outfitId}/wear`, params);
}

// ── 穿搭历史 ─────────────────────────────────────────────────

export interface GetHistoryListParams {
  startDate?: string;
  endDate?: string;
  page?: number;
  pageSize?: number;
}

/** 获取穿搭历史列表 */
export async function getHistoryList(params: GetHistoryListParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.startDate) searchParams.set('startDate', params.startDate);
  if (params.endDate) searchParams.set('endDate', params.endDate);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));

  const query = searchParams.toString();
  return apiClient.get<{
    list: OutfitHistory[];
    stats: HistoryStats;
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }>(`/outfit-history${query ? `?${query}` : ''}`);
}

/** 评价历史（满意度） */
export async function rateHistory(historyId: string, satisfaction: number, notes?: string) {
  return apiClient.put<OutfitHistory>(`/outfit-history/${historyId}`, {
    satisfaction,
    notes,
  });
}

/** 获取穿搭统计 */
export async function getHistoryStats() {
  // getHistoryList 已经返回 stats，但为了语义清晰单独导出
  const data = await getHistoryList({ page: 1, pageSize: 1 });
  return data.stats;
}
