export { AUTH_TOKEN_STORAGE_KEY, apiClient, getApiBaseUrl, getAuthorizationHeader } from './client';
export { ApiError } from './error';
export type {
  RequestInterceptor,
  ResponseInterceptor,
  ToastCallback,
  RequestOptions,
  RequestResult,
} from './client';
export { getUsers, getUserById, createUser, updateUser, deleteUser } from './endpoints';

export { getCurrentWeather, getWeatherForecast } from './weather';
export { wechatLogin, getUserProfile, updateUserProfile, getUserCapacity } from './user';
export { getCategories, getScenes, getStyles } from './dict';
export {
  getClothesList,
  getClothingById,
  createClothing,
  updateClothing,
  deleteClothing,
  getClothingByIds,
} from './clothes';
export type { GetClothesListParams } from './clothes';

export {
  getRecommend,
  refreshRecommend,
  getOutfitList,
  getOutfitDetail,
  updateOutfit,
  deleteOutfit,
  toggleOutfitFavorite,
  confirmWear,
  getHistoryList,
  rateHistory,
  getHistoryStats,
} from './outfit';
export type { GetOutfitListParams, ConfirmWearParams, GetHistoryListParams } from './outfit';
