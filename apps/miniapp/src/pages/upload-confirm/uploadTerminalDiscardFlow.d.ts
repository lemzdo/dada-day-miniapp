import type { ActiveAuthContext } from '@/lib/userPageCache';

export const WARDROBE_DISCARD_NOTICE: string;
export const WARDROBE_NOTICE_STORAGE_KEY: string;
export const TERMINAL_DISCARD_FALLBACK_NOTICE: string;
export const WARDROBE_TAB_URL: string;

export function shouldEnterTerminalDiscardLeaving(
  result: { batchTerminal?: boolean } | null | undefined,
  batchId: string | null | undefined,
): boolean;

export function normalizeTerminalDiscardStatus(status?: string): string;

export function setPendingWardrobeNotice(input?: {
  authContext?: ActiveAuthContext | null;
  notice?: string;
  setUserStorageSync: (key: string, value: unknown, options?: { authContext?: ActiveAuthContext | null }) => void;
}): void;

export function consumePendingWardrobeNotice(input?: {
  authContext?: ActiveAuthContext | null;
  getUserStorageSync: <T>(key: string, options?: { authContext?: ActiveAuthContext | null }) => T | undefined | null;
  removeUserStorageSync: (key: string, options?: { authContext?: ActiveAuthContext | null }) => void;
}): string;

export function finalizeTerminalDiscard(input?: {
  source?: 'draft' | 'batch' | string;
  batchId?: string | null;
  batchStatus?: string;
  authContext?: ActiveAuthContext | null;
  flowRuntimeKey?: string | null;
  isFlowCurrent?: (authContext: ActiveAuthContext | null | undefined, flowRuntimeKey: string | null) => boolean;
  setIsLeavingAfterDiscard?: (value: boolean) => void;
  buildAuthRuntimeKey?: (authContext: ActiveAuthContext) => string;
  buildUserStorageBusinessKey?: (...parts: Array<string | number | boolean>) => string;
  removeUserStorageSync?: (key: string, options?: { authContext?: ActiveAuthContext | null }) => void;
  markUploadBatchTerminal?: (input: {
    authRuntimeKey?: string;
    batchId: string;
    status: string;
  }) => void;
  removeUploadBatchFromLocalCache?: (input: {
    authRuntimeKey?: string;
    batchId: string;
    batchTerminal?: boolean;
  }) => void;
  setUserStorageSync?: (key: string, value: unknown, options?: { authContext?: ActiveAuthContext | null }) => void;
  invalidateAfterUploadTaskMutation?: (input: { authContext?: ActiveAuthContext | null }) => Promise<unknown>;
  navigateToWardrobe?: () => Promise<unknown>;
  onNavigationFailure?: (input: {
    source?: 'draft' | 'batch' | string;
    error: unknown;
    terminalStatus: string;
  }) => void;
}): Promise<{ navigated: boolean }>;
