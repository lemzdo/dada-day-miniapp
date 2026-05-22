import type { ApiResponse } from '@starter-template/types';

/** API 错误 */
export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public response?: ApiResponse<unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
