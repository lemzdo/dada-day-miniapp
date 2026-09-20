const DEFAULT_KEY_PREFIX = 'd1d:l1:';

export function utf8ByteLength(value) {
  const input = String(value);
  let bytes = 0;

  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && index + 1 < input.length) {
      const next = input.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }

  return bytes;
}

export function serializedByteSize(value) {
  const serialized = JSON.stringify(value);
  return typeof serialized === 'string' ? utf8ByteLength(serialized) : 0;
}

export function isQuotaError(error) {
  const message = getErrorMessage(error).toLowerCase();
  return /quota|storage.*full|exceed.*storage|maximum.*storage|no space/.test(message);
}

export function executeWriteWithQuotaRetry({ write, cleanup, quotaMatcher = isQuotaError }) {
  try {
    write();
    return { ok: true, attempts: 1 };
  } catch (firstError) {
    if (!quotaMatcher(firstError)) {
      return { ok: false, attempts: 1, error: firstError, quota: false };
    }

    cleanup();
    try {
      write();
      return { ok: true, attempts: 2 };
    } catch (secondError) {
      return {
        ok: false,
        attempts: 2,
        error: secondError,
        quota: quotaMatcher(secondError),
      };
    }
  }
}

export function createStorageCore({
  registry,
  adapter,
  onDiagnostic = () => {},
  now = () => Date.now(),
  keyPrefix = DEFAULT_KEY_PREFIX,
  highWaterBytes = 384 * 1024,
  softLimitBytes = 512 * 1024,
}) {
  function write(namespace, payload, options = {}) {
    const contract = registry[namespace];
    if (!contract || contract.enabled === false) {
      return reject(namespace, contract, 'unregistered', 0);
    }

    const timestamp = options.now ?? now();
    cleanup({ now: timestamp, aggressive: false });

    const storageKey = buildStorageKey(keyPrefix, namespace, options.scope, options.entryId);
    const previous = readEnvelope(storageKey);
    const envelope = {
      namespace,
      schemaVersion: contract.migrationVersion,
      scope: normalizePart(options.scope, 'device'),
      entryId: normalizePart(options.entryId, 'current'),
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
      expiresAt: contract.ttlMs === null ? null : timestamp + contract.ttlMs,
      payload,
    };
    const bytes = serializedByteSize(envelope);

    if (bytes > contract.maxBytes) {
      return reject(namespace, contract, 'namespace-byte-cap', bytes);
    }

    const namespaceEntries = collectEntries().filter((entry) => entry.envelope.namespace === namespace);
    const otherEntries = namespaceEntries.filter((entry) => entry.key !== storageKey);
    let namespaceBytes = bytes + otherEntries.reduce((sum, entry) => sum + entry.bytes, 0);
    let namespaceCount = 1 + otherEntries.length;

    if (namespaceCount > contract.maxEntries || namespaceBytes > contract.maxBytes) {
      if (!contract.evictable) {
        return reject(namespace, contract, 'namespace-cap-protected', bytes);
      }

      const candidates = sortOldestFirst(otherEntries.filter((entry) => isEntryEvictable(entry)));
      for (const candidate of candidates) {
        removeKey(candidate.key, namespace);
        namespaceBytes -= candidate.bytes;
        namespaceCount -= 1;
        if (namespaceCount <= contract.maxEntries && namespaceBytes <= contract.maxBytes) break;
      }

      if (namespaceCount > contract.maxEntries || namespaceBytes > contract.maxBytes) {
        return reject(namespace, contract, 'namespace-cap', bytes);
      }
    }

    const projectedBytes = storageBytes(storageKey) + bytes;
    if (projectedBytes > highWaterBytes) {
      const targetAfterWrite = projectedBytes > softLimitBytes
        ? Math.floor(highWaterBytes * 0.75)
        : highWaterBytes;
      evictPermittedCaches(targetAfterWrite - bytes, storageKey);
    }

    const afterGcBytes = storageBytes(storageKey) + bytes;
    if (afterGcBytes > softLimitBytes && contract.evictable) {
      return reject(namespace, contract, 'global-soft-limit', bytes);
    }

    const writeResult = executeWriteWithQuotaRetry({
      write: () => adapter.set(storageKey, envelope),
      cleanup: () => cleanupForQuota(storageKey, timestamp),
    });

    if (writeResult.ok) {
      diagnostic('write-success', namespace, {
        attempts: writeResult.attempts,
        bytes,
      });
      return {
        ok: true,
        status: 'persisted',
        attempts: writeResult.attempts,
        bytes,
      };
    }

    const protectedWrite = isProtected(contract);
    diagnostic('write-failed', namespace, {
      attempts: writeResult.attempts,
      bytes,
      quota: writeResult.quota === true,
      error: getErrorMessage(writeResult.error),
    });
    return {
      ok: false,
      status: protectedWrite ? 'persistence-error' : 'cache-skipped',
      reason: writeResult.quota ? 'quota-exhausted' : 'write-failed',
      attempts: writeResult.attempts,
      bytes,
      recoverability: protectedWrite ? 'memory-only' : 'recomputable',
    };
  }

  function read(namespace, options = {}) {
    const contract = registry[namespace];
    if (!contract || contract.enabled === false) {
      diagnostic('read-rejected', namespace, { reason: 'unregistered' });
      return null;
    }

    const storageKey = buildStorageKey(keyPrefix, namespace, options.scope, options.entryId);
    const envelope = readEnvelope(storageKey);
    if (!envelope || envelope.namespace !== namespace || envelope.schemaVersion !== contract.migrationVersion) {
      if (envelope) removeKey(storageKey, namespace);
      return null;
    }

    const timestamp = options.now ?? now();
    if (typeof envelope.expiresAt === 'number' && envelope.expiresAt <= timestamp) {
      removeKey(storageKey, namespace);
      diagnostic('expired-removed', namespace, { key: storageKey });
      return null;
    }

    return {
      payload: envelope.payload,
      createdAt: envelope.createdAt,
      updatedAt: envelope.updatedAt,
      expiresAt: envelope.expiresAt,
    };
  }

  function remove(namespace, options = {}) {
    if (!registry[namespace]) return false;
    const storageKey = buildStorageKey(keyPrefix, namespace, options.scope, options.entryId);
    return removeKey(storageKey, namespace);
  }

  function cleanup(options = {}) {
    const timestamp = options.now ?? now();
    let removed = 0;

    for (const entry of collectEntries()) {
      if (typeof entry.envelope.expiresAt === 'number' && entry.envelope.expiresAt <= timestamp) {
        removeKey(entry.key, entry.envelope.namespace);
        removed += 1;
        diagnostic('expired-removed', entry.envelope.namespace, { key: entry.key });
      }
    }

    const totalBytes = storageBytes();
    if (options.aggressive || totalBytes > highWaterBytes) {
      removed += evictPermittedCaches(options.aggressive ? 0 : highWaterBytes);
    }

    return { removed, bytes: storageBytes() };
  }

  function cleanupForQuota(excludedKey, timestamp) {
    cleanup({ now: timestamp, aggressive: false });
    evictPermittedCaches(0, excludedKey);
  }

  function evictPermittedCaches(targetBytes, excludedKey) {
    let totalBytes = storageBytes(excludedKey);
    let removed = 0;
    const candidates = sortOldestFirst(
      collectEntries().filter((entry) => entry.key !== excludedKey && isEntryEvictable(entry)),
    );

    for (const candidate of candidates) {
      if (totalBytes <= Math.max(0, targetBytes)) break;
      removeKey(candidate.key, candidate.envelope.namespace);
      totalBytes -= candidate.bytes;
      removed += 1;
      diagnostic('evicted', candidate.envelope.namespace, { key: candidate.key });
    }
    return removed;
  }

  function isEntryEvictable(entry) {
    const contract = registry[entry.envelope.namespace];
    return Boolean(contract?.evictable);
  }

  function collectEntries() {
    const entries = [];
    for (const key of adapter.keys()) {
      if (!key.startsWith(keyPrefix)) continue;
      const envelope = readEnvelope(key);
      if (!envelope || !registry[envelope.namespace]) continue;
      entries.push({ key, envelope, bytes: serializedByteSize(envelope) });
    }
    return entries;
  }

  function registeredBytes(excludedKey) {
    return collectEntries()
      .filter((entry) => entry.key !== excludedKey)
      .reduce((sum, entry) => sum + entry.bytes, 0);
  }

  function storageBytes(excludedKey) {
    if (typeof adapter.sizeBytes !== 'function') return registeredBytes(excludedKey);
    try {
      const total = Math.max(0, Number(adapter.sizeBytes()) || 0);
      if (!excludedKey) return total;
      const excluded = collectEntries().find((entry) => entry.key === excludedKey);
      return Math.max(0, total - (excluded?.bytes ?? 0));
    } catch (error) {
      diagnostic('size-read-failed', 'unknown', { error: getErrorMessage(error) });
      return registeredBytes(excludedKey);
    }
  }

  function readEnvelope(key) {
    try {
      const value = adapter.get(key);
      return isEnvelope(value) ? value : null;
    } catch (error) {
      diagnostic('read-failed', 'unknown', { key, error: getErrorMessage(error) });
      return null;
    }
  }

  function removeKey(key, namespace) {
    try {
      adapter.remove(key);
      return true;
    } catch (error) {
      diagnostic('remove-failed', namespace, { key, error: getErrorMessage(error) });
      return false;
    }
  }

  function reject(namespace, contract, reason, bytes) {
    const protectedWrite = Boolean(contract && isProtected(contract));
    diagnostic('write-rejected', namespace, { reason, bytes });
    return {
      ok: false,
      status: reason === 'unregistered'
        ? 'rejected-unregistered'
        : protectedWrite
          ? 'persistence-error'
          : 'cache-skipped',
      reason,
      attempts: 0,
      bytes,
      recoverability: protectedWrite ? 'memory-only' : 'recomputable',
    };
  }

  function diagnostic(event, namespace, detail) {
    onDiagnostic({ event, namespace, detail, at: now() });
  }

  return { write, read, remove, cleanup };
}

function isProtected(contract) {
  return contract.evictionPolicy === 'PROTECTED' || contract.evictionPolicy === 'TERMINAL_DELETE';
}

function sortOldestFirst(entries) {
  return [...entries].sort((left, right) => left.envelope.updatedAt - right.envelope.updatedAt);
}

function buildStorageKey(prefix, namespace, scope, entryId) {
  return [
    prefix,
    encodeURIComponent(namespace),
    ':',
    encodeURIComponent(normalizePart(scope, 'device')),
    ':',
    encodeURIComponent(normalizePart(entryId, 'current')),
  ].join('');
}

function normalizePart(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function isEnvelope(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof value.namespace === 'string'
      && typeof value.schemaVersion === 'number'
      && typeof value.createdAt === 'number'
      && typeof value.updatedAt === 'number'
      && Object.prototype.hasOwnProperty.call(value, 'payload'),
  );
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    return String(error.errMsg ?? error.message ?? 'unknown storage error');
  }
  return 'unknown storage error';
}
