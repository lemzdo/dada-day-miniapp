const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const componentDir = __dirname;
const formTsx = fs.readFileSync(path.join(componentDir, 'index.tsx'), 'utf8');
const formScss = fs.readFileSync(path.join(componentDir, 'index.scss'), 'utf8');
const uploadConfirmTsx = fs.readFileSync(path.join(componentDir, '../../pages/upload-confirm/index.tsx'), 'utf8');
const uploadConfirmScss = fs.readFileSync(path.join(componentDir, '../../pages/upload-confirm/index.scss'), 'utf8');

test('ClothingEditForm exposes a panel layout mode while keeping page as default', () => {
  assert.match(formTsx, /layoutMode\?: 'page' \| 'panel'/);
  assert.match(formTsx, /layoutMode = 'page'/);
  assert.match(formTsx, /clothing-edit-form \$\{layoutMode === 'panel'/);
});

test('panel mode does not use viewport min-height or window fixed footer', () => {
  assert.match(formScss, /\.clothing-edit-form\.panel/);
  assert.match(formScss, /min-height:\s*0/);
  assert.match(formScss, /\.clothing-edit-form\.panel[\s\S]*\.save-button-bar[\s\S]*position:\s*relative/);
});

test('upload-confirm wraps edit panel with scroll view and touch interception', () => {
  assert.match(uploadConfirmTsx, /catchMove/);
  assert.match(uploadConfirmTsx, /<ScrollView[\s\S]*className="draft-edit-scroll"[\s\S]*scrollY/);
  assert.match(uploadConfirmTsx, /layoutMode="panel"/);
  assert.match(uploadConfirmScss, /\.draft-edit-scroll/);
});
