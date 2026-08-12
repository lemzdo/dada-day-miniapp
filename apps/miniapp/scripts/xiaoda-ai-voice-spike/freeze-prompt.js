'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  BRIEF_SCHEMA_VERSION,
  GENERATION_PARAMETERS,
  PROMPT_VERSION,
  buildPrompt,
  sha256,
} = require('./core');

function freezePrompt(directory) {
  const promptFile = path.join(directory, '01-prompt.md');
  const schemaFile = path.join(directory, '02-brief-schema.json');
  const developmentFile = path.join(directory, 'prompt-development-model-check.json');
  if (!fs.existsSync(developmentFile)) throw new Error('prompt development model check is required');
  const development = JSON.parse(fs.readFileSync(developmentFile, 'utf8'));
  if (development.objectiveChecksPass !== true) throw new Error('prompt development objective checks did not pass');
  const prompt = fs.readFileSync(promptFile, 'utf8').trim();
  if (prompt !== buildPrompt()) throw new Error('prompt artifact does not match the versioned prompt');
  const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
  const freeze = {
    frozenAt: new Date().toISOString(),
    promptVersion: PROMPT_VERSION,
    promptSha256: sha256(prompt),
    briefSchemaVersion: BRIEF_SCHEMA_VERSION,
    briefSchemaSha256: sha256(schema),
    generationParameters: GENERATION_PARAMETERS,
    developmentFixtureCount: development.fixtureCount,
    developmentObjectiveChecksPass: true,
    holdoutOpenedAfterFreeze: false,
  };
  fs.writeFileSync(path.join(directory, 'prompt-freeze.json'), `${JSON.stringify(freeze, null, 2)}\n`, 'utf8');
  process.stdout.write(`PROMPT_FROZEN ${directory}\n`);
  return freeze;
}

if (require.main === module) freezePrompt(path.resolve(process.argv[2]));

module.exports = { freezePrompt };
