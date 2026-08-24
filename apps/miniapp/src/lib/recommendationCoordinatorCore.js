'use strict';
/* global module */

function createRecommendationCoordinatorCore({ execute }) {
  if (typeof execute !== 'function') throw new Error('recommendation coordinator requires execute');

  let latestIdentity = null;
  const inFlightByIdentity = new Map();
  const readyByIdentity = new Map();
  let nextSlot = null;

  function setLatestIdentity(identity) {
    if (!identity) throw new Error('recommendation identity is required');
    const normalized = String(identity);
    if (latestIdentity !== normalized) {
      latestIdentity = normalized;
      for (const key of readyByIdentity.keys()) {
        if (key !== normalized) readyByIdentity.delete(key);
      }
      if (nextSlot && nextSlot.identity !== normalized) nextSlot = null;
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

  function nextRun(record, joined, safeFailure = false) {
    const source = record.status === 'ready' ? 'next-ready'
      : record.status === 'failed' ? 'next-failed'
        : record.status === 'running' ? 'next-running' : 'next-stale';
    return {
      identity: record.identity,
      requestKey: record.requestKey,
      joined,
      source,
      promise: record.status === 'failed'
        ? (safeFailure || joined ? Promise.resolve(undefined) : Promise.reject(record.error))
        : record.promise,
    };
  }

  function prepareNext({ identity, requestKey = identity, request }) {
    const normalized = setLatestIdentity(identity);
    const normalizedRequestKey = String(requestKey || normalized);
    if (nextSlot && nextSlot.identity === normalized && nextSlot.requestKey === normalizedRequestKey) {
      return nextRun(nextSlot, true);
    }
    // Same effective input with a different current-batch key means the
    // visible batch changed (for example pull-down/retry). The old successor
    // is no longer consumable and is replaced by the newly bound slot.
    if (nextSlot && nextSlot.identity === normalized) nextSlot = null;
    const record = { identity: normalized, requestKey: normalizedRequestKey, status: 'running', promise: null, result: undefined, error: undefined };
    try {
      record.promise = Promise.resolve(execute(request, { identity: normalized, mode: 'prebuild' }));
    } catch (error) {
      record.promise = Promise.reject(error);
    }
    nextSlot = record;
    record.promise.then(
      (result) => {
        record.result = result;
        record.status = nextSlot === record && latestIdentity === normalized ? 'ready' : 'stale';
        if (record.status === 'stale' && nextSlot === record) nextSlot = null;
      },
      (error) => {
        record.error = error;
        record.status = nextSlot === record && latestIdentity === normalized ? 'failed' : 'stale';
        if (record.status === 'stale' && nextSlot === record) nextSlot = null;
      },
    );
    return nextRun(record, false);
  }

  function acquireNext({ identity, requestKey = identity }) {
    const normalized = String(identity);
    const normalizedRequestKey = String(requestKey || normalized);
    if (!nextSlot || nextSlot.identity !== normalized || nextSlot.requestKey !== normalizedRequestKey) {
      return { identity: normalized, requestKey: normalizedRequestKey, joined: false, source: 'next-missing', promise: Promise.resolve(undefined) };
    }
    const run = nextRun(nextSlot, nextSlot.status !== 'ready', true);
    // A ready value is consumed immediately. Keep a running record until it
    // settles (or is replaced/invalidated), so concurrent consumers still
    // join the same in-flight successor.
    if (nextSlot.status === 'ready') nextSlot = null;
    return run;
  }

  function isLatest(identity) {
    return latestIdentity === String(identity || '');
  }

  function reset() {
    latestIdentity = null;
    inFlightByIdentity.clear();
    readyByIdentity.clear();
    nextSlot = null;
  }

  function removeSettled(identity, record) {
    if (inFlightByIdentity.get(identity) === record) inFlightByIdentity.delete(identity);
  }

  return {
    acquire,
    getLatestIdentity: () => latestIdentity,
    invalidateAndPrebuild,
    prepareNext,
    acquireNext,
    getNextState: () => nextSlot
      ? { identity: nextSlot.identity, requestKey: nextSlot.requestKey, status: nextSlot.status }
      : null,
    isLatest,
    reset,
    setLatestIdentity,
  };
}

module.exports = { createRecommendationCoordinatorCore };
