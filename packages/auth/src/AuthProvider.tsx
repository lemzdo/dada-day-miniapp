import type React from 'react';
import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { AuthState, LoginParams, User } from '@starter-template/types';
import { storage } from '@starter-template/utils';
import { AUTH_TOKEN_STORAGE_KEY, apiClient } from '@starter-template/api';

const TOKEN_KEY = AUTH_TOKEN_STORAGE_KEY;
const USER_KEY = 'auth_user';

interface AuthContextValue extends AuthState {
  login: (params: LoginParams) => Promise<void>;
  logout: () => void;
  setUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>(() => {
    const token = storage.get<string>(TOKEN_KEY);
    const user = storage.get<User>(USER_KEY);
    return {
      user,
      token,
      isAuthenticated: !!token,
      isLoading: false,
    };
  });

  useEffect(() => {
    if (state.token) {
      storage.set(TOKEN_KEY, state.token);
      storage.set(USER_KEY, state.user);
    } else {
      storage.remove(TOKEN_KEY);
      storage.remove(USER_KEY);
    }
  }, [state.token, state.user]);

  const login = useCallback(async (params: LoginParams) => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const code = params.code ?? params.username ?? 'web-demo';
      const result = await apiClient.post<{ token: string; user: User }>('/auth/wechat-login', { code }, {
        successMsg: 'Login successful',
      });
      setState({
        user: result.user,
        token: result.token,
        isAuthenticated: true,
        isLoading: false,
      });
    } catch {
      setState((s) => ({ ...s, isLoading: false }));
      throw new Error('Login failed');
    }
  }, []);

  const logout = useCallback(() => {
    storage.remove(TOKEN_KEY);
    storage.remove(USER_KEY);
    setState({
      user: null,
      token: null,
      isAuthenticated: false,
      isLoading: false,
    });
  }, []);

  const setUser = useCallback((user: User) => {
    setState((s) => ({ ...s, user }));
    storage.set(USER_KEY, user);
  }, []);

  useEffect(() => {
    apiClient.setAuthTokenProvider(() => state.token);
    return () => {
      apiClient.setAuthTokenProvider(null);
    };
  }, [state.token]);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        login,
        logout,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
