import { Image, Input, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useLoad, usePullDownRefresh, useRouter } from '@tarojs/taro';
import { useCallback, useRef, useState } from 'react';
import {
  confirmClothesDrafts,
  discardClothesDraft,
  getUploadBatchDetail,
  processUploadImage,
} from '@/lib/cloud';
import type { ClothesDraft, ClothingCategory, UploadBatch, UploadImage } from '@starter-template/types';
import './index.scss';

const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';
const categoryOptions: Array<{ key: ClothingCategory; label: string }> = [
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '下装' },
  { key: 'onepiece', label: '连体' },
  { key: 'shoes', label: '鞋子' },
  { key: 'accessory', label: '配饰' },
  { key: 'other', label: '其他' },
];

export default function UploadConfirmPage() {
  const router = useRouter();
  const batchId = router.params.batchId || '';
  const [batch, setBatch] = useState<UploadBatch | null>(null);
  const [images, setImages] = useState<UploadImage[]>([]);
  const [drafts, setDrafts] = useState<ClothesDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const processingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!batchId) return;
    try {
      const detail = await getUploadBatchDetail(batchId);
      setBatch(detail.batch);
      setImages(detail.images);
      setDrafts(detail.drafts);
      return detail;
    } catch (error) {
      console.error('Fetch upload batch detail failed:', error);
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
      Taro.stopPullDownRefresh();
    }
  }, [batchId]);

  useLoad(() => {
    refresh().then((detail) => {
      void processPendingImages(detail?.images);
    });
  });

  usePullDownRefresh(() => {
    refresh();
  });

  async function processPendingImages(imagesOverride?: UploadImage[]) {
    if (!batchId || processingRef.current) return;
    processingRef.current = true;
    setProcessing(true);

    const stored = Taro.getStorageSync(`uploadBatchImages:${batchId}`) as string[] | undefined;
    const sourceImages = imagesOverride ?? images;
    const targetIds = Array.isArray(stored) && stored.length > 0
      ? stored
      : sourceImages.filter((item) => item.status === 'pending').map((item) => item.id);

    try {
      for (let index = 0; index < targetIds.length; index += 1) {
        const imageId = targetIds[index];
        if (!imageId) continue;
        Taro.showLoading({ title: `识别 ${index + 1}/${targetIds.length}` });
        await processUploadImage(imageId);
        await refresh();
      }
      Taro.removeStorageSync(`uploadBatchImages:${batchId}`);
    } finally {
      Taro.hideLoading();
      processingRef.current = false;
      setProcessing(false);
      await refresh();
    }
  }

  async function handleRetry(image: UploadImage) {
    setProcessing(true);
    try {
      Taro.showLoading({ title: '重新识别...' });
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

  async function handleCategorySelect(draft: ClothesDraft) {
    const res = await Taro.showActionSheet({ itemList: categoryOptions.map((item) => item.label) });
    const option = categoryOptions[res.tapIndex];
    if (option) patchDraft(draft.id, { type: option.key });
  }

  async function handleDiscard(draft: ClothesDraft) {
    patchDraft(draft.id, { selected: false, status: 'discarded' });
    try {
      await discardClothesDraft(draft.id);
    } catch (error) {
      console.warn('Discard draft failed:', error);
    }
  }

  async function handleSave() {
    if (!batchId || saving) return;
    const pendingDrafts = drafts.filter((draft) => draft.status === 'pending' || draft.status === 'discarded');
    const selectedCount = pendingDrafts.filter((draft) => draft.selected && draft.status !== 'discarded').length;
    if (selectedCount === 0) {
      Taro.showToast({ title: '请选择至少一件衣服', icon: 'none' });
      return;
    }

    setSaving(true);
    Taro.showLoading({ title: '保存中...' });
    try {
      await confirmClothesDrafts(batchId, pendingDrafts.map((draft) => ({
        id: draft.id,
        type: draft.type,
        categoryName: draft.categoryName,
        color: draft.color,
        colors: draft.colors,
        material: draft.material,
        style: draft.style,
        selected: draft.selected && draft.status !== 'discarded',
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

  const selectedCount = drafts.filter((draft) => draft.selected && draft.status === 'pending').length;
  const totalImages = batch?.totalImages ?? images.length;
  const processedImages = batch?.processedImages ?? images.filter((item) => item.status === 'completed' || item.status === 'failed').length;
  const progress = totalImages > 0 ? Math.round((processedImages / totalImages) * 100) : 0;

  if (loading) {
    return (
      <View className="upload-confirm-page loading">
        <Text className="loading-text">正在加载识别任务...</Text>
      </View>
    );
  }

  return (
    <View className="upload-confirm-page">
      <View className="progress-panel">
        <View className="progress-head">
          <Text className="progress-title">批量识别</Text>
          <Text className="progress-count">{processedImages}/{totalImages}</Text>
        </View>
        <View className="progress-track">
          <View className="progress-fill" style={{ width: `${progress}%` }} />
        </View>
        <Text className="progress-hint">
          {processing ? '正在逐张识别，单张失败不会影响其他图片' : `状态：${batch?.status || 'pending'}`}
        </Text>
      </View>

      {images.some((item) => item.status === 'failed') && (
        <View className="image-status-panel">
          {images.filter((item) => item.status === 'failed').map((item) => (
            <View key={item.id} className="failed-row">
              <Text className="failed-text">有一张图片识别失败：{item.errorMessage || '未知错误'}</Text>
              <View className="retry-btn" onClick={() => handleRetry(item)}>
                <Text className="retry-text">重试</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <ScrollView className="draft-list" scrollY>
        {drafts.length === 0 && !processing && (
          <View className="empty-state">
            <Text className="empty-title">暂无可确认的衣物</Text>
            <Text className="empty-desc">可以下拉刷新，或对失败图片重试识别。</Text>
          </View>
        )}

        {drafts.map((draft) => (
          <View key={draft.id} className={`draft-card ${draft.selected ? '' : 'muted'}`}>
            <Image className="draft-image" src={draft.croppedImageUrl || draft.originalImageUrl} mode="aspectFill" />
            <View className="draft-body">
              <View className="draft-topline">
                <View className={`select-dot ${draft.selected ? 'active' : ''}`} onClick={() => patchDraft(draft.id, { selected: !draft.selected })}>
                  <Text className="select-mark">{draft.selected ? '✓' : ''}</Text>
                </View>
                <Text className="confidence">置信度 {draft.confidence || 0}%</Text>
              </View>

              <View className="field-row" onClick={() => handleCategorySelect(draft)}>
                <Text className="field-label">类型</Text>
                <Text className="field-value">{getCategoryLabel(draft.type)}</Text>
              </View>

              <View className="field-row">
                <Text className="field-label">颜色</Text>
                <Input className="field-input" value={draft.color || ''} onInput={(event) => patchDraft(draft.id, { color: event.detail.value, colors: [event.detail.value].filter(Boolean) })} />
              </View>

              <View className="field-row">
                <Text className="field-label">材质</Text>
                <Input className="field-input" value={draft.material || ''} onInput={(event) => patchDraft(draft.id, { material: event.detail.value })} />
              </View>

              <View className="field-row">
                <Text className="field-label">风格</Text>
                <Input className="field-input" value={draft.style || ''} onInput={(event) => patchDraft(draft.id, { style: event.detail.value })} />
              </View>

              <View className="draft-actions">
                <View className="discard-btn" onClick={() => handleDiscard(draft)}>
                  <Text className="discard-text">丢弃</Text>
                </View>
              </View>
            </View>
          </View>
        ))}
      </ScrollView>

      <View className="save-bar">
        <Text className="save-count">已选择 {selectedCount} 件</Text>
        <View className={`save-btn ${saving || processing ? 'disabled' : ''}`} onClick={handleSave}>
          <Text className="save-text">{saving ? '保存中...' : '保存到衣柜'}</Text>
        </View>
      </View>
    </View>
  );
}

function getCategoryLabel(type?: string) {
  return categoryOptions.find((item) => item.key === type)?.label || '其他';
}
