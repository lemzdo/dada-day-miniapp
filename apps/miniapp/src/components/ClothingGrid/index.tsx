import { View, Image, Text } from '@tarojs/components';
import { categoryLabels, displayClothingTags, displayClothingText, getDisplayImage } from '@/utils/clothingLabels';
import type { Clothing } from '@starter-template/types';
import './index.scss';

interface ClothingGridProps {
  clothes: Clothing[];
  onItemClick?: (item: Clothing) => void;
  onItemLongPress?: (item: Clothing) => void;
  loading?: boolean;
  emptyText?: string;
  selectionMode?: boolean;
  selectedIds?: string[];
}

export function ClothingGrid({
  clothes,
  onItemClick,
  onItemLongPress,
  loading,
  emptyText = '还没有衣服，去添加第一件吧',
  selectionMode = false,
  selectedIds = [],
}: ClothingGridProps) {
  if (loading) {
    return (
      <View className="clothing-grid loading">
        <View className="grid-skeleton">
          {Array.from({ length: 6 }).map((_, i) => (
            <View key={i} className="skeleton-item" />
          ))}
        </View>
      </View>
    );
  }

  if (clothes.length === 0) {
    return (
      <View className="clothing-grid empty">
        <Text className="empty-text">{emptyText}</Text>
      </View>
    );
  }

  return (
    <View className="clothing-grid">
      {clothes.map((item) => {
        const styleTags = displayClothingTags(item.styleTags).slice(0, 2);
        const selected = selectedIds.includes(item.id);

        return (
          <View
            key={item.id}
            className={`grid-item ${selectionMode ? 'selectable' : ''} ${selected ? 'selected' : ''}`}
            onClick={() => onItemClick?.(item)}
            onLongPress={() => onItemLongPress?.(item)}
          >
            <View className="item-image-wrapper">
              <Image className="item-image" src={getDisplayImage(item)} mode="aspectFit" lazyLoad />
              {selectionMode && selected && (
                <>
                  <View className="selection-overlay" />
                  <View className="selection-label">
                    <Text className="selection-label-text">已选中</Text>
                  </View>
                </>
              )}
              {(item.aiRecognizeStatus === 'pending' || item.aiStatus === 'pending' || item.aiStatus === 'recognizing') && (
                <View className="ai-status-badge recognizing">
                  <Text className="ai-status-text">小搭整理中</Text>
                </View>
              )}
              {(item.aiRecognizeStatus === 'failed' || item.aiStatus === 'failed') && (
                <View className="ai-status-badge failed">
                  <Text className="ai-status-text">识别失败</Text>
                </View>
              )}
              {item.customName && (
                <View className="item-badge">
                  <Text className="badge-text">{item.customName}</Text>
                </View>
              )}
            </View>
            <View className="item-info">
              <Text className="item-category">{categoryLabels[item.category] || displayClothingText(item.category)}</Text>
              {styleTags.length > 0 && (
                <View className="item-tags">
                  {styleTags.map((tag, idx) => (
                    <Text key={idx} className="tag">
                      {tag}
                    </Text>
                  ))}
                </View>
              )}
            </View>
          </View>
        );
      })}
    </View>
  );
}
