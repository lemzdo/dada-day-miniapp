import { Image, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useLoad, useRouter } from '@tarojs/taro';
import { useState } from 'react';
import {
  addOutfitHistory,
  generateCloudOutfitComment,
  getCloudOutfit,
  getFavoriteOutfitDetail,
  getOutfitHistoryDetail,
  removeFavoriteOutfit,
  renameCloudOutfit,
  saveFavoriteOutfit,
} from '@/lib/cloud';
import { normalizeOutfitSnapshot, readOutfitDetailDraft, storeOutfitDetailDraft } from '@/utils/outfitSnapshot';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import type { Outfit, OutfitScores } from '@starter-template/types';
import './index.scss';

const scoreLabels: Record<keyof OutfitScores, string> = {
  total: '总分',
  weatherAdaptation: '天气',
  styleUnity: '风格',
  freshness: '新鲜',
  preference: '偏好',
  fashion: '时尚',
  comfort: '舒适',
  warmth: '保暖',
  coolness: '清爽',
  sceneMatch: '场景',
  colorHarmony: '配色',
};

type DetailSource = 'recommendation' | 'favorite' | 'history';
type EditableModalOptions = Parameters<typeof Taro.showModal>[0] & {
  editable: boolean;
  placeholderText: string;
};
type EditableModalResult = Awaited<ReturnType<typeof Taro.showModal>> & {
  content?: string;
};

export default function OutfitDetailPage() {
  const router = useRouter();
  const id = router.params.id;
  const sourceParam = router.params.source;
  const [outfit, setOutfit] = useState<Outfit | null>(null);
  const [detailSource, setDetailSource] = useState<DetailSource>('recommendation');
  const [loading, setLoading] = useState(true);
  const [operating, setOperating] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);

  useLoad(() => {
    if (id) fetchOutfit(id);
    else setLoading(false);
  });

  async function fetchOutfit(outfitId: string) {
    setLoading(true);
    try {
      const decodedId = decodeURIComponent(outfitId);
      const source = normalizeSource(sourceParam);
      setDetailSource(source);

      if (source === 'recommendation') {
        const draft = readOutfitDetailDraft(decodedId);
        if (draft) {
          setOutfit(normalizeOutfitSnapshot({ ...draft, outfitKind: draft.outfitKind || 'recommendation' }));
          return;
        }
      }

      const detail =
        source === 'favorite'
          ? await getFavoriteOutfitDetail(decodedId)
          : source === 'history'
            ? await getOutfitHistoryDetail(decodedId)
            : await getCloudOutfit(decodedId);
      setOutfit(normalizeOutfitSnapshot(detail));
    } catch (err) {
      console.error('Fetch outfit detail error:', err);
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }

  async function handleToggleFavorite() {
    if (!outfit || operating) return;

    setOperating(true);
    try {
      if (outfit.isFavorite) {
        await removeFavoriteOutfit(outfit.favoriteOutfitId || outfit.id);
        setOutfit({ ...outfit, isFavorite: false, favoriteOutfitId: undefined, outfitKind: 'recommendation' });
        setDetailSource('recommendation');
        Taro.showToast({ title: '已取消收藏', icon: 'success' });
        return;
      }

      const sourceForFavorite: Outfit = detailSource === 'history' ? { ...outfit, source: 'history' } : outfit;
      const saved = await saveFavoriteOutfit(normalizeOutfitSnapshot(sourceForFavorite), outfit.aiComment);
      setOutfit(
        normalizeOutfitSnapshot({
          ...outfit,
          isFavorite: true,
          favoriteOutfitId: saved.favoriteOutfitId || saved.id,
          favoritedAt: saved.favoritedAt || saved.createdAt,
        }),
      );
      Taro.showToast({ title: '已收藏', icon: 'success' });
    } catch (err) {
      console.error('Toggle outfit favorite error:', err);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setOperating(false);
    }
  }

  async function handleConfirmWear() {
    if (!outfit || operating) return;

    setOperating(true);
    try {
      const saved = await addOutfitHistory(normalizeOutfitSnapshot(outfit), {
        source: detailSource === 'favorite' || outfit.isFavorite ? 'favorite' : 'recommendation',
        sourceFavoriteOutfitId:
          detailSource === 'favorite' || outfit.isFavorite
            ? outfit.favoriteOutfitId || outfit.id
            : outfit.sourceFavoriteOutfitId,
        aiComment: outfit.aiComment,
      });
      setOutfit(
        normalizeOutfitSnapshot({
          ...outfit,
          isWornToday: true,
          todayHistoryId: saved.todayHistoryId || saved.historyId || saved.id,
          historyId: saved.historyId || saved.id,
          lastWornAt: saved.lastWornAt || saved.wornAt || new Date().toISOString(),
          wornAt: saved.wornAt,
          wornDate: saved.wornDate || outfit.wornDate,
        }),
      );
      Taro.showToast({ title: '已记录到穿搭历史', icon: 'success' });
    } catch (err) {
      console.error('Confirm outfit wear error:', err);
      Taro.showToast({ title: '操作失败', icon: 'none' });
    } finally {
      setOperating(false);
    }
  }

  async function handleRenameOutfit() {
    if (!outfit || operating) return;

    try {
      const modalResult = (await Taro.showModal({
        title: outfit.userTitle ? '编辑名称' : '给这套起个名字',
        content: outfit.userTitle || '',
        editable: true,
        placeholderText: '输入名称，清空可恢复系统名',
        confirmText: '保存',
        cancelText: '取消',
      } as EditableModalOptions)) as EditableModalResult;

      if (!modalResult.confirm) return;

      setOperating(true);
      const userTitle = typeof modalResult.content === 'string' ? modalResult.content : outfit.userTitle || '';
      const saved = await renameCloudOutfit({
        outfitId: outfit.outfitId || (detailSource === 'recommendation' ? outfit.id : undefined),
        outfitKey: outfit.outfitKey,
        outfit: normalizeOutfitSnapshot(outfit),
        userTitle,
      });
      const nextOutfit = normalizeOutfitSnapshot({
        ...outfit,
        title: saved.title || outfit.title,
        userTitle: saved.userTitle,
        displayTitle: saved.displayTitle,
        outfitId: saved.outfitId || saved.id || outfit.outfitId,
        outfitKey: saved.outfitKey || outfit.outfitKey,
        updatedAt: saved.updatedAt || outfit.updatedAt,
      });

      setOutfit(nextOutfit);
      if (detailSource === 'recommendation') {
        storeOutfitDetailDraft(nextOutfit);
      }
      Taro.showToast({ title: userTitle.trim() ? '已保存名称' : '已清空名称', icon: 'success' });
    } catch (err) {
      console.error('Rename outfit error:', err);
      Taro.showToast({ title: '名称保存失败', icon: 'none' });
    } finally {
      setOperating(false);
    }
  }

  async function handleGenerateAiComment() {
    if (!outfit || commentLoading) return;
    if (outfit.aiComment) {
      Taro.showToast({ title: '已展示小搭点评', icon: 'none' });
      return;
    }

    setCommentLoading(true);
    try {
      const result = await generateCloudOutfitComment(outfit);
      if (result.success && result.aiComment) {
        setOutfit({ ...outfit, aiComment: result.aiComment });
        Taro.showToast({ title: '小搭点评已生成', icon: 'success' });
        return;
      }
      Taro.showToast({ title: result.message || '小搭点评暂时不可用', icon: 'none' });
    } catch (err) {
      console.error('Generate outfit AI comment error:', err);
      Taro.showToast({ title: '小搭点评暂时不可用', icon: 'none' });
    } finally {
      setCommentLoading(false);
    }
  }

  if (loading) {
    return (
      <View className="outfit-detail-page loading">
        <View className="skeleton-title" />
        <View className="skeleton-card" />
        <View className="skeleton-card short" />
      </View>
    );
  }

  if (!outfit) {
    return (
      <View className="outfit-detail-page empty">
        <Text className="empty-title">没有找到这套穿搭</Text>
        <Text className="empty-desc">可能已经被删除，返回今日页再试试。</Text>
      </View>
    );
  }

  const scoreEntries = outfit.scores
    ? (Object.entries(outfit.scores) as Array<[keyof OutfitScores, number]>)
    : [];
  const deletedItemCount = getDeletedItemCount(outfit);
  const isFavoriteDetail = Boolean(outfit.isFavorite);

  return (
    <View className="outfit-detail-page">
      <ScrollView scrollY className="detail-scroll">
        <View className="hero-card">
          <View className="hero-header">
            <View>
              <Text className="hero-title">{getOutfitDisplayTitle(outfit, '今日推荐穿搭')}</Text>
              <Text className="hero-subtitle">
                {[outfit.scene, formatTimeOfDay(outfit.timeOfDay), outfit.targetDate].filter(Boolean).join(' · ')}
              </Text>
              <Text className="name-action" onClick={handleRenameOutfit}>
                {outfit.userTitle ? '编辑名称' : '给这套起个名字'}
              </Text>
            </View>
            <View className="detail-status-badges">
              {isFavoriteDetail && <Text className="favorite-mark">已收藏</Text>}
              {outfit.isWornToday && <Text className="worn-mark">今天穿过啦</Text>}
            </View>
          </View>

          {deletedItemCount > 0 && (
            <View className="deleted-notice">
              <Text className="deleted-notice-text">部分单品已从衣柜删除，仍按当时快照展示。</Text>
            </View>
          )}

          <View className="outfit-items">
            {outfit.items?.map((item) => (
              <View key={item.clothingId} className={`outfit-item ${item.isDeleted ? 'deleted' : ''}`}>
                <Image className="item-image" src={item.imageUrl} mode="aspectFit" lazyLoad />
                <Text className="item-name">{item.subcategory || item.category}</Text>
              </View>
            ))}
          </View>
        </View>

        {outfit.weatherSnapshot && (
          <View className="detail-card">
            <Text className="card-title">天气参考</Text>
            <View className="weather-grid">
              <WeatherValue label="温度" value={`${outfit.weatherSnapshot.temp}度`} />
              <WeatherValue label="天气" value={outfit.weatherSnapshot.weather} />
              <WeatherValue label="湿度" value={`${outfit.weatherSnapshot.humidity}%`} />
            </View>
          </View>
        )}

        {scoreEntries.length > 0 && (
          <View className="detail-card">
            <Text className="card-title">穿搭评分</Text>
            {scoreEntries.map(([key, value]) => (
              <ScoreValue key={key} label={scoreLabels[key] ?? key} value={value} />
            ))}
          </View>
        )}

        {(outfit.reasoning || outfit.reason) && (
          <View className="detail-card">
            <Text className="card-title">搭配理由</Text>
            <Text className="reasoning-text">{outfit.reasoning || outfit.reason}</Text>
          </View>
        )}

        <View className="detail-card ai-comment-card">
          <View className="ai-comment-header">
            <Text className="card-title">小搭点评</Text>
            <View
              className={`ai-comment-btn ${commentLoading || outfit.aiComment ? 'disabled' : ''}`}
              onClick={handleGenerateAiComment}
            >
              <Text className="ai-comment-btn-text">
                {commentLoading ? '点评中...' : outfit.aiComment ? '已生成' : '小搭点评这套'}
              </Text>
            </View>
          </View>

          {outfit.aiComment ? (
            <View className="ai-comment-content">
              <Text className="ai-comment-title">{outfit.aiComment.title}</Text>
              <Text className="ai-comment-reason">{outfit.aiComment.reason}</Text>
              {outfit.aiComment.styleTags.length > 0 && (
                <View className="ai-comment-tags">
                  {outfit.aiComment.styleTags.map((tag) => (
                    <Text key={tag} className="ai-comment-tag">
                      {tag}
                    </Text>
                  ))}
                </View>
              )}
              <Text className="ai-comment-tip">{outfit.aiComment.tip}</Text>
            </View>
          ) : (
            <Text className="ai-comment-empty">需要更自然的点评时，可以手动生成一次。</Text>
          )}
        </View>
      </ScrollView>

      <View className="action-bar">
        <View
          className={`action-btn favorite ${isFavoriteDetail ? 'active' : ''} ${operating ? 'disabled' : ''}`}
          onClick={handleToggleFavorite}
        >
          <Text className="btn-text">{isFavoriteDetail ? '取消收藏' : '收藏'}</Text>
        </View>
        <View className={`action-btn wear ${operating ? 'disabled' : ''}`} onClick={handleConfirmWear}>
          <Text className="btn-text">{operating ? '处理中...' : outfit.isWornToday ? '今天穿过啦' : '穿它'}</Text>
        </View>
      </View>
    </View>
  );
}

function WeatherValue({ label, value }: { label: string; value: string }) {
  return (
    <View className="weather-item">
      <Text className="weather-value">{value}</Text>
      <Text className="weather-label">{label}</Text>
    </View>
  );
}

function ScoreValue({ label, value }: { label: string; value: number }) {
  const score = formatScore(value);

  return (
    <View className="score-row">
      <Text className="score-label">{label}</Text>
      <View className="score-track">
        <View className="score-fill" style={{ width: `${score * 10}%` }} />
      </View>
      <Text className="score-value">{score}</Text>
    </View>
  );
}

function normalizeSource(value?: string): DetailSource {
  if (value === 'favorite' || value === 'history') return value;
  return 'recommendation';
}

function formatTimeOfDay(value?: string) {
  if (value === 'all_day') return '适合全天';
  if (value === 'morning') return '适合早晨';
  if (value === 'afternoon') return '适合下午';
  if (value === 'evening') return '适合晚上';
  return '';
}

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted || item.deletedAt).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}
