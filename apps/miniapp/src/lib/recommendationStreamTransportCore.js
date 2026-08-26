'use strict';

/**
 * Keep the interactive HTTP body limited to values the shared Runtime consumes.
 * Client-only timing ledgers remain local and are joined to the response later.
 */
function buildRecommendationStreamTransportInput(params = {}, generation, runtimeVersion) {
  const input = {
    date: params.date,
    scene: params.scene,
    timeOfDay: params.timeOfDay,
    weather: params.weather,
    weatherMode: params.weatherMode,
    v2BatchId: params.v2BatchId,
    performanceDiagnostics: params.performanceDiagnostics,
    acceptanceRunId: params.acceptanceRunId,
    captureId: params.captureId,
    trigger: params.trigger,
    excludedOutfitKeys: params.excludedOutfitKeys,
    requestKind: params.requestKind,
    runtimeVersion,
    streamGeneration: String(generation),
  };
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

module.exports = { buildRecommendationStreamTransportInput };
