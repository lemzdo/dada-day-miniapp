'use strict';

const { DEVELOPMENT_FIXTURES: BASE_FIXTURES } = require('../xiaoda-ai-voice-spike/development-fixtures');

const DEVELOPMENT_FIXTURES = Object.freeze(BASE_FIXTURES.map((fixture) => {
  if (fixture.id !== 'weather-relevant') return fixture;
  return {
    ...fixture,
    outfit: {
      ...fixture.outfit,
      weatherDependency: {
        ...fixture.outfit.weatherDependency,
        evidenceAuthorized: true,
        evidenceFactIds: ['weather:thermal_band:cold', 'weather:wind_relevant'],
      },
    },
  };
}));

module.exports = { DEVELOPMENT_FIXTURES };
