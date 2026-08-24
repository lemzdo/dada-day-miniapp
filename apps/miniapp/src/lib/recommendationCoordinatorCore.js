'use strict';

function createRecommendationCoordinatorCore({ execute }) {
  if (typeof execute !== 'function') throw new Error('recommendation coordinator requires execute');

  let latestIdentity = null;
  const inFlightByIdentity = new Map();
  const readyByIdentity = new Map();

  function setLatestIdentity(identity) {
    if (!identity) throw new Error('recommendation identity is required');
    const normalized = String(identity);
    if (latestIdentity !== normalized) {
      latestIdentity = normalized;
      for (const key of readyByIdentity.keys()) {
        if (key !== normalized) readyByIdentity.delete(key);
      }
    }
    return normalized;
  }

  function acquire({ identity, requestKey = identity, request, mode = 'today' }) {
    const normalized = setLatestIdentity(identity);
    const normalizedRequestKey = String(requestKey || normalized);
    const ready = readyByIdentity.get(normalizedRequestKey);
    if (ready !== undefined) {
      readyByIdentity.delete(normalizedRequestKey);
      return { identity: normalized, requestKey: normalizedRequestKey, joined: false, source: 'ready', promise: Promise.resolve(ready) };
    }

    const existing = inFlightByIdentity.get(normalizedRequestKey);
    if (existing) {
      return {
        identity: normalized,
        requestKey: normalizedRequestKey,
        joined: true,
        source: existing.mode === 'prebuild' ? 'prebuild-in-flight' : 'in-flight',
        promise: existing.promise,
      };
    }

    let promise;
    try {
      promise = Promise.resolve(execute(request, { identity: normalized, mode }));
    } catch (error) {
      promise = Promise.reject(error);
    }
    const record = { identity: normalized, mode, promise };
    inFlightByIdentity.set(normalizedRequestKey, record);
    promise.then(
      (result) => {
        if (record.mode === 'prebuild' && latestIdentity === normalized) {
          readyByIdentity.set(normalizedRequestKey, result);
        }
        removeSettled(normalizedRequestKey, record);
      },
      () => removeSettled(normalizedRequestKey, record),
    );
    return {
      identity: normalized,
      requestKey: normalizedRequestKey,
      joined: false,
      source: mode === 'prebuild' ? 'prebuild' : 'full-compute',
      promise,
    };
  }

  function invalidateAndPrebuild({ identity, requestKey = identity, request }) {
    setLatestIdentity(identity);
    readyByIdentity.delete(requestKey);
    return acquire({ identity, requestKey, request, mode: 'prebuild' });
  }

  function isLatest(identity) {
    return latestIdentity === String(identity || '');
  }

  function reset() {
    latestIdentity = null;
    inFlightByIdentity.clear();
    readyByIdentity.clear();
  }

  function removeSettled(identity, record) {
    if (inFlightByIdentity.get(identity) === record) inFlightByIdentity.delete(identity);
  }

  return {
    acquire,
    getLatestIdentity: () => latestIdentity,
    invalidateAndPrebuild,
    isLatest,
    reset,
    setLatestIdentity,
  };
}

module.exports = { createRecommendationCoordinatorCore };
