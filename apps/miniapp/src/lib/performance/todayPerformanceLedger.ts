import Taro from '@tarojs/taro';
import { isRecommendationDiagnosticEnvironment } from '@/lib/cloud';

export const TODAY_PERFORMANCE_LEDGER_KEY = 'today:performance-ledger:v1';
export const TODAY_PERFORMANCE_LEDGER_SCHEMA_VERSION = 3;
const HISTORY_LIMIT = 5;
const PUBLISH_DEBOUNCE_MS = 250;

export type TodayPerformanceExecutionMode = 'HOT' | 'COLD' | 'UNKNOWN';
export type TodayRestoreReturnReason =
  | 'NO_LOCAL_AUTH'
  | 'AUTH_CONTEXT_STALE'
  | 'RETURN_INTENT_REQUIRED'
  | 'SNAPSHOT_EMPTY'
  | 'SNAPSHOT_INVALID'
  | 'RESTORE_COMPLETED';
export type TodayPerformanceStage =
  | 'appOrPageEntry' | 'todayComponentEnter' | 'todayOnLoad' | 'todayOnShow'
  | 'identityStart' | 'localIdentityReady' | 'identityRemoteStart' | 'identityRemoteEnd' | 'identityReady' | 'sceneReady' | 'weatherStart' | 'weatherEnd'
  | 'locationPermissionPromptStart' | 'locationPermissionResolved'
  | 'snapshotReadStart' | 'snapshotReadEnd' | 'snapshotParseEnd'
  | 'snapshotValidationStart' | 'snapshotValidationEnd' | 'snapshotFound'
  | 'snapshotValid' | 'snapshotRejectReason' | 'snapshotCardCount'
  | 'statusApplyStart' | 'statusApplyEnd' | 'setOutfitsCalled'
  | 'reactCommitAfterOutfits' | 'firstCardMounted' | 'firstImageLoadStart'
  | 'firstImageLoaded' | 'generateOutfitRequestStart' | 'generateOutfitResponseEnd'
  | 'responseAdaptStart' | 'responseAdaptEnd' | 'snapshotPersistStart' | 'snapshotPersistEnd'
  | 'backgroundRefreshStart' | 'backgroundRefreshEnd' | 'finalCardCount'
  | 'generateOutfitRequestCount' | 'executionMode' | 'responseCode' | 'auditId'
  | 'runComplete';

export interface TodayPerformanceLedgerRecord {
  runId: string;
  enabled: true;
  executionMode: TodayPerformanceExecutionMode;
  startedAt: number;
  completedAt?: number;
  stages: Partial<Record<TodayPerformanceStage, number | string>>;
  durations: Record<string, number>;
  finalCardCount: number | 'NOT_OBSERVED';
  generateOutfitRequestCount: number;
  responseCode: number | string | 'NOT_OBSERVED';
  auditId?: string;
  complete: boolean;
  ledgerSchemaVersion: number;
  restoreDispatchAttempt: number | 'NOT_OBSERVED';
  restoreFunctionEntered: number | 'NOT_OBSERVED';
  authContextCurrentChecked: boolean | 'NOT_OBSERVED';
  authContextCurrentResult: boolean | 'NOT_OBSERVED';
  restoreReturnReason: TodayRestoreReturnReason | 'NOT_OBSERVED';
  snapshotReadStart: number | 'NOT_OBSERVED';
  restoreException: { type: string; message: string } | 'NOT_OBSERVED';
}

export interface TodayPerformanceLedgerSnapshot {
  active: TodayPerformanceLedgerRecord | null;
  history: TodayPerformanceLedgerRecord[];
}

let active: TodayPerformanceLedgerRecord | null = null;
let history: TodayPerformanceLedgerRecord[] = [];
let enabledState: boolean | undefined;
const listeners = new Set<(snapshot: TodayPerformanceLedgerSnapshot) => void>();
let publishTimer: ReturnType<typeof setTimeout> | undefined;

function now() {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === 'function' ? perf.now() : Date.now();
}

function isEnabled() {
  if (enabledState === undefined) enabledState = isRecommendationDiagnosticEnvironment();
  return enabledState;
}

function createRunId() {
  return `today_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function emptySnapshot(): TodayPerformanceLedgerSnapshot {
  return { active: null, history: [] };
}

function publishNow() {
  if (!isEnabled() || !active) return;
  if (publishTimer !== undefined) {
    clearTimeout(publishTimer);
    publishTimer = undefined;
  }
  const snapshot = { active: { ...active, stages: { ...active.stages }, durations: { ...active.durations } }, history: history.map((item) => ({ ...item, stages: { ...item.stages }, durations: { ...item.durations } })) };
  for (const listener of listeners) listener(snapshot);
  try {
    Taro.setStorageSync(TODAY_PERFORMANCE_LEDGER_KEY, snapshot);
  } catch {
    // Diagnostics must never affect the page.
  }
}

function publish() {
  if (!isEnabled() || !active) return;
  if (publishTimer !== undefined) return;
  publishTimer = setTimeout(() => {
    publishTimer = undefined;
    publishNow();
  }, PUBLISH_DEBOUNCE_MS);
}

export function readTodayPerformanceLedger(): TodayPerformanceLedgerSnapshot {
  if (!isEnabled()) return emptySnapshot();
  if (active) return { active, history };
  try {
    const stored = Taro.getStorageSync(TODAY_PERFORMANCE_LEDGER_KEY) as TodayPerformanceLedgerSnapshot;
    if (stored?.active) {
      active = stored.active;
      history = Array.isArray(stored.history) ? stored.history.slice(0, HISTORY_LIMIT) : [];
      return { active, history };
    }
  } catch { /* no-op */ }
  return emptySnapshot();
}

export function subscribeTodayPerformanceLedger(listener: (snapshot: TodayPerformanceLedgerSnapshot) => void) {
  if (!isEnabled()) return () => undefined;
  listeners.add(listener);
  listener(readTodayPerformanceLedger());
  return () => { listeners.delete(listener); };
}

export function startTodayPerformanceRun(): string | null {
  if (!isEnabled()) return null;
  const previous = readTodayPerformanceLedger();
  history = previous.history.slice(0, HISTORY_LIMIT);
  const t = now();
  active = {
    runId: createRunId(), enabled: true, executionMode: 'UNKNOWN', startedAt: t,
    stages: {}, durations: {}, finalCardCount: 'NOT_OBSERVED',
    generateOutfitRequestCount: 0, responseCode: 'NOT_OBSERVED', complete: false,
    ledgerSchemaVersion: TODAY_PERFORMANCE_LEDGER_SCHEMA_VERSION,
    restoreDispatchAttempt: 'NOT_OBSERVED',
    restoreFunctionEntered: 'NOT_OBSERVED',
    authContextCurrentChecked: 'NOT_OBSERVED',
    authContextCurrentResult: 'NOT_OBSERVED',
    restoreReturnReason: 'NOT_OBSERVED',
    snapshotReadStart: 'NOT_OBSERVED',
    restoreException: 'NOT_OBSERVED',
  };
  publish();
  return active.runId;
}

export function recordTodayRestoreDispatchAttempt() {
  if (!isEnabled() || !active) return;
  active.restoreDispatchAttempt = now();
  publish();
}

export function recordTodayRestoreFunctionEntered() {
  if (!isEnabled() || !active) return;
  active.restoreFunctionEntered = now();
  publish();
}

export function recordTodayAuthContextCurrentChecked(result: boolean) {
  if (!isEnabled() || !active) return;
  active.authContextCurrentChecked = true;
  active.authContextCurrentResult = result;
  publish();
}

export function recordTodayRestoreReturn(reason: TodayRestoreReturnReason) {
  if (!isEnabled() || !active) return;
  active.restoreReturnReason = reason;
  publish();
}

export function recordTodayRestoreException(error: unknown) {
  if (!isEnabled() || !active) return;
  const value = error instanceof Error ? error : new Error(String(error));
  active.restoreException = { type: value.name || 'Error', message: value.message.slice(0, 240) };
  publish();
}

export function markTodayPerformanceStage(stage: TodayPerformanceStage, value?: number | string) {
  if (!isEnabled() || !active) return;
  active.stages[stage] = value ?? now();
  if (stage === 'snapshotReadStart') active.snapshotReadStart = active.stages[stage] as number;
  if (stage === 'generateOutfitRequestStart') active.generateOutfitRequestCount += 1;
  if (stage === 'generateOutfitRequestStart') active.stages.generateOutfitRequestCount = active.generateOutfitRequestCount;
  if (stage === 'finalCardCount' && typeof value === 'number') active.finalCardCount = value;
  if (stage === 'executionMode' && (value === 'HOT' || value === 'COLD')) active.executionMode = value;
  if (stage === 'locationPermissionResolved') markTodayPerformanceDuration('permissionUserWaitMs', 'locationPermissionPromptStart', 'locationPermissionResolved');
  if (stage === 'finalCardCount' || stage === 'snapshotRejectReason') publishNow();
  else publish();
}

export function markTodayPerformanceDuration(name: string, startStage: TodayPerformanceStage, endStage: TodayPerformanceStage) {
  if (!isEnabled() || !active) return;
  const start = active.stages[startStage];
  const end = active.stages[endStage];
  if (typeof start === 'number' && typeof end === 'number') active.durations[name] = Math.max(0, end - start);
  publish();
}

export function completeTodayPerformanceRun() {
  if (!isEnabled() || !active) return;
  const current = active;
  current.completedAt = now();
  current.stages.runComplete = current.completedAt;
  current.complete = true;
  for (const stage of ['appOrPageEntry', 'todayComponentEnter', 'todayOnLoad', 'todayOnShow', 'identityStart', 'localIdentityReady', 'identityRemoteStart', 'identityRemoteEnd', 'identityReady', 'sceneReady', 'weatherStart', 'weatherEnd', 'locationPermissionPromptStart', 'locationPermissionResolved', 'snapshotReadStart', 'snapshotReadEnd', 'snapshotParseEnd', 'snapshotValidationStart', 'snapshotValidationEnd', 'snapshotFound', 'snapshotValid', 'snapshotRejectReason', 'snapshotCardCount', 'statusApplyStart', 'statusApplyEnd', 'setOutfitsCalled', 'reactCommitAfterOutfits', 'firstCardMounted', 'firstImageLoadStart', 'firstImageLoaded', 'generateOutfitRequestStart', 'generateOutfitResponseEnd', 'responseAdaptEnd', 'snapshotPersistStart', 'snapshotPersistEnd', 'backgroundRefreshStart', 'backgroundRefreshEnd', 'finalCardCount', 'generateOutfitRequestCount', 'executionMode', 'responseCode', 'auditId'] as TodayPerformanceStage[]) {
    if (current.stages[stage] === undefined) current.stages[stage] = stage === 'snapshotRejectReason' ? 'NOT_OBSERVED' : 'NOT_OBSERVED';
  }
  markTodayPerformanceDuration('onShowToFirstCard', 'todayOnShow', 'firstCardMounted');
  markTodayPerformanceDuration('onShowToFirstImage', 'todayOnShow', 'firstImageLoaded');
  markTodayPerformanceDuration('request', 'generateOutfitRequestStart', 'generateOutfitResponseEnd');
  markTodayPerformanceDuration('permissionUserWaitMs', 'locationPermissionPromptStart', 'locationPermissionResolved');
  history = [current, ...history.filter((item) => item.runId !== current.runId)].slice(0, HISTORY_LIMIT);
  publishNow();
}

export function resetTodayPerformanceLedgerForTest() {
  active = null;
  history = [];
  enabledState = undefined;
  listeners.clear();
  if (publishTimer !== undefined) clearTimeout(publishTimer);
  publishTimer = undefined;
}
