export interface TaskMetadata { name: string; model: string; prompt?: string; promptVariant?: string; promptVersion?: string; stream?: boolean; retry?: number; timeoutMs?: number; validator?: string; }
export interface ExecuteOptions { timeoutMs?: number; retry?: number; signal?: AbortSignal; fetch?: typeof fetch; request?: Record<string, unknown>; rawResponse?: boolean; endpoint?: string | ((input: unknown) => string); authLookup?: string | (() => string | Promise<string>); apiKey?: string; }
export interface XiaodaAI { execute(task: string, input: unknown, options?: ExecuteOptions): Promise<any>; registry: typeof import('./registry'); }
export declare const recommendationReasonTask: Readonly<TaskMetadata>;
export declare function createXiaodaAI(config?: ExecuteOptions & { telemetry?: (event: unknown) => void; secretProvider?: unknown }): XiaodaAI;
export declare const xiaodaAI: XiaodaAI;
export declare class SecretProvider { constructor(source: unknown); getSecret(name: string): Promise<string | undefined>; getBailianConfig(): Promise<{ apiKey?: string; baseUrl?: string }>; }
export declare class LegacyEnvSecretSource { constructor(env?: Record<string, string | undefined>); getSecret(name: string): string | undefined; getApiKey(): string | undefined; getBaseUrl(): string; }
export * from './registry';
export * from './provider';
export * from './policy';
export * from './telemetry';
