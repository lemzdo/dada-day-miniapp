export type RecommendationGenderPreference =
  | 'male_style'
  | 'female_style'
  | 'neutral_style'
  | 'all'
  | 'unknown';

export type FitPreference = 'loose' | 'regular' | 'slim' | 'oversize' | 'unknown';

export type TemperatureSensitivity = 'cold_sensitive' | 'normal' | 'heat_sensitive';

export interface RecommendationProfile {
  /**
   * Recommendation direction only. This is not the user's gender identity
   * and must only be used as a soft ranking signal.
   */
  genderPreference: RecommendationGenderPreference;
  styleTags: string[];
  fitPreference: FitPreference;
  colorPreference: string[];
  avoidTags: string[];
  temperatureSensitivity: TemperatureSensitivity;
}

export interface UserStyleProfile {
  preferredStyles?: string[];
  recommendationProfile?: Partial<RecommendationProfile>;
}

export const DEFAULT_RECOMMENDATION_PROFILE: RecommendationProfile = {
  genderPreference: 'unknown',
  styleTags: [],
  fitPreference: 'unknown',
  colorPreference: [],
  avoidTags: [],
  temperatureSensitivity: 'normal',
};
