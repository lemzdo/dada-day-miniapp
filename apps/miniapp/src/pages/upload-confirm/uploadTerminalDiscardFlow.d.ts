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
