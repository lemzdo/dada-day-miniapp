import { Image, Text, View } from '@tarojs/components';
import type { HomeLightCardV2 } from '@starter-template/types';

export interface HomeLightCardV2Props {
  card: HomeLightCardV2;
  position?: number;
  total?: number;
  onDetail?: (card: HomeLightCardV2) => void;
}

export function HomeLightCardV2({ card, position, total, onDetail }: HomeLightCardV2Props) {
  return (
    <View className="outfit-card home-light-card-v2" onClick={() => onDetail?.(card)}>
      <View className="outfit-card-header">
        <View className="outfit-title-section">
          <Text className="outfit-title">{card.displayTitle}</Text>
        </View>
        {position !== undefined && total !== undefined ? <Text className="card-count">{position + 1} / {total}</Text> : null}
      </View>
      <View className="outfit-collage">
        {card.items.map((item) => (
          <View className="collage-item" key={item.clothingId}>
            <View className="image-stage">
              <Image className="item-image" src={item.displayImageUrl} mode="aspectFit" />
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
