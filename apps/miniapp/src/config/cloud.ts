export const CLOUD_ENV_ID = 'cloud1-d8gl3k1vkdf0b7f05';

export const CLOUD_COLLECTIONS = {
  users: 'users',
  clothes: 'clothes',
  outfits: 'outfits',
  favoriteOutfits: 'favorite_outfits',
  outfitHistory: 'outfit_history',
  aiTasks: 'ai_tasks',
  userFeedback: 'user_feedback',
  // Legacy behavior feedback collection from the old wear-confirm flow. Do not use for user feedback.
  feedback: 'feedback',
} as const;
