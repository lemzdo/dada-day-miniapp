export type CloudMediaResolver = (fileIds: string[]) => Promise<Map<string, string> | Record<string, string>>;
export interface MediaTraceContext {
  generation: string | number;
  batchId?: string;
  trace: (stage: string, fields: Record<string, unknown>) => void;
}
export function hydrateHomeLightForRender<T extends { cards: unknown[] }>(canonicalLight: T, resolver?: CloudMediaResolver, traceContext?: MediaTraceContext): Promise<T | null>;
export function clearMediaResolutionCache(): void;
