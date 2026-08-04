function isRecommendationQaAuditEnabled(requestFlag, envValue) {
  return Boolean(requestFlag) && envValue === 'true';
}

module.exports = {
  isRecommendationQaAuditEnabled,
};
