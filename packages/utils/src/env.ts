declare let process: undefined | { env: Record<string, string | undefined> };

/** 是否为服务端（SSR）环境 */
export const isServer = typeof window === 'undefined';

/** 是否为浏览器环境 */
export const isBrowser = typeof window !== 'undefined';

/** 是否为微信小程序环境 */
export const isWeapp = typeof process !== 'undefined' && process?.env?.['TARO_ENV'] === 'weapp';
