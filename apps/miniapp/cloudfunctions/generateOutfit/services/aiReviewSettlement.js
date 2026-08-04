function canPersistAiReviewAsReady(aiComment) {
  const explanation = aiComment?.explanationV2;
  return Boolean(
    explanation
      && explanation.source === 'ai'
      && typeof explanation.overallComment === 'string'
      && explanation.overallComment.trim(),
  );
}

function resolveAiReviewFailureSettlement(previousReview, normalizeAiComment, now) {
  const previousComment = typeof normalizeAiComment === 'function'
    ? normalizeAiComment(previousReview?.aiComment)
    : null;
  if (!previousReview || !previousComment) {
    return {
      restored: false,
      data: {
        status: 'failed',
        aiComment: null,
        generatedAt: null,
        updatedAt: now,
      },
    };
  }
  return {
    restored: true,
    data: {
      status: 'ready',
      aiComment: previousComment,
      inputHash: previousReview.inputHash,
      inputDigest: previousReview.inputDigest,
      schemaVersion: previousReview.schemaVersion,
      reviewVersion: previousReview.reviewVersion,
      promptVersion: previousReview.promptVersion,
      copyPolicyVersion: previousReview.copyPolicyVersion,
      voicePolicyVersion: previousReview.voicePolicyVersion,
      evidenceVersion: previousReview.evidenceVersion,
      source: previousReview.source,
      explanationV2: previousReview.explanationV2,
      partial: Boolean(previousReview.partial || previousComment.partial),
      adviceRejectReasons: readStrings(previousReview.adviceRejectReasons || previousComment.adviceRejectReasons),
      provider: previousReview.provider,
      model: previousReview.model,
      generatedAt: previousReview.generatedAt,
      updatedAt: previousReview.updatedAt || now,
    },
  };
}

function readStrings(values) {
  return Array.isArray(values) ? values.filter((value) => typeof value === 'string' && value.trim()) : [];
}

module.exports = {
  canPersistAiReviewAsReady,
  resolveAiReviewFailureSettlement,
};
