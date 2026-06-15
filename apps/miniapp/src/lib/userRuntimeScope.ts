import type { ActiveAuthContext } from '@/stores/userStore';

export function buildAuthRuntimeKey(authContext: ActiveAuthContext) {
  return [
    encodeRuntimeKeyPart(authContext.userScope),
    `epoch:${authContext.authEpoch}`,
  ].join(':');
}

function encodeRuntimeKeyPart(value: string) {
  return encodeURIComponent(value);
}
