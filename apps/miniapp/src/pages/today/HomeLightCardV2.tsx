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
    <View className="home-light-card-v2" onClick={() => onDetail?.(card)}>
      <Text>{card.displayTitle}</Text>
      <Text>{card.todayReason}</Text>
      <View>
        {card.items.map((item) => (
          <Image key={item.clothingId} src={item.thumbnailUrl || item.imageUrl || ''} mode="aspectFill" />
        ))}
      </View>
      <View>
        <Text onClick={(event) => { event.stopPropagation(); onFavorite?.(card); }}>
          {card.isFavorite ? '已收藏' : '收藏'}
        </Text>
        <Text onClick={(event) => { event.stopPropagation(); onWear?.(card); }}>
          {card.isWornToday ? '今日已穿' : '确认穿着'}
        </Text>
      </View>
    </View>
  );
}
