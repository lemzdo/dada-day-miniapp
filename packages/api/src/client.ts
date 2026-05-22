import { isWeapp, normalizeError } from '@starter-template/utils';
import type { NormalizedError } from '@starter-template/utils';
import type { ApiResponse } from '@starter-template/types';
import { ApiError } from './error';

declare let process: undefined | { env: Record<string, string | undefined> };

// ── Types ──

export type RequestInterceptor = (url: string, init?: RequestInit) => [string, RequestInit?];

export type ResponseInterceptor = <T>(response: ApiResponse<T>) => ApiResponse<T>;

export type ToastCallback = (type: 'success' | 'error', message: string) => void;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  silent?: boolean;
  successMsg?: string;
  errorMsg?: string;
  onError?: (error: NormalizedError) => boolean;
}

export interface RequestResult<T> {
  data: T | null;
  error: NormalizedError | null;
  ok: boolean;
}

export const AUTH_TOKEN_STORAGE_KEY = 'token';

export function getAuthorizationHeader(token?: string | null): Record<string, string> | undefined {
  return token ? { Authorization: `Bearer ${token}` } : undefined;
}

const BASE_URL =
  typeof process !== 'undefined' && process?.env?.['TARO_APP_API_URL']
    ? process.env['TARO_APP_API_URL']
    : typeof process !== 'undefined' && process?.env?.['NEXT_PUBLIC_API_URL']
      ? process.env['NEXT_PUBLIC_API_URL']
      : isWeapp
        ? 'http://localhost:3000/api/v1'
        : '/api/v1';

export function getApiBaseUrl(): string {
  return BASE_URL;
}

function mergeHeaders(...headersList: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();
  for (const headersInit of headersList) {
    if (!headersInit) continue;
    new Headers(headersInit).forEach((value, key) => {
      headers.set(key, value);
    });
  }
  return headers;
}

function encodeBody(body: unknown): BodyInit | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof FormData !== 'undefined' && body instanceof FormData) return body;
  if (
    typeof body === 'string' ||
    body instanceof Blob ||
    body instanceof ArrayBuffer ||
    body instanceof URLSearchParams
  ) {
    return body;
  }
  return JSON.stringify(body);
}

// ── Client ──

class ApiClient {
  private requestInterceptors: RequestInterceptor[] = [];
  private responseInterceptors: ResponseInterceptor[] = [];
  private authTokenProvider: (() => string | null | undefined) | null = null;
  private onLoadingChange: ((loading: boolean) => void) | null = null;
  private onToast: ToastCallback | null = null;
  private loadingCount = 0;

  setLoadingHandler(handler: (loading: boolean) => void) {
    this.onLoadingChange = handler;
  }

  setToastHandler(handler: ToastCallback) {
    this.onToast = handler;
  }

  setAuthTokenProvider(provider: (() => string | null | undefined) | null) {
    this.authTokenProvider = provider;
  }

  onRequest(interceptor: RequestInterceptor) {
    this.requestInterceptors.push(interceptor);
    return () => {
      this.requestInterceptors = this.requestInterceptors.filter((i) => i !== interceptor);
    };
  }

  onResponse(interceptor: ResponseInterceptor) {
    this.responseInterceptors.push(interceptor);
    return () => {
      this.responseInterceptors = this.responseInterceptors.filter((i) => i !== interceptor);
    };
  }

  private startLoading() {
    this.loadingCount++;
    this.onLoadingChange?.(true);
  }

  private stopLoading() {
    this.loadingCount = Math.max(0, this.loadingCount - 1);
    if (this.loadingCount === 0) {
      this.onLoadingChange?.(false);
    }
  }

  async safeRequest<T>(
    endpoint: string,
    init?: RequestInit,
    options?: RequestOptions,
  ): Promise<RequestResult<T>> {
    try {
      const data = await this.request<T>(endpoint, init, options);
      if (options?.successMsg) {
        this.onToast?.('success', options.successMsg);
      }
      return { data, error: null, ok: true };
    } catch (err) {
      const normalized = normalizeError(err);
      const handled = options?.onError?.(normalized);
      if (!handled) {
        const msg = options?.errorMsg ?? normalized.message;
        this.onToast?.('error', msg);
      }
      return { data: null, error: normalized, ok: false };
    }
  }

  async request<T>(endpoint: string, init?: RequestInit, options?: RequestOptions): Promise<T> {
    let url = `${BASE_URL}${endpoint}`;
    let reqInit = init;

    for (const interceptor of this.requestInterceptors) {
      [url, reqInit] = interceptor(url, reqInit);
    }

    if (!options?.silent) this.startLoading();

    try {
      let res: Response;
      if (isWeapp) {
        res = await this.taroFetch(url, reqInit);
      } else {
        const headers = mergeHeaders(
          reqInit?.body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
          getAuthorizationHeader(this.authTokenProvider?.()),
          reqInit?.headers,
        );
        res = await fetch(url, {
          ...reqInit,
          headers,
        });
      }

      if (!res.ok) {
        let body: ApiResponse<unknown> | undefined;
        try {
          body = (await res.json()) as ApiResponse<unknown>;
        } catch {
          // ignore
        }
        const msg = body?.message ?? `Request failed: ${res.status}`;
        throw new ApiError(msg, res.status, body);
      }

      const result = (await res.json()) as ApiResponse<T>;
      let final = result;
      for (const interceptor of this.responseInterceptors) {
        final = interceptor(final) as ApiResponse<T>;
      }
      return final.data;
    } finally {
      if (!options?.silent) this.stopLoading();
    }
  }

  private async taroFetch(url: string, init?: RequestInit): Promise<Response> {
    const Taro = await import('@tarojs/taro');
    const token =
      this.authTokenProvider?.() ?? (Taro.getStorageSync(AUTH_TOKEN_STORAGE_KEY) as string | undefined);
    const headers = mergeHeaders(
      { 'Content-Type': 'application/json' },
      init?.headers,
      getAuthorizationHeader(token),
    );
    const header: Record<string, string> = {};
    headers.forEach((value, key) => {
      header[key] = value;
    });

    const res = await Taro.request({
      url,
      method: (init?.method as 'GET' | 'POST' | 'PUT' | 'DELETE') ?? 'GET',
      data: init?.body ? JSON.parse(init.body as string) : undefined,
      header,
    });
    return new Response(JSON.stringify(res.data), {
      status: res.statusCode,
      headers: new Headers(res.header as Record<string, string>),
    });
  }

  get<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { method: 'GET' }, options);
  }

  post<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(
      endpoint,
      {
        method: 'POST',
        body: encodeBody(body),
      },
      options,
    );
  }

  put<T>(endpoint: string, body?: unknown, options?: RequestOptions) {
    return this.request<T>(
      endpoint,
      {
        method: 'PUT',
        body: encodeBody(body),
      },
      options,
    );
  }

  delete<T>(endpoint: string, options?: RequestOptions) {
    return this.request<T>(endpoint, { method: 'DELETE' }, options);
  }

  safe = {
    get: <T>(endpoint: string, options?: RequestOptions) =>
      this.safeRequest<T>(endpoint, { method: 'GET' }, options),
    post: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
      this.safeRequest<T>(endpoint, { method: 'POST', body: encodeBody(body) }, options),
    put: <T>(endpoint: string, body?: unknown, options?: RequestOptions) =>
      this.safeRequest<T>(endpoint, { method: 'PUT', body: encodeBody(body) }, options),
    delete: <T>(endpoint: string, options?: RequestOptions) =>
      this.safeRequest<T>(endpoint, { method: 'DELETE' }, options),
  };
}

export const apiClient = new ApiClient();
