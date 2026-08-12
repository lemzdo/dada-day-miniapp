'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROMPT_VERSION } = require('./core');
test('phase2 dev4 prompt enforces authorized effect language and natural templates', () => { assert.equal(PROMPT_VERSION, 'xiaoda-today-voice-v2-dev4'); const prompt = buildPrompt(); for (const phrase of ['颜色连贯','张弛有度','轻盈','温和','有型','运动感更完整','敞开穿','清爽打底','精神','userFacingMeaning','allowedJudgments']) assert.match(prompt, new RegExp(phrase)); for (const example of ['印花上衣已经够醒目','红Polo配白短裤','白上衣和白鞋放一起','白衬衫配黑长裤','今天偏冷又有风']) assert.match(prompt, new RegExp(example)); assert.match(PROMPT_COMPONENTS.rules, /garment 只有/); assert.ok(Buffer.byteLength(prompt, 'utf8') < 3072); });
const {
  BRIEF_SCHEMA_VERSION,
  buildReasonCacheIdentity,
  buildStylingBriefV2,
  buildPrompt,
  selectVoiceInsight,
  toModelBrief,
  validateBriefBinding,
  validateGeneratedOutput,
  validateModelBrief,
  PERSONA_VERSION,
  PROMPT_COMPONENTS,
} = require('./core');

const item = (id, role = 'top') => ({ id, role, category: role, normalizedColor: 'blue', authorizedFactIds: [`fact:${id}`] });
const relation = (code, relationCode = code, ids = ['a']) => ({ code, relationCode, subjectItemIds: ids, evidenceFactIds: ids.map(id => `fact:${id}`) });
const outfit = (extra = {}) => ({ id: 'sample-1', scene: 'home', items: [item('a'), item('b', 'bottom')], stylingRelations: [], ...extra });

test('print relation is primary', () => assert.equal(selectVoiceInsight({ stylingRelations: [relation('SUBTYPE_FEATURE_PRINT')] }).delivery, 'primary'));
test('unknown relation is omitted', () => assert.equal(selectVoiceInsight({ stylingRelations: [relation('UNKNOWN')] }).delivery, 'omit'));
test('generic production relation loses to echo but echo is weak', () => { const x = selectVoiceInsight({ stylingRelations: [relation('HOME_EASY_DAY_SET', 'HOME_SHORT_SLEEVE_LONG_PANTS', ['a', 'b']), relation('COLOR_ECHO_TOP_SHOES', 'COLOR_ECHO_TOP_SHOES', ['a', 'b'])] }); assert.equal(x.relationType, 'COLOR_ECHO_TOP_SHOES'); assert.equal(x.delivery, 'weak'); });
test('onepiece shoes is primary', () => assert.equal(selectVoiceInsight({ stylingRelations: [relation('ONEPIECE_WITH_SHOES', 'STRUCTURE_ONEPIECE_SHOES')] }).delivery, 'primary'));
test('same color is weak', () => assert.equal(selectVoiceInsight({ stylingRelations: [relation('SAME_COLOR_TOP_BOTTOM')] }).delivery, 'weak'));
test('controlled semantic strings are portable', () => { const x = selectVoiceInsight({ stylingRelations: [relation('SUBTYPE_FEATURE_PRINT')] }); assert.ok(x.semanticPoint); assert.doesNotMatch(x.semanticPoint, /authorized|_/); });
test('brief has exact id, schema and delivery', () => { const b = buildStylingBriefV2(outfit(), { benchmarkId: 'exact-1' }); assert.equal(b.id, 'exact-1'); assert.equal(b.briefSchemaVersion, BRIEF_SCHEMA_VERSION); assert.ok(['primary', 'weak', 'omit'].includes(b.delivery)); });
test('model brief strips internal provenance', () => { const b = buildStylingBriefV2(outfit()); assert.equal(toModelBrief(b).provenance, undefined); assert.equal(toModelBrief(b).cacheDependencies, undefined); });
test('weather evidence gap is not sent', () => { const b = buildStylingBriefV2(outfit({ weatherDependency: { weatherRelevant: true, thermalBand: 'cold' } })); assert.equal(b.meaningfulWeather, undefined); });
test('authorized weather is sent', () => { const b = buildStylingBriefV2(outfit({ weatherDependency: { weatherRelevant: true, evidenceAuthorized: true, evidenceFactIds: ['weather:cold'], thermalBand: 'cold' } })); assert.equal(b.meaningfulWeather.thermalBand, 'cold'); });
test('weather requires both authorization and evidence', () => {
  const authorizedOnly = buildStylingBriefV2(outfit({ weatherDependency: { weatherRelevant: true, evidenceAuthorized: true, thermalBand: 'cold' } }));
  const evidenceOnly = buildStylingBriefV2(outfit({ weatherDependency: { weatherRelevant: true, evidenceFactIds: ['weather:cold'], thermalBand: 'cold' } }));
  assert.equal(authorizedOnly.meaningfulWeather, undefined);
  assert.equal(evidenceOnly.meaningfulWeather, undefined);
});
test('fenced JSON exact output passes', () => assert.equal(validateGeneratedOutput(' ```json\n{"items":[{"id":"a","reason":"ok"}]}\n``` ', ['a']).pass, true));
test('invented id fails', () => assert.equal(validateGeneratedOutput({ items: [{ id: 'x', reason: 'ok' }] }, ['a']).pass, false));
test('duplicate id fails', () => assert.equal(validateGeneratedOutput({ items: [{ id: 'a', reason: 'ok' }, { id: 'a', reason: 'ok' }] }, ['a', 'b']).pass, false));
test('missing id fails', () => assert.equal(validateGeneratedOutput({ items: [{ id: 'a', reason: 'ok' }] }, ['a', 'b']).pass, false));
test('empty reason fails', () => assert.equal(validateGeneratedOutput({ items: [{ id: 'a', reason: '' }] }, ['a']).pass, false));
test('persona algorithm violation is recorded as auxiliary', () => { const x = validateGeneratedOutput({ items: [{ id: 'a', reason: '颜色铺满' }] }, ['a']); assert.equal(x.automaticOnly, true); assert.ok(Array.isArray(x.results[0].personaViolations)); });
test('recursive model source key is rejected', () => assert.equal(validateModelBrief({ id: 'x', briefSchemaVersion: BRIEF_SCHEMA_VERSION, delivery: 'omit', scene: 'home', garments: [], nested: { reasoning: 'bad' } }).pass, false));
test('invalid subject alias is rejected internally', () => { const b = buildStylingBriefV2(outfit()); b.primaryStylingPoint = { subjectAliases: ['g99'] }; assert.equal(validateBriefBinding(b).pass, false); });
test('invalid provenance alias is rejected internally', () => { const b = buildStylingBriefV2(outfit()); b.provenance.aliases.g99 = 'missing'; assert.equal(validateBriefBinding(b).pass, false); });
test('source versions are retained', () => { const b = buildStylingBriefV2(outfit()); assert.ok(b.provenance.sourceVersions.stylingInsight); assert.ok(b.provenance.sourceVersions.voiceInsight); assert.ok(b.provenance.sourceVersions.persona); });
test('cache garment reorder is stable', () => { const a = buildReasonCacheIdentity(outfit()); const b = buildReasonCacheIdentity(outfit({ items: [item('b', 'bottom'), item('a')] })); assert.equal(a.outfitFingerprint, b.outfitFingerprint); });
test('cache primary insight change invalidates', () => { const base = outfit(); const a = buildReasonCacheIdentity(base, { selected: { relationType: 'SUBTYPE_FEATURE_PRINT', subjectItemIds: ['a'] } }); const b = buildReasonCacheIdentity(base, { selected: { relationType: 'SAME_COLOR_TOP_BOTTOM', subjectItemIds: ['a'] } }); assert.notEqual(a.primaryInsightFingerprint, b.primaryInsightFingerprint); });
test('cache scene and weather change invalidates', () => { const a = buildReasonCacheIdentity(outfit()); const b = buildReasonCacheIdentity(outfit({ scene: 'sport', weatherDependency: { weatherRelevant: true, evidenceAuthorized: true, evidenceFactIds: ['weather:cold'], thermalBand: 'cold' } })); assert.notEqual(a.scene, b.scene); assert.notEqual(a.weatherFingerprint, b.weatherFingerprint); });
test('cache identity carries voice contract versions and locale', () => {
  const identity = buildReasonCacheIdentity(outfit());
  assert.equal(identity.briefVersion, BRIEF_SCHEMA_VERSION);
  assert.equal(identity.personaVersion, PERSONA_VERSION);
  assert.equal(identity.promptVersion, PROMPT_VERSION);
  assert.equal(identity.model, 'qwen3.7-plus');
  assert.equal(identity.locale, 'zh-CN');
});
test('invalid model fails closed', () => assert.throws(() => buildReasonCacheIdentity(outfit(), { modelAlias: 'max' }), /not allowed/));
test('prompt has exact id output contract', () => assert.match(buildPrompt(), /exact IDs/));
test('prompt contains persona, job, boundaries and delivery semantics', () => {
  const prompt = buildPrompt();
  assert.match(prompt, /朋友型私人穿搭顾问/);
  assert.match(prompt, /绝不重新挑选/);
  assert.match(prompt, /primary、weak 或 omit/);
  assert.match(prompt, /禁止/);
  assert.match(prompt, /exact input id/);
  assert.ok(Buffer.byteLength(prompt, 'utf8') > 1000);
  assert.ok(Buffer.byteLength(prompt, 'utf8') < 6000);
  assert.ok((prompt.match(/GOOD/g) || []).length <= 2);
  assert.equal(PROMPT_COMPONENTS.repeatedInstructions, '');
});

test('upper-simple fixture selects DETAIL as primary', () => {
  const insight = selectVoiceInsight({ scene: 'home', stylingRelations: [relation('DETAIL_SINGLE_FOCUS')] });
  assert.equal(insight.relationType, 'DETAIL_SINGLE_FOCUS');
  assert.equal(insight.delivery, 'primary');
});

test('sport formality-only insight is omitted', () => {
  assert.equal(selectVoiceInsight({ scene: 'sport', stylingRelations: [relation('FORMALITY_ALIGNED')] }).delivery, 'omit');
});

test('work formality insight is primary', () => {
  const insight = selectVoiceInsight({ scene: 'work', stylingRelations: [relation('FORMALITY_ALIGNED')] });
  assert.equal(insight.relationType, 'FORMALITY_ALIGNED');
  assert.equal(insight.delivery, 'primary');
});

test('normalized garments adapter builds valid internal and model briefs', () => {
  const b = buildStylingBriefV2({
    id: 'normalized-1',
    scene: 'home',
    garments: [
      { itemId: 'a', role: 'top', subcategory: 'tee', canonicalColorFamily: 'blue', pattern: 'solid', styleFacts: ['basic'], formality: 'casual', fit: 'regular', shape: 'straight', importance: 'core', authorizedFactIds: ['fact:a'] },
      { itemId: 'b', role: 'bottom', subcategory: 'pants', canonicalColorFamily: 'black', pattern: 'solid', styleFacts: [], formality: 'casual', fit: 'regular', shape: 'straight', importance: 'core', authorizedFactIds: ['fact:b'] },
    ],
    stylingRelations: [relation('STRUCTURE_TOP_BOTTOM', 'STRUCTURE_TOP_BOTTOM', ['a', 'b'])],
  });
  assert.equal(validateBriefBinding(b).pass, true);
  assert.equal(validateModelBrief(toModelBrief(b)).pass, true);
});

test('provenance retains raw styling insight version', () => {
  const b = buildStylingBriefV2({ ...outfit(), xiaodaStyleInsight: { version: 'raw-v9', primary: relation('SUBTYPE_FEATURE_PRINT') } });
  assert.equal(b.provenance.sourceVersions.stylingInsight, 'raw-v9');
});
