import Taro from '@tarojs/taro';

type ImageSessionState = 'ready' | 'failed';

interface ImageSessionDiagnostics {
  cacheHits: number;
  nativeLoads: number;
  nativeErrors: number;
  mounts: number;
  unmounts: number;
  preloadRequests: number;
  preloadSuccesses: number;
  preloadFailures: number;
}

const MAX_SESSION_ENTRIES = 600;
const imageStates = new Map<string, ImageSessionState>();
const imagePreloads = new Map<string, Promise<boolean>>();
const imageListeners = new Map<string, Set<(state: ImageSessionState) => void>>();
const diagnostics: ImageSessionDiagnostics = {
  cacheHits: 0,
  nativeLoads: 0,
  nativeErrors: 0,
  mounts: 0,
  unmounts: 0,
  preloadRequests: 0,
  preloadSuccesses: 0,
  preloadFailures: 0,
};

export function getImageSessionCacheKey(src?: string, stableIdentity?: string): string {
  const normalizedSrc = typeof src === 'string' ? src.trim() : '';
  const normalizedIdentity = typeof stableIdentity === 'string' ? stableIdentity.trim() : '';
  return normalizedIdentity ? `${normalizedIdentity}|${normalizedSrc}` : normalizedSrc;
}

export function isImageSessionReady(src?: string, stableIdentity?: string): boolean {
  const key = getImageSessionCacheKey(src, stableIdentity);
  if (!key || imageStates.get(key) !== 'ready') return false;
  diagnostics.cacheHits += 1;
  return true;
}

export function markImageSessionReady(src?: string, stableIdentity?: string): void {
  diagnostics.nativeLoads += 1;
  setImageSessionState(src, stableIdentity, 'ready');
}

export function markImageSessionFailed(src?: string, stableIdentity?: string): void {
  diagnostics.nativeErrors += 1;
  setImageSessionState(src, stableIdentity, 'failed');
}

export function subscribeImageSession(
  src: string | undefined,
  stableIdentity: string | undefined,
  listener: (state: ImageSessionState) => void,
): () => void {
  const key = getImageSessionCacheKey(src, stableIdentity);
  if (!key) return () => undefined;
  const listeners = imageListeners.get(key) || new Set<(state: ImageSessionState) => void>();
  listeners.add(listener);
  imageListeners.set(key, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) imageListeners.delete(key);
  };
}

export function recordImageSessionMount(): () => void {
  diagnostics.mounts += 1;
  return () => {
    diagnostics.unmounts += 1;
  };
}

export async function preloadImageSession(src?: string, stableIdentity?: string): Promise<boolean> {
  const key = getImageSessionCacheKey(src, stableIdentity);
  if (!key) return false;
  if (imageStates.get(key) === 'ready') {
    diagnostics.cacheHits += 1;
    return true;
  }
  const existing = imagePreloads.get(key);
  if (existing) {
    diagnostics.cacheHits += 1;
    return existing;
  }

  diagnostics.preloadRequests += 1;
  const pending = Taro.getImageInfo({ src: String(src) })
    .then(() => {
      diagnostics.preloadSuccesses += 1;
      setImageSessionState(src, stableIdentity, 'ready');
      return true;
    })
    .catch(() => {
      diagnostics.preloadFailures += 1;
      return false;
    })
    .finally(() => {
      imagePreloads.delete(key);
    });
  imagePreloads.set(key, pending);
  return pending;
}

export function getImageSessionDiagnostics(): Readonly<ImageSessionDiagnostics> {
  return { ...diagnostics };
}

function setImageSessionState(
  src: string | undefined,
  stableIdentity: string | undefined,
  state: ImageSessionState,
): void {
  const key = getImageSessionCacheKey(src, stableIdentity);
  if (!key) return;
  if (!imageStates.has(key) && imageStates.size >= MAX_SESSION_ENTRIES) {
    const oldestKey = imageStates.keys().next().value;
    if (typeof oldestKey === 'string') imageStates.delete(oldestKey);
  }
  imageStates.set(key, state);
  imageListeners.get(key)?.forEach((listener) => listener(state));
}
