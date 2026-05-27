import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useRouter, useUnload } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import { ClothingEditForm, type ClothingEditFormValue } from '@/components/ClothingEditForm';
import { CATEGORY_OPTIONS } from '@/components/ClothingEditForm/constants';
import {
  confirmClothesDrafts,
  discardClothesDraft,
  discardUploadBatch,
  getUploadBatchDetail,
  processUploadImage,
  segmentClothesDraft,
} from '@/lib/cloud';
import { displayClothingTags, displayClothingText } from '@/utils/clothingLabels';
import type { ClothesDraft, ClothingCategory, UploadBatch, UploadImage } from '@starter-template/types';
import './index.scss';

const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';

export default function UploadConfirmPage() {
  const router = useRouter();
  const batchId = router.params.batchId || '';
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [images, setImages] = useState<UploadImage[]>([]);
  const [drafts, setDrafts] = useState<ClothesDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [discardingBatch, setDiscardingBatch] = useState(false);
  const [editingDraft, setEditingDraft] = useState<ClothesDraft | null>(null);
  const processingLoopRef = useRef(false);
  const mountedRef = useRef(true);
  const discardRequestedRef = useRef(false);
  const segmentingDraftIdsRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    if (!batchId) return;
    try {
      const detail = await getUploadBatchDetail(batchId);
      if (!mountedRef.current) return detail;
      setBatch(detail.batch);
      setImages(detail.images);
      setDrafts(detail.drafts);
      return detail;
    } catch (error) {
      console.error('Fetch upload batch detail failed:', error);
      if (mountedRef.current) {
        Taro.showToast({ title: '加载失败', icon: 'none' });
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        Taro.stopPullDownRefresh();
      }
    }
  }, [batchId]);

  useLoad(() => {
    mountedRef.current = true;
    refresh().then((detail) => {
      if (normalizeUploadBatchStatus(detail?.batch.status) === 'processing') {
        void processPendingImages(detail?.images);
      }
    });
  });

  useUnload(() => {
    mountedRef.current = false;
  });

  usePullDownRefresh(() => {
    refresh();
  });

  async function processPendingImages(imagesOverride?: UploadImage[]) {
    if (!batchId || processingLoopRef.current || !mountedRef.current || discardRequestedRef.current) return;
    processingLoopRef.current = true;
    setProcessing(true);

    const stored = Taro.getStorageSync(`uploadBatchImages:${batchId}`) as string[] | undefined;
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
        Taro.removeStorageSync(`uploadBatchImages:${batchId}`);
        if (mountedRef.current) await refresh();
        return;
      }

      for (let index = 0; index < targetIds.length; index += 1) {
        if (!mountedRef.current || discardRequestedRef.current) return;
        const imageId = targetIds[index];
        if (!imageId) continue;
        await processUploadImage(imageId);
        if (!mountedRef.current || discardRequestedRef.current) return;
        await refresh();
      }
      Taro.removeStorageSync(`uploadBatchImages:${batchId}`);
    } finally {
      processingLoopRef.current = false;
      if (mountedRef.current && !discardRequestedRef.current) {
        setProcessing(false);
        await refresh();
      }
    }
  }

  async function handleRetry(image: UploadImage) {
    setProcessing(true);
    try {
      Taro.showLoading({ title: '小搭重新整理...' });
      await processUploadImage(image.id);
      await refresh();
    } catch (error) {
      console.error('Retry upload image failed:', error);
      Taro.showToast({ title: '重试失败', icon: 'none' });
    } finally {
      Taro.hideLoading();
      setProcessing(false);
    }
  }

  function patchDraft(id: string, patch: Partial<ClothesDraft>) {
    setDrafts((prev) => prev.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  function handleEditDraft(draft: ClothesDraft) {
    setEditingDraft(draft);
  }

  async function handleDraftFormSave(value: ClothingEditFormValue) {
    if (!editingDraft) return;

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
    patchDraft(draft.id, { selected: false, status: 'discarded' });
    try {
      await discardClothesDraft(draft.id);
    } catch (error) {
      console.warn('Discard draft failed:', error);
    }
  }

  async function handleReprocessDraft(draft: ClothesDraft) {
    if (segmentingDraftIdsRef.current.has(draft.id)) return;
    segmentingDraftIdsRef.current.add(draft.id);
    patchDraft(draft.id, {
      segmentStatus: 'processing',
      assetStatus: 'needs_review',
    });
    try {
      Taro.showLoading({ title: '重新处理图片...' });
      const updated = await segmentClothesDraft(draft.id);
      patchDraft(updated.id, updated);
      Taro.showToast({ title: updated.segmentStatus === 'success' ? '处理完成' : '需要确认', icon: 'none' });
      await refresh();
    } catch (error) {
      console.warn('Reprocess draft image failed:', error);
      patchDraft(draft.id, {
        segmentStatus: 'failed',
        displayImageUrl: draft.cropImageUrl || draft.displayImageUrl || draft.originalImageUrl,
        imageSourceType: draft.cropImageUrl ? 'crop' : 'original',
        assetStatus: 'needs_review',
      });
      Taro.showToast({ title: '图片处理失败，已保留可用图片', icon: 'none' });
    } finally {
      Taro.hideLoading();
      segmentingDraftIdsRef.current.delete(draft.id);
    }
  }

  async function handleSave() {
    if (!batchId || saving) return;
    if (savableDrafts.length === 0) {
      Taro.showToast({ title: getDisabledSaveToast(taskStatus), icon: 'none' });
      return;
    }

    setSaving(true);
    Taro.showLoading({ title: '保存中...' });
    try {
      await confirmClothesDrafts(batchId, savableDrafts.map((draft) => ({
        id: draft.id,
        type: draft.type,
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
        displayImageUrl: getDraftDisplayImage(draft),
        imageSourceType: getDraftImageSourceType(draft),
        imageUrl: getDraftDisplayImage(draft),
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
      })));
      Taro.setStorageSync(WARDROBE_REFRESH_STORAGE_KEY, true);
      Taro.showToast({ title: '已保存到衣柜', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 700);
    } catch (error) {
      console.error('Confirm clothes drafts failed:', error);
      Taro.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      Taro.hideLoading();
      setSaving(false);
    }
  }

  async function handleDiscardBatch() {
    if (!batchId || discardingBatch) return;
    const modalRes = await Taro.showModal({
      title: '舍弃本次识别？',
      content: '舍弃后，本次上传的识别结果将不会保存到衣柜。',
      cancelText: '取消',
      confirmText: '确认舍弃',
      confirmColor: '#ef4444',
    });
    if (!modalRes.confirm) return;

    discardRequestedRef.current = true;
    setDiscardingBatch(true);
    try {
      Taro.showLoading({ title: '正在舍弃...' });
      Taro.removeStorageSync(`uploadBatchImages:${batchId}`);
      await discardUploadBatch(batchId);
      Taro.setStorageSync(WARDROBE_REFRESH_STORAGE_KEY, true);
      Taro.showToast({ title: '已舍弃本次识别', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 600);
    } catch (error) {
      console.error('Discard upload batch failed:', error);
      discardRequestedRef.current = false;
      Taro.showToast({ title: '舍弃失败，请稍后再试', icon: 'none' });
    } finally {
      Taro.hideLoading();
      if (mountedRef.current) setDiscardingBatch(false);
    }
  }

  const savableDrafts = drafts.filter(isSavableDraft);
  const totalImages = batch?.totalImages ?? images.length;
  const processedImages = batch?.processedImages ?? images.filter((item) => isImageProcessed(item)).length;
  const imageDetectedCount = images.reduce((sum, item) => sum + item.detectedCount, 0);
  const detectedCount = Math.max(drafts.length, batch?.totalDetectedClothes ?? 0, imageDetectedCount);
  const progress = totalImages > 0 ? Math.round((processedImages / totalImages) * 100) : 0;
  const taskStatus = normalizeUploadBatchStatus(batch?.status);
  const canEditDrafts = taskStatus !== 'saved' && taskStatus !== 'discarded';
  const canDiscardBatch = taskStatus === 'processing' || taskStatus === 'ready' || taskStatus === 'failed';
  const saveDisabled = saving || savableDrafts.length === 0;
  const saveText = getSaveButtonText(savableDrafts.length, saving);

  if (loading) {
    return (
      <View className="upload-confirm-page loading">
        <Text className="loading-text">正在加载整理任务...</Text>
      </View>
    );
  }

  return (
    <View className="upload-confirm-page">
      <View className={`progress-panel ${taskStatus}`}>
        <Text className="progress-title">{getProgressTitle(taskStatus)}</Text>
        <Text className="progress-desc">{getProgressDesc(taskStatus, batch)}</Text>
        <View className="progress-track">
          <View className="progress-fill" style={{ width: `${progress}%` }} />
        </View>
        <View className="progress-stat-list">
          <Text className="progress-stat">正在处理 {processedImages}/{totalImages} 张图片</Text>
          <Text className="progress-stat">已识别 {detectedCount} 件衣服</Text>
        </View>
        {taskStatus === 'processing' && detectedCount === 0 && (
          <Text className="progress-subhint">暂未识别到衣服，请稍等</Text>
        )}
        {taskStatus === 'failed' && (
          <Text className="progress-subhint">{getFailedStatusMessage(batch)}</Text>
        )}
        {(taskStatus === 'saved' || taskStatus === 'discarded') && (
          <View className="return-btn" onClick={() => Taro.navigateBack()}>
            <Text className="return-text">返回衣柜</Text>
          </View>
        )}
      </View>

      {images.some((item) => item.status === 'failed') && (
        <View className="image-status-panel">
          {images.filter((item) => item.status === 'failed').map((item) => (
            <View key={item.id} className="failed-row">
              <Text className="failed-text">有图片部分处理失败，可稍后重试{item.errorMessage ? `：${item.errorMessage}` : ''}</Text>
              <View className="retry-btn" onClick={() => handleRetry(item)}>
                <Text className="retry-text">重试</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <ScrollView className="draft-list" scrollY>
        {drafts.length === 0 && taskStatus !== 'processing' && (
          <View className="empty-state">
            <Text className="empty-title">{getEmptyTitle(taskStatus)}</Text>
            <Text className="empty-desc">{getEmptyDesc(taskStatus, batch)}</Text>
          </View>
        )}

        {drafts.map((draft) => (
          <View key={draft.id} className={`draft-card ${draft.selected ? '' : 'muted'}`}>
            <Image className="draft-image" src={getDraftDisplayImage(draft)} mode="aspectFill" />
            <View className="draft-body">
              <View className="draft-topline">
                <View
                  className={`select-dot ${draft.selected ? 'active' : ''} ${canEditDrafts ? '' : 'disabled'}`}
                  onClick={() => {
                    if (canEditDrafts) patchDraft(draft.id, { selected: !draft.selected });
                  }}
                >
                  <Text className="select-mark">{draft.selected ? '✓' : ''}</Text>
                </View>
                <Text className="confidence">置信度 {draft.confidence || 0}%</Text>
              </View>
              <View className="status-line">
                <Text className={`asset-status ${draft.assetStatus || 'needs_review'}`}>{getAssetStatusText(draft)}</Text>
                <Text className={`segment-status ${draft.segmentStatus}`}>{getSegmentStatusText(draft)}</Text>
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
                {canEditDrafts && (
                  <>
                    <View className="edit-btn" onClick={() => handleEditDraft(draft)}>
                      <Text className="edit-text">编辑属性</Text>
                    </View>
                    <View className="reprocess-btn" onClick={() => handleReprocessDraft(draft)}>
                      <Text className="reprocess-text">重新处理图片</Text>
                    </View>
                    <View className="discard-btn" onClick={() => handleDiscard(draft)}>
                      <Text className="discard-text">丢弃</Text>
                    </View>
                  </>
                )}
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      {editingDraft && (
        <View className="draft-edit-overlay">
          <View className="draft-edit-panel">
            <ClothingEditForm
              initialValue={toDraftFormValue(editingDraft)}
              showImage
              showMetaFields={false}
              submitText="保存属性"
              onSave={handleDraftFormSave}
              onCancel={() => setEditingDraft(null)}
            />
          </View>
        </View>
      )}

      <View className="save-bar">
        {canDiscardBatch ? (
          <View className={`discard-batch-btn ${discardingBatch ? 'disabled' : ''}`} onClick={handleDiscardBatch}>
            <Text className="discard-batch-text">{discardingBatch ? '舍弃中...' : '舍弃本次识别'}</Text>
          </View>
        ) : (
          <View className="save-bar-placeholder" />
        )}
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
  const subcategory = displayClothingText(draft.categoryName);
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

type UploadBatchViewStatus = 'processing' | 'ready' | 'failed' | 'saved' | 'discarded';

function normalizeUploadBatchStatus(status?: string): UploadBatchViewStatus {
  if (status === 'ready' || status === 'success' || status === 'partial_success' || status === 'completed') return 'ready';
  if (status === 'failed' || status === 'empty' || status === 'partial_failed') return 'failed';
  if (status === 'saved') return 'saved';
  if (status === 'discarded') return 'discarded';
  return 'processing';
}

function getProgressTitle(status: UploadBatchViewStatus) {
  if (status === 'ready') return '识别完成，待确认';
  if (status === 'failed') return '识别未完成';
  if (status === 'saved') return '本次识别已保存到衣柜';
  if (status === 'discarded') return '本次识别已舍弃';
  return '正在识别衣服';
}

function getProgressDesc(status: UploadBatchViewStatus, batch?: UploadBatch | null) {
  if (status === 'ready') return batch?.summaryMessage || '请确认识别结果，保存后会加入衣柜。';
  if (status === 'failed') return getFailedStatusMessage(batch);
  if (status === 'saved') return '这批识别结果已经保存，请返回衣柜查看。';
  if (status === 'discarded') return '这批上传识别已被舍弃，不能继续保存。';
  return 'AI 正在分析图片中的衣服，可能需要几秒到几十秒。你可以先返回衣柜，稍后继续处理。';
}

function getFailedStatusMessage(batch?: UploadBatch | null) {
  return batch?.errorMessage || batch?.summaryMessage || '本次识别未成功，可查看已有结果或返回衣柜。';
}

function isSavableDraft(draft: ClothesDraft) {
  return (
    draft.status === 'pending'
    && draft.selected
    && draft.assetStatus === 'ready'
    && draft.segmentStatus === 'success'
    && getDraftImageSourceType(draft) === 'clean'
    && Boolean(getDraftDisplayImage(draft))
  );
}

function getSaveButtonText(savableCount: number, saving: boolean) {
  if (saving) return '保存中...';
  if (savableCount === 0) return '识别完成后可保存';
  return '保存到衣柜';
}

function getDisabledSaveToast(status: UploadBatchViewStatus) {
  if (status === 'processing') return '识别完成后再保存';
  if (status === 'saved') return '本次识别已保存';
  if (status === 'discarded') return '本次识别已舍弃';
  return '暂无可保存的衣服';
}

function getEmptyTitle(status: UploadBatchViewStatus) {
  if (status === 'saved') return '本次识别已保存到衣柜';
  if (status === 'discarded') return '本次识别已舍弃';
  if (status === 'failed') return '暂无可确认的衣物';
  return '暂无可确认的衣物';
}

function getEmptyDesc(status: UploadBatchViewStatus, batch?: UploadBatch | null) {
  if (status === 'saved') return '返回衣柜即可查看已保存的衣服。';
  if (status === 'discarded') return '这批识别结果不会保存到衣柜。';
  if (status === 'failed') return getFailedStatusMessage(batch);
  return '可以下拉刷新，或对失败图片重新整理。';
}

function getSegmentStatusText(draft: ClothesDraft) {
  if (draft.segmentStatus === 'success') return '清晰衣物图已就绪';
  if (draft.segmentStatus === 'processing' || draft.segmentStatus === 'queued') return '小搭正在生成干净图';
  if (draft.segmentStatus === 'failed') return '图片增强失败';
  if (draft.segmentStatus === 'skipped' && (draft.cropImageUrl || draft.croppedImageUrl)) return '已保留自动截取图';
  return '已保留可用图片';
}

function getAssetStatusText(draft: ClothesDraft) {
  if (draft.assetStatus === 'ready') return '已处理完成';
  if (draft.assetStatus === 'failed') return '处理失败';
  return '需要确认';
}

function getDraftDisplayImage(draft: ClothesDraft) {
  if (draft.cleanImageUrl) return draft.cleanImageUrl;
  if (draft.aiSegmentImageUrl && draft.segmentStatus === 'success') return draft.aiSegmentImageUrl;
  if (draft.cropImageUrl) return draft.cropImageUrl;
  if (draft.croppedImageUrl) return draft.croppedImageUrl;
  if (draft.displayImageUrl) return draft.displayImageUrl;
  if (draft.imageUrl) return draft.imageUrl;
  if (draft.manualCropImageUrl && draft.manualCropStatus === 'success') return draft.manualCropImageUrl;
  return draft.originalImageUrl;
}

function getDraftImageSourceType(draft: ClothesDraft) {
  if (draft.cleanImageUrl || (draft.aiSegmentImageUrl && draft.segmentStatus === 'success')) return 'clean';
  if (draft.cropImageUrl || draft.croppedImageUrl || (draft.manualCropImageUrl && draft.manualCropStatus === 'success')) return 'crop';
  return 'original';
}

function getDraftImageSourceText(draft: ClothesDraft) {
  const sourceType = getDraftImageSourceType(draft);
  if (sourceType === 'clean') return '已生成清晰衣物图';
  if (sourceType === 'crop') return '已自动截取衣服区域';
  if (draft.segmentStatus === 'processing' || draft.segmentStatus === 'queued') return '小搭正在生成干净图';
  return '图片处理不理想，已先使用原图';
}
