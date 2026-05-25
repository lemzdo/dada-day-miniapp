import { View, Image, Text } from '@tarojs/components';
import Taro, { useLoad, useRouter } from '@tarojs/taro';
import { useState } from 'react';
import { deleteCloudClothing, getClothingById, inspectCloudClothingDelete, recognizeClothAttributes } from '@/lib/cloud';
import { categoryLabels, displayClothingTags, displayClothingText, getDisplayImage } from '@/utils/clothingLabels';
import type { Clothing } from '@starter-template/types';
import './index.scss';

const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';
const WARDROBE_REFRESH_EVENT = 'wardrobe:refresh';

function buildDeleteConfirmText(favoriteCount: number, historyCount: number) {
  const impacts = [];
  if (favoriteCount > 0) impacts.push(`${favoriteCount} 个收藏穿搭`);
  if (historyCount > 0) impacts.push(`${historyCount} 个历史穿搭`);

  if (impacts.length === 0) {
    return '删除后这件衣服会从衣柜和推荐中移除，7天后清理图片。';
  }

  return `这件衣服被 ${impacts.join('、')} 使用。删除后会保留穿搭快照，并标记为不完整，7天后清理衣服图片。`;
}

export default function ClothingDetailPage() {
  const router = useRouter();
  const id = router.params.id;
  const [clothing, setClothing] = useState<Clothing | null>(null);
  const [loading, setLoading] = useState(true);
  const [recognizing, setRecognizing] = useState(false);

  useLoad(() => {
    if (id) fetchClothing(id);
  });

  async function fetchClothing(clothingId: string) {
    setLoading(true);
    try {
      setClothing(await getClothingById(clothingId));
    } catch (err) {
      console.error('Fetch clothing error:', err);
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete() {
    if (!clothing) return;

    try {
      const impact = await inspectCloudClothingDelete(clothing.id);
      const res = await Taro.showModal({
        title: '确认删除',
        content: buildDeleteConfirmText(impact.affectedFavoriteCount, impact.affectedHistoryCount),
        confirmColor: '#FF6B6B',
      });
      if (!res.confirm) return;

      await deleteCloudClothing(clothing.id);
      Taro.setStorageSync(WARDROBE_REFRESH_STORAGE_KEY, '1');
      Taro.eventCenter.trigger(WARDROBE_REFRESH_EVENT, { deletedId: clothing.id });
      Taro.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 800);
    } catch (err) {
      console.error('Delete clothing error:', err);
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  }

  function handleEdit() {
    if (!clothing) return;
    Taro.navigateTo({ url: `/pages/clothing-form/index?id=${clothing.id}` });
  }

  async function handleRecognize() {
    if (!clothing || recognizing) return;
    setRecognizing(true);
    setClothing({ ...clothing, aiStatus: 'recognizing' });

    try {
      const updated = await recognizeClothAttributes(clothing.id);
      setClothing(updated);
      Taro.showToast({ title: '识别完成', icon: 'success' });
    } catch (err) {
      console.error('Recognize clothing error:', err);
      setClothing({ ...clothing, aiStatus: 'failed' });
      Taro.showToast({ title: '小搭暂时没整理好，可手动编辑或重新整理', icon: 'none' });
    } finally {
      setRecognizing(false);
    }
  }

  if (loading) {
    return (
      <View className="clothing-detail-page loading">
        <View className="skeleton-image" />
        <View className="skeleton-content">
          <View className="skeleton-line" />
          <View className="skeleton-line short" />
        </View>
      </View>
    );
  }

  if (!clothing) {
    return (
      <View className="clothing-detail-page error">
        <Text className="error-text">衣服不存在或已删除</Text>
      </View>
    );
  }

  const material = displayClothingText(clothing.materialGuess || clothing.material);
  const colors = clothing.colorPalette?.map((color) => ({
    ...color,
    name: displayClothingText(color.name),
  }));

  return (
    <View className="clothing-detail-page">
      <View className="image-section">
        <Image className="clothing-image" src={getDisplayImage(clothing)} mode="aspectFit" />
      </View>

      {(clothing.aiRecognizeStatus === 'pending' || clothing.aiRecognizeStatus === 'failed' || (clothing.aiStatus && clothing.aiStatus !== 'recognized')) && (
        <View className={`ai-status-card ${clothing.aiStatus}`}>
          <Text className="ai-status-title">
            {clothing.aiRecognizeStatus === 'failed' || clothing.aiStatus === 'failed' ? '小搭暂时没整理好' : '小搭正在整理属性...'}
          </Text>
          <Text className="ai-status-desc">
            {clothing.aiRecognizeStatus === 'failed' || clothing.aiStatus === 'failed'
              ? '可手动编辑或重新识别'
              : '衣服已加入衣橱，识别完成后会自动补全属性'}
          </Text>
          {(clothing.aiRecognizeStatus === 'failed' || clothing.aiStatus === 'failed') && (
            <View className="retry-btn" onClick={handleRecognize}>
              <Text className="retry-text">{recognizing ? '识别中...' : '重新识别'}</Text>
            </View>
          )}
        </View>
      )}

      <View className="info-card">
        <View className="info-section">
          <Text className="section-title">基础信息</Text>
          <View className="info-grid">
            <InfoItem label="品类" value={categoryLabels[clothing.category] || clothing.category} />
            {clothing.subcategory && <InfoItem label="子类" value={displayClothingText(clothing.subcategory)} />}
            {material && <InfoItem label="材质" value={material} />}
            {typeof clothing.aiConfidence === 'number' && clothing.aiConfidence > 0 && (
              <InfoItem label="小搭置信度" value={`${Math.round(clothing.aiConfidence * 100)}%`} />
            )}
            {clothing.brand && <InfoItem label="品牌" value={clothing.brand} />}
          </View>
        </View>

        {colors && colors.length > 0 && (
          <View className="info-section">
            <Text className="section-title">颜色</Text>
            <View className="color-list">
              {colors.map((color, idx) => (
                <View key={idx} className="color-item">
                  <View className="color-dot" style={{ backgroundColor: color.hex }} />
                  <Text className="color-name">{color.name}</Text>
                  <Text className="color-ratio">{Math.round(color.ratio * 100)}%</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <TagSection title="风格" tags={displayClothingTags(clothing.styleTags)} />
        <TagSection title="适用场景" tags={displayClothingTags(clothing.sceneTags)} className="scene" />
        <TagSection title="适用季节" tags={displayClothingTags(clothing.seasonTags)} className="season" />

        {clothing.customName && (
          <View className="info-section">
            <Text className="section-title">备注名称</Text>
            <Text className="custom-name">{clothing.customName}</Text>
          </View>
        )}
      </View>

      <View className="action-bar">
        <View className="action-btn edit" onClick={handleEdit}>
          <Text className="btn-text">编辑</Text>
        </View>
        <View className={`action-btn recognize ${recognizing ? 'disabled' : ''}`} onClick={handleRecognize}>
          <Text className="btn-text">{recognizing ? '识别中...' : '重新识别'}</Text>
        </View>
        <View className="action-btn delete" onClick={handleDelete}>
          <Text className="btn-text">删除</Text>
        </View>
      </View>
    </View>
  );
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <View className="info-item">
      <Text className="info-label">{label}</Text>
      <Text className="info-value">{value}</Text>
    </View>
  );
}

function TagSection({
  title,
  tags,
  className = '',
}: {
  title: string;
  tags?: string[];
  className?: string;
}) {
  if (!tags?.length) return null;

  return (
    <View className="info-section">
      <Text className="section-title">{title}</Text>
      <View className="tag-list">
        {tags.map((tag) => (
          <View key={tag} className={`tag-item ${className}`}>
            <Text className="tag-text">{tag}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
