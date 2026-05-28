import { View, Text } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClothingGrid } from '@/components/ClothingGrid';
import {
  CloudFunctionError,
  createUploadBatch,
  createUploadImage,
  deleteCloudClothing,
  deleteCloudClothingBatch,
  getRecoverableUploadBatches,
  getWardrobe,
  inspectCloudClothingDelete,
  recognizeClothAttributes,
  uploadBatchSourceImage,
} from '@/lib/cloud';
import { canRecognizeSingleClothing } from '@/utils/clothingLabels';
import type { Clothing, ClothingCategory } from '@starter-template/types';
import type { RecoverableUploadBatch } from '@/lib/cloud';
import './index.scss';

const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';
const WARDROBE_REFRESH_EVENT = 'wardrobe:refresh';
const WARDROBE_STALE_MS = 30 * 1000;

function buildDeleteConfirmText(favoriteCount: number, historyCount: number) {
  const impacts = [];
  if (favoriteCount > 0) impacts.push(`${favoriteCount} 个收藏穿搭`);
  if (historyCount > 0) impacts.push(`${historyCount} 个历史穿搭`);

  if (impacts.length === 0) {
    return '删除后这件衣服会从衣柜和推荐中移除，7天后清理图片。';
  }

  return `这件衣服被 ${impacts.join('、')} 使用。删除后会保留穿搭快照，并标记为不完整，7天后清理衣服图片。`;
}

const categories: Array<{ key: ClothingCategory | 'all'; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '下装' },
  { key: 'onepiece', label: '连体' },
  { key: 'shoes', label: '鞋子' },
  { key: 'accessory', label: '配饰' },
];

type CompressableTaro = typeof Taro & {
  compressImage?: (options: {
    src: string;
    quality?: number;
    compressedWidth?: number;
    compressedHeight?: number;
  }) => Promise<{ tempFilePath: string }>;
};

export default function WardrobePage() {
  const [clothes, setClothes] = useState<Clothing[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [activeCategory, setActiveCategory] = useState<ClothingCategory | 'all'>('all');
  const [stats, setStats] = useState({ total: 50, used: 0 });
  const [recoverableBatches, setRecoverableBatches] = useState<RecoverableUploadBatch[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const skipNextShowRefreshRef = useRef(false);
  const loadingRef = useRef(false);
  const lastFetchAtRef = useRef(0);

  const fetchClothes = useCallback(
    async (pageNum: number, reset = false, category: ClothingCategory | 'all' = activeCategory, force = false) => {
      if (loadingRef.current && !force) return;
      loadingRef.current = true;
      setLoading(true);

      try {
        const res = await getWardrobe({
          category,
          page: pageNum,
          pageSize: 10,
          status: 'active',
        });

        setClothes((prev) => (reset ? res.list : [...prev, ...res.list]));
        setStats({ total: res.capacity.total, used: res.capacity.used });
        setHasMore(pageNum < res.pagination.totalPages);
        if (reset || pageNum === 1) lastFetchAtRef.current = Date.now();
      } catch (err) {
        console.error('Fetch wardrobe error:', err);
        Taro.showToast({ title: '加载失败', icon: 'none' });
      } finally {
        loadingRef.current = false;
        setLoading(false);
        Taro.stopPullDownRefresh();
      }
    },
    [activeCategory],
  );

  const fetchRecoverableUploadTask = useCallback(async () => {
    try {
      const result = await getRecoverableUploadBatches(10);
      setRecoverableBatches((result.list || []).filter(isActiveRecoverableBatch));
    } catch (err) {
      console.warn('Fetch recoverable upload task failed:', err);
      setRecoverableBatches([]);
    }
  }, []);

  useLoad(() => {
    skipNextShowRefreshRef.current = true;
    fetchClothes(1, true);
    void fetchRecoverableUploadTask();
  });

  useDidShow(() => {
    if (skipNextShowRefreshRef.current) {
      skipNextShowRefreshRef.current = false;
      return;
    }

    const needsRefresh = Boolean(Taro.getStorageSync(WARDROBE_REFRESH_STORAGE_KEY));
    if (needsRefresh) {
      Taro.removeStorageSync(WARDROBE_REFRESH_STORAGE_KEY);
    }
    if (needsRefresh || Date.now() - lastFetchAtRef.current > WARDROBE_STALE_MS) {
      refreshWardrobe();
    }
    void fetchRecoverableUploadTask();
  });

  useEffect(() => {
    const handleRefresh = () => {
      refreshWardrobe();
    };

    Taro.eventCenter.on(WARDROBE_REFRESH_EVENT, handleRefresh);
    return () => {
      Taro.eventCenter.off(WARDROBE_REFRESH_EVENT, handleRefresh);
    };
  }, [fetchClothes]);

  useEffect(() => {
    setSelectedIds((prev) => prev.filter((id) => clothes.some((item) => item.id === id)));
  }, [clothes]);

  usePullDownRefresh(() => {
    refreshWardrobe();
    void fetchRecoverableUploadTask();
  });

  useReachBottom(() => {
    if (!hasMore || loading) return;
    const nextPage = page + 1;
    setPage(nextPage);
    fetchClothes(nextPage);
  });

  function handleCategoryChange(key: ClothingCategory | 'all') {
    setActiveCategory(key);
    setPage(1);
    fetchClothes(1, true, key);
  }

  async function handleAdd() {
    let loadingVisible = false;

    try {
      const imageRes = await Taro.chooseMedia({
        count: 9,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
      });
      const filePaths = imageRes.tempFiles
        .map((file) => file.tempFilePath)
        .filter(Boolean);
      if (filePaths.length === 0) return;

      Taro.showLoading({ title: '准备上传...' });
      loadingVisible = true;

      const batch = await createUploadBatch(filePaths.length);
      const imageIds: string[] = [];

      for (let index = 0; index < filePaths.length; index += 1) {
        Taro.showLoading({ title: `上传 ${index + 1}/${filePaths.length}` });
        const filePath = filePaths[index];
        if (!filePath) continue;
        const compressedPath = await compressImageForUpload(filePath);
        const fileID = await uploadBatchSourceImage(compressedPath);
        const uploadImage = await createUploadImage(batch.id, fileID);
        imageIds.push(uploadImage.id);
      }

      Taro.hideLoading();
      loadingVisible = false;
      Taro.setStorageSync(`uploadBatchImages:${batch.id}`, imageIds);
      Taro.navigateTo({ url: `/pages/upload-confirm/index?batchId=${batch.id}` });
    } catch (err) {
      console.error('Upload clothing error:', err);
      if (isUserCancel(err)) return;
      Taro.showToast({ title: getUploadErrorMessage(err), icon: 'none' });
    } finally {
      if (loadingVisible) Taro.hideLoading();
    }
  }

  function updateClothingInList(item: Clothing) {
    setClothes((prev) => prev.map((clothing) => (clothing.id === item.id ? item : clothing)));
  }

  function handleItemClick(item: Clothing) {
    if (selectionMode) {
      toggleSelected(item.id);
      return;
    }
    Taro.navigateTo({ url: `/pages/clothing-detail/index?id=${item.id}` });
  }

  function toggleSelectionMode() {
    if (selectionMode) {
      exitSelectionMode();
      return;
    }
    setSelectionMode(true);
  }

  function exitSelectionMode() {
    if (batchDeleting) return;
    setSelectionMode(false);
    setSelectedIds([]);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((itemId) => itemId !== id) : [...prev, id]));
  }

  function handleSelectAllToggle() {
    if (batchDeleting) return;
    if (allSelected) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(clothes.map((item) => item.id));
  }

  function refreshWardrobe() {
    setPage(1);
    fetchClothes(1, true, activeCategory, true);
  }

  function handleRecoverableTaskClick() {
    const firstBatch = recoverableBatches[0];
    if (!firstBatch) return;
    if (recoverableBatches.length === 1) {
      Taro.navigateTo({ url: `/pages/upload-confirm/index?batchId=${firstBatch.id}` });
      return;
    }
    Taro.navigateTo({ url: '/pages/upload-tasks/index' });
  }

  async function handleDelete(item: Clothing) {
    try {
      const impact = await inspectCloudClothingDelete(item.id);
      const modalRes = await Taro.showModal({
        title: '确认删除',
        content: buildDeleteConfirmText(impact.affectedFavoriteCount, impact.affectedHistoryCount),
        confirmColor: '#FF6B6B',
      });
      if (!modalRes.confirm) return;

      await deleteCloudClothing(item.id);
      Taro.showToast({ title: '已删除', icon: 'success' });
      setClothes((prev) => prev.filter((clothing) => clothing.id !== item.id));
      setStats((prev) => ({ ...prev, used: Math.max(0, prev.used - 1) }));
      refreshWardrobe();
    } catch (err) {
      console.error('Delete clothing error:', err);
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  }

  function handleItemLongPress(item: Clothing) {
    if (batchDeleting) return;
    if (!selectionMode) {
      setSelectionMode(true);
      setSelectedIds([item.id]);
      return;
    }
    toggleSelected(item.id);
  }

  async function handleBatchDelete() {
    if (batchDeleting || selectedIds.length === 0) return;

    const ids = selectedIds;
    const modalRes = await Taro.showModal({
      title: `让小搭帮你清理这 ${ids.length} 件衣服吗？`,
      content: '清理后，这些衣服会先从衣柜里消失。7 天内系统会保留一小会儿，之后再悄悄收走～',
      cancelText: '我再想想',
      confirmText: '确认清理',
      confirmColor: '#FF6B6B',
    });
    if (!modalRes.confirm) return;

    setBatchDeleting(true);
    try {
      const result = await deleteCloudClothingBatch(ids);
      if (result.successIds.length > 0) {
        setClothes((prev) => prev.filter((item) => !result.successIds.includes(item.id)));
        setStats((prev) => ({ ...prev, used: Math.max(0, prev.used - result.successIds.length) }));
      }

      if (result.failedIds.length > 0) {
        setSelectedIds(result.failedIds);
        Taro.showToast({ title: '部分衣服没清理成功，再试一次吧', icon: 'none' });
        return;
      }

      setSelectedIds([]);
      setSelectionMode(false);
      Taro.showToast({ title: '小搭已帮你清理好啦', icon: 'success' });
      refreshWardrobe();
    } catch (err) {
      console.error('Batch delete clothing error:', err);
      Taro.showToast({ title: '清理失败，小搭刚刚手滑了', icon: 'none' });
    } finally {
      setBatchDeleting(false);
    }
  }

  async function handleRecognize(item: Clothing) {
    if (!canSafelyRecognize(item)) {
      Taro.showModal({
        title: '暂不支持重新识别',
        content: '当前使用的是原图，暂不支持单独重新识别这件衣服。你可以手动编辑信息。',
        showCancel: false,
      });
      return;
    }

    updateClothingInList({ ...item, aiStatus: 'recognizing', aiRecognizeStatus: 'pending' });

    try {
      const updated = await recognizeClothAttributes(item.id);
      updateClothingInList(updated);
      Taro.showToast({ title: '识别完成', icon: 'success' });
    } catch (err) {
      console.error('Recognize clothing error:', err);
      updateClothingInList({ ...item, aiStatus: 'failed', aiRecognizeStatus: 'failed' });
      Taro.showToast({ title: '小搭暂时没整理好，可手动编辑或重新整理', icon: 'none' });
    }
  }

  const percent = stats.total > 0 ? Math.min(100, Math.round((stats.used / stats.total) * 100)) : 0;
  const recognitionEntryStatus = getRecognitionEntryStatus(recoverableBatches);
  const allSelected = clothes.length > 0 && clothes.every((item) => selectedIds.includes(item.id));
  const selectedCount = selectedIds.length;

  return (
    <View className={`wardrobe-page ${selectionMode ? 'selecting' : ''}`}>
      <View className="wardrobe-header">
        <View className="wardrobe-title-block">
          <Text className="wardrobe-title">我的衣柜</Text>
          {selectionMode && <Text className="selection-count">已选 {selectedCount} 件</Text>}
        </View>
        <View className={`manage-btn ${selectionMode ? 'active' : ''}`} onClick={toggleSelectionMode}>
          <Text className="manage-btn-text">{selectionMode ? '取消' : '管理'}</Text>
        </View>
      </View>

      <View className="capacity-bar">
        <View className="capacity-info">
          <Text className="capacity-label">衣橱容量</Text>
          <Text className="capacity-num">
            {stats.used} / {stats.total}
          </Text>
        </View>
        <View className="capacity-track">
          <View className="capacity-fill" style={{ width: `${percent}%` }} />
        </View>
      </View>

      {recoverableBatches.length > 0 && recognitionEntryStatus && (
        <View className={`recognition-task-card ${recognitionEntryStatus}`} onClick={handleRecoverableTaskClick}>
          <View className="recognition-task-main">
            <Text className="recognition-task-title">{getRecognitionTaskTitle(recoverableBatches)}</Text>
            <Text className="recognition-task-desc">{getRecognitionTaskDesc(recoverableBatches)}</Text>
          </View>
          <Text className="recognition-task-action">{getRecognitionTaskAction(recoverableBatches)}</Text>
        </View>
      )}

      <View className="category-scroll">
        {categories.map((cat) => (
          <View
            key={cat.key}
            className={`category-tag ${activeCategory === cat.key ? 'active' : ''}`}
            onClick={() => handleCategoryChange(cat.key)}
          >
            <Text>{cat.label}</Text>
          </View>
        ))}
      </View>

      <ClothingGrid
        clothes={clothes}
        loading={loading && clothes.length === 0}
        onItemClick={handleItemClick}
        onItemLongPress={handleItemLongPress}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
      />

      {clothes.length > 0 && (
        <View className="load-more">
          <Text className="load-more-text">
            {loading ? '加载中...' : hasMore ? '上拉加载更多' : '没有更多了'}
          </Text>
        </View>
      )}

      <View className="fab-add" onClick={handleAdd}>
        <Text className="fab-icon">+</Text>
      </View>

      {selectionMode && (
        <View className="selection-toolbar">
          <View className="select-all-btn" onClick={handleSelectAllToggle}>
            <Text className="select-all-text">{allSelected ? '取消全选' : '全选'}</Text>
          </View>
          <View
            className={`batch-delete-btn ${selectedCount === 0 || batchDeleting ? 'disabled' : ''} ${batchDeleting ? 'deleting' : ''}`}
            onClick={handleBatchDelete}
          >
            <Text className="batch-delete-text">
              {batchDeleting ? '清理中...' : selectedCount > 0 ? `清理 ${selectedCount} 件` : '清理'}
            </Text>
          </View>
        </View>
      )}
    </View>
  );
}

async function compressImageForUpload(filePath: string) {
  const imageInfo = await Taro.getImageInfo({ src: filePath });
  const longestSide = Math.max(imageInfo.width, imageInfo.height);
  const scale = longestSide > 1024 ? 1024 / longestSide : 1;
  const compressedWidth = Math.max(1, Math.round(imageInfo.width * scale));
  const compressedHeight = Math.max(1, Math.round(imageInfo.height * scale));
  const compressImage = (Taro as CompressableTaro).compressImage;

  if (!compressImage) return filePath;

  const result = await compressImage({
    src: filePath,
    quality: 75,
    compressedWidth,
    compressedHeight,
  });
  return result.tempFilePath || filePath;
}

function isUserCancel(error: unknown) {
  const message = getErrorMessage(error);
  return message.includes('cancel') || message.includes('取消');
}

function getUploadErrorMessage(error: unknown) {
  if (error instanceof CloudFunctionError) {
    return `上传失败：${trimMessage(error.message)}`;
  }

  const message = getErrorMessage(error);
  if (message.includes('云存储')) return '图片上传到云存储失败';
  if (message.includes('wx.cloud is not available')) return '云开发未初始化，请稍后再试';
  return '上传失败，请稍后再试';
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error && 'errMsg' in error) return String((error as { errMsg?: unknown }).errMsg ?? '');
  return String(error ?? '');
}

function canSafelyRecognize(item: Clothing) {
  if (canRecognizeSingleClothing(item)) return true;
  return !item.batchId && !item.sourceImageId;
}

function trimMessage(message: string) {
  return message.length > 16 ? `${message.slice(0, 16)}...` : message;
}

type RecoverableTaskStatus = 'processing' | 'ready' | 'failed';

function isActiveRecoverableBatch(batch: RecoverableUploadBatch) {
  if (isTerminalUploadBatchStatus(batch.status)) return false;
  return Boolean(getRecoverableTaskState(batch));
}

function isTerminalUploadBatchStatus(status?: string) {
  return status === 'saved' || status === 'discarded' || status === 'deleted' || status === 'expired';
}

function getRecoverableTaskState(batch: RecoverableUploadBatch): RecoverableTaskStatus | null {
  if (isTerminalUploadBatchStatus(batch.status)) return null;

  const totalImages = getRecoverableTotalImages(batch);
  const processedImages = getRecoverableProcessedImages(batch);
  const recognizedCount = getRecoverableRecognizedCount(batch);
  const isBatchComplete = totalImages > 0 && processedImages >= totalImages;

  if (isBatchComplete && recognizedCount > 0) return 'ready';
  if (isBatchComplete) return 'failed';
  if (batch.status === 'processing' || batch.status === 'pending') return 'processing';
  if (batch.status === 'ready' || batch.status === 'success' || batch.status === 'partial_success' || batch.status === 'completed') return 'ready';
  if (batch.status === 'failed' || batch.status === 'empty' || batch.status === 'partial_failed') return 'failed';
  return null;
}

function getRecognitionEntryStatus(batches: RecoverableUploadBatch[]): RecoverableTaskStatus | null {
  const states = batches.map(getRecoverableTaskState).filter(Boolean) as RecoverableTaskStatus[];
  if (states.length === 0) return null;
  if (states.some((state) => state === 'ready')) return 'ready';
  if (states.some((state) => state === 'processing')) return 'processing';
  return 'failed';
}

function getRecoverableTotalImages(batch: RecoverableUploadBatch) {
  return Math.max(0, Number(batch.totalImages || 0));
}

function getRecoverableProcessedImages(batch: RecoverableUploadBatch) {
  return Math.min(
    getRecoverableTotalImages(batch),
    Math.max(0, Number(batch.processedImages || 0)),
  );
}

function getRecoverableRecognizedCount(batch: RecoverableUploadBatch) {
  return Math.max(0, Number(batch.recognizedCount ?? batch.draftCount ?? batch.totalDetectedClothes ?? 0));
}

function getRecognitionTaskTitle(batches: RecoverableUploadBatch[]) {
  if (batches.length > 1) return `小搭正在整理 ${batches.length} 批新衣服`;

  const status = getRecoverableTaskState(batches[0] as RecoverableUploadBatch);
  if (status === 'processing') return '小搭正在整理新衣服';
  if (status === 'ready') return '有一批新衣服待确认';
  return '有一批新衣服需要看看';
}

function getRecognitionTaskDesc(batches: RecoverableUploadBatch[]) {
  if (batches.length > 1) return getRecognitionAggregateDesc(batches);

  const batch = batches[0] as RecoverableUploadBatch;
  const status = getRecoverableTaskState(batch);
  const totalImages = getRecoverableTotalImages(batch);
  const processedImages = getRecoverableProcessedImages(batch);
  const recognizedCount = getRecoverableRecognizedCount(batch);

  if (status === 'processing') {
    if (recognizedCount > 0) {
      return `已识别 ${recognizedCount} 件，剩下的还在慢慢整理`;
    }
    return `正在处理 ${processedImages}/${totalImages} 张图片`;
  }

  if (status === 'ready') {
    return `小搭识别出 ${recognizedCount} 件衣服，待你确认保存`;
  }

  return '这批识别遇到一点问题，去看看怎么处理';
}

function getRecognitionAggregateDesc(batches: RecoverableUploadBatch[]) {
  const counts = batches.reduce(
    (acc, batch) => {
      const state = getRecoverableTaskState(batch);
      if (state === 'ready') acc.ready += 1;
      if (state === 'processing') acc.processing += 1;
      if (state === 'failed') acc.failed += 1;
      return acc;
    },
    { ready: 0, processing: 0, failed: 0 },
  );
  const parts = [];
  if (counts.ready > 0) parts.push(`${counts.ready} 批待确认`);
  if (counts.processing > 0) parts.push(`${counts.processing} 批识别中`);
  if (counts.failed > 0) parts.push(`${counts.failed} 批需要看看`);
  return parts.length > 0 ? parts.join('，') : '小搭整理完会放在这里提醒你';
}

function getRecognitionTaskAction(batches: RecoverableUploadBatch[]) {
  if (batches.length > 1) return '查看全部';

  const status = getRecoverableTaskState(batches[0] as RecoverableUploadBatch);
  if (status === 'processing') return '点击查看进度';
  if (status === 'ready') return '查看结果';
  return '点击查看';
}
