import { View, Text } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ClothingGrid } from '@/components/ClothingGrid';
import {
  CloudFunctionError,
  createUploadBatch,
  createUploadImage,
  deleteCloudClothing,
  getWardrobe,
  inspectCloudClothingDelete,
  recognizeClothAttributes,
  uploadBatchSourceImage,
} from '@/lib/cloud';
import type { Clothing, ClothingCategory } from '@starter-template/types';
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

  useLoad(() => {
    skipNextShowRefreshRef.current = true;
    fetchClothes(1, true);
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

  usePullDownRefresh(() => {
    refreshWardrobe();
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
    Taro.navigateTo({ url: `/pages/clothing-detail/index?id=${item.id}` });
  }

  function refreshWardrobe() {
    setPage(1);
    fetchClothes(1, true, activeCategory, true);
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
    Taro.showActionSheet({
      itemList: ['查看详情', '重新识别', '删除'],
      success: (res) => {
        if (res.tapIndex === 0) handleItemClick(item);
        if (res.tapIndex === 1) handleRecognize(item);
        if (res.tapIndex === 2) handleDelete(item);
      },
    });
  }

  async function handleRecognize(item: Clothing) {
    updateClothingInList({ ...item, aiStatus: 'recognizing', aiRecognizeStatus: 'pending' });

    try {
      const updated = await recognizeClothAttributes(item.id);
      updateClothingInList(updated);
      Taro.showToast({ title: '识别完成', icon: 'success' });
    } catch (err) {
      console.error('Recognize clothing error:', err);
      updateClothingInList({ ...item, aiStatus: 'failed', aiRecognizeStatus: 'failed' });
      Taro.showToast({ title: 'AI识别失败，可手动编辑或重新识别', icon: 'none' });
    }
  }

  const percent = stats.total > 0 ? Math.min(100, Math.round((stats.used / stats.total) * 100)) : 0;

  return (
    <View className="wardrobe-page">
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

function trimMessage(message: string) {
  return message.length > 16 ? `${message.slice(0, 16)}...` : message;
}
