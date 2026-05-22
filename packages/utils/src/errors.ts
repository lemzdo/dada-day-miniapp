/** 标准化错误对象 */

export interface NormalizedError {
  message: string;
  code?: number | string;
  detail?: unknown;
}

/** 将任意错误转为 NormalizedError */
export function normalizeError(error: unknown): NormalizedError {
  if (error instanceof Error) {
    return { message: error.message };
  }
  if (typeof error === 'string') {
    return { message: error };
  }
  if (
    error &&
    typeof error === 'object' &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  ) {
    const e = error as Record<string, unknown>;
    return {
      message: e.message as string,
      code: e.code as number | string | undefined,
      detail: e.detail ?? e,
    };
  }
  return { message: 'Unknown error' };
}
