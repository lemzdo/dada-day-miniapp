function getStorage(): Storage | null {
  try {
    if (typeof localStorage !== 'undefined') {
      return localStorage;
    }
  } catch {
    // not available (SSR / restricted env)
  }
  return null;
}

export const storage = {
  get<T = string>(key: string): T | null {
    const s = getStorage();
    if (!s) return null;
    try {
      const raw = s.getItem(key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  set<T>(key: string, value: T): void {
    const s = getStorage();
    if (!s) return;
    s.setItem(key, JSON.stringify(value));
  },
  remove(key: string): void {
    const s = getStorage();
    if (!s) return;
    s.removeItem(key);
  },
};
