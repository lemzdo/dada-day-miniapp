import { Image, Text, View } from '@tarojs/components';
import type { HomeLightCardV2 } from '@starter-template/types';

export interface HomeLightCardV2Props {
  card: HomeLightCardV2;
  onFavorite?: (card: HomeLightCardV2) => void;
  onWear?: (card: HomeLightCardV2) => void;
  onDetail?: (card: HomeLightCardV2) => void;
}

export function HomeLightCardV2({ card, onFavorite, onWear, onDetail }: HomeLightCardV2Props) {
  return (
    <View className="outfit-card home-light-card-v2" onClick={() => onDetail?.(card)}>
      <View className="outfit-card-header"><Text className="outfit-title">{card.displayTitle}</Text></View>
      <Text className="reason-text">{card.todayReason}</Text>
      <View className="outfit-collage">
        {card.items.map((item) => (
          <Image className="item-image" key={item.clothingId} src={item.displayImageUrl} mode="aspectFill" />
        ))}
      </View>
      <View className="outfit-actions">
        <Text className="action-btn" onClick={(event) => { event.stopPropagation(); onFavorite?.(card); }}>
          {card.isFavorite ? '已收藏' : '收藏'}
        </Text>
        <Text className="action-btn primary" onClick={(event) => { event.stopPropagation(); onWear?.(card); }}>
          {card.isWornToday ? '今日已穿' : '确认穿着'}
        </Text>
      </View>
    </View>
  );
}
