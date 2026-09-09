'use strict';

/* global module */

/**
 * Test-only recommendation references.
 *
 * This module deliberately does not import the production selector.  The legacy
 * reference describes the old core-only contract, while the exhaustive
 * reference is intentionally small and slow enough to serve as a correctness
 * oracle for a bounded implementation.
 */

const CORE_ROLES = Object.freeze(['top', 'bottom', 'skirt', 'dress', 'shoes']);
const OPTIONAL_ROLES = Object.freeze(['outerwear', 'socks', 'hat', 'necklace', 'bracelet', 'bag']);

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function itemId(item) {
  return text(item?._id || item?.id || item?.itemId);
}

function category(item) {
  const value = text(item?.category || item?.type).toLowerCase();
  if (value === 'onepiece' || value === 'one-piece' || value === 'dress') return 'dress';
  return value;
}

function roleOf(item) {
  const value = category(item);
  return value === 'bottom' && (item?.isSkirt === true || /裙|skirt/i.test(text(item?.subcategory || item?.subCategory)))
    ? 'skirt'
    : value;
}

function stableItems(items) {
  return (Array.isArray(items) ? items : [])
    .filter((item) => itemId(item))
    .slice()
    .sort((left, right) => itemId(left).localeCompare(itemId(right)));
}

function combinations(values) {
  return values.reduce((result, valuesForSlot) => result.flatMap((prefix) => valuesForSlot.map((value) => [...prefix, value])), [[]]);
}

function completeIdentity(itemsByRole) {
  return OPTIONAL_ROLES.concat(CORE_ROLES)
    .map((role) => `${role}=${itemId(itemsByRole[role]) || 'NONE'}`)
    .join('|');
}

function defaultLegacyScore(candidate) {
  return candidate.roles.reduce((sum, role) => sum + (Number(candidate.itemsByRole[role]?.score) || 0), 0);
}

function buildLegacyCoreCandidates({ clothes, scene = 'home', score = defaultLegacyScore, isEligible = () => true } = {}) {
  const buckets = Object.fromEntries(CORE_ROLES.map((role) => [role, []]));
  stableItems(clothes).forEach((item) => {
    const role = roleOf(item);
    if (buckets[role]) buckets[role].push(item);
  });
  const skeletons = [];
  for (const top of buckets.top) for (const bottom of buckets.bottom) for (const shoes of buckets.shoes) skeletons.push({ top, bottom, shoes });
  for (const top of buckets.top) for (const skirt of buckets.skirt) for (const shoes of buckets.shoes) skeletons.push({ top, skirt, shoes });
  for (const dress of buckets.dress) for (const shoes of buckets.shoes) skeletons.push({ dress, shoes });
  const candidates = skeletons.map((itemsByRole) => {
    const items = CORE_ROLES.map((role) => itemsByRole[role]).filter(Boolean);
    const candidate = { scene, items, itemsByRole, roles: Object.keys(itemsByRole), outfitKey: completeIdentity(itemsByRole) };
    candidate.score = Number(score(candidate));
    return candidate;
  }).filter((candidate) => isEligible(candidate));
  return candidates.sort((left, right) => right.score - left.score || left.outfitKey.localeCompare(right.outfitKey));
}

function buildFullEnsembleExhaustiveOracle({
  clothes,
  scene = 'home',
  weather,
  score = defaultLegacyScore,
  isEligible = () => true,
  optionalRoles = OPTIONAL_ROLES,
  allowOptional = () => true,
} = {}) {
  const buckets = Object.fromEntries([...CORE_ROLES, ...OPTIONAL_ROLES].map((role) => [role, []]));
  stableItems(clothes).forEach((item) => {
    const role = roleOf(item);
    if (buckets[role]) buckets[role].push(item);
  });
  const structuralRoles = OPTIONAL_ROLES.filter((role) => optionalRoles.includes(role));
  const result = [];
  const skeletons = [];
  for (const top of buckets.top) for (const bottom of buckets.bottom) for (const shoes of buckets.shoes) skeletons.push({ top, bottom, shoes });
  for (const top of buckets.top) for (const skirt of buckets.skirt) for (const shoes of buckets.shoes) skeletons.push({ top, skirt, shoes });
  for (const dress of buckets.dress) for (const shoes of buckets.shoes) skeletons.push({ dress, shoes });
  for (const skeleton of skeletons) {
    const slotValues = structuralRoles.map((role) => [null, ...buckets[role]]);
    for (const optionalValues of combinations(slotValues)) {
      const itemsByRole = { ...skeleton };
      structuralRoles.forEach((role, index) => { itemsByRole[role] = optionalValues[index]; });
      const items = [...CORE_ROLES, ...structuralRoles].map((role) => itemsByRole[role]).filter(Boolean);
      const candidate = {
        scene,
        weather,
        items,
        itemIds: items.map(itemId),
        itemsByRole,
        roles: Object.keys(itemsByRole).filter((role) => itemsByRole[role]),
        outfitKey: completeIdentity(itemsByRole),
      };
      if (!allowOptional(candidate)) continue;
      if (!isEligible(candidate)) continue;
      candidate.score = Number(score(candidate));
      result.push(candidate);
    }
  }
  return result.sort((left, right) => right.score - left.score || left.outfitKey.localeCompare(right.outfitKey));
}

function assertCompleteIdentity(candidate) {
  if (!candidate || candidate.items.length !== candidate.itemIds.length) throw new Error('ORACLE_IDENTITY_ITEMS_MISMATCH');
  if (new Set(candidate.itemIds).size !== candidate.itemIds.length) throw new Error('ORACLE_IDENTITY_DUPLICATE_ITEM');
  if (candidate.items.some((item) => !candidate.outfitKey.includes(`=${itemId(item)}`))) throw new Error('ORACLE_IDENTITY_OMITS_ITEM');
  return true;
}

module.exports = {
  CORE_ROLES,
  OPTIONAL_ROLES,
  assertCompleteIdentity,
  buildLegacyCoreCandidates,
  buildFullEnsembleExhaustiveOracle,
  completeIdentity,
};
