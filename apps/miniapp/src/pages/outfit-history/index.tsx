import { View, Text } from '@tarojs/components';
import Taro from '@tarojs/taro';
import './index.scss';

export default function OutfitHistoryPage() {
  return (
    <View className="outfit-history-page">
      <View className="stats-card">
        <View className="stat-item">
          <Text className="stat-num">0</Text>
          <Text className="stat-label">记录天数</Text>
        </View>
        <View className="stat-item">
          <Text className="stat-num">-</Text>
          <Text className="stat-label">平均满意</Text>
        </View>
        <View className="stat-item">
          <Text className="stat-num">0</Text>
          <Text className="stat-label">常穿单品</Text>
        </View>
      </View>

      <View className="state-card">
        <Text className="state-title">穿搭历史稍后接入</Text>
        <Text className="state-desc">MVP 云开发版本先打通衣橱、识别、推荐、收藏和今日确认。</Text>
        <View className="state-action" onClick={() => Taro.switchTab({ url: '/pages/today/index' })}>
          <Text className="state-action-text">去今日页</Text>
        </View>
      </View>
    </View>
  );
}
