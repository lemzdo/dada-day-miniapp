const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async () => {
  try {
    const { OPENID } = cloud.getWXContext();
    const now = new Date().toISOString();
    const users = db.collection('users');
    const existing = await users.where({ _openid: OPENID }).limit(1).get();

    if (existing.data[0]) {
      const user = existing.data[0];
      await users.doc(user._id).update({ data: { updatedAt: now, lastLoginAt: now } });
      return ok(toUser({ ...user, updatedAt: now, lastLoginAt: now }));
    }

    const userData = {
      _openid: OPENID,
      nickname: '搭搭新朋友',
      avatarUrl: '',
      avatarType: 'default',
      profileCompleted: false,
      capacityTotal: 50,
      capacityUsed: 0,
      membershipTier: 'free',
      styleProfile: {
        preferredStyles: [],
        recommendationProfile: defaultRecommendationProfile(),
        avatarType: 'default',
        profileCompleted: false,
      },
      createdAt: now,
      updatedAt: now,
      lastLoginAt: now,
    };
    const addRes = await users.add({ data: userData });

    return ok(toUser({ ...userData, _id: addRes._id }));
  } catch (error) {
    console.error('[login] failed', error);
    return fail(error);
  }
};

function toUser(user) {
  const styleProfile = normalizeStyleProfile(user.styleProfile);
  return {
    id: user._id,
    openid: user._openid,
    nickname: normalizeNickname(user.nickname),
    avatarUrl: user.avatarUrl || '',
    avatarType: readAvatarType(user.avatarType || styleProfile.avatarType),
    profileCompleted: Boolean(user.profileCompleted || styleProfile.profileCompleted),
    capacityTotal: user.capacityTotal || 50,
    capacityUsed: user.capacityUsed || 0,
    membershipTier: user.membershipTier || 'free',
    styleProfile,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function normalizeNickname(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || trimmed === '搭一搭用户' || trimmed === '新用户') return '搭搭新朋友';
  return trimmed;
}

function readAvatarType(value) {
  return value === 'wechat' || value === 'preset' || value === 'default' ? value : 'default';
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}

function normalizeStyleProfile(styleProfile) {
  const profile = styleProfile || {};
  const recommendationProfile = {
    ...defaultRecommendationProfile(),
    ...(profile.recommendationProfile || {}),
  };
  if (!Array.isArray(recommendationProfile.styleTags)) {
    recommendationProfile.styleTags = Array.isArray(profile.preferredStyles) ? profile.preferredStyles : [];
  }
  return {
    ...profile,
    preferredStyles: recommendationProfile.styleTags,
    recommendationProfile,
    avatarType: readAvatarType(profile.avatarType),
    profileCompleted: Boolean(profile.profileCompleted),
  };
}

function defaultRecommendationProfile() {
  return {
    genderPreference: 'unknown',
    styleTags: [],
    fitPreference: 'unknown',
    colorPreference: [],
    avoidTags: [],
    temperatureSensitivity: 'normal',
  };
}
