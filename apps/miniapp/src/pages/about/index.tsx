import { Image, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import appLogo from '@/assets/brand/app-logo-about.png';
import './index.scss';

interface InfoItem {
  title: string;
  subtitle?: string;
  value?: string;
  type?: 'data' | 'legal';
}

const VERSION = '体验版 v0.0.1';

const infoItems: InfoItem[] = [
  { title: '当前版本', value: VERSION },
  {
    title: '使用与数据说明',
    subtitle: '了解衣橱、图片识别和推荐逻辑',
    type: 'data',
  },
  {
    title: '用户协议与隐私政策',
    subtitle: '了解使用规则、数据使用和隐私保护',
    type: 'legal',
  },
];

export default function AboutPage() {
  function openDetail(type: 'data' | 'legal') {
    Taro.navigateTo({ url: `/pages/about-detail/index?type=${type}` });
  }

  return (
    <View className="about-page">
      <View className="brand-card">
        <View className="brand-head">
          <Image className="brand-logo" src={appLogo} mode="aspectFit" />
          <View className="brand-copy">
            <Text className="brand-title">搭搭day</Text>
            <Text className="brand-subtitle">少纠结，也好看</Text>
          </View>
        </View>
        <Text className="brand-desc">
          搭搭day 是一款日常穿搭整理与推荐工具。你可以记录衣橱、完善偏好，并基于天气和场景获取穿搭参考。
        </Text>
      </View>

      <View className="info-card">
        {infoItems.map((item, index) => {
          const clickable = Boolean(item.type);
          return (
            <View
              key={item.title}
              className={`info-row ${index === infoItems.length - 1 ? 'last' : ''} ${clickable ? 'clickable' : ''}`}
              onClick={() => {
                if (item.type) openDetail(item.type);
              }}
            >
              <View className="info-main">
                <Text className="info-title">{item.title}</Text>
                {item.subtitle && <Text className="info-subtitle">{item.subtitle}</Text>}
              </View>
              <View className="info-right">
                {item.value && <Text className="info-value">{item.value}</Text>}
                {clickable && <Text className="info-arrow">›</Text>}
              </View>
            </View>
          );
        })}
      </View>

      <Text className="bottom-copy">每天少纠结一点，也能穿得好看一点。</Text>
    </View>
  );
}
