export {
  bootstrapProjectionStore,
  readBootstrapProjection,
  writeBootstrapProjection,
  WEATHER_FRESH_MS,
} from './bootstrapProjection';
export type {
  AuthResumeV2,
  ProfileBootstrapV2,
  StorageMetaV2,
} from './bootstrapProjection';
export {
  cleanupLocalStorage,
  createLocalStorageGateway,
  createTaroStorageAdapter,
  localStorageGateway,
  readLocalStorage,
  removeLocalStorage,
  writeLocalStorage,
} from './gateway';
export type {
  LocalStorageAddress,
  LocalStorageReadOptions,
  LocalStorageWriteOptions,
  LocalWriteResult,
} from './gateway';
export {
  clearLocalStorageDiagnostics,
  getLocalStorageDiagnostics,
} from './diagnostics';
export type { LocalStorageDiagnostic } from './diagnostics';
export {
  LOCAL_STORAGE_REGISTRY,
  STORAGE_BUDGETS,
} from './registry';
export type { LocalStorageNamespace } from './registry';
