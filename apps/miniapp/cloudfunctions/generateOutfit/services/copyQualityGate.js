const recommendationCopyAcceptanceGate = require('./recommendationCopyAcceptanceGate');

// Deprecated compatibility shim. Task 5 removes the remaining callers.
function sanitizeUserFacingCopy(value) {
  return value;
}

// Deprecated compatibility shim. Task 5 removes the remaining callers.
function sanitizeCopyObject(value) {
  return value;
}

module.exports = {
  ...recommendationCopyAcceptanceGate,
  sanitizeCopyObject,
  sanitizeUserFacingCopy,
};
