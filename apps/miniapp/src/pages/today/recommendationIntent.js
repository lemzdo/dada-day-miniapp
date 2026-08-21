function buildRecommendationInputSignature({
  userRuntimeKey = '',
  sceneKey = '',
  date = '',
  timeOfDay = '',
  weatherFingerprint = '',
  wardrobeVersion = '',
  profileVersion = '',
  recommendationBatchId = '',
  excludedOutfitKeys = [],
  requestKind = 'initial',
} = {}) {
  return [
    userRuntimeKey,
    sceneKey,
    date,
    timeOfDay,
    weatherFingerprint,
    wardrobeVersion,
    profileVersion,
    recommendationBatchId,
    uniqueStrings(excludedOutfitKeys).sort().join(','),
    requestKind,
  ].map(encodePart).join('|');
}

function createRecommendationIntentRegistry() {
  let nextGeneration = 0;
  let activeIntent = null;
  const inFlightBySignature = new Map();

  function run({ intentId, inputSignature, execute }) {
    if (!intentId || !inputSignature || typeof execute !== 'function') {
      throw new Error('recommendation intent requires id, signature, and execute');
    }

    const existing = inFlightBySignature.get(inputSignature);
    if (existing) {
      activeIntent = existing.intent;
      return {
        intent: existing.intent,
        promise: existing.promise,
        joined: true,
      };
    }

    const intent = Object.freeze({
      intentId: String(intentId),
      inputSignature: String(inputSignature),
      generation: ++nextGeneration,
    });
    activeIntent = intent;

    let promise;
    try {
      promise = Promise.resolve(execute(intent));
    } catch (error) {
      promise = Promise.reject(error);
    }
    const record = { intent, promise };
    inFlightBySignature.set(inputSignature, record);
    promise.then(
      () => removeSettledRecord(inputSignature, record),
      () => removeSettledRecord(inputSignature, record),
    );
    return { intent, promise, joined: false };
  }

  function activate({ intentId, inputSignature }) {
    if (!intentId || !inputSignature) {
      throw new Error('recommendation intent activation requires id and signature');
    }
    const intent = Object.freeze({
      intentId: String(intentId),
      inputSignature: String(inputSignature),
      generation: ++nextGeneration,
    });
    activeIntent = intent;
    return intent;
  }

  function isCurrent(intent) {
    return Boolean(
      intent
        && activeIntent
        && intent.generation === activeIntent.generation
        && intent.intentId === activeIntent.intentId
        && intent.inputSignature === activeIntent.inputSignature,
    );
  }

  function reset() {
    nextGeneration += 1;
    activeIntent = null;
    inFlightBySignature.clear();
  }

  function removeSettledRecord(inputSignature, record) {
    if (inFlightBySignature.get(inputSignature) === record) {
      inFlightBySignature.delete(inputSignature);
    }
  }

  return {
    activate,
    getActive: () => activeIntent,
    isCurrent,
    reset,
    run,
  };
}

function encodePart(value) {
  return encodeURIComponent(String(value || ''));
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))];
}

function createRecommendationInputCoordinator() {
  let identity = null;
  let releasedIdentity = null;

  function report({ inputIdentity, readiness = 'deferred' }) {
    if (!inputIdentity) throw new Error('recommendation input identity is required');
    if (identity !== inputIdentity) {
      identity = String(inputIdentity);
      releasedIdentity = null;
    }
    if (readiness === 'deferred') return { dispatch: false, inputIdentity: identity };
    if (releasedIdentity === identity) return { dispatch: false, inputIdentity: identity };
    releasedIdentity = identity;
    return { dispatch: true, inputIdentity: identity };
  }

  function reset() {
    identity = null;
    releasedIdentity = null;
  }

  return { report, reset };
}

module.exports = {
  buildRecommendationInputSignature,
  createRecommendationIntentRegistry,
  createRecommendationInputCoordinator,
};
