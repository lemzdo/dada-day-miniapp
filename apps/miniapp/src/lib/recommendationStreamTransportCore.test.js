'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { buildRecommendationStreamTransportInput } = require('./recommendationStreamTransportCore');

test('interactive recommendation transport excludes client-only timing objects', () => {
  const params = {
    date: '2026-08-26',
    scene: '约会',
    timeOfDay: 'all_day',
    weatherMode: 'disabled',
    trigger: 'scene',
    requestKind: 'initial',
    performanceDiagnostics: true,
    acceptanceRunId: 'ttui-v2-human-retake',
    captureId: 'ttui-v2-human-retake-capture',
    telemetryCorrelationId: 'cold-correlation-not-for-runtime',
    clientMilestones: Object.fromEntries(Array.from(
      { length: 10 },
      (_, index) => [`clientMilestone${index + 1}`, 1787731200000 + index],
    )),
  };
  const before = {
    ...params,
    runtimeVersion: 'today-runtime-v2',
    streamGeneration: '19',
  };
  const after = buildRecommendationStreamTransportInput(params, 19, 'today-runtime-v2');

  assert.equal('clientMilestones' in after, false);
  assert.equal('telemetryCorrelationId' in after, false);
  assert.equal(after.scene, '约会');
  assert.equal(after.performanceDiagnostics, true);
  assert.ok(Buffer.byteLength(JSON.stringify(after)) < Buffer.byteLength(JSON.stringify(before)));
});
