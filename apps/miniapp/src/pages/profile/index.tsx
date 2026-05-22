import { Button, Image, Input, Text, View } from '@tarojs/components';
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
  const [editing, setEditing] = useState(false);
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
        };

        writeCachedProfile(nextProfile);
        nextProfileForDraft = nextProfile;
        return nextProfile;
      });
      if (!editing && nextProfileForDraft) {
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

  function startEdit() {
    syncDraft();
    setEditing(true);
  }

  function cancelEdit() {
    syncDraft();
    setEditing(false);
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
      setEditing(false);
      Taro.showToast({ title: '搭配档案已更新', icon: 'success' });
    } catch (error) {
      console.error('Save profile failed:', error);
      Taro.showToast({ title: '保存失败，请稍后再试', icon: 'none' });
    } finally {
      setSaving(false);
    }
  }

  function goToOutfitHistory() {
    Taro.navigateTo({ url: '/pages/outfit-history/index' });
  }

  function goToFavoriteOutfits() {
    Taro.navigateTo({ url: '/pages/favorite-outfits/index' });
  }

  function goToStylePreferences() {
    Taro.navigateTo({ url: '/pages/style-preferences/index' });
  }

  function showComingSoon(title: string) {
    Taro.showToast({ title: `${title}待上线`, icon: 'none' });
  }

  const capacityPercent =
    profile.capacityTotal > 0
      ? Math.min(100, Math.round((profile.capacityUsed / profile.capacityTotal) * 100))
      : 0;
  const preferenceSummary = getPreferenceSummary(profile.preferredStyles);
  const profileActionDesc = getProfileActionDesc(profile);
  const profileActionText = profile.preferredStyles.length > 0 ? '编辑' : '去完善';
  const activePreset = AVATAR_PRESETS.find((item) => item.id === draftPresetId) ?? AVATAR_PRESETS[0]!;

  return (
    <View className="profile-page">
      <View className="user-card" onClick={startEdit}>
        <AvatarView avatarUrl={profile.avatarUrl} avatarType={profile.avatarType} />
        <View className="user-info">
          <Text className="nickname">{profile.nickname}</Text>
          <Text className="slogan">少纠结，多好看 ✦</Text>
          <Text className="preference-summary">{preferenceSummary}</Text>
        </View>
      </View>

      <View className="profile-action-card">
        <View className="profile-action-copy">
          <Text className="profile-action-title">我的穿搭档案</Text>
          <Text className="profile-action-desc">{profileActionDesc}</Text>
        </View>
        <View className="profile-action-btn" onClick={goToStylePreferences}>
          <Text className="profile-action-text">{profileActionText}</Text>
        </View>
      </View>

      {editing && (
        <View className="edit-card">
          <View className="edit-header">
            <View>
              <Text className="edit-title">换个头像和昵称</Text>
              <Text className="edit-subtitle">可以随时改，也可以继续用搭搭头像。</Text>
            </View>
            <Text className="edit-close" onClick={cancelEdit}>×</Text>
          </View>

          <View className="avatar-editor">
            <AvatarView avatarUrl={draftAvatarUrl} avatarType={draftAvatarType} presetId={draftPresetId} />
            <Button className="wechat-avatar-btn" openType="chooseAvatar" onChooseAvatar={handleChooseAvatar}>
              选择微信头像
            </Button>
          </View>

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

          <View className="preset-header">
            <Text className="preset-title">搭搭day 默认头像</Text>
            <Text className="preset-random" onClick={randomPreset}>换一个搭搭头像</Text>
          </View>

          <View className="preset-grid">
            {AVATAR_PRESETS.map((preset) => (
              <View
                key={preset.id}
                className={`preset-option ${activePreset.id === preset.id && draftAvatarType !== 'wechat' ? 'active' : ''}`}
                onClick={() => choosePreset(preset.id)}
              >
                <Image className="preset-image" src={preset.image} mode="aspectFill" />
                <Text className="preset-name">{preset.name}</Text>
              </View>
            ))}
          </View>

          <View className={`save-profile-btn ${saving ? 'disabled' : ''}`} onClick={saveProfile}>
            <Text className="save-profile-text">{saving ? '保存中...' : '保存我的搭配档案'}</Text>
          </View>
        </View>
      )}

      <View className="capacity-card">
        <View className="capacity-header">
          <Text className="capacity-title">衣橱容量</Text>
          <View className="capacity-meta">
            <Text className="capacity-num">{formatCapacity(profile)}</Text>
          </View>
        </View>
        <View className="capacity-track">
          <View className="capacity-fill" style={{ width: `${capacityPercent}%` }} />
        </View>
        <Text className="capacity-tip">{formatRemaining(profile)}</Text>
        {dataNotice && <Text className="data-notice">{dataNotice}</Text>}
      </View>

      <View className="menu-section">
        <View className="menu-item" onClick={goToOutfitHistory}>
          <Text className="menu-label">穿搭历史</Text>
          <Text className="menu-arrow">›</Text>
        </View>
        <View className="menu-item" onClick={goToFavoriteOutfits}>
          <Text className="menu-label">我的收藏</Text>
          <Text className="menu-arrow">›</Text>
        </View>
        <View className="menu-item" onClick={() => showComingSoon('衣柜分析')}>
          <Text className="menu-label">衣柜分析</Text>
          <Text className="menu-value">待上线</Text>
        </View>
        <View className="menu-item" onClick={() => showComingSoon('穿搭提醒')}>
          <Text className="menu-label">穿搭提醒</Text>
          <Text className="menu-value">未开启</Text>
        </View>
      </View>

      <View className="vip-card" onClick={() => showComingSoon('升级会员')}>
        <Text className="vip-text">升级会员 · 更大衣橱</Text>
      </View>
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

function getProfileActionDesc(profile: ProfileState) {
  if (profile.preferredStyles.length === 0) {
    return '完善风格、版型和冷热偏好，让推荐更贴合你。';
  }

  if (profile.preferredStyles.length < 3) {
    return '已记录你的部分偏好，继续补充会更准。';
  }

  return `已根据 ${profile.preferredStyles.slice(0, 3).join(' / ')} 优化每日推荐。`;
}

function formatCapacity(profile: ProfileState) {
  return profile.capacityLoaded ? `${profile.capacityUsed} / ${profile.capacityTotal}` : '--';
}

function formatRemaining(profile: ProfileState) {
  return profile.capacityLoaded ? `还可收纳 ${profile.capacityRemaining} 件衣物` : '容量数据稍后更新';
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
