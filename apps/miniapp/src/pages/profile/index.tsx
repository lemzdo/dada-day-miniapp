import { Button, Image, Input, ScrollView, Text, View } from '@tarojs/components';
import Taro, { useDidShow, useLoad, usePullDownRefresh, useUnload } from '@tarojs/taro';
import { useRef, useState } from 'react';
import { getWardrobe, loginWithCloud, updateCloudUserProfile } from '@/lib/cloud';
import { useUserStore } from '@/stores/userStore';
import avatar01 from '@/assets/avatars/default-avatar-01.png';
import avatar02 from '@/assets/avatars/default-avatar-02.png';
import avatar03 from '@/assets/avatars/default-avatar-03.png';
import avatar04 from '@/assets/avatars/default-avatar-04.png';
import avatar05 from '@/assets/avatars/default-avatar-05.png';
import avatar06 from '@/assets/avatars/default-avatar-06.png';
import avatar07 from '@/assets/avatars/default-avatar-07.png';
import avatar08 from '@/assets/avatars/default-avatar-08.png';
import avatar09 from '@/assets/avatars/default-avatar-09.png';
import avatar10 from '@/assets/avatars/default-avatar-10.png';
import './index.scss';

type AvatarType = 'wechat' | 'preset' | 'default';

interface AvatarPreset {
  id: string;
  name: string;
  image: string;
}

interface ProfileState {
  nickname: string;
  avatarUrl: string;
  avatarType: AvatarType;
  profileCompleted: boolean;
  updatedAt: string;
  membershipTier: string;
  capacityTotal: number;
  capacityUsed: number;
  capacityRemaining: number;
  capacityLoaded: boolean;
  preferredStyles: string[];
  genderPreference?: string;
  fitPreference?: string;
  temperatureSensitivity?: string;
}

const DEFAULT_NICKNAME = '今日搭子';
const PROFILE_CACHE_KEY = 'profileSummaryCache';

const AVATAR_PRESETS: AvatarPreset[] = [
  { id: 'avatar-01', name: '头像 01', image: avatar01 },
  { id: 'avatar-02', name: '头像 02', image: avatar02 },
  { id: 'avatar-03', name: '头像 03', image: avatar03 },
  { id: 'avatar-04', name: '头像 04', image: avatar04 },
  { id: 'avatar-05', name: '头像 05', image: avatar05 },
  { id: 'avatar-06', name: '头像 06', image: avatar06 },
  { id: 'avatar-07', name: '头像 07', image: avatar07 },
  { id: 'avatar-08', name: '头像 08', image: avatar08 },
  { id: 'avatar-09', name: '头像 09', image: avatar09 },
  { id: 'avatar-10', name: '头像 10', image: avatar10 },
];

const defaultProfile: ProfileState = {
  nickname: DEFAULT_NICKNAME,
  avatarUrl: '',
  avatarType: 'default',
  profileCompleted: false,
  updatedAt: '',
  membershipTier: 'free',
  capacityTotal: 0,
  capacityUsed: 0,
  capacityRemaining: 50,
  capacityLoaded: false,
  preferredStyles: [],
};

export default function ProfilePage() {
  const [profile, setProfile] = useState<ProfileState>(() => readCachedProfile());
  const [draftNickname, setDraftNickname] = useState(DEFAULT_NICKNAME);
  const [draftAvatarUrl, setDraftAvatarUrl] = useState('');
  const [draftAvatarType, setDraftAvatarType] = useState<AvatarType>('default');
  const [draftPresetId, setDraftPresetId] = useState(AVATAR_PRESETS[0]!.id);
  const [showEditModal, setShowEditModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [dataNotice, setDataNotice] = useState('');
  const didShowOnceRef = useRef(false);
  const mountedRef = useRef(true);
  const requestIdRef = useRef(0);

  useLoad(() => {
    fetchProfileSummary();
  });

  useUnload(() => {
    mountedRef.current = false;
  });

  useDidShow(() => {
    if (!didShowOnceRef.current) {
      didShowOnceRef.current = true;
      return;
    }
    fetchProfileSummary();
  });

  usePullDownRefresh(() => {
    fetchProfileSummary({ manual: true }).finally(() => {
      Taro.stopPullDownRefresh();
    });
  });

  async function fetchProfileSummary(options: { manual?: boolean } = {}) {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setDataNotice('');

    try {
      const cachedUser = options.manual ? null : readUserFromStore();
      const [userResult, wardrobeResult] = await Promise.allSettled([
        cachedUser ? Promise.resolve(cachedUser) : loginWithCloud(),
        getWardrobe({ page: 1, pageSize: 1, status: 'active' }),
      ]);

      const user = userResult.status === 'fulfilled' ? userResult.value : null;
      const wardrobe = wardrobeResult.status === 'fulfilled' ? wardrobeResult.value : null;
      const hasRejected = [userResult, wardrobeResult].some((result) => result.status === 'rejected');

      if (!isActiveRequest(requestId)) return;

      let nextProfileForDraft: ProfileState | null = null;
      setProfile((prev) => {
        const styleProfile = user?.styleProfile ?? {};
        const preferredStyles = user ? readPreferredStyles(styleProfile) : prev.preferredStyles;
        const avatarType = user ? readAvatarType(user.avatarType ?? styleProfile['avatarType']) : prev.avatarType;
        
        const recommendationProfile = styleProfile['recommendationProfile'] as Record<string, unknown> | undefined;
        
        const nextProfile: ProfileState = {
          ...prev,
          nickname: user ? normalizeNickname(user.nickname) : prev.nickname,
          avatarUrl: user?.avatarUrl ?? prev.avatarUrl,
          avatarType,
          profileCompleted: user ? Boolean(user.profileCompleted ?? styleProfile['profileCompleted']) : prev.profileCompleted,
          updatedAt: user?.updatedAt ?? prev.updatedAt,
          membershipTier: user?.membershipTier ?? prev.membershipTier,
          capacityTotal: wardrobe?.capacity.total ?? user?.capacityTotal ?? prev.capacityTotal,
          capacityUsed: wardrobe?.capacity.used ?? user?.capacityUsed ?? prev.capacityUsed,
          capacityRemaining: wardrobe?.capacity.remaining ?? prev.capacityRemaining,
          capacityLoaded: wardrobe ? true : user ? true : prev.capacityLoaded,
          preferredStyles,
          genderPreference: recommendationProfile?.['genderPreference'] as string | undefined,
          fitPreference: recommendationProfile?.['fitPreference'] as string | undefined,
          temperatureSensitivity: recommendationProfile?.['temperatureSensitivity'] as string | undefined,
        };

        writeCachedProfile(nextProfile);
        nextProfileForDraft = nextProfile;
        return nextProfile;
      });
      if (!showEditModal && nextProfileForDraft) {
        syncDraft(nextProfileForDraft);
      }

      if (hasRejected) {
        setDataNotice('数据稍后更新');
        if (options.manual) {
          Taro.showToast({ title: '刷新失败，稍后再试', icon: 'none' });
        }
      } else if (options.manual) {
        Taro.showToast({ title: '已更新', icon: 'success' });
      }
    } catch (err) {
      console.error('Fetch profile summary error:', err);
      if (isActiveRequest(requestId)) {
        setDataNotice('数据稍后更新');
      }
      if (options.manual) {
        Taro.showToast({ title: '刷新失败，稍后再试', icon: 'none' });
      }
    } finally {
      // Refresh is intentionally silent on this page.
    }
  }

  function isActiveRequest(requestId: number) {
    return mountedRef.current && requestIdRef.current === requestId;
  }

  function syncDraft(nextProfile = profile) {
    setDraftNickname(nextProfile.nickname);
    setDraftAvatarUrl(nextProfile.avatarUrl);
    setDraftAvatarType(nextProfile.avatarType);
    setDraftPresetId(getPresetIdFromUrl(nextProfile.avatarUrl) ?? AVATAR_PRESETS[0]!.id);
  }

  function openEditModal() {
    syncDraft();
    setShowEditModal(true);
  }

  function closeEditModal() {
    syncDraft();
    setShowEditModal(false);
  }

  function handleChooseAvatar(event: { detail?: { avatarUrl?: string } }) {
    const avatarUrl = event.detail?.avatarUrl;
    if (!avatarUrl) return;
    setDraftAvatarUrl(avatarUrl);
    setDraftAvatarType('wechat');
  }

  function choosePreset(presetId: string) {
    setDraftPresetId(presetId);
    setDraftAvatarUrl(toPresetAvatarUrl(presetId));
    setDraftAvatarType('preset');
  }

  function randomPreset() {
    const currentIndex = AVATAR_PRESETS.findIndex((item) => item.id === draftPresetId);
    const next = AVATAR_PRESETS[(currentIndex + 1) % AVATAR_PRESETS.length] ?? AVATAR_PRESETS[0]!;
    choosePreset(next.id);
  }

  async function saveProfile() {
    if (saving) return;

    const nickname = normalizeNickname(draftNickname);
    const avatarUrl = draftAvatarType === 'wechat' ? draftAvatarUrl : toPresetAvatarUrl(draftPresetId);
    const avatarType: AvatarType = draftAvatarType === 'wechat' ? 'wechat' : 'preset';
    const now = new Date().toISOString();

    setSaving(true);
    try {
      await updateCloudUserProfile({
        nickname,
        avatarUrl,
        avatarType,
        profileCompleted: true,
      });

      setProfile((prev) => ({
        ...prev,
        nickname,
        avatarUrl,
        avatarType,
        profileCompleted: true,
        updatedAt: now,
      }));
      closeEditModal();
      Taro.showToast({ title: '搭配档案已更新', icon: 'success' });
    } catch (error) {
      console.error('Save profile failed:', error);
      Taro.showToast({ title: '保存失败，请稍后再试', icon: 'none' });
    } finally {
      setSaving(false);
    }
  }

  function goToFavoriteOutfits() {
    Taro.navigateTo({ url: '/pages/favorite-outfits/index' });
  }

  function goToStylePreferences() {
    Taro.navigateTo({ url: '/pages/style-preferences/index' });
  }

  function goToFeedback() {
    Taro.navigateTo({ url: '/pages/feedback/index?page=profile' });
  }

  function goToAbout() {
    Taro.navigateTo({ url: '/pages/about/index' });
  }

  const capacityPercent =
    profile.capacityTotal > 0
      ? Math.min(100, Math.round((profile.capacityUsed / profile.capacityTotal) * 100))
      : 0;
  const preferenceSummary = getPreferenceSummary(profile.preferredStyles);
  const profileCompletedCount = getProfileCompletedCount(profile);
  const profileActionText = profileCompletedCount >= 4 ? '调整风格画像' : '完善风格画像';
  const activePreset = AVATAR_PRESETS.find((item) => item.id === draftPresetId) ?? AVATAR_PRESETS[0]!;

  return (
    <View className="profile-page">
      <View className="profile-header">
        <Text className="profile-title">我的穿搭档案</Text>
        <Text className="profile-subtitle">记录你的风格，让小搭更懂你</Text>
      </View>

      <View className="identity-card">
        <AvatarView avatarUrl={profile.avatarUrl} avatarType={profile.avatarType} />
        <View className="identity-info">
          <Text className="identity-nickname">{profile.nickname}</Text>
          <Text className="identity-slogan">小搭正在学习你的穿衣偏好</Text>
          {profile.preferredStyles.length > 0 && (
            <View className="identity-tags">
              {profile.preferredStyles.slice(0, 3).map((style) => (
                <Text key={style} className="identity-tag">{style}</Text>
              ))}
            </View>
          )}
        </View>
        <View className="edit-btn" onClick={openEditModal}>
          <Text className="edit-btn-text">编辑资料</Text>
        </View>
      </View>

      <View className="style-portrait-card" onClick={goToStylePreferences}>
        <View className="card-header">
          <View className="card-title-wrap">
            <Text className="card-title">我的风格画像</Text>
            <Text className="card-progress">已完成 {profileCompletedCount}/4</Text>
          </View>
          <Text className="card-action">{profileActionText}</Text>
        </View>
        <View className="portrait-content">
          <View className="portrait-row">
            <Text className="portrait-label">搭配倾向</Text>
            <Text className="portrait-value">{formatGenderPreference(profile.genderPreference)}</Text>
          </View>
          <View className="portrait-row">
            <Text className="portrait-label">风格偏好</Text>
            <Text className="portrait-value">{preferenceSummary}</Text>
          </View>
          <View className="portrait-row">
            <Text className="portrait-label">版型偏好</Text>
            <Text className="portrait-value">{formatFitPreference(profile.fitPreference)}</Text>
          </View>
          <View className="portrait-row">
            <Text className="portrait-label">冷热敏感</Text>
            <Text className="portrait-value">{formatTempPreference(profile.temperatureSensitivity)}</Text>
          </View>
        </View>
        <View className="portrait-hint">完善画像，让推荐更贴近你的喜好</View>
      </View>

      <View className="wardrobe-status-card">
        <View className="wardrobe-header">
          <Text className="wardrobe-title">衣橱状态</Text>
          <Text className="wardrobe-count">{profile.capacityLoaded ? `${profile.capacityUsed}/${profile.capacityTotal}` : '--'}</Text>
        </View>
        <View className="wardrobe-track">
          <View className="wardrobe-fill" style={{ width: `${capacityPercent}%` }} />
        </View>
        <Text className="wardrobe-tip">
          {profile.capacityLoaded ? `还可收纳 ${profile.capacityRemaining} 件衣物` : '容量数据稍后更新'}
        </Text>
        <Text className="wardrobe-hint">衣服越丰富，推荐越懂你</Text>
        {dataNotice && <Text className="data-notice">{dataNotice}</Text>}
      </View>

      <View className="favorite-card" onClick={goToFavoriteOutfits}>
        <View className="favorite-icon">✦</View>
        <View className="favorite-content">
          <Text className="favorite-title">我的收藏</Text>
          <Text className="favorite-desc">喜欢的搭配，都帮你收好了</Text>
        </View>
        <Text className="favorite-arrow">›</Text>
      </View>

      <View className="help-card">
        <Text className="section-label">帮助与关于</Text>
        <View className="help-row" onClick={goToFeedback}>
          <View className="help-icon">
            <Text className="help-icon-text">?</Text>
          </View>
          <View className="help-content">
            <Text className="help-title">意见反馈</Text>
            <Text className="help-desc">识别不准、推荐不喜欢，都可以告诉小搭</Text>
          </View>
          <Text className="help-arrow">›</Text>
        </View>
        <View className="help-divider" />
        <View className="help-row" onClick={goToAbout}>
          <View className="help-icon">
            <Text className="help-icon-text">i</Text>
          </View>
          <View className="help-content">
            <Text className="help-title">关于搭搭day</Text>
            <Text className="help-desc">版本信息、隐私和服务说明</Text>
          </View>
          <Text className="help-arrow">›</Text>
        </View>
      </View>

      <View className="page-footer">
        <Text className="footer-text">搭搭day · 少纠结，也好看</Text>
      </View>

      {showEditModal && (
        <View className="edit-overlay" onClick={closeEditModal}>
          <View className="edit-modal" onClick={(e) => e.stopPropagation()}>
            <View className="modal-header">
              <Text className="modal-title">编辑我的资料</Text>
              <Text className="modal-close" onClick={closeEditModal}>×</Text>
            </View>

            <ScrollView scrollY className="modal-content">
              <View className="avatar-section">
                <AvatarView avatarUrl={draftAvatarUrl} avatarType={draftAvatarType} presetId={draftPresetId} />
                <Button className="wechat-avatar-btn" openType="chooseAvatar" onChooseAvatar={handleChooseAvatar}>
                  使用微信头像
                </Button>
              </View>

              <View className="nickname-section">
                <Text className="nickname-label">昵称</Text>
                <View className="input-wrap">
                  <Input
                    className="nickname-input"
                    type="nickname"
                    value={draftNickname}
                    maxlength={16}
                    placeholder="比如：今日搭子、黑白灰选手、通勤懒人"
                    onInput={(event) => setDraftNickname(String(event.detail.value ?? ''))}
                  />
                </View>
              </View>

              <View className="preset-section">
                <Text className="preset-title">选择一个搭搭头像</Text>

                <View className="preset-grid">
                  {AVATAR_PRESETS.map((preset) => (
                    <View
                      key={preset.id}
                      className={`preset-option ${activePreset.id === preset.id && draftAvatarType !== 'wechat' ? 'active' : ''}`}
                      onClick={() => choosePreset(preset.id)}
                    >
                      <Image className="preset-image" src={preset.image} mode="aspectFill" />
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>

            <View className={`save-profile-btn ${saving ? 'disabled' : ''}`} onClick={saveProfile}>
              <Text className="save-profile-text">{saving ? '保存中...' : '保存我的资料'}</Text>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function AvatarView({
  avatarUrl,
  avatarType,
  presetId,
}: {
  avatarUrl: string;
  avatarType: AvatarType;
  presetId?: string;
}) {
  if (avatarType === 'wechat' && avatarUrl) {
    return <Image className="avatar-image" src={avatarUrl} mode="aspectFill" />;
  }

  const preset = AVATAR_PRESETS.find((item) => item.id === (presetId ?? getPresetIdFromUrl(avatarUrl))) ?? AVATAR_PRESETS[0]!;

  return <Image className="avatar-image" src={preset.image} mode="aspectFill" />;
}

function normalizeNickname(value?: string) {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === '搭一搭用户' || trimmed === '新用户' || trimmed === '搭搭新朋友') return DEFAULT_NICKNAME;
  return trimmed;
}

function readPreferredStyles(styleProfile: Record<string, unknown>) {
  const recommendationProfile = styleProfile['recommendationProfile'] as { styleTags?: unknown } | undefined;
  if (Array.isArray(recommendationProfile?.styleTags)) return recommendationProfile.styleTags.filter(isString);
  if (Array.isArray(styleProfile['preferredStyles'])) return styleProfile['preferredStyles'].filter(isString);
  return [];
}

function readAvatarType(value: unknown): AvatarType {
  return value === 'wechat' || value === 'preset' || value === 'default' ? value : 'default';
}

function getPreferenceSummary(styles: string[]) {
  if (styles.length === 0) return '还没设置';
  return styles.slice(0, 2).join(' / ');
}

function getProfileCompletedCount(profile: ProfileState) {
  let count = 0;
  if (profile.genderPreference && profile.genderPreference !== 'unknown') count++;
  if (profile.preferredStyles.length > 0) count++;
  if (profile.fitPreference) count++;
  if (profile.temperatureSensitivity) count++;
  return count;
}

function formatGenderPreference(gender?: string) {
  const map: Record<string, string> = {
    male_style: '偏男性穿搭',
    female_style: '偏女性穿搭',
    neutral_style: '中性/无性别',
    all: '都可以',
    unknown: '暂未选择',
  };
  return map[gender ?? ''] || '暂未选择';
}

function formatFitPreference(fit?: string) {
  const map: Record<string, string> = {
    loose: '宽松',
    regular: '合身',
    slim: '修身',
    oversize: 'Oversize',
    unknown: '看单品决定',
  };
  return map[fit ?? ''] || '暂未选择';
}

function formatTempPreference(temp?: string) {
  const map: Record<string, string> = {
    cold_sensitive: '怕冷',
    normal: '正常',
    heat_sensitive: '怕热',
  };
  return map[temp ?? ''] || '暂未选择';
}

function readCachedProfile(): ProfileState {
  try {
    const cached = Taro.getStorageSync(PROFILE_CACHE_KEY) as Partial<ProfileState> | '';
    if (!cached || typeof cached !== 'object') return defaultProfile;
    return {
      ...defaultProfile,
      ...cached,
      nickname: normalizeNickname(cached.nickname),
      avatarType: readAvatarType(cached.avatarType),
      preferredStyles: Array.isArray(cached.preferredStyles) ? cached.preferredStyles.filter(isString) : [],
    };
  } catch {
    return defaultProfile;
  }
}

function writeCachedProfile(profile: ProfileState) {
  try {
    Taro.setStorageSync(PROFILE_CACHE_KEY, profile);
  } catch (error) {
    console.warn('Cache profile summary failed:', error);
  }
}

function readUserFromStore() {
  const user = useUserStore.getState();
  if (!user.isLoggedIn || !user.userId || !user.openid) return null;

  return {
    id: user.userId,
    openid: user.openid,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    avatarType: user.avatarType,
    profileCompleted: user.profileCompleted,
    capacityTotal: user.capacityTotal,
    capacityUsed: user.capacityUsed,
    membershipTier: user.membershipTier,
    updatedAt: '',
    styleProfile: {
      preferredStyles: user.preferredStyles,
      recommendationProfile: user.recommendationProfile,
      avatarType: user.avatarType,
      profileCompleted: user.profileCompleted,
    },
  };
}

function toPresetAvatarUrl(presetId: string) {
  return `preset:${presetId}`;
}

function getPresetIdFromUrl(avatarUrl: string) {
  return avatarUrl.startsWith('preset:') ? avatarUrl.slice('preset:'.length) : null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
