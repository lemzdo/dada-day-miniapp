import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRecommendScene,
  SCENE_KEY_TO_TAG,
  type RecommendSceneKey,
} from './sceneNormalization';

// ── 正例：已知中英文场景词应映射到 canonical SceneKey + sceneTag ─────

test('居家/home → home + 居家', () => {
  for (const input of ['home', '居家', '  home  ', 'HOME', '  居家  ']) {
    const r = resolveRecommendScene(input);
    assert.equal(r.valid, true, `expected valid for "${input}"`);
    if (r.valid) {
      assert.equal(r.sceneKey, 'home');
      assert.equal(r.sceneTag, '居家');
    }
  }
});

test('上班/通勤/work → work + 上班', () => {
  // 项目现有 normalizeScene 还接受 正式/开会 → work
  for (const input of ['work', '上班', '通勤', '正式', '开会', 'WORK', '  通勤  ']) {
    const r = resolveRecommendScene(input);
    assert.equal(r.valid, true, `expected valid for "${input}"`);
    if (r.valid) {
      assert.equal(r.sceneKey, 'work');
      assert.equal(r.sceneTag, '上班');
    }
  }
});

test('约会/date → date + 约会', () => {
  for (const input of ['date', '约会', 'DATE', '  约会  ']) {
    const r = resolveRecommendScene(input);
    assert.equal(r.valid, true, `expected valid for "${input}"`);
    if (r.valid) {
      assert.equal(r.sceneKey, 'date');
      assert.equal(r.sceneTag, '约会');
    }
  }
});

test('运动/sport → sport + 运动', () => {
  for (const input of ['sport', 'sports', '运动', 'SPORT', '  运动  ']) {
    const r = resolveRecommendScene(input);
    assert.equal(r.valid, true, `expected valid for "${input}"`);
    if (r.valid) {
      assert.equal(r.sceneKey, 'sport');
      assert.equal(r.sceneTag, '运动');
    }
  }
});

// ── 推荐引擎收到的 scene：resolver.sceneTag 就是 generateRecommendations 的 scene ──

test('home 输入最终 engine scene 为 居家', () => {
  // route.ts 中 generateRecommendations({ scene: sceneTag, ... })，
  // sceneTag 来自 resolveRecommendScene(body.scene).sceneTag
  const r = resolveRecommendScene('home');
  if (!r.valid) throw new Error('expected valid');
  assert.equal(r.sceneTag, '居家');
});

test('work 输入最终 engine scene 为 上班', () => {
  const r = resolveRecommendScene('work');
  if (!r.valid) throw new Error('expected valid');
  assert.equal(r.sceneTag, '上班');
});

test('缺失输入最终为 home/居家', () => {
  for (const input of [undefined, null, '', '   ']) {
    const r = resolveRecommendScene(input);
    assert.equal(r.valid, true, `expected valid (default home) for "${String(input)}"`);
    if (r.valid) {
      assert.equal(r.sceneKey, 'home');
      assert.equal(r.sceneTag, '居家');
    }
  }
});

// ── 反例：未知非空场景值 → resolver 返回 invalid，路由将返回 400 ──

test('未知非空场景值 resolver 返回 invalid，不静默伪装成 home 或其他场景', () => {
  for (const input of ['travel', '旅行', 'xyz', 'school', 'home2', 'home-office', '123', '  unknown-scene  ']) {
    const r = resolveRecommendScene(input);
    // invalid 分支不携带 sceneKey/sceneTag，路由据此返回 HTTP 400 INVALID_SCENE
    assert.equal(r.valid, false, `expected invalid for "${input}"`);
  }
});

test('未知场景不会落入任何 canonical SceneKey', () => {
  // resolver 对未知值返回 { valid: false }，不携带任何 sceneKey，
  // 因此路由不会返回 sceneKey 为空串的成功响应，而是 HTTP 400。
  const r = resolveRecommendScene('travel');
  assert.equal(r.valid, false);
});

// ── SCENE_KEY_TO_TAG：与 miniapp SCENE_TAGS 保持一致 ─────────────

test('SCENE_KEY_TO_TAG 为每个 canonical SceneKey 保留对应的用户场景标签', () => {
  assert.equal(SCENE_KEY_TO_TAG.home, '居家');
  assert.equal(SCENE_KEY_TO_TAG.work, '上班');
  assert.equal(SCENE_KEY_TO_TAG.date, '约会');
  assert.equal(SCENE_KEY_TO_TAG.sport, '运动');
});

test('resolveRecommendScene 与 SCENE_KEY_TO_TAG 配合：已知场景的标签与 miniapp 一致', () => {
  const cases: Array<{ input: string; expectedKey: RecommendSceneKey; expectedTag: string }> = [
    { input: 'home', expectedKey: 'home', expectedTag: '居家' },
    { input: '居家', expectedKey: 'home', expectedTag: '居家' },
    { input: 'work', expectedKey: 'work', expectedTag: '上班' },
    { input: '通勤', expectedKey: 'work', expectedTag: '上班' },
    { input: 'date', expectedKey: 'date', expectedTag: '约会' },
    { input: 'sport', expectedKey: 'sport', expectedTag: '运动' },
  ];
  for (const { input, expectedKey, expectedTag } of cases) {
    const r = resolveRecommendScene(input);
    assert.equal(r.valid, true, `expected valid for "${input}"`);
    if (r.valid) {
      assert.equal(r.sceneKey, expectedKey);
      assert.equal(r.sceneTag, expectedTag);
      assert.equal(SCENE_KEY_TO_TAG[expectedKey], expectedTag);
    }
  }
});
