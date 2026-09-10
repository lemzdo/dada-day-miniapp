import { Image, Text, View } from '@tarojs/components';
import type { HomeLightCardV2 } from '@starter-template/types';
import { resolveGarmentAsset } from '@/utils/garmentAssetResolution';

export interface HomeLightCardV2Props {
  card: HomeLightCardV2;
  batchId: string;
  position?: number;
  total?: number;
  onDetail?: (card: HomeLightCardV2) => void;
  onFirstImageLoad?: (identity: { batchId: string; outfitKey: string }) => void;
}

export function HomeLightCardV2({ card, batchId, position, total, onDetail, onFirstImageLoad }: HomeLightCardV2Props) {
  const isFirstCard = position === 0;
  return (
    <View
      className={`outfit-card home-light-card-v2 ${isFirstCard ? 'qa-first-card-visible-target' : ''}`}
      data-recommendation-batch-id={batchId}
      data-outfit-key={card.outfitKey}
      onClick={() => onDetail?.(card)}
    >
      <View className="outfit-card-header">
        <View className="outfit-title-section">
          <Text className="outfit-title">{card.displayTitle}</Text>
        </View>
        {position !== undefined && total !== undefined ? <Text className="card-count">{position + 1} / {total}</Text> : null}
      </View>
      <View className="outfit-collage">
        {card.items.map((item, itemIndex) => (
          <View className="collage-item" key={item.clothingId}>
            <View className="image-stage">
              <Image
                className={`item-image ${isFirstCard && itemIndex === 0 ? 'qa-first-card-main-image' : ''}`}
                data-recommendation-batch-id={batchId}
                data-outfit-key={card.outfitKey}
                src={resolveGarmentAsset(item as unknown as Record<string, unknown>, 'CARD', { compatProfile: 'TODAY_CARD' }) || item.displayImageUrl}
                mode="aspectFit"
                onLoad={isFirstCard && itemIndex === 0
                  ? () => onFirstImageLoad?.({ batchId, outfitKey: card.outfitKey })
                  : undefined}
              />
            </View>
          </View>
        ))}
      </View>
      <View className="outfit-tags">
        {card.styleTags.slice(0, 3).map((tag) => <Text key={tag} className="style-tag">{tag}</Text>)}
      </View>
      <View className="outfit-reason">
        <Text className="reason-label">小搭推荐</Text>
        <Text className="reason-text">{card.todayReason}</Text>
      </View>
    </View>
  );
}
