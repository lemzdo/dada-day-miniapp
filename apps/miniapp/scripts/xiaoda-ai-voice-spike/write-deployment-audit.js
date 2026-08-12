'use strict';

const fs = require('node:fs');
const path = require('node:path');

function writeAudit(directory) {
  const resolved = path.resolve(directory);
  const audit = {
    version: 'xiaoda-voice-benchmark-deployment-audit-v1',
    environmentId: 'cloud1-d8gl3k1vkdf0b7f05',
    benchmarkTarget: 'generateOutfit',
    benchmarkEntryStatus: 'REMOVED',
    benchmarkHelperFileStatus: {
      status: 'ORPHANED_BUT_UNREACHABLE',
      file: 'benchmarkXiaodaVoice.js',
      evidence: 'The downloaded production index contains no import, dispatch branch, or callable entry for the helper.',
      cleanupConstraint: 'Incremental deployment can restore the exact index but cannot delete an orphan file without a riskier full-function replacement.',
    },
    productionVerification: {
      transportProbe: 'PASS',
      cloudBuildVersion: 'generateOutfit-copy-natural-language-v4-20260811',
      cloudIndexMatchesPreSpikeSha256: true,
      benchmarkEntryAbsentFromDownloadedIndex: true,
      productionRecommendationDiff: 'NONE',
    },
    localSecretStatus: 'BENCHMARK_TOKEN_REMOVED',
    localStagingStatus: 'REMOVED',
    cleanupIncident: {
      status: 'CLEANED',
      resourceType: 'cloudFunction',
      exactResourceName: 'cloud-state-audit-20260812',
      reason: 'A recovery upload used a source directory whose basename was interpreted by WeChat CLI as a new function name. It was removed with the official CloudBase CLI after an exact-target dry-run.',
      cleanupCompletedAt: new Date().toISOString(),
      cleanupEvidence: {
        dryRun: 'Only cloud-state-audit-20260812 was selected.',
        deleteResult: 'Function deleted',
        postDeleteDetail: 'RESOURCE_NOT_FOUND',
        productionFunctionDetail: 'generateOutfit Active/Available',
      },
      safetyNote: 'Do not delete any similarly named or production function. This resource was created by this spike and is not referenced by production.',
    },
  };
  fs.writeFileSync(path.join(resolved, 'deployment-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  return audit;
}

if (require.main === module) writeAudit(process.argv[2]);

module.exports = { writeAudit };
