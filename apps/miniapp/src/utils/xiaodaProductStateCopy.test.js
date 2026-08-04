const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const serverBank = require('../../cloudfunctions/generateOutfit/services/xiaodaVoiceBankV2');
const { PRODUCT_STATE_COPY, getProductStateCopy } = require('./xiaodaProductStateCopy');

test('client product states stay byte-identical to the reviewed Voice Bank namespace', () => {
  assert.equal(Object.keys(PRODUCT_STATE_COPY).length, 7);
  for (const record of serverBank.PRODUCT_STATE_COPY) {
    assert.equal(getProductStateCopy(record.state), record.text, record.id);
  }
});

test('client has no generic Limited fallback', () => {
  assert.equal(getProductStateCopy('limited'), '');
  assert.equal(JSON.stringify(PRODUCT_STATE_COPY).includes('衣橱信息还不多'), false);
});

test('unknown product states fail closed without inventing copy', () => {
  assert.equal(getProductStateCopy('unknown'), '');
  assert.equal(getProductStateCopy(null), '');
});

test('Today uses reviewed loading states while server availability owns Limited classification', () => {
  const files = ['../../cloudfunctions/generateOutfit/index.js', '../pages/today/index.tsx'];
  const serverSource = fs.readFileSync(path.join(__dirname, files[0]), 'utf8');
  const todaySource = fs.readFileSync(path.join(__dirname, files[1]), 'utf8');
  assert.equal(serverSource.includes('resolveRecommendationAvailability'), true);
  assert.equal(serverSource.includes('getProductStateCopy'), false);
  assert.equal(todaySource.includes('getProductStateCopy'), true);
  assert.equal(todaySource.includes('getRecommendationEmptyStateCopy'), true);
  const combined = files
    .map((relative) => fs.readFileSync(path.join(__dirname, relative), 'utf8'))
    .join('\n');
  for (const retired of [
    '推荐说明正在准备中',
    '小搭先挑了这几套靠谱的。',
    '小搭还没找到合适搭配',
    '页面先保留上一版内容',
  ]) {
    assert.equal(combined.includes(retired), false, retired);
  }
  for (const relative of [
    '../pages/favorite-outfits/index.tsx',
    '../pages/outfit-history/index.tsx',
  ]) {
    const source = fs.readFileSync(path.join(__dirname, relative), 'utf8');
    assert.equal(source.includes('getProductStateCopy'), false, relative);
  }
});
