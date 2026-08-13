'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { buildGoldPlans } = require('./gold-plans');
const { buildRendererInput } = require('./core');
const { buildArtifact } = require('./run');
const { prepareReview } = require('./prepare-review');

test('prepare review writes identity-free blind file and separate sealed mapping', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-review-'));
  const plans = buildGoldPlans();
  const inputs = plans.map(buildRendererInput);
  const calls = ['max', 'plus'].map((modelAlias) => ({
    modelAlias,
    repetition: 1,
    outputs: plans.map((plan) => ({
      planId: plan.planId,
      insightId: plan.primary?.insightId || null,
      text: plan.primary?.meaning || `${plan.garments[0]}配${plan.garments[1]}，就是简单日常的一套。`,
    })),
    checks: plans.map((plan) => ({ caseId: plan.caseId, planId: plan.planId, pass: true, failures: [] })),
  }));
  fs.writeFileSync(path.join(directory, 'raw-runs.json'), JSON.stringify(buildArtifact(plans, inputs, calls, 1, ['max', 'plus'])));
  prepareReview(directory);
  const blind = fs.readFileSync(path.join(directory, 'sol-blind-review.json'), 'utf8');
  const sealed = fs.readFileSync(path.join(directory, '.sealed-model-map.json'), 'utf8');
  assert.doesNotMatch(blind, /qwen3\.7|max|plus|modelAlias|sealedModelMap/);
  assert.match(sealed, /max/);
  assert.match(sealed, /plus/);
  assert.equal(fs.existsSync(path.join(directory, 'stability-summary.json')), true);
});
