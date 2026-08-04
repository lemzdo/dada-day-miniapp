const { getClaimById } = require('./xiaodaVoiceBankV2');

function createBatchCopyConstraints() {
  return {
    usedClaimIds: [],
    claimUsage: {},
  };
}

function appendBatchCopySelection(constraints, selection) {
  const current = hasValidConstraints(constraints)
    ? copyConstraints(constraints)
    : createBatchCopyConstraints();
  const claimId = readClaimId(selection);
  if (!claimId) return current;
  return {
    usedClaimIds: appendUnique(current.usedClaimIds, [claimId]),
    claimUsage: {
      ...current.claimUsage,
      [claimId]: Number(current.claimUsage[claimId] || 0) + 1,
    },
  };
}

function buildBatchCopyConstraints(selections = []) {
  return (Array.isArray(selections) ? selections : []).reduce(
    appendBatchCopySelection,
    createBatchCopyConstraints(),
  );
}

function copyConstraints(constraints) {
  return {
    usedClaimIds: Array.isArray(constraints?.usedClaimIds)
      ? constraints.usedClaimIds.slice()
      : [],
    claimUsage: isPlainObject(constraints?.claimUsage)
      ? { ...constraints.claimUsage }
      : {},
  };
}

function hasValidConstraints(value) {
  return isPlainObject(value)
    && isDenseUniqueClaimIdArray(value.usedClaimIds)
    && isClaimCountRecord(value.claimUsage);
}

function readClaimId(selection) {
  if (!isPlainObject(selection)) return '';
  const claimId = readString(selection.claimId);
  const definition = getClaimById(claimId);
  return definition ? definition.claimId : '';
}

function isClaimCountRecord(value) {
  return isPlainObject(value) && Object.entries(value).every(([claimId, count]) =>
    Boolean(getClaimById(readString(claimId)))
    && Number.isInteger(count)
    && count >= 0);
}

function isDenseUniqueClaimIdArray(value) {
  if (!Array.isArray(value)) return false;
  const normalized = [];
  for (let index = 0; index < value.length; index += 1) {
    if (!Object.prototype.hasOwnProperty.call(value, index)) return false;
    const claimId = readString(value[index]);
    if (!getClaimById(claimId) || normalized.includes(claimId)) return false;
    normalized.push(claimId);
  }
  return true;
}

function appendUnique(current, additions) {
  return [...new Set([...(current || []), ...(additions || [])].map(readString).filter(Boolean))];
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

module.exports = {
  appendBatchCopySelection,
  buildBatchCopyConstraints,
  copyConstraints,
  createBatchCopyConstraints,
  hasValidConstraints,
};
