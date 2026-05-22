// 鈹€鈹€ Domain types 鈹€鈹€

export interface User {
  id: string;
  name: string;
  avatar?: string;
  email?: string;
  role?: UserRole;
}

export type UserRole = 'admin' | 'user' | 'guest';

export interface ApiResponse<T> {
  code: number;
  data: T;
  message: string;
}

export interface PaginationParams {
  page: number;
  pageSize: number;
}

export interface PaginatedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

// 鈹€鈹€ Auth types 鈹€鈹€

export interface AuthState {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

export interface LoginParams {
  code?: string;
  username?: string;
  password?: string;
}

export interface LoginResult {
  token: string;
  user: User;
}

// 鈹€鈹€ Notification / Toast 鈹€鈹€

export type ToastType = 'success' | 'error' | 'warning' | 'info' | 'loading';

export type ToastPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export interface ToastOptions {
  id?: string;
  type?: ToastType;
  message: string;
  duration?: number;
  position?: ToastPosition;
  closable?: boolean;
}

export interface Toast extends Required<ToastOptions> {
  id: string;
  createdAt: number;
}

// 鈹€鈹€ Request state 鈹€鈹€

export interface RequestState<T = unknown> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface MutationState<T = unknown> extends RequestState<T> {
  mutate: (params?: unknown) => Promise<void>;
  reset: () => void;
}

// 鈹€鈹€ Component prop types 鈹€鈹€

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';
export type InputType = 'text' | 'password' | 'email' | 'number' | 'tel' | 'url';
export type InputSize = 'sm' | 'md' | 'lg';
export type CardPadding = 'none' | 'sm' | 'md' | 'lg';
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

// 鈹€鈹€ Utility types 鈹€鈹€

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
export type ValuesOf<T> = T[keyof T];
export type Callback<T = void> = () => T;
export type CallbackWith<P, R = void> = (param: P) => R;
export type AsyncCallback<T = void> = () => Promise<T>;
export type AsyncCallbackWith<P, R = void> = (param: P) => Promise<R>;

// 鈹€鈹€ Config 鈹€鈹€

export type ThemeMode = 'light' | 'dark' | 'system';

export interface AppConfig {
  apiBaseUrl: string;
  theme: ThemeMode;
  locale: string;
}

export interface MenuItem {
  key: string;
  label: string;
  icon?: string;
  path?: string;
  children?: MenuItem[];
}


// ── 搭一搭 · 穿搭领域类型 ──

export * from './clothes';
export * from './outfit';
export * from './weather';
export * from './dict';
export * from './ai';
export * from './recommendation-profile';
