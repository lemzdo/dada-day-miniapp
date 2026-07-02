import { View, Text } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh, useReachBottom } from '@tarojs/taro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ClothingGrid } from '@/components/ClothingGrid';
import { useAuthRuntime } from '@/hooks/useAuthRuntime';
import {
  CloudFunctionError,
  createUploadBatch,
  createUploadImage,
  deleteCloudClothing,
  deleteCloudClothingBatch,
  getRecoverableUploadBatches,
  getUserClothingSubcategories,
  getWardrobe,
  inspectCloudClothingDelete,
  isClothingNotActiveError,
  isSupersededCloudResult,
  recognizeClothAttributes,
  uploadBatchSourceImage,
} from '@/lib/cloud';
import { invalidateAfterWardrobeMutation } from '@/lib/cacheInvalidation';
import { buildPageCacheKey } from '@/lib/pageCache';
import {
  captureAuthContext,
  getUserPageCache,
  isAuthContextCurrent,
  setUserPageCache,
  type ActiveAuthContext,
} from '@/lib/userPageCache';
import {
  buildUserStorageBusinessKey,
  getUserStorageSync,
  removeUserStorageSync,
  setUserStorageSync,
} from '@/lib/userStorage';
import { buildAuthRuntimeKey } from '@/lib/userRuntimeScope';
import { filterTerminalBatches } from '@/lib/uploadTaskLocalCache';
import { consumePendingWardrobeNotice } from '@/pages/upload-confirm/uploadTerminalDiscardFlow';
import { canRecognizeSingleClothing, getSubcategoryDisplayLabel } from '@/utils/clothingLabels';
import type { Clothing, ClothingCategory, UserClothingSubcategory } from '@starter-template/types';
import type { RecoverableUploadBatch } from '@/lib/cloud';
import {
  SUBCATEGORY_OPTIONS,
  type SelectOption,
} from '@/components/ClothingEditForm/constants';
import { DEFAULT_WARDROBE_LIMIT } from '@/constants/wardrobeCapacity';
import './index.scss';

const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';
const WARDROBE_REFRESH_EVENT = 'wardrobe:refresh';
const WARDROBE_STALE_MS = 30 * 1000;
const WARDROBE_PAGE_SIZE = 10;
const WARDROBE_FIRST_PAGE_CACHE_TTL = 45 * 1000;
const FREE_WARDROBE_LIMIT = DEFAULT_WARDROBE_LIMIT;

type WardrobeResponse = Awaited<ReturnType<typeof getWardrobe>>;

interface WardrobeFirstPageCacheData {
  list: Clothing[];
  pagination: WardrobeResponse['pagination'];
  capacity: WardrobeResponse['capacity'];
  hasMore: boolean;
}

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

interface WardrobeEmptyState {
  title: string;
  desc: string;
  actionText: string;
  illustrationClass: string;
  action: 'add' | 'recover';
  secondaryText?: string;
}

type CompressableTaro = typeof Taro & {
  compressImage?: (options: {
    src: string;
    quality?: number;
    compressedWidth?: number;
    compressedHeight?: number;
  }) => Promise<{ tempFilePath: string }>;
};

function isCurrentAuthContext(authContext: ActiveAuthContext | null) {
  return Boolean(authContext && isAuthContextCurrent(authContext));
}

function readCapacityStats(capacity: WardrobeResponse['capacity'] | undefined) {
  const limit = Number(capacity?.limit ?? capacity?.total ?? FREE_WARDROBE_LIMIT);
  const used = Number(capacity?.used ?? 0);
  return {
    total: Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : FREE_WARDROBE_LIMIT,
    used: Number.isFinite(used) && used > 0 ? Math.floor(used) : 0,
  };
}

export default function WardrobePage() {
  const { authStatus, runtimeKey, isAuthenticated } = useAuthRuntime();
  const [clothes, setClothes] = useState<Clothing[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);
  const [activeCategory, setActiveCategory] = useState<ClothingCategory | 'all'>('all');
  const [activeSubcategory, setActiveSubcategory] = useState<string>('all');
  const [activeSubcategoryId, setActiveSubcategoryId] = useState<string>('');
  const [userSubcategories, setUserSubcategories] = useState<UserClothingSubcategory[]>([]);
  const [stats, setStats] = useState<{ total: number; used: number }>({ total: FREE_WARDROBE_LIMIT, used: 0 });
  const [recoverableBatches, setRecoverableBatches] = useState<RecoverableUploadBatch[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [recognizingIds, setRecognizingIds] = useState<string[]>([]);
  const skipNextShowRefreshRef = useRef(false);
  const loadingRef = useRef(false);
  const lastFetchAtRef = useRef(0);
  const lastHandledRuntimeKeyRef = useRef<string | null>(null);

  const resetUserState = useCallback(() => {
    loadingRef.current = false;
    lastFetchAtRef.current = 0;
    setClothes([]);
    setLoading(false);
    setHasMore(true);
    setPage(1);
    setActiveCategory('all');
    setActiveSubcategory('all');
    setActiveSubcategoryId('');
    setUserSubcategories([]);
    setStats({ total: FREE_WARDROBE_LIMIT, used: 0 });
    setRecoverableBatches([]);
    setSelectionMode(false);
    setSelectedIds([]);
    setBatchDeleting(false);
    setRecognizingIds([]);
  }, []);

  const applyWardrobeFirstPageCache = useCallback(async (cacheKey: string, authContext: ActiveAuthContext | null) => {
    const cached = await getUserPageCache<WardrobeFirstPageCacheData>(cacheKey, { authContext });
    if (!cached.hit || cached.expired || !cached.data) return false;
    if (!isCurrentAuthContext(authContext)) return false;

    setClothes(dedupeClothesById(cached.data.list));
    setStats(readCapacityStats(cached.data.capacity));
    setHasMore(cached.data.hasMore);
    setPage(1);
    lastFetchAtRef.current = cached.record?.createdAt ?? Date.now();
    return true;
  }, []);

  const fetchClothes = useCallback(
    async (
      pageNum: number, 
      reset = false, 
      category: ClothingCategory | 'all' = activeCategory, 
      subcategoryParam: string = activeSubcategory,
      subcategoryIdParam: string = activeSubcategoryId,
      force = false
    ) => {
      if (loadingRef.current && !force) return;
      const authContext = captureAuthContext();
      if (!authContext) return;

      loadingRef.current = true;
      const cacheKey = buildWardrobeFirstPageCacheKey(
        WARDROBE_PAGE_SIZE,
        category,
        subcategoryParam,
        subcategoryIdParam,
      );
      const canUseFirstPageCache = pageNum === 1 && reset && !force;
      const cacheApplied = canUseFirstPageCache ? await applyWardrobeFirstPageCache(cacheKey, authContext) : false;
      if (!isCurrentAuthContext(authContext)) {
        loadingRef.current = false;
        return;
      }
      setLoading(!cacheApplied);

      try {
        const params: Parameters<typeof getWardrobe>[0] = {
          category,
          page: pageNum,
          pageSize: WARDROBE_PAGE_SIZE,
          status: 'active',
        };

        if (subcategoryIdParam) {
          params.subcategoryId = subcategoryIdParam;
        } else if (subcategoryParam !== 'all') {
          params.subcategory = subcategoryParam;
        }

        const res = await getWardrobe(params, { force });
        const nextHasMore = pageNum < res.pagination.totalPages;
        if (!isCurrentAuthContext(authContext)) return;

        setClothes((prev) => {
          const next = reset ? dedupeClothesById(res.list) : mergeUniqueClothes(prev, res.list);
          console.log('[wardrobe] fetch clothes result', {
            category,
            page: pageNum,
            reset,
            receivedCount: res.list.length,
            visibleCount: next.length,
          });
          return next;
        });
        setStats(readCapacityStats(res.capacity));
        setHasMore(nextHasMore);
        if (reset || pageNum === 1) lastFetchAtRef.current = Date.now();
        if (pageNum === 1 && reset) {
          await setUserPageCache<WardrobeFirstPageCacheData>(
            cacheKey,
            {
              list: dedupeClothesById(res.list),
              pagination: res.pagination,
              capacity: res.capacity,
              hasMore: nextHasMore,
            },
            { ttl: WARDROBE_FIRST_PAGE_CACHE_TTL, authContext },
          );
        }
      } catch (err) {
        console.error('Fetch wardrobe error:', err);
        if (!isCurrentAuthContext(authContext)) return;
        Taro.showToast({ title: '加载失败', icon: 'none' });
      } finally {
        loadingRef.current = false;
        if (isCurrentAuthContext(authContext)) {
          setLoading(false);
          Taro.stopPullDownRefresh();
        }
      }
    },
    [activeCategory, activeSubcategory, activeSubcategoryId, applyWardrobeFirstPageCache],
  );

  const fetchRecoverableUploadTask = useCallback(async () => {
    const authContext = captureAuthContext();
    if (!authContext) return;

    try {
      const result = await getRecoverableUploadBatches(10);
      if (!isCurrentAuthContext(authContext)) return;
      const filtered = filterTerminalBatches(buildAuthRuntimeKey(authContext), result.list || []) as RecoverableUploadBatch[];
      setRecoverableBatches(filtered.filter(isActiveRecoverableBatch));
    } catch (err) {
      console.warn('Fetch recoverable upload task failed:', err);
      if (isCurrentAuthContext(authContext)) {
        setRecoverableBatches([]);
      }
    }
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !runtimeKey) {
      lastHandledRuntimeKeyRef.current = null;
      skipNextShowRefreshRef.current = true;
      resetUserState();
      return;
    }

    if (lastHandledRuntimeKeyRef.current === runtimeKey) return;
    loadingRef.current = false;
    resetUserState();
    lastHandledRuntimeKeyRef.current = runtimeKey;
    skipNextShowRefreshRef.current = true;
    fetchClothes(1, true, 'all', 'all', '', true);
    void fetchRecoverableUploadTask();
    void loadUserSubcategories();
  }, [authStatus, fetchClothes, fetchRecoverableUploadTask, isAuthenticated, resetUserState, runtimeKey]);

  useLoad(() => {
    skipNextShowRefreshRef.current = true;
  });

  useDidShow(() => {
    const authContext = captureAuthContext();
    const pendingNotice = consumePendingWardrobeNotice({
      authContext,
      getUserStorageSync,
      removeUserStorageSync,
    });
    if (pendingNotice) {
      Taro.showToast({ title: pendingNotice, icon: 'success' });
    }

    if (skipNextShowRefreshRef.current) {
      skipNextShowRefreshRef.current = false;
      return;
    }

    if (authContext) {
      setRecoverableBatches((prev) => (
        filterTerminalBatches(buildAuthRuntimeKey(authContext), prev) as RecoverableUploadBatch[]
      ).filter(isActiveRecoverableBatch));
    }
    const needsRefresh = Boolean(getUserStorageSync(WARDROBE_REFRESH_STORAGE_KEY, { authContext }));
    if (needsRefresh) {
      removeUserStorageSync(WARDROBE_REFRESH_STORAGE_KEY, { authContext });
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

  async function loadUserSubcategories() {
    const authContext = captureAuthContext();
    if (!authContext) return;

    try {
      const categories = await getUserClothingSubcategories();
      if (!isCurrentAuthContext(authContext)) return;
      setUserSubcategories(categories);
    } catch (err) {
      console.error('Load user subcategories failed:', err);
    }
  }

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
    setActiveSubcategory('all');
    setActiveSubcategoryId('');
    setPage(1);
    fetchClothes(1, true, key, 'all', '');
  }

  function handleSubcategoryChange(value: string, isCustom: boolean, customId?: string) {
    const newSubcategory = value;
    const newSubcategoryId = isCustom && customId ? customId : '';
    
    if (value === 'all') {
      setActiveSubcategory('all');
      setActiveSubcategoryId('');
    } else {
      setActiveSubcategory(value);
      setActiveSubcategoryId(newSubcategoryId);
    }
    setPage(1);
    fetchClothes(1, true, activeCategory, newSubcategory, newSubcategoryId);
  }

  async function handleAdd() {
    const authContext = captureAuthContext();
    if (!authContext) return;

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
      if (!isCurrentAuthContext(authContext)) return;
      setUserStorageSync(buildUserStorageBusinessKey('uploadBatchImages', batch.id), imageIds, { authContext });
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
    fetchClothes(1, true, activeCategory, activeSubcategory, activeSubcategoryId, true);
  }

  function handleShowAll() {
    setActiveCategory('all');
    setActiveSubcategory('all');
    setActiveSubcategoryId('');
    setPage(1);
    fetchClothes(1, true, 'all', 'all', '', true);
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
    const authContext = captureAuthContext();
    if (!authContext) return;

    try {
      const impact = await inspectCloudClothingDelete(item.id);
      if (!isCurrentAuthContext(authContext)) return;
      const modalRes = await Taro.showModal({
        title: '确认删除',
        content: buildDeleteConfirmText(impact.affectedFavoriteCount, impact.affectedHistoryCount),
        confirmColor: '#FF6B6B',
      });
      if (!modalRes.confirm) return;
      if (!isCurrentAuthContext(authContext)) return;

      const result = await deleteCloudClothing(item.id);
      if (!isCurrentAuthContext(authContext)) return;
      await invalidateAfterWardrobeMutation({ authContext });
      if (!isCurrentAuthContext(authContext)) return;
      Taro.showToast({
        title: result.referenceRepairPending ? '已从衣橱移除，历史记录正在整理' : '已删除',
        icon: result.referenceRepairPending ? 'none' : 'success',
      });
      setClothes((prev) => prev.filter((clothing) => clothing.id !== item.id));
      setStats((prev) => ({ ...prev, used: Math.max(0, prev.used - 1) }));
      refreshWardrobe();
    } catch (err) {
      console.error('Delete clothing error:', err);
      if (!isCurrentAuthContext(authContext)) return;
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
    const authContext = captureAuthContext();
    if (!authContext) return;

    const ids = selectedIds;
    const modalRes = await Taro.showModal({
      title: `让小搭帮你清理这 ${ids.length} 件衣服吗？`,
      content: '清理后，这些衣服会先从衣柜里消失。7 天内系统会保留一小会儿，之后再悄悄收走～',
      cancelText: '我再想想',
      confirmText: '确认清理',
      confirmColor: '#FF6B6B',
    });
    if (!modalRes.confirm) return;
    if (!isCurrentAuthContext(authContext)) return;

    setBatchDeleting(true);
    try {
      const result = await deleteCloudClothingBatch(ids);
      if (!isCurrentAuthContext(authContext)) return;
      if (result.successIds.length > 0) {
        await invalidateAfterWardrobeMutation({ authContext });
        if (!isCurrentAuthContext(authContext)) return;
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
      Taro.showToast({
        title: result.referenceRepairPending ? '已从衣橱移除，历史记录正在整理' : '小搭已帮你清理好啦',
        icon: result.referenceRepairPending ? 'none' : 'success',
      });
      refreshWardrobe();
    } catch (err) {
      console.error('Batch delete clothing error:', err);
      if (!isCurrentAuthContext(authContext)) return;
      Taro.showToast({ title: '清理失败，小搭刚刚手滑了', icon: 'none' });
    } finally {
      if (isCurrentAuthContext(authContext)) {
        setBatchDeleting(false);
      }
    }
  }

  async function handleRecognize(item: Clothing) {
    const authContext = captureAuthContext();
    if (!authContext) return;
    if (recognizingIds.includes(item.id)) return;
    if (item.status === 'deleted') {
      Taro.showToast({ title: '这件衣服已移出衣橱，不能继续处理', icon: 'none' });
      return;
    }

    if (!canSafelyRecognize(item)) {
      Taro.showModal({
        title: '暂不支持重新识别',
        content: '当前使用的是原图，暂不支持单独重新识别这件衣服。你可以手动编辑信息。',
        showCancel: false,
      });
      return;
    }

    setRecognizingIds((prev) => prev.includes(item.id) ? prev : [...prev, item.id]);
    updateClothingInList({ ...item, aiStatus: 'recognizing', aiRecognizeStatus: 'pending' });

    try {
      const updated = await recognizeClothAttributes(item.id);
      if (!isCurrentAuthContext(authContext)) return;
      if (isSupersededCloudResult(updated)) {
        refreshWardrobe();
        return;
      }
      updateClothingInList(updated);
      await invalidateAfterWardrobeMutation({ authContext });
      if (!isCurrentAuthContext(authContext)) return;
      Taro.showToast({ title: '识别完成', icon: 'success' });
    } catch (err) {
      console.error('Recognize clothing error:', err);
      if (!isCurrentAuthContext(authContext)) return;
      if (isClothingNotActiveError(err)) {
        Taro.showToast({ title: '这件衣服已移出衣橱，不能继续处理', icon: 'none' });
        refreshWardrobe();
        return;
      }
      updateClothingInList({ ...item, aiStatus: 'failed', aiRecognizeStatus: 'failed' });
      Taro.showToast({ title: '小搭暂时没整理好，可手动编辑或重新整理', icon: 'none' });
    } finally {
      if (isCurrentAuthContext(authContext)) {
        setRecognizingIds((prev) => prev.filter((id) => id !== item.id));
      }
    }
  }

  const remaining = Math.max(0, stats.total - stats.used);
  const percent = stats.total > 0 ? Math.min(100, Math.round((stats.used / stats.total) * 100)) : 0;
  const recognitionEntryStatus = getRecognitionEntryStatus(recoverableBatches);
  const allSelected = clothes.length > 0 && clothes.every((item) => selectedIds.includes(item.id));
  const selectedCount = selectedIds.length;
  const showEmptyState = clothes.length === 0 && !loading;
  const hideUploadDock = showEmptyState;

  const subcategoryOptions = useMemo(() => {
    if (activeCategory === 'all') return [];
    
    const systemOptions = SUBCATEGORY_OPTIONS[activeCategory] ?? [];
    const customOptions = userSubcategories
      .filter((cat) => cat.parentCategory === activeCategory && cat.status === 'active')
      .map((cat) => ({ value: cat.id, label: cat.name, isCustom: true as const }));
    
    return [
      { value: 'all', label: '全部', isCustom: false as const },
      ...systemOptions.map((opt) => ({
        ...opt,
        label: getSubcategoryDisplayLabel(activeCategory, opt.value, userSubcategories),
        isCustom: false as const,
      })),
      ...customOptions,
    ];
  }, [activeCategory, userSubcategories]);
  const emptyState = getWardrobeEmptyState({
    statsUsed: stats.used,
    activeCategory,
    activeCategoryLabel: getCategoryLabel(activeCategory),
    activeSubcategory,
    activeSubcategoryLabel: getActiveSubcategoryLabel(activeSubcategory, activeSubcategoryId, subcategoryOptions),
    hasReadyRecoverableBatch: recoverableBatches.some((batch) => getRecoverableTaskState(batch) === 'ready'),
  });

  function handleEmptyPrimaryAction() {
    if (emptyState.action === 'recover') {
      handleRecoverableTaskClick();
      return;
    }
    handleAdd();
  }

  return (
    <View className={`wardrobe-page ${selectionMode ? 'selecting' : ''}`}>
      {/* 衣橱状态卡 - 整合容量、识别任务、管理入口 */}
      <View className="wardrobe-status-card">
        <View className="status-card-header">
          <Text className="status-card-title">衣橱状态</Text>
          {selectionMode && <Text className="selection-count">已选 {selectedCount} 件</Text>}
          <View className={`manage-btn ${selectionMode ? 'active' : ''}`} onClick={toggleSelectionMode}>
            <Text className="manage-btn-text">{selectionMode ? '取消' : '管理'}</Text>
          </View>
        </View>

        <View className="status-card-main">
          <Text className="capacity-num">
            {stats.used} / {stats.total} 件
          </Text>
          <View className="capacity-track">
            <View className="capacity-fill" style={{ width: `${percent}%` }} />
          </View>
          <Text className="capacity-hint">还可以收纳 {remaining} 件衣服</Text>
        </View>

        {recoverableBatches.length > 0 && recognitionEntryStatus && (
          <View className={`status-card-task ${recognitionEntryStatus}`} onClick={handleRecoverableTaskClick}>
            <View className="task-main">
              <Text className="task-title">{getRecognitionTaskTitle(recoverableBatches)}</Text>
              <Text className="task-desc">{getRecognitionTaskDesc(recoverableBatches)}</Text>
            </View>
            <Text className="task-action">{getRecognitionTaskAction(recoverableBatches)}</Text>
          </View>
        )}
      </View>

      {/* 分类筛选栏 */}
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

      {/* 二级细分类筛选栏 */}
      {subcategoryOptions.length > 1 && (
        <View className="subcategory-scroll">
          {subcategoryOptions.map((opt) => (
            <View
              key={opt.value}
              className={`subcategory-tag ${activeSubcategory === opt.value || (opt.isCustom && activeSubcategoryId === opt.value) ? 'active' : ''} ${opt.isCustom ? 'custom' : ''}`}
              onClick={() => handleSubcategoryChange(opt.value, opt.isCustom, opt.isCustom ? opt.value : undefined)}
            >
              <Text>{opt.label}</Text>
            </View>
          ))}
        </View>
      )}

      {/* 衣物内容区 */}
      <View className="wardrobe-content">
        {showEmptyState ? (
          <View className="empty-state">
            <View className={`empty-illustration ${emptyState.illustrationClass}`}>
              <View className="empty-rail" />
              <View className="empty-hanger" />
              <View className="empty-box" />
            </View>
            <Text className="empty-title">{emptyState.title}</Text>
            <Text className="empty-desc">{emptyState.desc}</Text>
            <View className="empty-action" onClick={handleEmptyPrimaryAction}>
              <Text className="empty-action-text">{emptyState.actionText}</Text>
            </View>
            {emptyState.secondaryText && (
              <View className="empty-secondary-action" onClick={handleShowAll}>
                <Text className="empty-secondary-text">{emptyState.secondaryText}</Text>
              </View>
            )}
          </View>
        ) : (
          <>
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
          </>
        )}
      </View>

      {/* 底部 Dock - 普通模式显示上传，管理模式显示整理栏 */}
      {!hideUploadDock && (
        <View className="bottom-dock">
          <View className="dock-safe-area">
            {!selectionMode ? (
              <View className="upload-dock" onClick={handleAdd}>
                <View className="upload-btn">
                  <Text className="upload-btn-text">+ 添新衣</Text>
                </View>
              </View>
            ) : (
              <View className="selection-toolbar">
                <View className={`selection-cancel-btn ${batchDeleting ? 'disabled' : ''}`} onClick={exitSelectionMode}>
                  <Text className="selection-cancel-text">完成</Text>
                </View>
                <View className="selection-actions">
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
              </View>
            )}
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

function dedupeClothesById(list: Clothing[]) {
  const seen = new Set<string>();
  return list.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function mergeUniqueClothes(prev: Clothing[], nextPage: Clothing[]) {
  const seen = new Set(prev.map((item) => item.id));
  const uniqueNext = nextPage.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  return [...prev, ...uniqueNext];
}

function buildWardrobeFirstPageCacheKey(
  pageSize: number,
  category: ClothingCategory | 'all',
  subcategory: string,
  subcategoryId: string,
) {
  return buildPageCacheKey([
    'wardrobe',
    'first',
    'v1',
    pageSize,
    category || 'all',
    subcategoryId || subcategory || 'all',
    'active',
  ]);
}

function getWardrobeEmptyState({
  statsUsed,
  activeCategory,
  activeCategoryLabel,
  activeSubcategory,
  activeSubcategoryLabel,
  hasReadyRecoverableBatch,
}: {
  statsUsed: number;
  activeCategory: ClothingCategory | 'all';
  activeCategoryLabel: string;
  activeSubcategory: string;
  activeSubcategoryLabel: string;
  hasReadyRecoverableBatch: boolean;
}): WardrobeEmptyState {
  if (hasReadyRecoverableBatch) {
    return {
      title: '还有新衣等你保存',
      desc: '小搭已经整理好识别结果，保存后就能出现在衣橱里',
      actionText: '查看待保存衣服',
      illustrationClass: 'pending',
      action: 'recover',
    };
  }

  if (statsUsed === 0) {
    return {
      title: '衣橱还空着呢',
      desc: '先上传几件常穿衣服，小搭才能帮你搭得更准',
      actionText: '添加第一件衣服',
      illustrationClass: 'wardrobe',
      action: 'add',
    };
  }

  if (activeSubcategory !== 'all') {
    return {
      title: `还没有${activeSubcategoryLabel}`,
      desc: '换个分类看看，或者给小搭添几件新的单品',
      actionText: '添加衣服',
      secondaryText: '查看全部',
      illustrationClass: 'shoebox',
      action: 'add',
    };
  }

  if (activeCategory !== 'all') {
    return {
      title: `还没有${activeCategoryLabel}`,
      desc: '换个分类看看，或者给小搭添几件新的单品',
      actionText: '添加衣服',
      secondaryText: '查看全部',
      illustrationClass: 'category',
      action: 'add',
    };
  }

  return {
    title: '衣橱还空着呢',
    desc: '先上传几件常穿衣服，小搭才能帮你搭得更准',
    actionText: '添加第一件衣服',
    illustrationClass: 'wardrobe',
    action: 'add',
  };
}

function getCategoryLabel(category: ClothingCategory | 'all') {
  return categories.find((item) => item.key === category)?.label ?? '这个分类';
}

function getActiveSubcategoryLabel(activeSubcategory: string, activeSubcategoryId: string, options: SelectOption[]) {
  const activeValue = activeSubcategoryId || activeSubcategory;
  return options.find((item) => item.value === activeValue)?.label ?? '这个细分类';
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
  const states = batches.map(getRecoverableTaskState).filter(Boolean) as RecoverableTaskStatus[];
  
  if (states.some((state) => state === 'failed')) {
    const failedCount = states.filter((s) => s === 'failed').length;
    if (failedCount > 1) {
      return '有 ' + failedCount + ' 批新衣需要处理';
    }
    return '有 1 批新衣需要处理';
  }
  if (states.some((state) => state === 'ready')) {
    const readyCount = states.filter((s) => s === 'ready').length;
    if (readyCount > 1) {
      return '小搭整理好 ' + readyCount + ' 批新衣';
    }
    return '小搭整理好 1 批新衣';
  }
  if (states.some((state) => state === 'processing')) {
    if (batches.length > 1) {
      return '小搭正在整理 ' + batches.length + ' 批新衣';
    }
    return '小搭正在整理新衣';
  }
  return '有新衣需要看看';
}

function getRecognitionTaskDesc(batches: RecoverableUploadBatch[]) {
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

  if (counts.failed > 0 && counts.ready === 0 && counts.processing === 0) {
    return '部分图片没识别成功，可重新处理';
  }
  
  if (counts.ready > 0 && counts.processing > 0) {
    return counts.ready + ' 批待确认 · ' + counts.processing + ' 批识别中';
  }
  
  if (counts.ready > 0) {
    const readyCount = batches
      .filter((b) => getRecoverableTaskState(b) === 'ready')
      .reduce((sum, batch) => sum + getRecoverableRecognizedCount(batch), 0);
    if (readyCount > 0) {
      return '识别 ' + readyCount + ' 件 · 等你保存';
    }
    return '等你保存';
  }
  
  if (counts.processing > 0) {
    if (counts.processing > 1) {
      return counts.processing + ' 批识别中，完成后会提醒你';
    }
    return '1 批识别中，完成后会提醒你';
  }
  
  return '小搭整理完会提醒你';
}

function getRecognitionTaskAction(batches: RecoverableUploadBatch[]) {
  const states = batches.map(getRecoverableTaskState).filter(Boolean) as RecoverableTaskStatus[];
  
  if (states.some((state) => state === 'failed')) {
    return '查看';
  }
  
  if (states.some((state) => state === 'ready')) {
    if (batches.length === 1) {
      return '去确认';
    }
    return '查看';
  }
  
  return '查看';
}
