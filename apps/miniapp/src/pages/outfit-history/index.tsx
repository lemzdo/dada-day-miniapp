import { ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh } from '@tarojs/taro';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SafeImage } from '@/components/SafeImage';
import { useAuthRuntime } from '@/hooks/useAuthRuntime';
import { invalidateHistoryCache } from '@/lib/cacheInvalidation';
import { listOutfitHistory } from '@/lib/cloud';
import { buildPageCacheKey } from '@/lib/pageCache';
import {
  captureAuthContext,
  getUserPageCache,
  isAuthContextCurrent,
  setUserPageCache,
  type ActiveAuthContext,
} from '@/lib/userPageCache';
import { applyOutfitStatuses, setOutfitStatuses } from '@/stores/outfitStatusStore';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import { getOutfitStyleTags } from '@/utils/outfitContextText';
import { getSavedSnapshotDefaultCopy } from '@/utils/recommendationCopyContract';
import type { OutfitStatusPatch } from '@/stores/outfitStatusStore';
import type { Outfit } from '@starter-template/types';
import './index.scss';

const PAGE_SIZE = 100;
const HISTORY_FIRST_PAGE_CACHE_TTL = 2 * 60 * 1000;
const HISTORY_FIRST_PAGE_CACHE_KEY = buildPageCacheKey([
  'history',
  'first',
  'recommendation-copy-contract-v3',
  PAGE_SIZE,
]);
const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'];

interface HistoryFirstPageCache {
  list: Outfit[];
  hasMore: boolean;
  page: number;
  pageSize: number;
}

function isCurrentAuthContext(authContext: ActiveAuthContext | null | undefined) {
  return Boolean(authContext && isAuthContextCurrent(authContext));
}

function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getYearMonth(year: number, month: number) {
  return `${year}年${month}月`;
}

function getDaysInMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number) {
  const day = new Date(year, month - 1, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

function formatMonthDay(dateStr: string) {
  return `${parseInt(dateStr.slice(5, 7))}月${parseInt(dateStr.slice(8, 10))}日`;
}

export default function OutfitHistoryPage() {
  const { authStatus, runtimeKey, isAuthenticated } = useAuthRuntime();
  const [allRecords, setAllRecords] = useState<Outfit[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [page, setPage] = useState(1);

  const today = new Date();
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth() + 1);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const selectedDateRef = useRef<string | null>(null);
  const skipFirstDidShowRef = useRef(false);
  const fetchingRef = useRef(false);
  const lastHandledRuntimeKeyRef = useRef<string | null>(null);

  const resetUserState = useCallback(() => {
    const now = new Date();
    const todayStr = getTodayStr();
    fetchingRef.current = false;
    selectedDateRef.current = todayStr;
    setAllRecords([]);
    setLoading(false);
    setHasMore(true);
    setPage(1);
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth() + 1);
    setSelectedDate(todayStr);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !runtimeKey) {
      lastHandledRuntimeKeyRef.current = null;
      skipFirstDidShowRef.current = true;
      resetUserState();
      return;
    }

    if (lastHandledRuntimeKeyRef.current === runtimeKey) return;
    resetUserState();
    lastHandledRuntimeKeyRef.current = runtimeKey;
    skipFirstDidShowRef.current = true;
    void fetchHistory(1, true, { force: true });
  }, [authStatus, isAuthenticated, resetUserState, runtimeKey]);

  useLoad(() => {
    skipFirstDidShowRef.current = true;
  });

  useDidShow(() => {
    if (skipFirstDidShowRef.current) {
      skipFirstDidShowRef.current = false;
      return;
    }
    if (!isAuthenticated || !runtimeKey) return;
    syncHistoryFromStatusStore();
    void fetchHistory(1, true, { force: true, silent: true });
  });

  usePullDownRefresh(() => {
    fetchHistory(1, true, { force: true }).finally(() => {
      Taro.stopPullDownRefresh();
    });
  });

  async function fetchHistory(pageNum: number, reset = false, options: { force?: boolean; silent?: boolean } = {}) {
    if (fetchingRef.current) return;
    fetchingRef.current = true;

    const authContext = captureAuthContext();
    if (!authContext) {
      fetchingRef.current = false;
      return;
    }
    const isFirstPage = reset && pageNum === 1;
    if (isFirstPage && !options.force) {
      await hydrateHistoryFirstPageCache(authContext);
    }

    if (!isCurrentAuthContext(authContext)) {
      fetchingRef.current = false;
      return;
    }
    if (!options.silent) setLoading(true);
    try {
      const data = await listOutfitHistory({ page: pageNum, pageSize: PAGE_SIZE });
      const rawList = data.list || [];
      if (!isCurrentAuthContext(authContext)) return;
      setOutfitStatuses(getOutfitStatusPatches(rawList), authContext);
      const nextList = applyHistoryOutfitStatuses(rawList, authContext);
      setAllRecords((prev) => (reset ? nextList : applyHistoryOutfitStatuses([...prev, ...nextList], authContext)));
      setHasMore(data.hasMore);
      if (reset) setPage(data.page || 1);
      else setPage(pageNum);
      if (isFirstPage) {
        void writeHistoryFirstPageCache({
          list: nextList,
          hasMore: data.hasMore,
          page: data.page || 1,
          pageSize: PAGE_SIZE,
        }, authContext);
      }
    } catch (err) {
      console.error('Fetch outfit history error:', err);
    } finally {
      fetchingRef.current = false;
      if (!options.silent && isCurrentAuthContext(authContext)) setLoading(false);
    }
  }

  async function hydrateHistoryFirstPageCache(authContext: ActiveAuthContext | null) {
    const cached = await getUserPageCache<HistoryFirstPageCache>(HISTORY_FIRST_PAGE_CACHE_KEY, { authContext });
    if (!cached.hit || !cached.data) return false;
    if (!isCurrentAuthContext(authContext)) return false;

    setAllRecords(applyHistoryOutfitStatuses(cached.data.list, authContext));
    setHasMore(cached.data.hasMore);
    setPage(cached.data.page);
    return true;
  }

  function syncHistoryFromStatusStore() {
    const authContext = captureAuthContext();
    if (!isCurrentAuthContext(authContext)) return;

    setAllRecords((prev) => {
      const next = applyHistoryOutfitStatuses(prev, authContext);
      if (!isSameHistoryRecordList(prev, next)) {
        void invalidateHistoryCache({ authContext });
      }
      return next;
    });
  }

  async function loadMore() {
    if (loading || fetchingRef.current || !hasMore) return;
    const nextPage = page + 1;
    setPage(nextPage);
    await fetchHistory(nextPage);
  }

  function goToPrevMonth() {
    if (currentMonth === 1) {
      setCurrentYear((y) => y - 1);
      setCurrentMonth(12);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }

  function goToNextMonth() {
    const now = new Date();
    const isCurrentMonth = currentYear === now.getFullYear() && currentMonth === now.getMonth() + 1;

    if (currentMonth === 12) {
      setCurrentYear((y) => y + 1);
      setCurrentMonth(1);
    } else {
      setCurrentMonth((m) => m + 1);
    }

    if (!isCurrentMonth) {
      const newSelectedDate = selectedDateRef.current;
      if (newSelectedDate) {
        const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
        if (!newSelectedDate.startsWith(monthStr)) {
          setSelectedDate(null);
          selectedDateRef.current = null;
        }
      }
    }
  }

  function goToToday() {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth() + 1);
    setSelectedDate(getTodayStr());
    selectedDateRef.current = getTodayStr();
  }

  function handleDateClick(dateStr: string) {
    setSelectedDate(dateStr);
    selectedDateRef.current = dateStr;
  }

  function goToDetail(record: Outfit) {
    Taro.navigateTo({ url: `/pages/outfit-detail/index?id=${encodeURIComponent(record.id)}&source=history` });
  }

  function goToTodayPage() {
    Taro.switchTab({ url: '/pages/today/index' });
  }

  const recordsByDate = useMemo(() => {
    const map: Record<string, Outfit[]> = {};
    allRecords.forEach((record) => {
      const dateStr = getRecordDate(record);
      if (!map[dateStr]) map[dateStr] = [];
      map[dateStr].push(record);
    });
    return map;
  }, [allRecords]);

  const currentMonthRecords = useMemo(() => {
    const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;
    return Object.entries(recordsByDate)
      .filter(([date]) => date.startsWith(monthStr))
      .map(([date, records]) => ({ date, records }))
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [recordsByDate, currentYear, currentMonth]);

  const monthStats = useMemo(() => {
    const daysWithRecord = currentMonthRecords.length;
    const totalRecords = currentMonthRecords.reduce((sum, item) => sum + item.records.length, 0);
    const uniqueItems = new Set<string>();
    currentMonthRecords.forEach((item) => {
      item.records.forEach((r) => {
        r.clothingIds?.forEach((id) => uniqueItems.add(id));
      });
    });
    return { days: daysWithRecord, records: totalRecords, items: uniqueItems.size };
  }, [currentMonthRecords]);

  const calendarDays = useMemo(() => {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth);
    const firstDay = getFirstDayOfWeek(currentYear, currentMonth);
    const days: Array<{ day: number; dateStr: string; hasRecord: boolean; isToday: boolean }> = [];
    const todayStr = getTodayStr();
    const monthStr = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    for (let i = 0; i < firstDay; i++) {
      days.push({ day: 0, dateStr: '', hasRecord: false, isToday: false });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${monthStr}-${String(d).padStart(2, '0')}`;
      days.push({
        day: d,
        dateStr,
        hasRecord: Boolean(recordsByDate[dateStr]?.length),
        isToday: dateStr === todayStr,
      });
    }

    return days;
  }, [currentYear, currentMonth, recordsByDate]);

  const selectedDateRecords = selectedDate ? recordsByDate[selectedDate] ?? [] : [];
  const selectedDateLabel = selectedDate ? formatMonthDay(selectedDate) : '';
  const isTodayStr = selectedDate === getTodayStr();
  const selectedCount = selectedDateRecords.length;

  const isCurrentMonth =
    currentYear === today.getFullYear() && currentMonth === today.getMonth() + 1;

  return (
    <View className="outfit-history-page">
      <View className="page-header">
        <Text className="page-title">穿搭日历</Text>
        <Text className="page-subtitle">把每天的好看都记下来</Text>
      </View>

      <View className="month-selector">
        <View className="month-nav" onClick={goToPrevMonth}>
          <Text className="nav-arrow">‹</Text>
        </View>
        <View className="month-display">
          <Text className="month-text">{getYearMonth(currentYear, currentMonth)}</Text>
          {!isCurrentMonth && (
            <View className="today-btn" onClick={goToToday}>
              <Text className="today-btn-text">回到今天</Text>
            </View>
          )}
        </View>
        <View className="month-nav" onClick={goToNextMonth}>
          <Text className="nav-arrow">›</Text>
        </View>
      </View>

      <View className="calendar-card">
        <View className="calendar-weekdays">
          {WEEKDAY_LABELS.map((label) => (
            <View key={label} className="weekday-cell">
              <Text className="weekday-text">{label}</Text>
            </View>
          ))}
        </View>

        <View className="calendar-grid">
          {calendarDays.map((item, index) => (
            <View
              key={index}
              className={`calendar-day ${item.day === 0 ? 'empty' : ''} ${item.hasRecord ? 'has-record' : ''} ${
                selectedDate === item.dateStr ? 'selected' : ''
              } ${item.isToday ? 'today' : ''}`}
              onClick={() => item.day > 0 && handleDateClick(item.dateStr)}
            >
              {item.day > 0 && (
                <>
                  <Text className="day-text">{item.day}</Text>
                  {item.hasRecord && !selectedDate?.includes(item.dateStr) && <View className="record-dot" />}
                </>
              )}
            </View>
          ))}
        </View>
      </View>

      <View className="month-summary-card">
        <Text className="summary-title">本月穿搭小结</Text>
        <View className="summary-stats">
          <View className="summary-stat">
            <Text className="summary-num">{monthStats.days}</Text>
            <Text className="summary-label">天记录</Text>
          </View>
          <View className="summary-divider" />
          <View className="summary-stat">
            <Text className="summary-num">{monthStats.records}</Text>
            <Text className="summary-label">次穿搭</Text>
          </View>
          <View className="summary-divider" />
          <View className="summary-stat">
            <Text className="summary-num">{monthStats.items}</Text>
            <Text className="summary-label">件单品</Text>
          </View>
        </View>
      </View>

      <View className="records-section">
        {selectedDate ? (
          <>
            <View className="records-header">
              <Text className="records-title">
                {isTodayStr ? '今天' : selectedDateLabel}
                {selectedCount > 0 && (
                  <Text className="records-count"> · {selectedCount}套穿搭</Text>
                )}
              </Text>
            </View>

            {selectedDateRecords.length > 0 ? (
              <ScrollView scrollY className="records-list" onScrollToLower={loadMore}>
                {selectedDateRecords.map((record) => (
                  <View key={record.id} className="record-card" onClick={() => goToDetail(record)}>
                    <View className="record-header">
                      <Text className="record-title">{getOutfitDisplayTitle(record, '穿搭记录')}</Text>
                      <Text className="record-detail">详情 ›</Text>
                    </View>

                    <Text className="record-meta">
                      {[record.scene, formatWeather(record)].filter(Boolean).join(' · ')}
                    </Text>

                    <View className="record-tags">
                      {getOutfitStyleTags(record).slice(0, 3).map((tag) => (
                        <Text key={tag} className="record-tag">{tag}</Text>
                      ))}
                    </View>

                    <View className="record-thumbs">
                      {record.items?.slice(0, 3).map((item) => (
                        <SafeImage
                          key={item.clothingId}
                          className="record-thumb"
                          src={item.thumbnailUrl || item.imageUrl}
                          cacheIdentity={item.clothingId}
                          mode="aspectFill"
                          lazyLoad
                        />
                      ))}
                    </View>

                    {getSavedSnapshotDefaultCopy(record) ? (
                      <Text className="record-reason">{getSavedSnapshotDefaultCopy(record)}</Text>
                    ) : null}
                  </View>
                ))}

                {loading && (
                  <View className="loading-more">
                    <Text className="loading-text">加载中...</Text>
                  </View>
                )}

                {!loading && hasMore && selectedDateRecords.length > 0 && (
                  <View className="load-more-btn" onClick={loadMore}>
                    <Text className="load-more-text">加载更多</Text>
                  </View>
                )}
              </ScrollView>
            ) : (
              <View className="empty-state-card">
                <Text className="empty-title">这天还没有记录穿搭</Text>
                <Text className="empty-desc">今天穿了喜欢的搭配，可以在推荐页点"穿它"帮你记下来</Text>
                <View className="empty-action" onClick={goToTodayPage}>
                  <Text className="empty-action-text">去今日推荐</Text>
                </View>
              </View>
            )}
          </>
        ) : (
          <View className="empty-state-card">
            <Text className="empty-title">选择一个日期</Text>
            <Text className="empty-desc">点击上方日历中的日期，查看当天的穿搭记录</Text>
          </View>
        )}
      </View>
    </View>
  );
}

async function writeHistoryFirstPageCache(
  data: HistoryFirstPageCache,
  authContext: ActiveAuthContext | null,
) {
  await setUserPageCache(HISTORY_FIRST_PAGE_CACHE_KEY, data, {
    ttl: HISTORY_FIRST_PAGE_CACHE_TTL,
    authContext,
    meta: {
      pageSize: data.pageSize,
    },
  });
}

function applyHistoryOutfitStatuses(outfits: Outfit[], authContext?: ActiveAuthContext | null) {
  return applyOutfitStatuses(outfits, authContext);
}

function getOutfitStatusPatches(outfits: Outfit[]) {
  return outfits.map((outfit) => getOutfitStatusPatch(outfit)).filter((patch) => Boolean(patch.outfitKey));
}

function getOutfitStatusPatch(outfit: Outfit, fallbackOutfitKey = '', updatedAtOverride?: number): OutfitStatusPatch {
  const patch: OutfitStatusPatch = {
    outfitKey: outfit.outfitKey ?? fallbackOutfitKey,
  };
  const updatedAt = updatedAtOverride ?? getOutfitStatusUpdatedAt(outfit.updatedAt);

  if (updatedAt !== undefined) patch.updatedAt = updatedAt;
  if (outfit.isFavorite !== undefined) patch.isFavorite = outfit.isFavorite;
  if (outfit.favoriteOutfitId !== undefined) {
    patch.favoriteOutfitId = outfit.favoriteOutfitId;
  } else if (outfit.isFavorite === false) {
    patch.favoriteOutfitId = '';
  }
  if (outfit.isWornToday !== undefined) patch.isWornToday = outfit.isWornToday;
  if (outfit.todayHistoryId !== undefined) patch.todayHistoryId = outfit.todayHistoryId;
  if (outfit.wornAt !== undefined) patch.wornAt = outfit.wornAt;
  if (outfit.wornDate !== undefined) patch.wornDate = outfit.wornDate;
  if (outfit.userTitle !== undefined) patch.userTitle = outfit.userTitle;
  if (outfit.displayTitle !== undefined) patch.displayTitle = outfit.displayTitle;
  if (outfit.title !== undefined) patch.title = outfit.title;

  return patch;
}

function getOutfitStatusUpdatedAt(updatedAt: string | undefined) {
  if (!updatedAt) return undefined;
  const timestamp = Date.parse(updatedAt);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function isSameHistoryRecordList(prev: Outfit[], next: Outfit[]) {
  if (prev.length !== next.length) return false;
  return prev.every((item, index) => {
    const nextItem = next[index];
    if (!nextItem) return false;
    return (
      item.id === nextItem.id
      && item.outfitKey === nextItem.outfitKey
      && item.isFavorite === nextItem.isFavorite
      && item.favoriteOutfitId === nextItem.favoriteOutfitId
      && item.isWornToday === nextItem.isWornToday
      && item.todayHistoryId === nextItem.todayHistoryId
      && item.wornAt === nextItem.wornAt
      && item.wornDate === nextItem.wornDate
      && item.userTitle === nextItem.userTitle
      && item.displayTitle === nextItem.displayTitle
      && item.title === nextItem.title
    );
  });
}

function getRecordDate(record: Outfit): string {
  const dateValue = record.wornDate || record.wornAt || record.createdAt || '';
  return dateValue.slice(0, 10) || '';
}

function formatWeather(record: Outfit) {
  const weather = record.weatherSnapshot;
  if (!weather) return '';
  return [weather.weather, `${weather.temp}度`].filter(Boolean).join(' ');
}

OutfitHistoryPage.config = {
  navigationBarTitleText: '日历',
};
