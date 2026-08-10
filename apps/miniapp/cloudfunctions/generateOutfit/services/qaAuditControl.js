function isRecommendationQaAuditEnabled(requestFlag, envValue) {
  return Boolean(requestFlag) && envValue === 'true';
}

function isSceneEvidenceAcceptanceAuditEnabled(event = {}) {
  if (event.diagnostics !== true
    || event.performanceDiagnostics !== true
    || event.debugRecommendationAudit !== true) {
    return false;
  }
  const runMatch = /^today-copy-naturalness-\d{14}-(home|work|date|sport)$/.exec(String(event.acceptanceRunId || ''));
  const captureMatch = /^copy-naturalness-(home|work|date|sport)-[0-9a-f]{6}$/.exec(String(event.captureId || ''));
  return Boolean(runMatch && captureMatch && runMatch[1] === captureMatch[1]);
}

module.exports = {
  isRecommendationQaAuditEnabled,
  isSceneEvidenceAcceptanceAuditEnabled,
};
