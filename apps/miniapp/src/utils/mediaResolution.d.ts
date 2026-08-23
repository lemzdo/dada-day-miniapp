export type CloudMediaResolver = (fileIds: string[]) => Promise<Map<string, string> | Record<string, string>>;
export function hydrateHomeLightForRender<T extends { cards: unknown[] }>(canonicalLight: T, resolver?: CloudMediaResolver): Promise<T | null>;
export function clearMediaResolutionCache(): void;
