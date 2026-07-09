const assert = require('node:assert/strict');
const test = require('node:test');

const { classifyWearabilityItem } = require('./itemWearabilityFacts');

function item(id, category, extra = {}) {
  return {
    _id: id,
    category,
    subcategory: extra.subcategory || category,
    customName: extra.customName || extra.name || id,
    styleTags: extra.styleTags || [],
    sceneTags: extra.sceneTags || [],
    seasonTags: extra.seasonTags || [],
    colorPalette: extra.colorPalette || [],
    material: extra.material,
    materialGuess: extra.materialGuess,
    thickness: extra.thickness,
    fit: extra.fit,
    patternType: extra.patternType,
    aestheticFeatures: extra.aestheticFeatures,
    confidence: extra.confidence ?? 0.86,
    ...extra,
  };
}

test('classifies warm heavy clothing conservatively without light signals', () => {
  const facts = classifyWearabilityItem(item('hoodie', 'top', {
    subcategory: '卫衣',
    thickness: '厚',
    material: '棉',
  }));

  assert.equal(facts.isSweaterLike, true);
  assert.equal(facts.isWarmTop, true);
  assert.equal(facts.warmthLevel >= 3, true);
  assert.deepEqual(facts.lightnessSignals, []);
  assert.ok(facts.evidence.some((entry) => entry.includes('卫衣')));
});

test('allows thin summer knit only when explicit lightness evidence exists', () => {
  const facts = classifyWearabilityItem(item('summer-knit', 'top', {
    subcategory: '薄针织防晒衫',
    seasonTags: ['夏季'],
    thickness: '轻薄',
    material: '冰丝',
  }));

  assert.equal(facts.isSweaterLike, true);
  assert.equal(facts.isWarmTop, false);
  assert.equal(facts.warmthLevel <= 2, true);
  assert.ok(facts.lightnessSignals.includes('轻薄'));
  assert.ok(facts.lightnessSignals.includes('夏季'));
});

test('does not treat slippers or crocs as commute shoes', () => {
  const slipper = classifyWearabilityItem(item('slipper', 'shoes', {
    subcategory: '拖鞋',
    sceneTags: ['居家'],
  }));
  const crocs = classifyWearabilityItem(item('crocs', 'shoes', {
    subcategory: '洞洞鞋',
    styleTags: ['休闲'],
  }));

  assert.equal(slipper.isSlipperLike, true);
  assert.equal(slipper.isHomeShoe, true);
  assert.equal(slipper.workSignals.length, 0);
  assert.equal(crocs.isCrocsLike, true);
  assert.equal(crocs.workSignals.length, 0);
});

test('does not upgrade ordinary dresses into sport dresses', () => {
  const regular = classifyWearabilityItem(item('dress', 'onepiece', {
    subcategory: '连衣裙',
    sceneTags: ['约会'],
    styleTags: ['优雅'],
  }));
  const tennis = classifyWearabilityItem(item('tennis-dress', 'onepiece', {
    subcategory: '网球运动连衣裙',
    sceneTags: ['运动'],
    styleTags: ['运动', '网球'],
  }));

  assert.equal(regular.isDressLike, true);
  assert.equal(regular.isNormalDress, true);
  assert.equal(regular.isSportDress, false);
  assert.equal(tennis.isDressLike, true);
  assert.equal(tennis.isSportDress, true);
});
