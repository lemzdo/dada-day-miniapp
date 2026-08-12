'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const phase2 = require('./core');
const { validateReview } = require('./editorial-review');

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const fileHash = (file) => sha256(fs.readFileSync(file));

function freezePrompt(artifactDir) {
  const dir = path.resolve(artifactDir);
  const attempts = fs.readdirSync(dir).filter((n) => /^06-development-attempt-\d+\.json$/.test(n)).sort();
  if (!attempts.length) throw new Error('DEVELOPMENT_RESULT_REQUIRED');
  const development = read(path.join(dir, attempts[attempts.length - 1]));
  if (development.objectiveChecksPass !== true || development.fixtureCount !== 20) throw new Error('DEVELOPMENT_OBJECTIVE_CHECK_FAILED');
  const reviewFile = ['07-editorial-review.json', 'editorial-review.json'].find((n) => fs.existsSync(path.join(dir, n)));
  if (!reviewFile || read(path.join(dir, reviewFile)).freezeApproved !== true) throw new Error('EDITORIAL_FREEZE_APPROVAL_REQUIRED');
  const review = read(path.join(dir, reviewFile));
  if (!validateReview(review, { kind: 'development', requireFreezeApproval: true }).pass) throw new Error('EDITORIAL_REVIEW_INVALID');
  const promptFile = path.join(dir, '01-prompt.md');
  const schemaFile = path.join(dir, '02-brief-schema.json');
  const holdoutFile = path.join(dir, '04-holdout-sealed.json');
  const holdout = read(holdoutFile);
  if (holdout.sealed !== true || holdout.opened === true || holdout.count !== 16) throw new Error('HOLDOUT_NOT_SEALED');
  const manifest = {
    version: 'xiaoda-ai-voice-phase2-freeze-v1',
    frozenAt: new Date().toISOString(),
    promptVersion: phase2.PROMPT_VERSION,
    briefSchemaVersion: phase2.BRIEF_SCHEMA_VERSION,
    voiceInsightVersion: phase2.VOICE_INSIGHT_VERSION,
    personaVersion: phase2.PERSONA_VERSION,
    modelAllowlist: phase2.MODEL_ALLOWLIST,
    promptSha256: fileHash(promptFile),
    briefSchemaSha256: fileHash(schemaFile),
    holdoutSealedSha256: fileHash(holdoutFile),
    voiceInsightSha256: sha256(phase2.VOICE_INSIGHT_VERSION),
    personaSha256: sha256(phase2.PERSONA_VERSION),
    modelAllowlistSha256: sha256(JSON.stringify(phase2.MODEL_ALLOWLIST)),
    holdoutOpened: false,
    immutable: true,
  };
  const target = path.join(dir, '08-prompt-freeze.json');
  if (fs.existsSync(target)) throw new Error('PROMPT_ALREADY_FROZEN');
  fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (require.main === module) freezePrompt(process.argv[2]);
module.exports = { freezePrompt, sha256, fileHash };
