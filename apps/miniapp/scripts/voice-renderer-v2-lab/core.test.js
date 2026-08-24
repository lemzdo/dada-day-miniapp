'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  GENERATION_PARAMETERS,
  MODEL_ALLOWLIST,
  buildCompressedPayload,
  buildCompressedSystemPrompt,
  buildRendererInput,
  buildRequestBody,
  findForbiddenKeys,
  parseRendererOutputs,
  parseCompressedRendererOutputs,
  validateRendererOutput,
} = require('./core');
const { buildGoldPlans } = require('./gold-plans');

test('Gold plans cover required Primary, baseline, and Competing cases', () => {
  const plans = buildGoldPlans();
  assert.equal(plans.length, 8);
  assert.deepEqual(plans.filter((plan) => plan.primary).map((plan) => plan.primary.insightCode), [
    'PATTERN_FOCUS',
    'SILHOUETTE_CONTRAST',
    'COLOR_UNITY',
    'SCENE_WORK_STRUCTURED_SET',
    'PATTERN_FOCUS',
  ]);
  assert.deepEqual(plans.filter((plan) => !plan.primary).map((plan) => plan.baselineKind), [
    'weak_only',
    'sparse_low_confidence',
    'sparse_none',
  ]);
  assert.equal(plans.find((plan) => plan.competing).goldSource.selectedSecondaryPresent, true);
});

test('compressed prompt removes repeated transport metadata but keeps the authorized meaning and garments', () => {
  const inputs = buildGoldPlans().map(buildRendererInput);
  const current = buildRequestBody('max', inputs);
  const compressed = buildRequestBody('max', inputs, { promptVariant: 'compressed' });
  const payload = buildCompressedPayload(inputs);
  assert.equal(buildCompressedSystemPrompt(), compressed.messages[0].content);
  assert.equal(compressed.response_format.type, 'json_object');
  assert.equal(payload.length, inputs.length);
  assert.deepEqual(Object.keys(payload[0]).sort(), ['g', 'id', 'm']);
  assert.equal(payload[0].m, inputs[0].primary.meaning);
  assert.deepEqual(payload[0].g, inputs[0].garments);
  assert.equal(payload.find((entry) => entry.m === null) !== undefined, true);
  assert.doesNotMatch(compressed.messages[1].content, /inputVersion|personaVersion|allowedClaims|insightId|planId/);
  const currentChars = current.messages.reduce((sum, message) => sum + message.content.length, 0);
  const compressedChars = compressed.messages.reduce((sum, message) => sum + message.content.length, 0);
  assert.ok(compressedChars / currentChars < 0.15);
});

test('compressed output parser restores authoritative plan and insight bindings server-side', () => {
  const inputs = buildGoldPlans().map(buildRendererInput).slice(0, 2);
  const raw = JSON.stringify({ copies: [
    { id: '1', text: inputs[0].primary.meaning },
    { id: '2', text: inputs[1].primary.meaning },
  ] });
  assert.deepEqual(parseCompressedRendererOutputs(raw, inputs), inputs.map((input) => ({
    planId: input.planId,
    insightId: input.primary.insightId,
    text: input.primary.meaning,
  })));
  assert.throws(() => parseCompressedRendererOutputs(JSON.stringify({ copies: [{ id: '1', text: 'x' }, { id: '1', text: 'y' }] }), inputs), /OUTPUT_PLAN_BINDING/);
  assert.throws(() => parseCompressedRendererOutputs(JSON.stringify({ copies: [{ id: '1', text: 'x', extra: true }, { id: '2', text: 'y' }] }), inputs), /OUTPUT_KEYS/);
});

test('Renderer input is minimal and strips candidates, secondary, scores, and raw context', () => {
  for (const plan of buildGoldPlans()) {
    const input = buildRendererInput(plan);
    assert.deepEqual(findForbiddenKeys(input), []);
    assert.equal(Object.hasOwn(input, 'goldSource'), false);
    assert.equal(Object.hasOwn(input, 'requiredMeaningGroups'), false);
    assert.equal(Object.hasOwn(input, 'baselineKind'), false);
    assert.equal(Object.hasOwn(input, 'evidence'), false);
    assert.equal(input.expressionMode === 'baseline', input.primary === null);
    if (plan.competing) assert.doesNotMatch(JSON.stringify(input), /SILHOUETTE_CONTRAST|selectedSecondary/);
  }
});

test('Max, Plus, and current Flash requests differ only by model and keep generation parameters fixed', () => {
  const inputs = buildGoldPlans().map(buildRendererInput);
  const max = buildRequestBody('max', inputs);
  const plus = buildRequestBody('plus', inputs);
  const flash = buildRequestBody('flash', inputs);
  assert.equal(max.model, MODEL_ALLOWLIST.max);
  assert.equal(plus.model, MODEL_ALLOWLIST.plus);
  assert.equal(flash.model, MODEL_ALLOWLIST.flash);
  assert.equal(flash.model, 'qwen3.7-flash');
  assert.deepEqual({ ...max, model: 'same' }, { ...plus, model: 'same' });
  assert.deepEqual({ ...max, model: 'same' }, { ...flash, model: 'same' });
  for (const [key, value] of Object.entries(GENERATION_PARAMETERS)) {
    assert.equal(max[key], value);
    assert.equal(plus[key], value);
    assert.equal(flash[key], value);
  }
});

test('Output parser enforces minimal shape and exact plan/insight binding', () => {
  const plans = buildGoldPlans().slice(0, 2);
  const inputs = plans.map(buildRendererInput);
  const raw = JSON.stringify(inputs.map((input) => ({
    planId: input.planId,
    insightId: input.primary.insightId,
    text: input.primary.meaning,
  })));
  assert.equal(parseRendererOutputs(raw, inputs).length, 2);
  assert.throws(() => parseRendererOutputs(JSON.stringify([{ ...JSON.parse(raw)[0], extra: true }]), inputs), /OUTPUT_COMPLETENESS|OUTPUT_KEYS/);
  assert.throws(() => parseRendererOutputs(JSON.stringify([{ ...JSON.parse(raw)[0], insightId: 'wrong' }, JSON.parse(raw)[1]]), inputs), /OUTPUT_INSIGHT_BINDING/);
});

test('Automated checks detect preserved meaning, new reasons, unsupported facts, and persona failures', () => {
  const plans = buildGoldPlans();
  const pattern = plans.find((plan) => plan.caseId === 'primary-pattern-focus');
  assert.equal(validateRendererOutput({ planId: pattern.planId, insightId: pattern.primary.insightId, text: '条纹上衣已经是重点，纯色长裤简单一点，整套不会显乱。' }, pattern).pass, true);
  assert.ok(validateRendererOutput({ planId: pattern.planId, insightId: pattern.primary.insightId, text: '算法判断条纹上衣显瘦，修身上衣配阔腿裤也平衡。' }, pattern).failures.includes('UNSUPPORTED_FACT'));

  const competing = plans.find((plan) => plan.competing);
  assert.ok(validateRendererOutput({ planId: competing.planId, insightId: competing.primary.insightId, text: '条纹是重点，一紧一松的轮廓也很平衡。' }, competing).failures.includes('NEW_REASON_OR_SECONDARY'));

  const sparse = plans.find((plan) => plan.baselineKind === 'sparse_none');
  assert.equal(validateRendererOutput({ planId: sparse.planId, insightId: null, text: '白色T恤配灰色长裤，就是简单日常的一套。' }, sparse).pass, true);
});
