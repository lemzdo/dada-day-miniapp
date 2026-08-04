'use strict';

const REAL_SPORT_EVIDENCE_FIXTURE = Object.freeze({
  auditId: 'rec_5_mrw7ry58_9wpcnz',
  sceneKey: 'sport',
  weather: Object.freeze({ mode: 'disabled', temp: null }),
  clothes: Object.freeze([
    Object.freeze({
      _id: 'evidence-tee',
      category: 'top',
      subcategory: 'tee',
      structuredAiFacts: Object.freeze(['sport_top']),
    }),
    Object.freeze({
      _id: 'evidence-shorts',
      category: 'bottom',
      subcategory: 'shorts',
    }),
    Object.freeze({
      _id: 'evidence-sport-shoes',
      category: 'shoes',
      subcategory: 'running shoes',
      structuredAiFacts: Object.freeze(['sport_shoe']),
    }),
  ]),
});

function createRealSportEvidenceFixture() {
  return {
    ...REAL_SPORT_EVIDENCE_FIXTURE,
    weather: { ...REAL_SPORT_EVIDENCE_FIXTURE.weather },
    clothes: REAL_SPORT_EVIDENCE_FIXTURE.clothes.map((item) => ({
      ...item,
      ...(Array.isArray(item.structuredAiFacts)
        ? { structuredAiFacts: item.structuredAiFacts.slice() }
        : {}),
    })),
  };
}

module.exports = {
  REAL_SPORT_EVIDENCE_FIXTURE,
  createRealSportEvidenceFixture,
};
