export interface BuildUserScopeInput {
  envVersion: string;
  cloudEnvId: string;
  confirmedOpenid: string;
}

export interface BuildCacheEnvironmentScopeInput {
  envVersion: string;
  cloudEnvId: string;
}

export function buildUserScope(input: BuildUserScopeInput): string | null {
  const environmentScope = buildCacheEnvironmentScope({
    envVersion: input.envVersion,
    cloudEnvId: input.cloudEnvId,
  });
  const openid = normalizeOpenidForScope(input.confirmedOpenid);

  if (!environmentScope || !openid) return null;

  return `${environmentScope}:user:${openid}`;
}

export function buildCacheEnvironmentScope(input: BuildCacheEnvironmentScopeInput): string | null {
  const envVersion = normalizeScopeSegment(input.envVersion);
  const cloudEnvId = normalizeScopeSegment(input.cloudEnvId);

  if (!envVersion || !cloudEnvId) return null;

  return `${envVersion}:cloud:${cloudEnvId}`;
}

export function normalizeOpenidForScope(openid: string): string {
  const trimmed = openid.trim();
  if (!trimmed) return '';

  return Array.from(trimmed)
    .map((char) => {
      if (/^[a-zA-Z0-9_-]$/.test(char)) return char;
      const codePoint = char.codePointAt(0);
      return codePoint === undefined ? '' : `~${codePoint.toString(16)}~`;
    })
    .join('');
}

function normalizeScopeSegment(value: string): string {
  return normalizeOpenidForScope(value);
}
