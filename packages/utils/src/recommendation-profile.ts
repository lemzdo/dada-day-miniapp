import {
  DEFAULT_RECOMMENDATION_PROFILE,
  type RecommendationProfile,
  type UserStyleProfile,
} from '@starter-template/types';

export function normalizeRecommendationProfile(styleProfile?: Record<string, unknown> | null): RecommendationProfile {
  const profile = (styleProfile ?? {}) as UserStyleProfile;
  const recommendationProfile = profile.recommendationProfile ?? {};
  const legacyStyles = Array.isArray(profile.preferredStyles) ? profile.preferredStyles : [];

  return {
    genderPreference: isGenderPreference(recommendationProfile.genderPreference)
      ? recommendationProfile.genderPreference
      : DEFAULT_RECOMMENDATION_PROFILE.genderPreference,
    styleTags: readStringArray(recommendationProfile.styleTags, legacyStyles),
    fitPreference: isFitPreference(recommendationProfile.fitPreference)
      ? recommendationProfile.fitPreference
      : DEFAULT_RECOMMENDATION_PROFILE.fitPreference,
    colorPreference: readStringArray(recommendationProfile.colorPreference),
    avoidTags: readStringArray(recommendationProfile.avoidTags),
    temperatureSensitivity: isTemperatureSensitivity(recommendationProfile.temperatureSensitivity)
      ? recommendationProfile.temperatureSensitivity
      : DEFAULT_RECOMMENDATION_PROFILE.temperatureSensitivity,
  };
}

export function buildStyleProfileWithRecommendation(
  current: Record<string, unknown> | null | undefined,
  recommendationProfile: RecommendationProfile,
): UserStyleProfile {
  return {
    ...(current ?? {}),
    preferredStyles: recommendationProfile.styleTags,
    recommendationProfile,
  };
}

function readStringArray(value: unknown, fallback: string[] = []) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback;
}

function isGenderPreference(value: unknown): value is RecommendationProfile['genderPreference'] {
  return ['male_style', 'female_style', 'neutral_style', 'all', 'unknown'].includes(String(value));
}

function isFitPreference(value: unknown): value is RecommendationProfile['fitPreference'] {
  return ['loose', 'regular', 'slim', 'oversize', 'unknown'].includes(String(value));
}

function isTemperatureSensitivity(value: unknown): value is RecommendationProfile['temperatureSensitivity'] {
  return ['cold_sensitive', 'normal', 'heat_sensitive'].includes(String(value));
}
