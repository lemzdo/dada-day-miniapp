import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useLoad } from '@tarojs/taro';
import { useState, type ReactNode } from 'react';
import { useUserStore } from '@/stores/userStore';
import type {
  FitPreference,
  RecommendationGenderPreference,
  RecommendationProfile,
  TemperatureSensitivity,
} from '@starter-template/types';
import { DEFAULT_RECOMMENDATION_PROFILE } from '@/constants/recommendationProfile';
import './index.scss';

const STYLE_LIMIT = 5;

const GENDER_OPTIONS: Array<{ value: RecommendationGenderPreference; label: string }> = [
  { value: 'male_style', label: '偏男性穿搭' },
  { value: 'female_style', label: '偏女性穿搭' },
  { value: 'neutral_style', label: '中性/无性别穿搭' },
  { value: 'all', label: '都可以' },
  { value: 'unknown', label: '暂不选择' },
];

const STYLE_OPTIONS = [
  '日常休闲',
  '通勤简约',
  '韩系',
  '日系',
  '甜酷',
  '工装',
  '运动',
  '美式复古',
  'Clean Fit',
  '极简',
  '学院风',
  '松弛感',
  '街头',
  '轻熟',
];

const FIT_OPTIONS: Array<{ value: FitPreference; label: string }> = [
  { value: 'loose', label: '宽松' },
  { value: 'regular', label: '合身' },
  { value: 'slim', label: '修身' },
  { value: 'oversize', label: 'Oversize' },
  { value: 'unknown', label: '看单品决定' },
];

const TEMP_OPTIONS: Array<{ value: TemperatureSensitivity; label: string }> = [
  { value: 'cold_sensitive', label: '怕冷' },
  { value: 'normal', label: '正常' },
  { value: 'heat_sensitive', label: '怕热' },
];

export default function StylePreferencesPage() {
  const [profile, setProfile] = useState<RecommendationProfile>(DEFAULT_RECOMMENDATION_PROFILE);
  const [saving, setSaving] = useState(false);
  const saveRecommendationProfile = useUserStore((state) => state.saveRecommendationProfile);

  useLoad(() => {
    setProfile(useUserStore.getState().recommendationProfile);
  });

  function setGenderPreference(genderPreference: RecommendationGenderPreference) {
    setProfile((prev) => ({ ...prev, genderPreference }));
  }

  function setFitPreference(fitPreference: FitPreference) {
    setProfile((prev) => ({ ...prev, fitPreference }));
  }

  function setTemperatureSensitivity(temperatureSensitivity: TemperatureSensitivity) {
    setProfile((prev) => ({ ...prev, temperatureSensitivity }));
  }

  function toggleStyle(style: string) {
    setProfile((prev) => {
      if (prev.styleTags.includes(style)) {
        return { ...prev, styleTags: prev.styleTags.filter((item) => item !== style) };
      }

      if (prev.styleTags.length >= STYLE_LIMIT) {
        Taro.showToast({ title: `最多选 ${STYLE_LIMIT} 个`, icon: 'none' });
        return prev;
      }

      return { ...prev, styleTags: [...prev.styleTags, style] };
    });
  }

  async function handleSave() {
    await saveAndLeave(profile);
  }

  async function handleSkip() {
    await saveAndLeave(profile);
  }

  async function saveAndLeave(nextProfile: RecommendationProfile) {
    if (saving) return;

    setSaving(true);
    try {
      await saveRecommendationProfile(nextProfile);
      Taro.showToast({ title: '已保存', icon: 'success' });
      setTimeout(goNext, 500);
    } catch (error) {
      console.error('Save recommendation profile failed:', error);
      Taro.showToast({ title: '保存失败，请稍后再试', icon: 'none' });
    } finally {
      setSaving(false);
    }
  }

  function goNext() {
    const pages = Taro.getCurrentPages();
    if (pages.length > 1) {
      Taro.navigateBack();
      return;
    }
    Taro.switchTab({ url: '/pages/today/index' });
  }

  return (
    <View className="style-preferences-page">
      <ScrollView scrollY className="style-scroll" showScrollbar={false}>
        <View className="brand-card">
          <View className="brand-copy">
            <Text className="brand-name">搭搭day</Text>
            <Text className="brand-slogan">少纠结，多好看 ✦</Text>
            <Text className="brand-desc">每天出门前，给你一套刚刚好的搭配</Text>
          </View>
          <View className="brand-orbit">
            <Text className="orbit-icon orbit-shirt">衣</Text>
            <Text className="orbit-icon orbit-weather">23°</Text>
            <Text className="orbit-icon orbit-spark">AI</Text>
          </View>
        </View>

        <View className="hero-copy">
          <Text className="hero-title">我的穿搭档案</Text>
          <Text className="hero-desc">记录风格、版型和冷热偏好，让每日推荐更贴合你。</Text>
        </View>

        <PreferenceSection
          eyebrow="档案 01"
          title="你希望推荐更偏向哪类穿搭？"
          hint="这不是性别选择，只是搭配风格偏好，可以随时修改。"
        >
          <View className="tag-list">
            {GENDER_OPTIONS.map((option) => (
              <TagButton
                key={option.value}
                label={option.label}
                active={profile.genderPreference === option.value}
                onClick={() => setGenderPreference(option.value)}
              />
            ))}
          </View>
        </PreferenceSection>

        <PreferenceSection
          eyebrow="档案 02"
          title="你常喜欢哪些风格？"
          hint="最多选 5 个，搭搭day会优先按这些口味推荐。"
          aside={`${profile.styleTags.length}/${STYLE_LIMIT}`}
        >
          <View className="tag-list">
            {STYLE_OPTIONS.map((style) => (
              <TagButton
                key={style}
                label={style}
                active={profile.styleTags.includes(style)}
                onClick={() => toggleStyle(style)}
              />
            ))}
          </View>
        </PreferenceSection>

        <PreferenceSection eyebrow="档案 03" title="你更喜欢衣服怎么穿在身上？">
          <View className="tag-list">
            {FIT_OPTIONS.map((option) => (
              <TagButton
                key={option.value}
                label={option.label}
                active={profile.fitPreference === option.value}
                onClick={() => setFitPreference(option.value)}
              />
            ))}
          </View>
        </PreferenceSection>

        <PreferenceSection
          eyebrow="档案 04"
          title="你对冷热敏感吗？"
          hint="同样 18℃，有人要外套，有人只想短袖。"
        >
          <View className="tag-list compact">
            {TEMP_OPTIONS.map((option) => (
              <TagButton
                key={option.value}
                label={option.label}
                active={profile.temperatureSensitivity === option.value}
                onClick={() => setTemperatureSensitivity(option.value)}
              />
            ))}
          </View>
        </PreferenceSection>
      </ScrollView>

      <View className="action-bar">
        <View className={`primary-btn ${saving ? 'disabled' : ''}`} onClick={handleSave}>
          <Text className="primary-text">{saving ? '保存中...' : '保存我的穿搭档案'}</Text>
        </View>
        <View className={`secondary-btn ${saving ? 'disabled' : ''}`} onClick={handleSkip}>
          <Text className="secondary-text">稍后再补</Text>
        </View>
      </View>
    </View>
  );
}

function PreferenceSection({
  eyebrow,
  title,
  hint,
  aside,
  children,
}: {
  eyebrow: string;
  title: string;
  hint?: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <View className="preference-card">
      <View className="section-meta">
        <Text className="section-eyebrow">{eyebrow}</Text>
        {aside && <Text className="section-aside">{aside}</Text>}
      </View>
      <Text className="section-title">{title}</Text>
      {hint && <Text className="section-hint">{hint}</Text>}
      {children}
    </View>
  );
}

function TagButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <View className={`taste-tag ${active ? 'active' : ''}`} onClick={onClick}>
      <Text className="taste-tag-mark">{active ? '✦' : ''}</Text>
      <Text className="taste-tag-text">{label}</Text>
    </View>
  );
}
