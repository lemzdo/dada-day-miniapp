const assert = require('node:assert/strict');
const test = require('node:test');

const {
  USER_BENEFIT_CODES,
  VOICE_POLICY_VERSION,
  deriveUserBenefitsV1,
  findXiaodaVoicePolicyViolations,
  renderXiaodaDetailCopy,
  renderXiaodaStylistFallback,
  renderXiaodaTodayCopy,
} = require('./xiaodaVoicePolicy');

function item(overrides = {}) {
  return {
    id: overrides.id || overrides.slot || 'item',
    slot: overrides.slot || 'top',
    name: overrides.name || '上衣',
    colors: overrides.colors || [],
    styleTags: overrides.styleTags || [],
    patternType: overrides.patternType || '',
    thickness: overrides.thickness || '',
    material: overrides.material || '',
    fit: overrides.fit || '',
    length: overrides.length || '',
    formalityLevel: overrides.formalityLevel ?? null,
    ...overrides,
  };
}

function facts(overrides = {}) {
  return {
    items: overrides.items || [
      item({ id: 'top', slot: 'top', name: '白色短袖T恤', colors: ['白色'], thickness: '薄', styleTags: ['休闲'] }),
      item({ id: 'bottom', slot: 'bottom', name: '灰色短裤', colors: ['灰色'], length: 'short', styleTags: ['休闲'] }),
      item({ id: 'shoes', slot: 'shoes', name: '运动鞋', colors: ['白色'], styleTags: ['运动'] }),
    ],
    outfit: overrides.outfit || { categories: ['bottom', 'shoes', 'top'], styleTags: ['休闲', '运动'] },
    context: overrides.context || { scene: '居家', temperatureBand: 'hot' },
    ...overrides,
  };
}

function codes(benefits) {
  return benefits.map((benefit) => benefit.code);
}

test('deriveUserBenefitsV1 exposes stable xiaoda voice version and allowlist', () => {
  assert.equal(VOICE_POLICY_VERSION, 'xiaoda-voice-v1');
  assert.ok(USER_BENEFIT_CODES.includes('HOT_DAY_LIGHT_AND_EASY'));
  assert.ok(USER_BENEFIT_CODES.includes('LOW_EFFORT_COHERENT_LOOK'));
});

test('hot weather with short sleeve shorts and sneakers produces grounded benefits', () => {
  const benefits = deriveUserBenefitsV1(facts(), [], {});
  assert.deepEqual(codes(benefits).filter((code) => code.startsWith('HOT_DAY')), [
    'HOT_DAY_LIGHT_AND_EASY',
    'HOT_DAY_EASY_TO_MOVE',
  ]);
  assert.ok(codes(benefits).includes('HOME_READY_FOR_QUICK_OUTING'));
});

test('hot weather with sparse clothing facts does not invent breathable or cool sensations', () => {
  const source = facts({
    items: [item({ slot: 'top', name: '上衣', colors: ['白色'] })],
    outfit: { categories: ['top'], styleTags: [] },
    context: { scene: '居家', temperatureBand: 'hot' },
  });
  const benefits = deriveUserBenefitsV1(source, [], {});
  assert.equal(codes(benefits).includes('HOT_DAY_LIGHT_AND_EASY'), false);
  const copy = [
    renderXiaodaTodayCopy({ facts: source, benefits }),
    renderXiaodaDetailCopy({ facts: source, benefits }),
    renderXiaodaStylistFallback({ facts: source, benefits }).overallComment,
  ].join('');
  assert.doesNotMatch(copy, /透气|不闷|凉快|吸汗|舒服/);
});

test('sport scene without sport item does not claim easy movement', () => {
  const source = facts({
    items: [
      item({ slot: 'top', name: '上衣', colors: ['白色'], styleTags: ['简约'] }),
      item({ slot: 'bottom', name: '长裤', colors: ['黑色'], styleTags: ['简约'] }),
    ],
    context: { scene: '运动', temperatureBand: 'mild' },
  });
  assert.equal(codes(deriveUserBenefitsV1(source)).includes('SPORT_EASY_TO_MOVE'), false);
});

test('low temperature without coat thickness or sleeve facts does not claim warmth', () => {
  const source = facts({
    items: [item({ slot: 'top', name: '针织衫', colors: ['米色'], styleTags: ['简约'] })],
    context: { scene: '上班', temperatureBand: 'cold' },
  });
  const benefits = deriveUserBenefitsV1(source);
  assert.equal(codes(benefits).includes('COLD_DAY_LAYERING_READY'), false);
  assert.doesNotMatch(renderXiaodaTodayCopy({ facts: source, benefits }), /保暖|暖和/);
});

test('benefits are deduped stable order independent and never mutate input', () => {
  const source = facts();
  const before = JSON.stringify(source);
  const reversed = { ...source, items: source.items.slice().reverse() };
  assert.deepEqual(deriveUserBenefitsV1(source), deriveUserBenefitsV1(reversed));
  assert.equal(JSON.stringify(source), before);
  assert.equal(deriveUserBenefitsV1(source).every((benefit) => Number.isFinite(benefit.strength)), true);
});

test('pattern competition blocks low effort coherent look and does not reverse into tidy copy', () => {
  const source = facts({
    items: [
      item({ slot: 'top', name: '条纹衬衫', colors: ['蓝白'], patternType: 'stripe' }),
      item({ slot: 'bottom', name: '格纹裙', colors: ['灰色'], patternType: 'plaid' }),
    ],
    context: { scene: '约会', temperatureBand: 'mild' },
  });
  const insights = [{ code: 'PATTERN_COMPETITION', dimension: 'pattern', strength: 2 }];
  const benefits = deriveUserBenefitsV1(source, insights);
  assert.equal(codes(benefits).includes('LOW_EFFORT_COHERENT_LOOK'), false);
  assert.doesNotMatch(renderXiaodaTodayCopy({ facts: source, insights, benefits }), /不乱|不会显得太乱/);
});

test('xiaoda renderers reject mechanical terms and unsupported sensations', () => {
  const source = facts();
  const benefits = deriveUserBenefitsV1(source);
  const copy = [
    renderXiaodaTodayCopy({ facts: source, benefits }),
    renderXiaodaDetailCopy({ facts: source, benefits }),
    renderXiaodaStylistFallback({ facts: source, benefits }).overallComment,
    renderXiaodaStylistFallback({ facts: source, benefits }).advice,
  ].join('\n');
  assert.equal(findXiaodaVoicePolicyViolations(copy).length, 0);
  assert.doesNotMatch(copy, /克制|稳定|基础单品|正式度接近|视觉关系|更完整|宝宝|绝绝子|拿捏/);
});
