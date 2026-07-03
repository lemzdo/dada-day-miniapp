import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useRouter, useUnload } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import { SafeImage } from '@/components/SafeImage';
import { ClothingEditForm, type ClothingEditFormValue } from '@/components/ClothingEditForm';
import { CATEGORY_OPTIONS } from '@/components/ClothingEditForm/constants';
import { useBoundUserFlow } from '@/hooks/useBoundUserFlow';
import {
  CloudFunctionError,
  confirmClothesDrafts,
  discardClothesDraft,
  discardUploadBatch,
  getWardrobe,
  getUploadBatchDetail,
  processUploadImage,
  segmentClothesDraft,
} from '@/lib/cloud';
import {
  invalidateAfterConfirmDraftsSaved,
  invalidateAfterUploadTaskMutation,
} from '@/lib/cacheInvalidation';
import {
  captureAuthContext,
  isAuthContextCurrent,
  type ActiveAuthContext,
} from '@/lib/userPageCache';
import {
  buildUserStorageBusinessKey,
  getUserStorageSync,
  removeUserStorageSync,
  setUserStorageSync,
} from '@/lib/userStorage';
import { buildAuthRuntimeKey } from '@/lib/userRuntimeScope';
import {
  markUploadBatchTerminal,
  removeUploadBatchFromLocalCache,
} from '@/lib/uploadTaskLocalCache';
import { displayClothingTags, displayClothingText, getSubcategoryDisplayLabel, getUploadDraftDisplayImage } from '@/utils/clothingLabels';
import type { ClothesDraft, ClothingCategory, ClothingImageSourceType, UploadBatch, UploadImage, WardrobeCapacity } from '@starter-template/types';
import { DEFAULT_WARDROBE_LIMIT } from '@/constants/wardrobeCapacity';
import * as uploadConfirmState from './uploadConfirmStateCore';
import {
  TERMINAL_DISCARD_FALLBACK_NOTICE,
  WARDROBE_TAB_URL,
  finalizeTerminalDiscard,
  shouldEnterTerminalDiscardLeaving,
} from './uploadTerminalDiscardFlow';
import './index.scss';

const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';
const FREE_WARDROBE_LIMIT = DEFAULT_WARDROBE_LIMIT;

function isCurrentAuthContext(authContext: ActiveAuthContext | null | undefined) {
  return Boolean(authContext && isAuthContextCurrent(authContext));
}

function normalizeWardrobeCapacity(value?: Partial<WardrobeCapacity> | null): WardrobeCapacity {
  const limit = normalizeNonNegativeInteger(value?.limit, FREE_WARDROBE_LIMIT) || FREE_WARDROBE_LIMIT;
  const used = normalizeNonNegativeInteger(value?.used, 0);
  const remaining = Math.max(0, normalizeNonNegativeInteger(value?.remaining, limit - used));
  return {
    plan: value?.plan === 'member' || value?.plan === 'premium' ? value.plan : 'free',
    used,
    limit,
    remaining,
    canAdd: used < limit,
  };
}

function normalizeNonNegativeInteger(value: unknown, fallback: number) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function readCapacityError(error: unknown): { message: string; capacity?: WardrobeCapacity } | null {
  if (!(error instanceof CloudFunctionError) || !error.data || typeof error.data !== 'object') return null;
  const data = error.data as {
    code?: unknown;
    message?: unknown;
    capacity?: Partial<WardrobeCapacity>;
  };
  if (data.code === 'WARDROBE_CAPACITY_EXCEEDED') {
    return {
      message: error.message || '衣橱容量不足，请减少后再保存',
      capacity: normalizeWardrobeCapacity(data.capacity),
    };
  }
  if (data.code === 'WARDROBE_CAPACITY_BUSY') {
    return { message: error.message || '正在保存另一批衣服，请稍后再试' };
  }
  return null;
}

export default function UploadConfirmPage() {
  const router = useRouter();
  const batchId = router.params.batchId || '';
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [images, setImages] = useState<UploadImage[]>([]);
  const [drafts, setDrafts] = useState<ClothesDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [capacity, setCapacity] = useState<WardrobeCapacity | null>(null);
  const [discardingBatch, setDiscardingBatch] = useState(false);
  const [discardingDraftIds, setDiscardingDraftIds] = useState<Set<string>>(() => new Set());
  const [editingDraft, setEditingDraft] = useState<ClothesDraft | null>(null);
  const [isLeavingAfterDiscard, setIsLeavingAfterDiscard] = useState(false);
  const processingLoopRef = useRef(false);
  const mountedRef = useRef(true);
  const discardRequestedRef = useRef(false);
  const segmentingDraftIdsRef = useRef(new Set<string>());
  const savingRef = useRef(false);
  const batchRefreshCountRef = useRef(0);
  const requestSeqRef = useRef(0);
  const redirectingRef = useRef(false);

  const resetFlowState = useCallback(() => {
    requestSeqRef.current += 1;
    processingLoopRef.current = false;
    discardRequestedRef.current = false;
    segmentingDraftIdsRef.current.clear();
    savingRef.current = false;
    batchRefreshCountRef.current = 0;
    setBatch(null);
    setImages([]);
    setDrafts([]);
    setLoading(false);
    setProcessing(false);
    setSaving(false);
    setCapacity(null);
    setDiscardingBatch(false);
    setDiscardingDraftIds(new Set());
    setEditingDraft(null);
    setIsLeavingAfterDiscard(false);
    Taro.hideLoading();
    Taro.stopPullDownRefresh();
  }, []);

  const navigateToWardrobe = useCallback(() => {
    if (redirectingRef.current) return Promise.resolve(false);
    redirectingRef.current = true;
    return Taro.switchTab({ url: WARDROBE_TAB_URL }).then(() => true).catch((error) => {
      console.warn('Navigate to wardrobe failed:', error);
      redirectingRef.current = false;
      throw error;
    });
  }, []);

  const {
    boundRuntimeKeyRef,
    isFlowActive,
  } = useBoundUserFlow({
    onBind: () => {
      if (!batchId) {
        setLoading(false);
        return;
      }
      void initializeFlow();
    },
    onInvalidate: () => {
      resetFlowState();
      void navigateToWardrobe();
    },
  });

  const refresh = useCallback(async () => {
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    const authContext = captureAuthContext();
    if (!batchId || !authContext || !isFlowActive(flowRuntimeKey)) return;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    try {
      batchRefreshCountRef.current += 1;
      const detail = await getUploadBatchDetail(batchId);
      if (!isFlowCurrent(authContext, flowRuntimeKey, requestSeq)) return detail;
      setBatch(detail.batch);
      setImages(detail.images);
      setDrafts(detail.drafts);
      return detail;
    } catch (error) {
      console.error('Fetch upload batch detail failed:', error);
      if (isFlowCurrent(authContext, flowRuntimeKey, requestSeq)) {
        Taro.showToast({ title: '加载失败', icon: 'none' });
      }
    } finally {
      if (isFlowCurrent(authContext, flowRuntimeKey, requestSeq)) {
        setLoading(false);
        Taro.stopPullDownRefresh();
      }
    }
  }, [batchId, boundRuntimeKeyRef, isFlowActive]);

  useLoad(() => {
    mountedRef.current = true;
  });

  useUnload(() => {
    mountedRef.current = false;
  });

  usePullDownRefresh(() => {
    void refresh();
  });

  function initializeFlow() {
    setLoading(true);
    void refreshCapacity();
    return refresh().then((detail) => {
      if (normalizeUploadBatchStatus(detail?.batch.status) === 'processing') {
        void processPendingImages(detail?.images);
      }
    });
  }

  async function refreshCapacity() {
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowActive(flowRuntimeKey)) return;
    try {
      const result = await getWardrobe({ capacityOnly: true }, { force: true });
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      setCapacity(normalizeWardrobeCapacity(result.capacity));
    } catch (error) {
      console.warn('[upload-confirm] capacity fetch failed', error);
      if (isFlowCurrent(authContext, flowRuntimeKey)) {
        setCapacity(null);
      }
    }
  }

  function isFlowCurrent(
    authContext: ActiveAuthContext | null | undefined,
    flowRuntimeKey: string | null,
    requestSeq?: number,
  ) {
    return Boolean(
      mountedRef.current
        && authContext
        && isCurrentAuthContext(authContext)
        && isFlowActive(flowRuntimeKey)
        && (requestSeq === undefined || requestSeqRef.current === requestSeq),
    );
  }

  async function processPendingImages(imagesOverride?: UploadImage[]) {
    if (!batchId || processingLoopRef.current || !mountedRef.current || discardRequestedRef.current || isLeavingAfterDiscard) return;
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowActive(flowRuntimeKey)) return;
    processingLoopRef.current = true;
    setProcessing(true);
    batchRefreshCountRef.current = 0;
    const startedAt = Date.now();

    const uploadImagesKey = buildUserStorageBusinessKey('uploadBatchImages', batchId);
    const stored = getUserStorageSync<string[]>(uploadImagesKey, { authContext }) ?? undefined;
    const sourceImages = imagesOverride ?? images;
    const imageById = new Map(sourceImages.map((item) => [item.id, item]));
    const candidateIds = Array.isArray(stored) && stored.length > 0
      ? stored
      : sourceImages.filter(isImagePendingForProcess).map((item) => item.id);
    const targetIds = Array.from(new Set(candidateIds)).filter((id) => {
      const image = imageById.get(id);
      return image ? isImagePendingForProcess(image) : false;
    });

    try {
      if (targetIds.length === 0) {
        removeUserStorageSync(uploadImagesKey, { authContext });
        if (isFlowCurrent(authContext, flowRuntimeKey)) await refresh();
        return;
      }

      for (let index = 0; index < targetIds.length; index += 1) {
        if (!isFlowCurrent(authContext, flowRuntimeKey) || discardRequestedRef.current) return;
        const imageId = targetIds[index];
        if (!imageId) continue;
        const result = await processUploadImage(imageId);
        if (!isFlowCurrent(authContext, flowRuntimeKey) || discardRequestedRef.current) return;
        applyProcessedImageResult(imageId, result);
        if (result.status === 'superseded' || result.status === 'reused') {
          await refresh();
        }
      }
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      removeUserStorageSync(uploadImagesKey, { authContext });
      await invalidateAfterUploadTaskMutation({ authContext });
    } catch (error) {
      console.error('Process pending upload images failed:', error);
      if (isFlowCurrent(authContext, flowRuntimeKey) && !discardRequestedRef.current) {
        Taro.showToast({ title: '识别暂时中断，可稍后重试', icon: 'none' });
      }
    } finally {
      processingLoopRef.current = false;
      if (isFlowCurrent(authContext, flowRuntimeKey) && !discardRequestedRef.current) {
        setProcessing(false);
        await refresh();
        console.log('[upload-confirm] processPendingImages completed', {
          batchId,
          totalImages: targetIds.length,
          durationMs: Date.now() - startedAt,
          batchRefreshCount: batchRefreshCountRef.current,
        });
      }
    }
  }

  function applyProcessedImageResult(
    imageId: string,
    result: Awaited<ReturnType<typeof processUploadImage>>,
  ) {
    const nextDrafts = result.drafts || [];
    if (result.status === 'inProgress') {
      setImages((prev) => prev.map((item) => (
        item.id === imageId
          ? {
              ...item,
              status: 'processing',
              detectStatus: 'pending',
              errorMessage: '',
            }
          : item
      )));
      return;
    }
    if (result.status === 'superseded') return;

    const nextStatus = result.status === 'reused'
      ? (nextDrafts.length > 0 ? 'detected' : 'empty')
      : result.status;
    const isTerminalStatus = nextStatus === 'detected' || nextStatus === 'empty' || nextStatus === 'failed';
    setImages((prev) => prev.map((item) => (
      item.id === imageId
        ? {
            ...item,
            status: nextStatus,
            detectStatus: nextStatus === 'failed' ? 'failed' : 'success',
            detectedCount: nextDrafts.length,
            errorMessage: result.errorMessage || '',
          }
        : item
    )));
    setDrafts((prev) => mergeDrafts(prev, nextDrafts));
    if (!isTerminalStatus) return;
    setBatch((prev) => {
      if (!prev) return prev;
      const currentImage = images.find((item) => item.id === imageId);
      const alreadyProcessed = currentImage ? isImageProcessed(currentImage) : false;
      const totalImages = Math.max(0, Number(prev.totalImages || images.length || 0));
      const processedImages = Math.min(
        totalImages,
        Math.max(0, Number(prev.processedImages || 0)) + (alreadyProcessed ? 0 : 1),
      );
      const previousDetectedCount = currentImage ? Math.max(0, Number(currentImage.detectedCount || 0)) : 0;
      const totalDetectedClothes = Math.max(
        0,
        Number(prev.totalDetectedClothes || 0) - previousDetectedCount + nextDrafts.length,
      );
      return {
        ...prev,
        processedImages,
        totalDetectedClothes,
        status: processedImages >= totalImages ? (totalDetectedClothes > 0 ? 'ready' : 'failed') : 'processing',
      };
    });
  }

  async function handleRetry(image: UploadImage) {
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowActive(flowRuntimeKey)) return;
    setProcessing(true);
    try {
      Taro.showLoading({ title: '小搭重新整理...' });
      await processUploadImage(image.id);
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      await invalidateAfterUploadTaskMutation({ authContext });
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      await refresh();
    } catch (error) {
      console.error('Retry upload image failed:', error);
      if (isFlowCurrent(authContext, flowRuntimeKey)) {
        Taro.showToast({ title: '重试失败', icon: 'none' });
      }
    } finally {
      Taro.hideLoading();
      if (isFlowCurrent(authContext, flowRuntimeKey)) setProcessing(false);
    }
  }

  function patchDraft(id: string, patch: Partial<ClothesDraft>) {
    setDrafts((prev) => prev.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  function toggleDraftSelected(draft: ClothesDraft) {
    if (!canEditDrafts || isLeavingAfterDiscard || !isDraftSelectable(draft)) return;
    if (discardingDraftIds.has(draft.id)) return;
    patchDraft(draft.id, { selected: !draft.selected });
  }

  function handleSelectAllDraftsToggle() {
    if (!canEditDrafts || isLeavingAfterDiscard || selectableDraftCount === 0) return;
    setDrafts((prev) => prev.map((draft) => (
      isDraftSelectable(draft) ? { ...draft, selected: !allSelectableDraftsSelected } : draft
    )));
  }

  function handleEditDraft(draft: ClothesDraft) {
    if (isLeavingAfterDiscard) return;
    setEditingDraft(draft);
  }

  async function handleDraftFormSave(value: ClothingEditFormValue) {
    if (!editingDraft || !isFlowActive(boundRuntimeKeyRef.current)) return;

    const colors = value.colors.filter(Boolean);
    const styleTags = value.styleTags.filter(Boolean);
    patchDraft(editingDraft.id, {
      type: value.category,
      categoryName: value.subcategory || '',
      color: colors[0] || '',
      colors,
      material: value.material || '',
      thickness: value.thickness || '',
      style: styleTags[0] || '',
      styleTags,
      seasonTags: value.seasonTags.filter(Boolean),
    });
    setEditingDraft(null);
  }

  async function handleDiscard(draft: ClothesDraft) {
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowActive(flowRuntimeKey)) return;
    if (isLeavingAfterDiscard || discardRequestedRef.current || discardingDraftIds.has(draft.id)) return;
    const modalRes = await Taro.showModal({
      title: '舍弃这件衣服？',
      content: '舍弃后，这件识别结果不会保存到衣橱。',
      cancelText: '取消',
      confirmText: '舍弃',
      confirmColor: '#D97973',
    });
    if (!modalRes.confirm) return;
    if (!isFlowCurrent(authContext, flowRuntimeKey)) return;

    setDiscardingDraftIds((prev) => new Set(prev).add(draft.id));
    try {
      const result = await discardClothesDraft(draft.id);
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      if (shouldEnterTerminalDiscardLeaving(result, batchId)) {
        discardRequestedRef.current = true;
        await finalizeTerminalDiscard({
          source: 'draft',
          batchId,
          batchStatus: result.batchStatus,
          authContext,
          flowRuntimeKey,
          isFlowCurrent,
          setIsLeavingAfterDiscard,
          buildAuthRuntimeKey,
          buildUserStorageBusinessKey,
          removeUserStorageSync,
          markUploadBatchTerminal,
          removeUploadBatchFromLocalCache,
          setUserStorageSync,
          invalidateAfterUploadTaskMutation,
          navigateToWardrobe,
          onNavigationFailure: () => {
            setBatch((prev) => prev ? { ...prev, status: 'discarded' } : prev);
            setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
            Taro.showToast({ title: TERMINAL_DISCARD_FALLBACK_NOTICE, icon: 'none' });
          },
        });
        return;
      }
      setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
      await invalidateAfterUploadTaskMutation({ authContext });
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      void refresh();
    } catch (error) {
      console.warn('Discard draft failed:', error);
      if (isFlowCurrent(authContext, flowRuntimeKey)) {
        if (discardRequestedRef.current) {
          setIsLeavingAfterDiscard(false);
          setBatch((prev) => prev ? { ...prev, status: 'discarded' } : prev);
          setDrafts((prev) => prev.filter((item) => item.id !== draft.id));
          Taro.showToast({ title: TERMINAL_DISCARD_FALLBACK_NOTICE, icon: 'none' });
        } else {
          Taro.showToast({ title: '舍弃失败，请稍后再试', icon: 'none' });
        }
      }
    } finally {
      if (isFlowCurrent(authContext, flowRuntimeKey) && !discardRequestedRef.current) {
        setDiscardingDraftIds((prev) => {
          const next = new Set(prev);
          next.delete(draft.id);
          return next;
        });
      }
    }
  }

  async function handleReprocessDraft(draft: ClothesDraft) {
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowActive(flowRuntimeKey)) return;
    if (isLeavingAfterDiscard) return;
    if (segmentingDraftIdsRef.current.has(draft.id)) return;
    segmentingDraftIdsRef.current.add(draft.id);
    patchDraft(draft.id, {
      segmentStatus: 'processing',
      assetStatus: 'needs_review',
    });
    try {
      Taro.showLoading({ title: '重新处理图片...' });
      const updated = await segmentClothesDraft(draft.id);
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      await invalidateAfterUploadTaskMutation({ authContext });
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      patchDraft(updated.id, updated);
      Taro.showToast({ title: updated.segmentStatus === 'success' ? '小搭处理好啦' : '小搭已保留可用图片', icon: 'none' });
      await refresh();
    } catch (error) {
      console.warn('Reprocess draft image failed:', error);
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      patchDraft(draft.id, {
        segmentStatus: 'failed',
        displayImageUrl: draft.cropImageUrl || draft.displayImageUrl || draft.originalImageUrl,
        imageSourceType: draft.cropImageUrl ? 'crop' : 'original',
        assetStatus: 'needs_review',
      });
      Taro.showToast({ title: '小搭已保留可用图片', icon: 'none' });
    } finally {
      Taro.hideLoading();
      segmentingDraftIdsRef.current.delete(draft.id);
    }
  }

  async function handleSave() {
    if (!batchId || saving || savingRef.current || isLeavingAfterDiscard) return;
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowActive(flowRuntimeKey)) return;

    if (!isBatchComplete) {
      Taro.showToast({ title: '小搭还在识别，全部完成后就可以保存啦', icon: 'none' });
      return;
    }
    if (savableDrafts.length === 0) {
      Taro.showToast({ title: '这次还没有可保存的衣服', icon: 'none' });
      return;
    }
    if (capacity && savableDrafts.length > capacity.remaining) {
      Taro.showToast({
        title: capacity.used >= capacity.limit
          ? `衣橱已达 ${capacity.limit} 件上限`
          : `还可放入 ${capacity.remaining} 件，请减少后再保存`,
        icon: 'none',
      });
      return;
    }

    savingRef.current = true;
    setSaving(true);
    Taro.showLoading({ title: '保存中...' });
    try {
      const draftPayload = savableDrafts.map((draft) => ({
        id: draft.id,
        type: normalizeCategory(draft.type),
        categoryName: draft.categoryName,
        color: draft.color,
        colors: draft.colors,
        material: draft.material,
        thickness: draft.thickness,
        style: draft.style,
        styleTags: draft.styleTags,
        seasonTags: draft.seasonTags,
        assetVersion: draft.assetVersion,
        originalImageUrl: draft.originalImageUrl,
        normalizedImageUrl: draft.normalizedImageUrl,
        cropImageUrl: draft.cropImageUrl,
        croppedImageUrl: draft.croppedImageUrl,
        maskImageUrl: draft.maskImageUrl,
        cleanImageUrl: draft.cleanImageUrl,
        displayImageUrl: getSavableDraftImage(draft),
        imageSourceType: getDraftImageSourceType(draft),
        imageUrl: getSavableDraftImage(draft),
        assetStatus: draft.assetStatus,
        qualityScore: draft.qualityScore,
        needsUserConfirm: draft.needsUserConfirm,
        confirmReasons: draft.confirmReasons,
        bbox: draft.bbox,
        cropBox: draft.cropBox,
        itemIndex: draft.itemIndex,
        stageStatus: draft.stageStatus,
        providerTrace: draft.providerTrace,
        aiSegmentImageUrl: draft.aiSegmentImageUrl,
        manualCropImageUrl: draft.manualCropImageUrl,
        manualCropStatus: draft.manualCropStatus,
        selected: true,
      }));
      const selectedIds = draftPayload.map((draft) => draft.id);
      console.log('[upload-confirm] confirm selected drafts', {
        batchId,
        selectedIds,
        draftTotal: drafts.length,
        saveCount: draftPayload.length,
      });

      await confirmClothesDrafts(batchId, draftPayload, selectedIds);
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      await invalidateAfterConfirmDraftsSaved({ authContext });
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      setUserStorageSync(WARDROBE_REFRESH_STORAGE_KEY, true, { authContext });
      Taro.showToast({ title: '已保存到衣柜', icon: 'success' });
      setTimeout(() => {
        if (isFlowCurrent(authContext, flowRuntimeKey)) navigateToWardrobe();
      }, 700);
    } catch (error) {
      console.error('Confirm clothes drafts failed:', error);
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      const capacityError = readCapacityError(error);
      if (capacityError?.capacity) setCapacity(normalizeWardrobeCapacity(capacityError.capacity));
      Taro.showToast({ title: capacityError?.message || '保存失败', icon: 'none' });
    } finally {
      Taro.hideLoading();
      savingRef.current = false;
      if (isFlowCurrent(authContext, flowRuntimeKey)) setSaving(false);
    }
  }

  async function handleDiscardBatch() {
    if (!batchId || discardingBatch || discardRequestedRef.current || isLeavingAfterDiscard) return;
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowActive(flowRuntimeKey)) return;
    const modalRes = await Taro.showModal({
      title: '舍弃本次识别？',
      content: '舍弃后，本次上传的识别结果将不会保存到衣柜。',
      cancelText: '取消',
      confirmText: '确认舍弃',
      confirmColor: '#D97973',
    });
    if (!modalRes.confirm) return;
    if (!isFlowCurrent(authContext, flowRuntimeKey)) return;

    let batchDiscarded = false;
    discardRequestedRef.current = true;
    setDiscardingBatch(true);
    try {
      Taro.showLoading({ title: '正在舍弃...' });
      await discardUploadBatch(batchId);
      batchDiscarded = true;
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      await finalizeTerminalDiscard({
        source: 'batch',
        batchId,
        batchStatus: 'discarded',
        authContext,
        flowRuntimeKey,
        isFlowCurrent,
        setIsLeavingAfterDiscard,
        buildAuthRuntimeKey,
        buildUserStorageBusinessKey,
        removeUserStorageSync,
        markUploadBatchTerminal,
        removeUploadBatchFromLocalCache,
        setUserStorageSync,
        invalidateAfterUploadTaskMutation,
        navigateToWardrobe,
        onNavigationFailure: () => {
          setBatch((prev) => prev ? { ...prev, status: 'discarded' } : prev);
          setDrafts([]);
          Taro.showToast({ title: TERMINAL_DISCARD_FALLBACK_NOTICE, icon: 'none' });
        },
      });
    } catch (error) {
      console.error('Discard upload batch failed:', error);
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      if (batchDiscarded) {
        setIsLeavingAfterDiscard(false);
        setBatch((prev) => prev ? { ...prev, status: 'discarded' } : prev);
        setDrafts([]);
        Taro.showToast({ title: TERMINAL_DISCARD_FALLBACK_NOTICE, icon: 'none' });
      } else {
        discardRequestedRef.current = false;
        Taro.showToast({ title: '舍弃失败，请稍后再试', icon: 'none' });
      }
    } finally {
      Taro.hideLoading();
      if (isFlowCurrent(authContext, flowRuntimeKey)) setDiscardingBatch(false);
    }
  }

  const derivedState = uploadConfirmState.buildUploadConfirmState({
    batch,
    images,
    drafts,
    saving,
  });
  const {
    savableDrafts,
    visibleDrafts,
    batchProgress,
    totalImages,
    processedImages,
    recognizedCount,
    taskStatus,
    pageState,
    showProcessingProgress,
    canEditDrafts,
    canDiscardBatch,
    canSave,
    selectableDraftCount,
    allSelectableDraftsSelected,
  } = derivedState;
  const progress = totalImages > 0 ? Math.round((processedImages / totalImages) * 100) : 0;
  const isBatchComplete = batchProgress.isBatchComplete;
  const interactionLocked = isLeavingAfterDiscard;
  const canEditDraftsNow = canEditDrafts && !interactionLocked;
  const saveDisabled = !canSave || interactionLocked;
  const saveText = uploadConfirmState.getSaveButtonText(derivedState);
  const selectAllText = allSelectableDraftsSelected ? '全不选' : '全选';
  const failedImageCount = images.filter((item) => item.status === 'failed').length;
  const displayCapacity = normalizeWardrobeCapacity(capacity);
  const capacityOverSelected = savableDrafts.length > displayCapacity.remaining;

  if (loading) {
    return (
      <View className="upload-confirm-page loading">
        <View className="loading-panel">
          <View className="loading-dot" />
          <Text className="loading-text">小搭正在整理这批新衣...</Text>
        </View>
      </View>
    );
  }

  return (
    <View className={`upload-confirm-page ${editingDraft ? 'editing' : ''} ${isLeavingAfterDiscard ? 'leaving-after-discard' : ''}`}>
      <ScrollView className="upload-confirm-main-scroll" scrollY={!editingDraft && !interactionLocked} enhanced showScrollbar={false}>
      <View className={`progress-panel ${taskStatus}`}>
        <Text className="progress-title">{uploadConfirmState.getProgressTitle(derivedState)}</Text>
        <Text className="progress-desc">{uploadConfirmState.getProgressDesc(derivedState)}</Text>
        {showProcessingProgress && (
          <>
            <View className="progress-track">
              <View className="progress-fill" style={{ width: `${progress}%` }} />
            </View>
            <View className="progress-stat-list">
              <Text className="progress-stat">正在处理 {processedImages}/{totalImages} 张图片</Text>
              {recognizedCount > 0 && <Text className="progress-stat">已识别 {recognizedCount} 件衣服</Text>}
            </View>
          </>
        )}
        {showProcessingProgress && recognizedCount === 0 && (
          <Text className="progress-subhint">暂未识别到衣服，请稍等</Text>
        )}
        {(taskStatus === 'saved' || taskStatus === 'discarded') && (
          <View className="return-btn" onClick={navigateToWardrobe}>
            <Text className="return-text">返回衣橱</Text>
          </View>
        )}
      </View>

      <View className={`capacity-panel ${capacityOverSelected ? 'warning' : ''}`}>
        <Text className="capacity-line">已使用 {displayCapacity.used} / {displayCapacity.limit}</Text>
        <Text className="capacity-desc">还可放入 {displayCapacity.remaining} 件</Text>
      </View>

      {failedImageCount > 0 && (
        <View className="image-status-panel">
          {images.filter((item) => item.status === 'failed').map((item) => (
            <View key={item.id} className="failed-row">
              <Text className="failed-text">有 {failedImageCount} 张图片暂时没整理好，可稍后重试</Text>
              <View className="retry-btn" onClick={() => handleRetry(item)}>
                <Text className="retry-text">重新处理</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View className="draft-list">
        {visibleDrafts.length === 0 && pageState !== 'processing' && (
          <View className="empty-state">
            <View className="empty-illustration">
              <Text className="empty-icon">衣</Text>
            </View>
            <Text className="empty-title">{uploadConfirmState.getEmptyTitle(derivedState)}</Text>
            <Text className="empty-desc">{uploadConfirmState.getEmptyDesc(derivedState, batch)}</Text>
          </View>
        )}

        {visibleDrafts.map((draft: ClothesDraft) => {
          const isDiscardingDraft = discardingDraftIds.has(draft.id);
          return (
          <View
            key={draft.id}
            className={`draft-card ${draft.selected ? 'selected' : 'muted'} ${canEditDraftsNow && isDraftSelectable(draft) ? 'selectable' : 'readonly'} ${isDiscardingDraft ? 'discarding' : ''}`}
            onClick={() => toggleDraftSelected(draft)}
          >
            <View className="draft-image-wrapper">
              <SafeImage className="draft-image" src={getDraftDisplayImage(draft)} mode="aspectFill" lazyLoad />
            </View>
            <View className="draft-body">
              <View className="draft-topline">
                <Text className={`draft-keep-badge ${draft.selected ? 'active' : ''}`}>
                  {draft.selected ? '已选择' : '未选择'}
                </Text>
                <Text className="confidence">置信度 {draft.confidence || 0}%</Text>
              </View>
              <View className="status-line">
                <Text className={`asset-status ${getDraftPrimaryStatusClass(draft)}`}>{getDraftPrimaryStatusText(draft)}</Text>
              </View>

              <View className="draft-summary">
                <Text className="draft-title">{getDraftSummaryTitle(draft)}</Text>
                <View className="summary-tags">
                  {getDraftSummaryTags(draft).map((tag) => (
                    <Text key={tag} className="summary-tag">{tag}</Text>
                  ))}
                  {getDraftSummaryTags(draft).length === 0 && (
                    <Text className="summary-empty">暂无更多属性</Text>
                  )}
                </View>
              </View>

              <View className="source-row">
                <Text className="field-label">展示图</Text>
                <Text className="source-note">{getDraftImageSourceText(draft)}</Text>
              </View>

              <View className="draft-actions">
                {canEditDraftsNow && (
                  <>
                    <View className="edit-btn" onClick={(event) => {
                      event.stopPropagation();
                      handleEditDraft(draft);
                    }}>
                      <Text className="edit-text">编辑属性</Text>
                    </View>
                    <View className="reprocess-btn" onClick={(event) => {
                      event.stopPropagation();
                      handleReprocessDraft(draft);
                    }}>
                      <Text className="reprocess-text">重新处理</Text>
                    </View>
                    <View className={`discard-btn ${isDiscardingDraft || interactionLocked ? 'disabled' : ''}`} onClick={(event) => {
                      event.stopPropagation();
                      handleDiscard(draft);
                    }}>
                      <Text className="discard-text">{isDiscardingDraft ? '舍弃中...' : '舍弃这件'}</Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          </View>
          );
        })}
      </View>

      </ScrollView>

      {editingDraft && (
        <View className="draft-edit-overlay">
          <View className="draft-edit-mask" catchMove />
          <View className="draft-edit-panel" onClick={(event) => event.stopPropagation()}>
            <ClothingEditForm
              initialValue={toDraftFormValue(editingDraft)}
              showImage
              showMetaFields={false}
              submitText="保存属性"
              onSave={handleDraftFormSave}
              onCancel={() => setEditingDraft(null)}
              mode="draft-confirm"
              layoutMode="panel"
            />
          </View>
        </View>
      )}

      {isLeavingAfterDiscard && (
        <View className="leaving-discard-overlay" catchMove>
          <View className="leaving-discard-panel">
            <View className="leaving-discard-dot" />
            <Text className="leaving-discard-text">正在返回衣橱...</Text>
          </View>
        </View>
      )}

      <View className="save-bar">
        {canDiscardBatch ? (
          <View className={`discard-batch-btn ${discardingBatch || interactionLocked ? 'disabled' : ''}`} onClick={handleDiscardBatch}>
            <Text className="discard-batch-text">{discardingBatch ? '舍弃中...' : '舍弃本次'}</Text>
          </View>
        ) : (
          <View className="save-bar-placeholder" />
        )}
        <View
          className={`select-all-drafts-btn ${!canEditDraftsNow || selectableDraftCount === 0 ? 'disabled' : ''}`}
          onClick={handleSelectAllDraftsToggle}
        >
          <Text className="select-all-drafts-text">{selectAllText}</Text>
        </View>
        <View className={`save-btn ${saveDisabled ? 'disabled' : ''}`} onClick={handleSave}>
          <Text className="save-text">{saveText}</Text>
        </View>
      </View>
    </View>
  );
}

function getCategoryLabel(type?: string) {
  return CATEGORY_OPTIONS.find((item) => item.value === normalizeCategory(type))?.label || '其他';
}

function normalizeCategory(value?: string): ClothingCategory {
  const map: Record<string, ClothingCategory> = {
    top: 'top',
    上衣: 'top',
    外套: 'top',
    bottom: 'bottom',
    下装: 'bottom',
    裤子: 'bottom',
    裙子: 'bottom',
    onepiece: 'onepiece',
    dress: 'onepiece',
    连体: 'onepiece',
    连衣裙: 'onepiece',
    shoes: 'shoes',
    鞋子: 'shoes',
    accessory: 'accessory',
    配饰: 'accessory',
    包: 'accessory',
    帽子: 'accessory',
    other: 'other',
    其他: 'other',
  };
  return map[value || ''] || 'other';
}

function toDraftFormValue(draft: ClothesDraft): ClothingEditFormValue {
  const styleTags = draft.styleTags && draft.styleTags.length > 0
    ? draft.styleTags
    : (draft.style ? [draft.style] : []);

  return {
    imageUrl: getDraftDisplayImage(draft),
    customName: '',
    brand: '',
    customTags: [],
    category: normalizeCategory(draft.type),
    subcategory: draft.categoryName || '',
    colors: draft.colors && draft.colors.length > 0 ? draft.colors : (draft.color ? [draft.color] : []),
    material: draft.material || '',
    thickness: draft.thickness || '',
    styleTags,
    seasonTags: draft.seasonTags || [],
  };
}

function getDraftSummaryTitle(draft: ClothesDraft) {
  const category = getCategoryLabel(draft.type);
  const subcategory = getSubcategoryDisplayLabel(normalizeCategory(draft.type), draft.categoryName);
  return subcategory ? `${category} · ${subcategory}` : category;
}

function getDraftSummaryTags(draft: ClothesDraft) {
  const tags = [
    ...displayClothingTags(draft.colors && draft.colors.length > 0 ? draft.colors : (draft.color ? [draft.color] : [])),
    ...displayClothingTags(draft.seasonTags),
    ...displayClothingTags(draft.styleTags && draft.styleTags.length > 0 ? draft.styleTags : (draft.style ? [draft.style] : [])),
    displayClothingText(draft.material),
    displayClothingText(draft.thickness),
  ].filter(Boolean);

  return Array.from(new Set(tags)).slice(0, 8);
}

function isImageProcessed(image: UploadImage) {
  return image.status === 'detected' || image.status === 'completed' || image.status === 'success' || image.status === 'empty' || image.status === 'failed';
}

function isImagePendingForProcess(image: UploadImage) {
  if (isImageProcessed(image)) return false;
  return image.status === 'pending' || image.status === 'detecting' || image.status === 'processing';
}

function mergeDrafts(prev: ClothesDraft[], next: ClothesDraft[]) {
  if (next.length === 0) return prev;
  const byId = new Map(prev.map((draft) => [draft.id, draft]));
  next.forEach((draft) => {
    byId.set(draft.id, draft);
  });
  return Array.from(byId.values());
}

type UploadBatchViewStatus = 'processing' | 'ready' | 'failed' | 'saved' | 'discarded';
type UploadConfirmPageState = 'processing' | 'ready' | 'empty';

interface BatchProgress {
  totalImages: number;
  processedImages: number;
  isBatchComplete: boolean;
}

function getBatchProgress(batch: UploadBatch | null, images: UploadImage[]): BatchProgress {
  const totalImages = Math.max(0, Number(batch?.totalImages ?? images.length));
  const fallbackProcessedImages = images.filter((item) => isImageProcessed(item)).length;
  const processedImages = Math.min(
    totalImages,
    Math.max(0, Number(batch?.processedImages ?? fallbackProcessedImages)),
  );

  return {
    totalImages,
    processedImages,
    isBatchComplete: totalImages > 0 && processedImages >= totalImages,
  };
}

function getPageState(isBatchComplete: boolean, hasSavableDrafts: boolean): UploadConfirmPageState {
  if (!isBatchComplete) return 'processing';
  if (hasSavableDrafts) return 'ready';
  return 'empty';
}

function normalizeUploadBatchStatus(status?: string): UploadBatchViewStatus {
  if (status === 'ready' || status === 'success' || status === 'partial_success' || status === 'completed') return 'ready';
  if (status === 'failed' || status === 'empty' || status === 'partial_failed') return 'failed';
  if (status === 'saved') return 'saved';
  if (status === 'discarded') return 'discarded';
  return 'processing';
}

function getProgressTitle(state: UploadConfirmPageState, status: UploadBatchViewStatus) {
  if (status === 'saved') return '这批衣服已保存到衣橱';
  if (status === 'discarded') return '这批识别已舍弃';
  if (state === 'processing') return '小搭正在帮你整理新衣服';
  if (state === 'ready') return '小搭整理好啦';
  return '这次没识别出可保存的衣服';
}

function getProgressDesc(
  state: UploadConfirmPageState,
  recognizedCount: number,
  processedImages: number,
  totalImages: number,
  status: UploadBatchViewStatus,
) {
  if (status === 'saved') return '返回衣橱，就能看到刚刚保存好的衣服啦。';
  if (status === 'discarded') return '这批识别结果不会保存到衣橱。';
  if (state === 'ready') return `已识别出 ${recognizedCount} 件衣服，确认后就能放进衣橱`;
  if (state === 'empty') return '可以换张更清晰的照片再试试，或先舍弃本次识别。';
  if (recognizedCount > 0) {
    return `小搭已经识别出 ${recognizedCount} 件衣服，正在处理剩下的图片，全部完成后就可以一起确认啦。`;
  }
  return `正在处理 ${processedImages}/${totalImages} 张图片，整理完成后就可以确认啦。`;
}

function getFailedStatusMessage(batch?: UploadBatch | null) {
  return batch?.errorMessage || batch?.summaryMessage || '本次识别未成功，可以返回衣橱重新上传更清晰的照片。';
}

function isSavableDraft(draft: ClothesDraft) {
  return uploadConfirmState.isSavableDraft(draft);
}

function isDraftSelectable(draft: ClothesDraft) {
  return uploadConfirmState.isDraftSelectable(draft);
}

function isDraftProcessing(draft: ClothesDraft) {
  return uploadConfirmState.isProcessingDraft(draft);
}

function getSavableDraftImage(draft: ClothesDraft) {
  return draft.displayImageUrl || draft.originalImageUrl;
}

function getSaveButtonText(
  state: UploadConfirmPageState,
  processedImages: number,
  totalImages: number,
  saving: boolean,
  savableCount: number,
) {
  if (saving) return '保存中...';
  if (state === 'ready' && savableCount > 0) return `保存 ${savableCount} 件`;
  if (state === 'ready') return '保存到衣橱';
  if (state === 'processing') return `识别中 ${processedImages}/${totalImages}`;
  return '暂无可保存衣服';
}

function getEmptyTitle(state: UploadConfirmPageState, status: UploadBatchViewStatus) {
  if (status === 'saved') return '这批衣服已保存到衣橱';
  if (status === 'discarded') return '这批识别已舍弃';
  if (state === 'empty') return '这批新衣暂时没有可确认的结果';
  if (status === 'failed') return '暂无可确认的衣物';
  return '暂无可确认的衣物';
}

function getEmptyDesc(state: UploadConfirmPageState, status: UploadBatchViewStatus, batch?: UploadBatch | null) {
  if (status === 'saved') return '返回衣橱即可查看已保存的衣服。';
  if (status === 'discarded') return '这批识别结果不会保存到衣橱。';
  if (state === 'empty') return '可以返回衣橱重新上传更清晰的照片。';
  if (status === 'failed') return getFailedStatusMessage(batch);
  return '可以下拉刷新，或对失败图片重新整理。';
}

function getDraftPrimaryStatusText(draft: ClothesDraft) {
  if (isUsingOriginalFallback(draft)) return '已保留原图';
  if (draft.assetStatus === 'ready') return '已处理完成';
  if (draft.assetStatus === 'failed') return '处理异常';
  if (isDraftProcessing(draft)) return '小搭整理中';
  return '小搭整理中';
}

function getDraftPrimaryStatusClass(draft: ClothesDraft) {
  if (isUsingOriginalFallback(draft)) return 'original_fallback';
  if (draft.assetStatus === 'ready') return 'ready';
  if (draft.assetStatus === 'failed') return 'failed';
  return 'needs_review';
}

function getDraftDisplayImage(draft: ClothesDraft) {
  return getUploadDraftDisplayImage(draft);
}

function getDraftImageSourceType(draft: ClothesDraft): ClothingImageSourceType {
  if (draft.cleanImageUrl || (draft.aiSegmentImageUrl && draft.segmentStatus === 'success')) return 'clean';
  if (draft.cropImageUrl || draft.croppedImageUrl || (draft.manualCropImageUrl && draft.manualCropStatus === 'success')) return 'crop';
  return 'original';
}

function getDraftImageSourceText(draft: ClothesDraft) {
  const sourceType = getDraftImageSourceType(draft);
  if (isUsingOriginalFallback(draft)) return '小搭没能抠出清晰衣物图，已先帮你保留原图。';
  if (sourceType === 'clean') return '小搭已生成清晰衣物图。';
  if (sourceType === 'crop') return '小搭已帮你截取衣服区域。';
  return '小搭正在整理这件衣服。';
}

function isUsingOriginalFallback(draft: ClothesDraft) {
  const hasOriginalImage = Boolean(draft.originalImageUrl);
  const hasUsableImage = Boolean(draft.displayImageUrl || draft.originalImageUrl);
  return (
    hasOriginalImage
    && (
      draft.segmentStatus === 'failed'
      || draft.segmentStatus === 'skipped'
      || draft.imageSourceType === 'original'
      || draft.displayImageUrl === draft.originalImageUrl
      || (!draft.cleanImageUrl && hasUsableImage)
      || (draft.assetStatus === 'needs_review' && hasUsableImage)
    )
  );
}
