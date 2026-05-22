declare let process: undefined | { env: Record<string, string | undefined> };

/** 类型安全的环境变量读取 */

function getEnv(key: string, fallback = ''): string {
  if (typeof process !== 'undefined' && process?.env) {
    return process.env[key] ?? fallback;
  }
  return fallback;
}

function getPublicEnv(key: string, fallback = ''): string {
  const publicKey = key.startsWith('NEXT_PUBLIC_') ? key : `NEXT_PUBLIC_${key}`;
  return getEnv(publicKey, fallback);
}

/** 应用环境变量（强类型） */
export const env = {
  apiBaseUrl: getPublicEnv('API_URL', '/api'),
  appName: getPublicEnv('APP_NAME', 'Starter'),
  mode: getEnv('NODE_ENV', 'development'),
  isProd: getEnv('NODE_ENV') === 'production',
  isDev: getEnv('NODE_ENV', 'development') === 'development',
} as const;
