'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function indexOf(directory) {
  const file = path.join(path.resolve(directory), 'index.js');
  if (!fs.existsSync(file)) throw new Error(`INDEX_MISSING:${file}`);
  return file;
}
function verifyDeploymentState(options = {}) {
  const preIndex = indexOf(options.preDownloadDir);
  const postIndex = indexOf(options.postDownloadDir);
  const preHash = sha256(preIndex);
  const postHash = sha256(postIndex);
  const postSource = fs.readFileSync(postIndex, 'utf8');
  const forbidden = ['xiaodaVoicePhase2Benchmark', 'benchmarkXiaodaVoicePhase2'];
  const forbiddenHits = forbidden.filter((term) => postSource.includes(term));
  const cloud = options.cloudEvidence || {};
  const target = cloud.target || cloud.functionName || null;
  const targetActive = target === 'generateOutfit' && /active/i.test(String(cloud.status || cloud.detail || ''));
  let packageReport = null;
  if (options.packageDir) {
    packageReport = require('../check-generate-outfit-package').analyzePackage(options.packageDir);
  }
  const audit = {
    version: 'xiaoda-ai-voice-phase2-deployment-audit-v1',
    benchmarkTarget: 'generateOutfit',
    preDownload: { directory: path.resolve(options.preDownloadDir), indexSha256: preHash },
    postDownload: { directory: path.resolve(options.postDownloadDir), indexSha256: postHash, indexMatchesPre: preHash === postHash, forbiddenHits },
    packageIntegrity: packageReport ? { passed: packageReport.passed, packageFileCount: packageReport.packageFileCount, runtimeDependencyCount: packageReport.runtimeDependencyCount } : { status: 'NOT_REQUESTED' },
    cloudEvidence: { supplied: Object.keys(cloud).length > 0, target, targetActive, evidence: cloud },
    staging: { auditSupplied: Boolean(options.stagingAudit), cleanupStatus: options.stagingAudit?.localStagingStatus || 'NOT_OBSERVED', tokenStatus: 'REDACTED' },
    pass: preHash === postHash && forbiddenHits.length === 0 && (!packageReport || packageReport.passed) && (!Object.keys(cloud).length || targetActive),
    recoverability: 'Original production source remains locally available; audit is non-destructive and any restoration requires explicit generateOutfit target deployment.',
  };
  if (options.artifactDir) {
    fs.mkdirSync(options.artifactDir, { recursive: true });
    fs.writeFileSync(path.join(options.artifactDir, 'deployment-audit.json'), `${JSON.stringify(audit, null, 2)}\n`, 'utf8');
  }
  return audit;
}

if (require.main === module) {
  const [preDownloadDir, postDownloadDir, artifactDir] = process.argv.slice(2);
  process.stdout.write(`${JSON.stringify(verifyDeploymentState({ preDownloadDir, postDownloadDir, artifactDir }), null, 2)}\n`);
}

module.exports = { verifyDeploymentState, sha256 };
