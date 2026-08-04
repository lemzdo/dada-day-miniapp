'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const test = require('node:test');
const {
  CANONICAL_SOURCE_PATH,
  CLOUD_FUNCTIONS_DIR,
  DEPLOYMENT_TARGETS,
  checkDeploymentCopies,
} = require('./syncCloudfunctionShared');

const FUNCTION_ROOTS = Object.freeze({
  generateOutfit: path.join(CLOUD_FUNCTIONS_DIR, 'generateOutfit'),
  confirmClothesDrafts: path.join(CLOUD_FUNCTIONS_DIR, 'confirmClothesDrafts'),
});

function resolveLocalModule(fromFile, specifier) {
  const basePath = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [basePath, `${basePath}.js`, path.join(basePath, 'index.js')];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function assertDependencyGraphStaysInside(functionRoot, entryFile) {
  const pending = [entryFile];
  const visited = new Set();
  const rootWithSeparator = `${functionRoot}${path.sep}`;

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || visited.has(current)) continue;
    visited.add(current);

    const source = fs.readFileSync(current, 'utf8');
    const relativeRequirePattern = /require\(\s*['"](\.[^'"]+)['"]\s*\)/g;
    let match = relativeRequirePattern.exec(source);
    while (match) {
      const specifier = match[1];
      const resolved = resolveLocalModule(current, specifier);
      assert.ok(resolved, `cannot resolve ${specifier} from ${current}`);
      assert.ok(
        resolved.startsWith(rootWithSeparator),
        `relative dependency leaves function root: ${current} -> ${specifier} -> ${resolved}`,
      );
      pending.push(resolved);
      match = relativeRequirePattern.exec(source);
    }
  }
}

function requireFromFunctionRoot(functionRoot, specifier) {
  const probe = [
    `const facts = require(${JSON.stringify(specifier)});`,
    "if (typeof facts.deriveSceneEligibilityFacts !== 'function') process.exit(1);",
  ].join(' ');

  execFileSync(process.execPath, ['-e', probe], {
    cwd: functionRoot,
    stdio: 'pipe',
  });
}

test('deployment copies are byte-identical to the canonical source', () => {
  assert.deepEqual(checkDeploymentCopies(), []);

  const canonical = fs.readFileSync(CANONICAL_SOURCE_PATH);
  for (const target of DEPLOYMENT_TARGETS) {
    const copy = fs.readFileSync(target);
    assert.ok(copy.equals(canonical), `${target} must be a complete canonical copy`);
    assert.doesNotMatch(copy.toString('utf8'), /module\.exports\s*=\s*require\(/);
  }
});

test('each cloud function resolves its local deployment copy from its own root', () => {
  requireFromFunctionRoot(FUNCTION_ROOTS.generateOutfit, './services/itemWearabilityFacts');
  requireFromFunctionRoot(
    FUNCTION_ROOTS.confirmClothesDrafts,
    './shared/sceneEligibilityFacts',
  );
});

test('scene eligibility local dependency graphs remain within each cloud function root', () => {
  assertDependencyGraphStaysInside(
    FUNCTION_ROOTS.generateOutfit,
    path.join(FUNCTION_ROOTS.generateOutfit, 'services', 'itemWearabilityFacts.js'),
  );
  assertDependencyGraphStaysInside(
    FUNCTION_ROOTS.confirmClothesDrafts,
    path.join(FUNCTION_ROOTS.confirmClothesDrafts, 'index.js'),
  );
});
