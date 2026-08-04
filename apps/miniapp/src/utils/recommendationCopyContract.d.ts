import type { Outfit } from '@starter-template/types';

export const COPY_CONTRACT_VERSION: 'recommendation-copy-contract-v3';
export const VOICE_BANK_VERSION: 'xiaoda-fixed-claim-catalog-v2';

export function hasCurrentDefaultCopy(outfit: unknown): outfit is Outfit & {
  copyContractVersion: typeof COPY_CONTRACT_VERSION;
  voiceBankVersion: typeof VOICE_BANK_VERSION;
};

export function hasCurrentCopyContract(outfit: unknown): outfit is Outfit & {
  copyContractVersion: typeof COPY_CONTRACT_VERSION;
  voiceBankVersion: typeof VOICE_BANK_VERSION;
};

export function hasCurrentNewRecommendationCopy(outfit: unknown): outfit is Outfit & {
  copyContractVersion: typeof COPY_CONTRACT_VERSION;
  voiceBankVersion: typeof VOICE_BANK_VERSION;
  copyFinalizationMode: 'new_recommendation';
  copyContract: NonNullable<Outfit['copyContract']> & {
    todayReason: string;
    coreEligibilityReason: string;
    coreEligibilityReasonCode: string;
  };
};

export function getSavedSnapshotDefaultCopy(outfit: unknown): string;

export function stripStaleDefaultCopy<T>(outfit: T): T;
