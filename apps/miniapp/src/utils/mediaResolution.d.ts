export type CloudMediaResolver = (fileIds: string[]) => Promise<Map<string, string> | Record<string, string>>;
export function isCloudFileId(value?: unknown): boolean;
export function resolveMediaBatch(fileIds: string[], resolver: CloudMediaResolver): Promise<Map<string, string>>;
export function resolveRecommendationMedia<T extends object>(response: T, resolver?: CloudMediaResolver): Promise<T>;
export function clearMediaResolutionCache(): void;
