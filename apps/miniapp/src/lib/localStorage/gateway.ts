import Taro from '@tarojs/taro';
import {
  createStorageCore,
  type StorageAdapter,
  type StorageReadResult,
  type StorageWriteResult,
} from './core.mjs';
import { recordLocalStorageDiagnostic } from './diagnostics';
import { LOCAL_STORAGE_REGISTRY, STORAGE_BUDGETS, type LocalStorageNamespace } from './registry';

export type LocalWriteResult = StorageWriteResult;

export interface LocalStorageAddress {
  scope?: string;
  entryId?: string;
}

export interface LocalStorageWriteOptions extends LocalStorageAddress {
  now?: number;
}

export interface LocalStorageReadOptions extends LocalStorageAddress {
  now?: number;
}

export function createTaroStorageAdapter(): StorageAdapter {
  return {
    keys() {
      try {
        return Taro.getStorageInfoSync().keys ?? [];
      } catch {
        return [];
      }
    },
    get(key) {
      return Taro.getStorageSync(key) as unknown;
    },
    set(key, value) {
      Taro.setStorageSync(key, value);
    },
    remove(key) {
      Taro.removeStorageSync(key);
    },
    sizeBytes() {
      const currentSizeKiB = Taro.getStorageInfoSync().currentSize ?? 0;
      return Math.max(0, currentSizeKiB * 1024);
    },
  };
}

export function createLocalStorageGateway(adapter: StorageAdapter = createTaroStorageAdapter()) {
  const core = createStorageCore({
    registry: LOCAL_STORAGE_REGISTRY,
    adapter,
    onDiagnostic: recordLocalStorageDiagnostic,
    highWaterBytes: STORAGE_BUDGETS.highWaterBytes,
    softLimitBytes: STORAGE_BUDGETS.softLimitBytes,
  });

  return {
    read<T>(namespace: LocalStorageNamespace, options?: LocalStorageReadOptions): StorageReadResult<T> | null {
      return core.read<T>(namespace, options);
    },
    write<T>(namespace: LocalStorageNamespace, payload: T, options?: LocalStorageWriteOptions): LocalWriteResult {
      return core.write(namespace, payload, options);
    },
    remove(namespace: LocalStorageNamespace, options?: LocalStorageAddress): boolean {
      return core.remove(namespace, options);
    },
    cleanup(options?: { now?: number; aggressive?: boolean }) {
      return core.cleanup(options);
    },
  };
}

export const localStorageGateway = createLocalStorageGateway();

export function readLocalStorage<T>(namespace: LocalStorageNamespace, options?: LocalStorageReadOptions) {
  return localStorageGateway.read<T>(namespace, options);
}

export function writeLocalStorage<T>(namespace: LocalStorageNamespace, payload: T, options?: LocalStorageWriteOptions) {
  return localStorageGateway.write(namespace, payload, options);
}

export function removeLocalStorage(namespace: LocalStorageNamespace, options?: LocalStorageAddress) {
  return localStorageGateway.remove(namespace, options);
}

export function cleanupLocalStorage(options?: { now?: number; aggressive?: boolean }) {
  return localStorageGateway.cleanup(options);
}
