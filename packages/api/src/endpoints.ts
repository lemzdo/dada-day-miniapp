import type { PaginatedResult, User } from '@starter-template/types';
import { apiClient } from './client';

/** 获取用户列表 */
export function getUsers(page = 1, pageSize = 10) {
  return apiClient.get<PaginatedResult<User>>(`/users?page=${page}&pageSize=${pageSize}`);
}

/** 获取用户详情 */
export function getUserById(id: string) {
  return apiClient.get<User>(`/users/${id}`);
}

/** 创建用户 */
export function createUser(data: Partial<User>) {
  return apiClient.post<User>('/users', data);
}

/** 更新用户 */
export function updateUser(id: string, data: Partial<User>) {
  return apiClient.put<User>(`/users/${id}`, data);
}

/** 删除用户 */
export function deleteUser(id: string) {
  return apiClient.delete<void>(`/users/${id}`);
}
