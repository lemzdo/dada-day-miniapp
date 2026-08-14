import { View, Text, ScrollView } from '@tarojs/components';
import Taro, { useLoad, useUnload } from '@tarojs/taro';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useBoundUserFlow } from '@/hooks/useBoundUserFlow';
import {
  classifyRecommendationProfileInvalidation,
  invalidateAfterProfileMutation,
} from '@/lib/cacheInvalidation';
import { updateCloudUserProfile } from '@/lib/cloud';
import {
  captureAuthContext,
  isAuthContextCurrent,
  type ActiveAuthContext,
} from '@/lib/userPageCache';
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

function normalizeProfile(profile: RecommendationProfile): RecommendationProfile {
  return {
    ...profile,
    styleTags: [...new Set(profile.styleTags)].sort((a, b) =>
      STYLE_OPTIONS.indexOf(a) - STYLE_OPTIONS.indexOf(b)
    ),
  };
}

function areProfilesEqual(a: RecommendationProfile, b: RecommendationProfile): boolean {
  const normA = normalizeProfile(a);
  const normB = normalizeProfile(b);
  return (
    normA.genderPreference === normB.genderPreference &&
    normA.fitPreference === normB.fitPreference &&
    normA.temperatureSensitivity === normB.temperatureSensitivity &&
    normA.styleTags.length === normB.styleTags.length &&
    normA.styleTags.every((tag, index) => tag === normB.styleTags[index])
  );
}

export default function StylePreferencesPage() {
  const [profile, setProfile] = useState<RecommendationProfile>(DEFAULT_RECOMMENDATION_PROFILE);
  const [saving, setSaving] = useState(false);
  const initialSnapshot = useRef<RecommendationProfile>(DEFAULT_RECOMMENDATION_PROFILE);
  const mountedRef = useRef(true);
  const savingRef = useRef(false);
  const redirectingRef = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileRef = useRef(profile);
  const isDirtyRef = useRef(false);

  const resetFlowState = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    savingRef.current = false;
    initialSnapshot.current = DEFAULT_RECOMMENDATION_PROFILE;
    setProfile(DEFAULT_RECOMMENDATION_PROFILE);
    setSaving(false);
  }, []);

  const navigateToProfile = useCallback(() => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    Taro.switchTab({ url: '/pages/profile/index' }).catch((error) => {
      console.warn('Navigate to profile failed:', error);
      redirectingRef.current = false;
    });
  }, []);

  const {
    boundRuntimeKeyRef,
    isFlowActive,
  } = useBoundUserFlow({
    onBind: () => {
      initializeFlow();
    },
    onInvalidate: () => {
      resetFlowState();
      navigateToProfile();
    },
  });

  useLoad(() => {
    mountedRef.current = true;
  });

  const isDirty = !areProfilesEqual(profile, initialSnapshot.current);
  profileRef.current = profile;
  isDirtyRef.current = isDirty;
  savingRef.current = saving;

  function initializeFlow() {
    const savedProfile = useUserStore.getState().recommendationProfile;
    setProfile(savedProfile);
    initialSnapshot.current = savedProfile;
  }

  function isFlowCurrent(
    authContext: ActiveAuthContext | null | undefined,
    flowRuntimeKey: string | null,
  ) {
    return Boolean(
      authContext
        && isAuthContextCurrent(authContext)
        && isFlowActive(flowRuntimeKey),
    );
  }

  function canWriteState(authContext: ActiveAuthContext | null | undefined, flowRuntimeKey: string | null) {
    return mountedRef.current && isFlowCurrent(authContext, flowRuntimeKey);
  }

  function setGenderPreference(genderPreference: RecommendationGenderPreference) {
    if (!isFlowActive(boundRuntimeKeyRef.current)) return;
    setProfile((prev) => ({ ...prev, genderPreference }));
  }

  function setFitPreference(fitPreference: FitPreference) {
    if (!isFlowActive(boundRuntimeKeyRef.current)) return;
    setProfile((prev) => ({ ...prev, fitPreference }));
  }

  function setTemperatureSensitivity(temperatureSensitivity: TemperatureSensitivity) {
    if (!isFlowActive(boundRuntimeKeyRef.current)) return;
    setProfile((prev) => ({ ...prev, temperatureSensitivity }));
  }

  function toggleStyle(style: string) {
    if (!isFlowActive(boundRuntimeKeyRef.current)) return;
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
    if (saving) return;
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowActive(flowRuntimeKey)) return;

    if (!isDirty) {
      goNext();
      return;
    }

    setSaving(true);
    try {
      const saved = await saveRecommendationProfileForFlow(profile, authContext, flowRuntimeKey);
      if (!saved) return;
      Taro.showToast({ title: '偏好已保存，正在重新搭配', icon: 'none' });
      initialSnapshot.current = profile;
      saveTimerRef.current = setTimeout(() => {
        if (isFlowCurrent(authContext, flowRuntimeKey)) goNext();
      }, 500);
    } catch (error) {
      console.error('Save recommendation profile failed:', error);
      if (isFlowCurrent(authContext, flowRuntimeKey)) {
        Taro.showToast({ title: '保存失败，请稍后再试', icon: 'none' });
      }
    } finally {
      if (canWriteState(authContext, flowRuntimeKey)) setSaving(false);
    }
  }

  function goNext() {
    navigateToProfile();
  }

  async function saveRecommendationProfileForFlow(
    nextProfile: RecommendationProfile,
    authContext: ActiveAuthContext,
    flowRuntimeKey: string | null,
  ) {
    if (!isFlowCurrent(authContext, flowRuntimeKey)) return false;
    const previousProfile = useUserStore.getState().recommendationProfile;
    await updateCloudUserProfile(nextProfile);
    if (!isFlowCurrent(authContext, flowRuntimeKey)) return false;
    useUserStore.setState({
      recommendationProfile: nextProfile,
      preferredStyles: nextProfile.styleTags,
    });
    await invalidateAfterProfileMutation({
      authContext,
      recommendationImpact: classifyRecommendationProfileInvalidation(previousProfile, nextProfile),
      dirtyReason: 'preference_changed',
    });
    if (!isFlowCurrent(authContext, flowRuntimeKey)) return false;
    return true;
  }

  useUnload(() => {
    mountedRef.current = false;
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowCurrent(authContext, flowRuntimeKey) || !isDirtyRef.current || savingRef.current) return;
    const activeAuthContext = authContext;

    if (isDirtyRef.current && !savingRef.current) {
      Taro.showModal({
        title: '提示',
        content: '还没保存这次调整，离开后不会同步到你的风格画像。',
        confirmText: '保存',
        cancelText: '离开',
        success: async (res) => {
          if (res.confirm) {
            try {
              const saved = await saveRecommendationProfileForFlow(profileRef.current, activeAuthContext, flowRuntimeKey);
              if (saved && isFlowCurrent(activeAuthContext, flowRuntimeKey)) {
                initialSnapshot.current = profileRef.current;
                Taro.showToast({ title: '偏好已保存，正在重新搭配', icon: 'none' });
              }
            } catch (error) {
              console.error('Save recommendation profile failed:', error);
            }
          }
        },
      });
    }
  });

  return (
    <View className="style-preferences-page">
      <ScrollView scrollY className="style-scroll" showScrollbar={false}>
        <View className="page-header">
          <Text className="page-title">我的风格画像</Text>
          <Text className="page-subtitle">告诉小搭你的偏好，推荐会更贴近你</Text>
        </View>

        <PreferenceSection
          title="搭配倾向"
          hint="你更希望推荐偏向哪种穿搭表达？"
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
          title="喜欢的风格"
          hint="最多选 5 个，小搭会优先参考这些风格。"
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

        <PreferenceSection
          title="版型偏好"
          hint="你平时更喜欢什么样的衣服轮廓？"
        >
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
          title="冷热敏感"
          hint="同样的天气，小搭会按你的体感调整厚薄。"
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

        <View className="bottom-space" />
      </ScrollView>

      <View className="action-bar">
        <View className={`primary-btn ${saving ? 'disabled' : ''}`} onClick={handleSave}>
          <Text className="primary-text">{saving ? '保存中...' : '保存并返回我的页'}</Text>
        </View>
      </View>
    </View>
  );
}

function PreferenceSection({
  title,
  hint,
  aside,
  children,
}: {
  title: string;
  hint?: string;
  aside?: string;
  children: ReactNode;
}) {
  return (
    <View className="preference-card">
      <View className="section-header">
        <View className="section-title-row">
          <Text className="section-title">{title}</Text>
          {aside && <Text className="section-aside">{aside}</Text>}
        </View>
        {hint && <Text className="section-hint">{hint}</Text>}
      </View>
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
