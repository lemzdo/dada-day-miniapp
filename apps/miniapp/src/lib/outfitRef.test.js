'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(file) {
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(output, file);
  return loaded.exports;
}

const refs = loadTypeScriptModule(path.join(__dirname, 'outfitRef.ts'));

function routeParams(url) {
  return Object.fromEntries(new URL(`https://miniapp.local${url}`).searchParams.entries());
}

test('Today to Detail retains stable recommendation identity', () => {
  const ref = refs.createRecommendationOutfitRef('batch-1', {
    outfitKey: 'top-1|bottom-1',
    referenceId: 'signed-ref-1',
  });
  assert.ok(ref);
  const recovered = refs.readOutfitRefFromRoute(routeParams(refs.buildOutfitDetailUrl(ref)));
  assert.deepEqual(recovered, ref);
  assert.match(refs.getOutfitRefIdentity(ref), /batch-1:signed-ref-1/);
});

test('Favorite and History refs recover their cloud relation ids', () => {
  const base = {
    id: 'relation-1',
    userId: 'user-1',
    outfitId: 'outfit-1',
    outfitKey: 'composition-1',
    clothingIds: [],
    createdAt: '',
    updatedAt: '',
  };
  const favorite = refs.createOutfitRef({ ...base, favoriteOutfitId: 'favorite-1' }, 'favorite');
  const history = refs.createOutfitRef({ ...base, id: 'history-1' }, 'history');
  assert.equal(refs.getOutfitRefResolverId(favorite), 'favorite-1');
  assert.equal(refs.getOutfitRefResolverId(history), 'history-1');
});

test('legacy History entry without any stable identity is guarded', () => {
  const ref = refs.createOutfitRef({
    id: '',
    userId: 'user-1',
    clothingIds: [],
    createdAt: '',
    updatedAt: '',
  }, 'history');
  assert.equal(ref, null);
});
