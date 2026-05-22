// ============================================================
// 搭一搭 · 衣服 API 端点函数
// ============================================================

import type {
  Clothing,
  ClothingCategory,
  ClothingUpdateInput,
  PaginatedResult,
} from '@starter-template/types';
import { apiClient } from './client';

// ── 列表查询 ─────────────────────────────────────────────────

export interface GetClothesListParams {
  category?: ClothingCategory;
  status?: 'active' | 'archived';
  page?: number;
  pageSize?: number;
}

/** 获取衣服列表（分页） */
export async function getClothesList(params: GetClothesListParams = {}) {
  const searchParams = new URLSearchParams();
  if (params.category) searchParams.set('category', params.category);
  if (params.status) searchParams.set('status', params.status);
  if (params.page) searchParams.set('page', String(params.page));
  if (params.pageSize) searchParams.set('pageSize', String(params.pageSize));

  const query = searchParams.toString();
  return apiClient.get<{
    list: Clothing[];
    pagination: {
      total: number;
      page: number;
      pageSize: number;
      totalPages: number;
    };
  }>(`/clothes${query ? `?${query}` : ''}`);
}

// ── 单件操作 ─────────────────────────────────────────────────

/** 获取衣服详情 */
export async function getClothingById(id: string) {
  return apiClient.get<Clothing>(`/clothes/${id}`);
}

/** 创建衣服（上传） */
export async function createClothing(formData: FormData) {
  return apiClient.post<Clothing>('/clothes', formData, {
    headers: {
      // 不要手动设置 Content-Type，让浏览器自动设置 boundary
    },
  });
}

/** 更新衣服信息 */
export async function updateClothing(id: string, data: ClothingUpdateInput) {
  return apiClient.put<Clothing>(`/clothes/${id}`, data);
}

/** 删除衣服（软删除/归档） */
export async function deleteClothing(id: string) {
  return apiClient.delete<{ id: string }>(`/clothes/${id}`);
}

// ── 批量操作（预留）──────────────────────────────────────────

/** 批量获取衣服（用于穿搭组合） */
export async function getClothingByIds(ids: string[]) {
  // 如果后端支持批量查询，可以改为 /clothes/batch?ids=...
  // 目前用 Promise.all 并行请求
  const results = await Promise.all(
    ids.map((id) => getClothingById(id).catch(() => null)),
  );
  return results.filter((r): r is NonNullable<typeof r> => r !== null);
}
