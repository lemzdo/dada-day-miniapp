'use strict';

// Compatibility facade for existing adapters and regression tests.
module.exports = require('./recommendationOrchestrator');
module.exports.normalizeInput = require('./recommendationCore').normalizeInput;
module.exports.runRecommendationRuntime = module.exports.runRecommendationOrchestrator;
