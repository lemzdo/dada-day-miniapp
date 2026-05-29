import { Image, Text, View } from '@tarojs/components';
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
import { normalizeOutfitSnapshot, readOutfitDetailDraft, storeOutfitDetailDraft, storeOutfitStateSync } from '@/utils/outfitSnapshot';
import {
  getDateLabel,
  getItemCountText,
  getOutfitScoreLabels,
  getOutfitStyleTags,
  getOutfitWeatherSummary,
  getSceneLabel,
  getTimeLabel,
} from '@/utils/outfitContextText';
import { getOutfitDisplayTitle } from '@/utils/outfitTitle';
import type { Outfit } from '@starter-template/types';
import './index.scss';

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
        await removeFavoriteOutfit(outfit.favoriteOutfitId || outfit.id, outfit.outfitKey);
        persistOutfitUpdate(
          normalizeOutfitSnapshot({
            ...outfit,
            isFavorite: false,
            favoriteOutfitId: undefined,
            favoritedAt: undefined,
            outfitKind: 'recommendation',
          }),
        );
        setDetailSource('recommendation');
        Taro.showToast({ title: '已取消收藏', icon: 'success' });
        return;
      }

      const sourceForFavorite: Outfit = detailSource === 'history' ? { ...outfit, source: 'history' } : outfit;
      const saved = await saveFavoriteOutfit(normalizeOutfitSnapshot(sourceForFavorite), outfit.aiComment);
      persistOutfitUpdate(
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
      persistOutfitUpdate(
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

      persistOutfitUpdate(nextOutfit);
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

  function persistOutfitUpdate(nextOutfit: Outfit) {
    setOutfit(nextOutfit);
    storeOutfitStateSync(nextOutfit);
    if (detailSource === 'recommendation') {
      storeOutfitDetailDraft(nextOutfit);
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

  const deletedItemCount = getDeletedItemCount(outfit);
  const isFavoriteDetail = Boolean(outfit.isFavorite);
  const styleTags = getOutfitStyleTags(outfit);
  const weatherSummary = getOutfitWeatherSummary(outfit);
  const scoreLabels = getOutfitScoreLabels(outfit);
  const itemCountText = getItemCountText(outfit);

  return (
    <View className="outfit-detail-page">
      <View className="detail-scroll">
        <View className="hero-card">
          <View className="hero-header">
            <View className="hero-title-block">
              <Text className="hero-title">{getOutfitDisplayTitle(outfit, '今日推荐穿搭')}</Text>
              <View className="fact-chips">
                <Text className="fact-chip">{getSceneLabel(outfit)}</Text>
                <Text className="fact-chip">{getDateLabel(outfit)}</Text>
                <Text className="fact-chip">{weatherSummary.chip || getTimeLabel(outfit)}</Text>
                {isFavoriteDetail && <Text className="fact-chip favorite">已收藏</Text>}
                {outfit.isWornToday && <Text className="fact-chip worn">今天穿过啦</Text>}
              </View>
            </View>
            <View className="name-action" onClick={handleRenameOutfit}>
              <Text className="name-action-text">{outfit.userTitle ? '编辑' : '命名'}</Text>
            </View>
          </View>

          {deletedItemCount > 0 && (
            <View className="deleted-notice">
              <Text className="deleted-notice-text">部分单品已从衣柜删除，仍按当时快照展示。</Text>
            </View>
          )}
        </View>

        <View className="visual-card">
          <View className="visual-collage">
            {outfit.items?.map((item) => (
              <View key={item.clothingId} className={`visual-item ${item.isDeleted ? 'deleted' : ''}`}>
                <Image className="visual-image" src={item.imageUrl} mode="aspectFit" lazyLoad />
              </View>
            ))}
          </View>
        </View>

        {styleTags.length > 0 && (
          <View className="style-tags">
            {styleTags.map((tag) => (
              <Text key={tag} className="style-tag">
                {tag}
              </Text>
            ))}
          </View>
        )}

        {(outfit.reasoning || outfit.reason) && (
          <View className="detail-card reason-card">
            <Text className="card-title">为什么推荐这套</Text>
            <Text className="reasoning-text">{outfit.reasoning || outfit.reason}</Text>
          </View>
        )}

        <View className="detail-card weather-card">
          <Text className="card-title">今日天气参考</Text>
          <View className="weather-summary">
            <Text className="weather-title">{weatherSummary.title}</Text>
            <Text className="weather-tip">{weatherSummary.tip}</Text>
          </View>
        </View>

        {scoreLabels.length > 0 && (
          <View className="detail-card">
            <Text className="card-title">搭配指数</Text>
            <View className="score-cards">
              {scoreLabels.map((score) => (
                <View key={score.label} className="score-card">
                  <Text className="score-card-label">{score.label}</Text>
                  <Text className="score-card-value">{score.value}</Text>
                  <Text className="score-card-text">{score.text}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <View className="detail-card ai-comment-card">
          <View className="ai-comment-header">
            <Text className="card-title">小搭点评</Text>
            <View
              className={`ai-comment-btn ${commentLoading ? 'disabled' : ''}`}
              onClick={handleGenerateAiComment}
            >
              <Text className="ai-comment-btn-text">
                {commentLoading ? '点评中...' : outfit.aiComment ? '重新点评' : '让小搭点评这套'}
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
            <Text className="ai-comment-empty">想听听小搭怎么看这套时，可以手动生成一次。</Text>
          )}
        </View>

        <View className="detail-card item-list-card">
          <Text className="card-title">用到的单品 {itemCountText}</Text>
          <View className="outfit-items">
            {outfit.items?.map((item) => (
              <View key={item.clothingId} className={`outfit-item ${item.isDeleted ? 'deleted' : ''}`}>
                <Image className="item-image" src={item.imageUrl} mode="aspectFit" lazyLoad />
                <Text className="item-name">{item.subcategory || item.category}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>

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

function normalizeSource(value?: string): DetailSource {
  if (value === 'favorite' || value === 'history') return value;
  return 'recommendation';
}

function getDeletedItemCount(outfit: Outfit) {
  if (typeof outfit.deletedItemCount === 'number') return outfit.deletedItemCount;
  const snapshotCount = outfit.snapshotItems?.filter((item) => item.isDeleted || item.deletedAt).length ?? 0;
  const itemCount = outfit.items?.filter((item) => item.isDeleted).length ?? 0;
  return Math.max(snapshotCount, itemCount);
}

