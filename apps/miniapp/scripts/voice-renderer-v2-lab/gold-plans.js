'use strict';

const {
  materializeFixture,
  recommendationStylingShadowV2Fixtures,
} = require('../../cloudfunctions/generateOutfit/services/recommendationStylingShadowV2.fixtures');
const {
  buildRecommendationNarrativePlanV2,
} = require('../../cloudfunctions/generateOutfit/services/recommendationNarrativePlanV2');

const CASE_SPECS = Object.freeze([
  spec('primary-pattern-focus', {
    garments: ['条纹上衣', '纯色长裤'],
    meaning: '条纹上衣是这套搭配唯一明确的图案重点，纯色长裤保持简单。',
    requiredMeaningGroups: [['条纹', '图案', '花纹'], ['简单', '重点', '不乱']],
    forbiddenMeaningTerms: ['修身', '阔腿', '松紧', '轮廓'],
  }),
  spec('primary-silhouette-contrast', {
    garments: ['修身上衣', '阔腿裤'],
    meaning: '修身上衣与阔腿裤形成一紧一松的轮廓对比。',
    requiredMeaningGroups: [['修身', '一紧一松'], ['阔腿', '轮廓']],
    forbiddenMeaningTerms: ['条纹', '图案', '同色'],
  }),
  spec('primary-monochromatic', {
    garments: ['蓝色上衣', '藏青长裤'],
    meaning: '蓝色上衣和藏青长裤处在接近的蓝色系，颜色保持统一。',
    requiredMeaningGroups: [['蓝色', '藏青'], ['同色', '统一', '颜色']],
    forbiddenMeaningTerms: ['修身', '阔腿', '图案'],
  }),
  spec('scene-primary-work-structure', {
    garments: ['衬衫', '西装长裤', '商务鞋'],
    meaning: '衬衫、西装长裤和商务鞋组成清楚完整的上班搭配。',
    requiredMeaningGroups: [['衬衫', '西装长裤'], ['上班', '通勤']],
    forbiddenMeaningTerms: ['天气', '保暖', '修身'],
  }),
  spec('weak-formality-only', {
    garments: ['基础上衣', '基础长裤'],
    baselineKind: 'weak_only',
    requiredMeaningGroups: [['简单', '日常', '基础', '直接']],
  }),
  spec('sparse-low-confidence-pattern', {
    garments: ['图案上衣', '印花长裤'],
    baselineKind: 'sparse_low_confidence',
    requiredMeaningGroups: [['简单', '日常', '基础', '直接']],
    forbiddenMeaningTerms: ['图案重点', '印花重点', '呼应'],
  }),
  spec('sparse-basic-no-evidence', {
    garments: ['白色T恤', '灰色长裤'],
    baselineKind: 'sparse_none',
    requiredMeaningGroups: [['简单', '日常', '基础', '直接']],
  }),
  spec('competing-pattern-and-silhouette', {
    garments: ['条纹修身上衣', '纯色阔腿裤'],
    meaning: '条纹修身上衣是这套搭配唯一需要表达的图案重点，纯色阔腿裤保持简单。',
    requiredMeaningGroups: [['条纹', '图案'], ['简单', '重点', '不乱']],
    forbiddenMeaningTerms: ['一紧一松', '轮廓对比', '松紧', '平衡'],
    competing: true,
  }),
]);

function buildGoldPlans() {
  return CASE_SPECS.map((caseSpec) => {
    const fixture = recommendationStylingShadowV2Fixtures.find((entry) => entry.id === caseSpec.fixtureId);
    if (!fixture) throw new Error(`FIXTURE_NOT_FOUND:${caseSpec.fixtureId}`);
    const plan = buildRecommendationNarrativePlanV2(materializeFixture(fixture), {
      scene: fixture.scene,
      weather: fixture.weather,
      recommendationInstanceId: `voice-lab:${fixture.id}`,
    });
    const primary = plan.insights.primary;
    if (caseSpec.meaning && !primary) throw new Error(`PRIMARY_NOT_FOUND:${fixture.id}`);
    if (!caseSpec.meaning && primary) throw new Error(`BASELINE_EXPECTED:${fixture.id}`);
    return Object.freeze({
      caseId: fixture.id,
      sourceFixture: fixture.id,
      planId: plan.planId,
      expressionMode: plan.expressionStrategy.mode,
      primary: primary
        ? Object.freeze({
            insightId: primary.insightId,
            insightCode: primary.insightCode,
            meaning: caseSpec.meaning,
            subjectGarments: caseSpec.garments.filter((_, index) => index < Math.max(1, primary.subjectItemIds.length)),
          })
        : null,
      garments: Object.freeze(caseSpec.garments.slice()),
      allowedClaims: Object.freeze(primary ? [primary.claimCode] : ['outfit.composition_fact']),
      evidence: Object.freeze(primary
        ? {
            evidenceRefs: Object.freeze(primary.evidenceRefs.slice()),
            subjectItemIds: Object.freeze(primary.subjectItemIds.slice()),
            claimCode: primary.claimCode,
          }
        : {
            evidenceRefs: Object.freeze(plan.claimPermission.baselineCompositionClaim.evidenceRefs.slice()),
            subjectItemIds: Object.freeze(plan.identity.outfitComposition.itemIds.slice()),
            claimCode: plan.claimPermission.baselineCompositionClaim.claimCode,
          }),
      scene: primary?.contextDependencies?.scene ? fixture.scene : '',
      baselineKind: caseSpec.baselineKind || null,
      competing: caseSpec.competing === true,
      requiredMeaningGroups: Object.freeze((caseSpec.requiredMeaningGroups || []).map((group) => Object.freeze(group.slice()))),
      forbiddenMeaningTerms: Object.freeze((caseSpec.forbiddenMeaningTerms || []).slice()),
      goldSource: Object.freeze({
        narrativePlanVersion: plan.version,
        materiality: plan.resolution.materiality,
        competition: plan.resolution.competition,
        selectedSecondaryPresent: Boolean(plan.insights.selectedSecondary),
      }),
    });
  });
}

function spec(fixtureId, details) {
  return Object.freeze({ fixtureId, ...details });
}

module.exports = { CASE_SPECS, buildGoldPlans };
