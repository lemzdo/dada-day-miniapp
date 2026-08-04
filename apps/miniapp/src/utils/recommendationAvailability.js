const NO_MORE_NEW_OUTFITS_NOTICE = '这一轮暂时没有更多新搭配了。';
const NEUTRAL_EMPTY_NOTICE = '这个场景暂时没找到合适的搭配，换个场景试试吧。';
const ROLE_LABELS = Object.freeze({
  top: '上衣',
  bottom: '下装',
  onepiece: '连衣裙',
  shoes: '鞋子',
});
const FACT_LABELS = Object.freeze({
  sport_activity_top: '适合活动的上装',
  sport_activity_bottom: '活动方便的下装',
  sport_stable_shoe: '稳定包脚的运动鞋',
});

function getRecommendationEmptyStateCopy(missingRoles = [], missingFacts = []) {
  const roles = normalizeRoles(missingRoles);
  const facts = normalizeFacts(missingFacts);
  if (roles.length === 0 && facts.length === 0) return NEUTRAL_EMPTY_NOTICE;
  const apparelAlternatives = roles.includes('top') && roles.includes('bottom') && roles.includes('onepiece');
  const parts = [];
  if (apparelAlternatives) parts.push('上衣和下装，或一件连衣裙');
  else parts.push(...roles.filter((role) => role !== 'onepiece').map((role) => ROLE_LABELS[role]));
  if (roles.includes('onepiece') && !apparelAlternatives) parts.push(ROLE_LABELS.onepiece);
  if (roles.includes('shoes') && !parts.includes(ROLE_LABELS.shoes)) parts.push(ROLE_LABELS.shoes);
  parts.push(...facts.map((fact) => FACT_LABELS[fact]));
  return `当前场景还缺少${parts.filter(Boolean).join('、')}，补齐后再试试。`;
}

function normalizeRoles(value) {
  if (!Array.isArray(value)) return [];
  return Object.keys(ROLE_LABELS).filter((role) => value.includes(role));
}

function normalizeFacts(value) {
  if (!Array.isArray(value)) return [];
  return Object.keys(FACT_LABELS).filter((fact) => value.includes(fact));
}

module.exports = {
  NEUTRAL_EMPTY_NOTICE,
  NO_MORE_NEW_OUTFITS_NOTICE,
  getRecommendationEmptyStateCopy,
};
