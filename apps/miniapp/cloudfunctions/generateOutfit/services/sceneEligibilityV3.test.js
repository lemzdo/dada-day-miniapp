const assert = require('node:assert/strict');
const test = require('node:test');

const { evaluateSceneEligibilityV3 } = require('./sceneEligibilityV3');

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
    thickness: extra.thickness,
    confidence: extra.confidence ?? 0.86,
    ...extra,
  };
}

test('work hard rejects slippers crocs and home shoes', () => {
  for (const shoeName of ['拖鞋', '洞洞鞋', '家居鞋']) {
    const result = evaluateSceneEligibilityV3({
      scene: 'work',
      items: [
        item('shirt', 'top', { subcategory: '衬衫', sceneTags: ['上班'] }),
        item('pants', 'bottom', { subcategory: '西裤', sceneTags: ['上班'] }),
        item('shoe', 'shoes', { subcategory: shoeName, sceneTags: ['居家'] }),
      ],
    });

    assert.equal(result.eligible, false, shoeName);
    assert.equal(result.hardRejected, true, shoeName);
    assert.ok(result.rejectReasons.includes('WORK_INVALID_SHOE'), shoeName);
  }
});

test('date hard rejects slippers crocs and home shoes', () => {
  for (const shoeName of ['拖鞋', '洞洞鞋', '家居鞋']) {
    const result = evaluateSceneEligibilityV3({
      scene: 'date',
      items: [
        item('top', 'top', { subcategory: '针织上衣', sceneTags: ['约会'], colorPalette: [{ name: '粉色' }] }),
        item('skirt', 'bottom', { subcategory: '半裙', sceneTags: ['约会'] }),
        item('shoe', 'shoes', { subcategory: shoeName, sceneTags: ['居家'] }),
      ],
    });

    assert.equal(result.eligible, false, shoeName);
    assert.equal(result.hardRejected, true, shoeName);
    assert.ok(result.rejectReasons.includes('DATE_INVALID_SHOE'), shoeName);
  }
});

test('work rejects plain tee shorts sneaker unless work evidence is strong', () => {
  const plain = evaluateSceneEligibilityV3({
    scene: 'work',
    items: [
      item('tee', 'top', { subcategory: 'T恤', sceneTags: ['日常'] }),
      item('shorts', 'bottom', { subcategory: '短裤', sceneTags: ['日常'] }),
      item('sneaker', 'shoes', { subcategory: '运动鞋', sceneTags: ['日常'] }),
    ],
  });
  const supported = evaluateSceneEligibilityV3({
    scene: 'work',
    items: [
      item('clean-top', 'top', { subcategory: '简洁通勤T恤', sceneTags: ['上班'], styleTags: ['通勤'] }),
      item('shorts', 'bottom', { subcategory: '利落百慕大短裤', sceneTags: ['上班'], styleTags: ['通勤'] }),
      item('sneaker', 'shoes', { subcategory: '干净通勤运动鞋', sceneTags: ['上班', '通勤'] }),
    ],
  });

  assert.equal(plain.eligible, false);
  assert.ok(plain.rejectReasons.includes('WORK_TOO_CASUAL_SHORTS_TEE'));
  assert.equal(supported.eligible, true);
});

test('date rejects plain tee shorts sneaker that only has color facts', () => {
  const result = evaluateSceneEligibilityV3({
    scene: 'date',
    items: [
      item('tee', 'top', { subcategory: '白色T恤', sceneTags: ['日常'], colorPalette: [{ name: '白色' }] }),
      item('shorts', 'bottom', { subcategory: '灰色短裤', sceneTags: ['日常'], colorPalette: [{ name: '灰色' }] }),
      item('sneaker', 'shoes', { subcategory: '白色运动鞋', sceneTags: ['日常'], colorPalette: [{ name: '白色' }] }),
    ],
  });

  assert.equal(result.eligible, false);
  assert.ok(result.rejectReasons.includes('DATE_TOO_CASUAL_SHORTS_TEE'));
});

test('sport requires sport apparel and sport shoes together', () => {
  const dress = evaluateSceneEligibilityV3({
    scene: 'sport',
    items: [
      item('dress', 'onepiece', { subcategory: '普通连衣裙', sceneTags: ['日常'] }),
      item('running-shoe', 'shoes', { subcategory: '跑步鞋', sceneTags: ['运动'] }),
    ],
  });
  const athletic = evaluateSceneEligibilityV3({
    scene: 'sport',
    items: [
      item('top', 'top', { subcategory: '速干训练上衣', sceneTags: ['运动'], styleTags: ['运动'] }),
      item('pants', 'bottom', { subcategory: '训练裤', sceneTags: ['运动'], styleTags: ['运动'] }),
      item('running-shoe', 'shoes', { subcategory: '跑步鞋', sceneTags: ['运动'] }),
    ],
  });

  assert.equal(dress.eligible, false);
  assert.ok(dress.rejectReasons.includes('SPORT_NON_SPORT_APPAREL'));
  assert.equal(athletic.eligible, true);
});
