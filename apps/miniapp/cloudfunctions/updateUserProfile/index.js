const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event = {}) => {
  const { OPENID } = cloud.getWXContext();
  const now = new Date().toISOString();

  try {
    const users = db.collection('users');
    const userRes = await users.where({ _openid: OPENID }).limit(1).get();
    const user = userRes.data[0];
    if (!user) throw new Error('user not found');

    const existingStyleProfile = normalizeStyleProfile(user.styleProfile);
    const hasRecommendationProfile = event.recommendationProfile && typeof event.recommendationProfile === 'object';
    const recommendationProfile = hasRecommendationProfile
      ? normalizeRecommendationProfile(event.recommendationProfile)
      : existingStyleProfile.recommendationProfile;
    const styleProfile = {
      ...existingStyleProfile,
      preferredStyles: recommendationProfile.styleTags,
      recommendationProfile,
    };

    const data = {
      updatedAt: now,
      styleProfile,
    };

    if (typeof event.nickname === 'string') {
      data.nickname = normalizeNickname(event.nickname);
    }

    if (typeof event.avatarUrl === 'string') {
      data.avatarUrl = event.avatarUrl;
      styleProfile.avatarUrl = event.avatarUrl;
    }

    if (isAvatarType(event.avatarType)) {
      data.avatarType = event.avatarType;
      styleProfile.avatarType = event.avatarType;
    }

    if (typeof event.profileCompleted === 'boolean') {
      data.profileCompleted = event.profileCompleted;
      styleProfile.profileCompleted = event.profileCompleted;
    }

    await users.doc(user._id).update({ data });

    return ok({
      styleProfile,
      recommendationProfile,
      nickname: data.nickname || user.nickname || '搭搭新朋友',
      avatarUrl: data.avatarUrl || user.avatarUrl || '',
      avatarType: data.avatarType || user.avatarType || styleProfile.avatarType || 'default',
      profileCompleted: data.profileCompleted ?? user.profileCompleted ?? styleProfile.profileCompleted ?? false,
      updatedAt: now,
    });
  } catch (error) {
    console.error('[updateUserProfile] failed', error);
    return fail(error);
  }
};

function normalizeRecommendationProfile(input) {
  const profile = input || {};
  return {
    genderPreference: readEnum(profile.genderPreference, ['male_style', 'female_style', 'neutral_style', 'all', 'unknown'], 'unknown'),
    styleTags: readStringArray(profile.styleTags),
    fitPreference: readEnum(profile.fitPreference, ['loose', 'regular', 'slim', 'oversize', 'unknown'], 'unknown'),
    colorPreference: readStringArray(profile.colorPreference),
    avoidTags: readStringArray(profile.avoidTags),
    temperatureSensitivity: readEnum(profile.temperatureSensitivity, ['cold_sensitive', 'normal', 'heat_sensitive'], 'normal'),
  };
}

function normalizeStyleProfile(styleProfile) {
  const profile = styleProfile || {};
  const recommendationProfile = normalizeRecommendationProfile({
    ...(profile.recommendationProfile || {}),
    styleTags: Array.isArray((profile.recommendationProfile || {}).styleTags)
      ? profile.recommendationProfile.styleTags
      : profile.preferredStyles,
  });
  return {
    ...profile,
    preferredStyles: recommendationProfile.styleTags,
    recommendationProfile,
  };
}

function normalizeNickname(value) {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || trimmed === '搭一搭用户' || trimmed === '新用户') return '搭搭新朋友';
  return trimmed.slice(0, 16);
}

function isAvatarType(value) {
  return value === 'wechat' || value === 'preset' || value === 'default';
}

function readStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function readEnum(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function ok(data) {
  return { code: 0, data, message: 'ok' };
}

function fail(error) {
  return { code: 1, data: null, message: error && error.message ? error.message : 'unknown error' };
}
