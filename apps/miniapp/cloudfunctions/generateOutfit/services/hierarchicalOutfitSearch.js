const CORE_ROLES = Object.freeze(['top', 'bottom', 'skirt', 'dress', 'onepiece', 'shoes']);
const HIERARCHICAL_SEARCH_VERSION = 'hierarchical-outfit-search-v2';
const STRUCTURAL_ROLES = Object.freeze(['outerwear', 'socks', 'gloves', 'scarf', 'hat']);
const ACCESSORY_ROLES = Object.freeze(['socks', 'hat', 'bag', 'belt', 'necklace', 'bracelet', 'watch', 'accessory']);
const ALL_ROLES = Object.freeze([...new Set([...CORE_ROLES, ...STRUCTURAL_ROLES, ...ACCESSORY_ROLES])]);
const ITEM_ROLES = Object.freeze({ core: CORE_ROLES, structural: STRUCTURAL_ROLES, accessory: ACCESSORY_ROLES });
const SKELETONS = Object.freeze([
  ['top', 'bottom', 'shoes'],
  ['top', 'skirt', 'shoes'],
  ['dress', 'shoes'],
  ['onepiece', 'shoes'],
]);
const HOME_SKELETONS = Object.freeze([
  ['top', 'bottom'],
  ['top', 'skirt'],
  ['dress'],
  ['onepiece'],
  ...SKELETONS,
]);
const OPTIONAL_SLOTS = ACCESSORY_ROLES;

function hierarchicalOutfitSearch({
  clothes = [], scene = 'home', weather = {}, itemFactsContext,
  targetBatchSize = 8, targetQualifiedBatches = 3,
  scoreCandidate, evaluateEligibility, compatibility,
  maxReservoir, diagnostics: suppliedDiagnostics,
} = {}) {
  const diagnostics = suppliedDiagnostics || createDiagnostics();
  const buckets = buildRoleBuckets(clothes, itemFactsContext, diagnostics);
  const budget = deriveSearchBudget({ buckets, targetBatchSize, targetQualifiedBatches, maxReservoir });
  diagnostics.budget = budget;
  const filtered = prefilterBuckets(buckets, { scene, weather, itemFactsContext, diagnostics });
  const skeletons = boundedSkeletonSearch(filtered, { scene, budget, diagnostics, compatibility });
  const structurallyCompleted = [];
  for (const skeleton of skeletons) {
    if (structurallyCompleted.length >= budget.hardCandidateLimit
      || diagnostics.structuralExpansionCount >= budget.structuralExpansionBudget) break;
    const completions = structuralCompletion(skeleton, filtered, {
      scene, weather, budget, diagnostics, compatibility,
    });
    for (const completion of completions) {
      if (structurallyCompleted.length >= budget.hardCandidateLimit) break;
      structurallyCompleted.push(completion);
    }
  }
  const baseCapacity = Math.max(
    budget.targetBatchSize,
    budget.hardCandidateLimit - budget.accessoryExpansionBudget,
  );
  const orderedBase = structurallyCompleted.slice().sort((left, right) => (
    candidateHint(right) - candidateHint(left) || candidateKey(left).localeCompare(candidateKey(right))
  ));
  const full = selectDiversityReservoir(dedupeCandidates(orderedBase), baseCapacity, diagnostics);
  const accessorySeeds = evenlySample(full, Math.min(budget.accessorySeedCount, full.length));
  for (const candidate of accessorySeeds) {
    if (full.length >= budget.hardCandidateLimit
      || diagnostics.accessoryBeamExpansionCount >= budget.accessoryExpansionBudget) break;
    const remainingSeedCount = Math.max(1, accessorySeeds.length - accessorySeeds.indexOf(candidate));
    const remainingExpansionBudget = budget.accessoryExpansionBudget - diagnostics.accessoryBeamExpansionCount;
    const seedExpansionLimit = Math.max(1, Math.ceil(remainingExpansionBudget / remainingSeedCount));
    const completed = accessoryBeamCompletion(candidate, filtered, {
      scene, weather, budget, diagnostics, compatibility,
      expansionLimit: diagnostics.accessoryBeamExpansionCount + seedExpansionLimit,
    });
    for (const entry of completed) {
      if (full.length >= budget.hardCandidateLimit) break;
      if (candidateKey(entry) !== candidateKey(candidate)) full.push(entry);
    }
  }
  diagnostics.fullCandidateLimitHit = full.length >= budget.hardCandidateLimit;
  const hasFinalEvaluation = typeof evaluateEligibility === 'function' || typeof scoreCandidate === 'function';
  if (!hasFinalEvaluation) {
    diagnostics.actualCandidateCount = full.length;
    diagnostics.selectedCount = full.length;
    delete diagnostics._pairMemo;
    delete diagnostics._colorMemo;
    return { candidates: full.map(compactCandidate), diagnostics, buckets };
  }
  const accepted = [];
  for (const candidate of full) {
    const result = typeof evaluateEligibility === 'function'
      ? evaluateEligibility(candidate, { scene, weather, itemFactsContext })
      : { eligible: true };
    diagnostics.eligibilityEvaluations += 1;
    if (result === false || result?.eligible === false || result?.hardRejected === true) {
      diagnostics.hardRejectCount += 1;
      continue;
    }
    const score = typeof scoreCandidate === 'function'
      ? Number(scoreCandidate(candidate, { scene, weather, itemFactsContext, diagnostics })) || 0
      : candidate.items.reduce((total, item) => total + Number(item._scoreHint || 0), 0);
    accepted.push({ ...candidate, score, eligibility: result });
    diagnostics.acceptedCount += 1;
  }
  accepted.sort(compareCandidates);
  const selected = selectDiversityReservoir(accepted, budget.reservoirCapacity, diagnostics);
  diagnostics.scoringCount = accepted.length;
  diagnostics.selectedCount = selected.length;
  diagnostics.actualCandidateCount = full.length;
  delete diagnostics._pairMemo;
  delete diagnostics._colorMemo;
  return { candidates: selected.map(compactCandidate), diagnostics, buckets };
}

function createDiagnostics() {
  return {
    budget: null, rawSkeletonCount: 0, partialSkeletonExpansionCount: 0, fullSkeletonCount: 0, structuralExpansionCount: 0,
    accessoryBeamExpansionCount: 0, actualCandidateCount: 0,
    weatherEvalCount: 0, sceneRuleEvalCount: 0, eligibilityEvaluations: 0,
    hardRejectCount: 0, acceptedCount: 0, scoringCount: 0, selectedCount: 0,
    pairMemoHits: 0, colorMemoHits: 0, prefilterRejectedCount: 0,
  };
}

function buildRoleBuckets(clothes, itemFactsContext, diagnostics) {
  const metrics = diagnostics || createDiagnostics();
  const buckets = Object.fromEntries(ALL_ROLES.map((role) => [role, []]));
  for (const sourceItem of Array.isArray(clothes) ? clothes : []) {
    const id = readId(sourceItem);
    if (!id) continue;
    const facts = itemFactsContext?.resolveItemFacts?.({ _id: id });
    const role = classifyRole(sourceItem, facts);
    if (!role || !buckets[role]) continue;
    buckets[role].push(toRef(sourceItem, role, roleGroup(role, sourceItem, facts), facts));
  }
  for (const role of ALL_ROLES) buckets[role].sort(compareRefs);
  metrics.roleCounts = Object.fromEntries(ALL_ROLES.map((role) => [role, buckets[role].length]));
  return buckets;
}

function prefilterBuckets(buckets, { scene, weather, itemFactsContext, diagnostics }) {
  const result = Object.fromEntries(ALL_ROLES.map((role) => [role, []]));
  for (const role of ALL_ROLES) {
    for (const item of buckets[role]) {
      const source = item.sourceItem || item;
      if (source.deletedAt || source.archivedAt || source.status === 'deleted' || source.status === 'archived') {
        diagnostics.prefilterRejectedCount += 1;
        continue;
      }
      const text = itemText(source, itemFactsContext, item);
      if (scene === 'sport' && /高跟|拖鞋|洞洞鞋|heel|slipper|crocs/i.test(text)) {
        diagnostics.prefilterRejectedCount += 1;
        continue;
      }
      if (isWeatherHardConflict(item, text, weather)) {
        diagnostics.prefilterRejectedCount += 1;
        diagnostics.weatherEvalCount += 1;
        continue;
      }
      diagnostics.weatherEvalCount += 1;
      diagnostics.sceneRuleEvalCount += 1;
      result[role].push(item);
    }
  }
  return result;
}

function deriveSearchBudget({ buckets, targetBatchSize, targetQualifiedBatches, maxReservoir }) {
  const batch = Math.max(1, Math.floor(Number(targetBatchSize) || 8));
  const qualified = Math.max(1, Math.floor(Number(targetQualifiedBatches) || 1));
  const opportunities = CORE_ROLES.reduce((sum, role) => sum + Math.min(8, buckets[role]?.length || 0), 0);
  const skeletonBeamWidth = Math.max(batch, Math.min(64, batch * qualified + Math.ceil(opportunities / 4)));
  const skeletonExpansionBudget = Math.min(4096, Math.max(32, skeletonBeamWidth * Math.max(2, qualified)));
  const structuralBeamWidth = Math.max(batch, Math.min(32, Math.ceil(skeletonBeamWidth / 2)));
  const accessoryBeamWidth = Math.max(batch, Math.min(32, batch + qualified * 2));
  const accessoryExpansionBudget = Math.min(2048, accessoryBeamWidth * Math.max(4, qualified));
  const reservoirCapacity = Math.max(batch, Math.min(Number(maxReservoir) || batch * qualified * 2, 512));
  const hardCandidateLimit = Math.min(4096, Math.max(256, reservoirCapacity * 8));
  const structuralExpansionBudget = Math.min(32768, hardCandidateLimit * 8);
  return {
    targetBatchSize: batch,
    targetQualifiedBatches: qualified,
    skeletonBeamWidth,
    skeletonExpansionBudget,
    structuralBeamWidth,
    structuralExpansionBudget,
    accessoryBeamWidth,
    accessoryExpansionBudget,
    accessorySeedCount: Math.max(batch, Math.min(reservoirCapacity, batch * qualified)),
    reservoirCapacity,
    // Eight final-evaluation opportunities per intended reservoir entry keeps
    // quality headroom explicit while preventing wardrobe-size growth.
    hardCandidateLimit,
  };
}

function boundedSkeletonSearch(buckets, { scene, budget, diagnostics, compatibility }) {
  const result = [];
  const skeletonFamilies = scene === 'home' ? HOME_SKELETONS : SKELETONS;
  const viable = skeletonFamilies.filter((roles) => roles.every((role) => buckets[role].length > 0));
  const quota = Math.max(1, Math.floor(budget.skeletonExpansionBudget / Math.max(1, viable.length)));
  for (let skeletonIndex = 0; skeletonIndex < viable.length; skeletonIndex += 1) {
    const roles = viable[skeletonIndex];
    const combinationCount = roles.reduce((product, role) => product * buckets[role].length, 1);
    const sampleCount = Math.min(quota, combinationCount);
    const step = coprimeStep(combinationCount);
    for (let attempt = 0; attempt < sampleCount && result.length < budget.skeletonExpansionBudget; attempt += 1) {
      let cursor = (attempt * step + skeletonIndex) % combinationCount;
      const tuple = roles.map((role) => {
        const list = buckets[role];
        const item = list[cursor % list.length];
        cursor = Math.floor(cursor / list.length);
        return item;
      });
      diagnostics.partialSkeletonExpansionCount += roles.length - 1;
      if (!tuple.every((item, index) => compatibleWithPartial(item, tuple.slice(0, index), compatibility, diagnostics))) continue;
      result.push({ items: tuple, roles: roles.slice() });
      diagnostics.rawSkeletonCount += 1;
      diagnostics.fullSkeletonCount += 1;
    }
  }
  return result;
}

function coprimeStep(total) {
  if (total <= 2) return 1;
  let step = Math.floor(total / 2) + 1;
  while (greatestCommonDivisor(step, total) !== 1) step += 1;
  return step;
}

function greatestCommonDivisor(left, right) {
  let a = left;
  let b = right;
  while (b) [a, b] = [b, a % b];
  return a;
}

function structuralCompletion(skeleton, buckets, { scene, weather, budget, diagnostics, compatibility }) {
  const temperature = readTemperature(weather);
  const outerwearPolicy = structuralPolicy('outerwear', scene, temperature);
  const optional = ['socks', 'gloves', 'scarf', 'hat'];
  let beam = [{ items: skeleton.items.slice(), roles: skeleton.roles.slice() }];
  for (const role of ['outerwear', ...optional]) {
    if (diagnostics.structuralExpansionCount >= budget.structuralExpansionBudget) return [];
    const options = buckets[role]
      .filter((item) => item.outfitRole === 'functional')
      .filter((item) => compatibleWithPartial(item, skeleton.items, compatibility, diagnostics));
    const policy = role === 'outerwear' ? outerwearPolicy : structuralPolicy(role, scene, temperature);
    const choices = policy.forbidden ? [null] : (policy.required && options.length > 0 ? options : [null, ...options]);
    const next = [];
    for (const entry of beam) {
      for (const selected of takeFirst(choices, budget.structuralBeamWidth)) {
        if (diagnostics.structuralExpansionCount >= budget.structuralExpansionBudget) return [];
        if (policy.required && !selected && options.length > 0) continue;
        next.push(selected
          ? { items: [...entry.items, selected], roles: [...entry.roles, role] }
          : entry);
        diagnostics.structuralExpansionCount += 1;
      }
    }
    beam = keepBeam(next, budget.structuralBeamWidth);
  }
  return beam;
}

function structuralPolicy(role, scene, temperature) {
  if (role === 'outerwear') {
    if (Number.isFinite(temperature) && temperature >= 26) return { state: 'forbidden', forbidden: true, required: false };
    if (Number.isFinite(temperature) && (temperature <= 15 || (scene === 'work' && temperature <= 24))) {
      return { state: temperature <= 15 ? 'required' : 'recommended', required: temperature <= 15, forbidden: false };
    }
  }
  if (role === 'hat' && Number.isFinite(temperature) && temperature <= 5) {
    return { state: 'required', required: true, forbidden: false };
  }
  if (role === 'gloves' && Number.isFinite(temperature) && temperature <= 5) {
    return { state: 'required', required: true, forbidden: false };
  }
  if ((role === 'socks' || role === 'scarf') && Number.isFinite(temperature) && temperature <= 10) {
    return { state: 'recommended', required: false, forbidden: false };
  }
  return { state: 'optional', required: false, forbidden: false };
}

function accessoryBeamCompletion(candidate, buckets, { budget, diagnostics, compatibility, expansionLimit }) {
  const effectiveExpansionLimit = Math.min(
    budget.accessoryExpansionBudget,
    Number(expansionLimit) || budget.accessoryExpansionBudget,
  );
  let beam = [candidate];
  const roles = OPTIONAL_SLOTS.filter((role) => buckets[role].length > 0);
  for (const role of roles) {
    if (candidateItems(candidate).some((item) => item.outfitSlot === role)) continue;
    const roleItems = buckets[role].filter((item) => item.outfitRole === 'optional');
    if (roleItems.length === 0) continue;
    const next = [];
    for (const entry of beam) {
      next.push(entry); // NONE is always a legal option.
      for (const item of boundedAlternatives(roleItems, entry.items, budget.accessoryBeamWidth, (a, b) => relationScore(a, b, compatibility, diagnostics))) {
        if (!compatibleWithPartial(item, entry.items, compatibility, diagnostics)) continue;
        if (diagnostics.accessoryBeamExpansionCount >= effectiveExpansionLimit) break;
        next.push({ items: [...entry.items, item], roles: [...entry.roles, role] });
        diagnostics.accessoryBeamExpansionCount += 1;
      }
      if (diagnostics.accessoryBeamExpansionCount >= effectiveExpansionLimit) break;
    }
    beam = keepBeam(dedupeCandidates(next), budget.accessoryBeamWidth);
    if (diagnostics.accessoryBeamExpansionCount >= effectiveExpansionLimit) break;
  }
  return beam;
}

function boundedAlternatives(items, existing, width, relation) {
  const ordered = (items || []).slice().sort((left, right) => relation(right, existing) - relation(left, existing) || compareRefs(left, right));
  return takeFirst(ordered, width);
}

function keepBeam(candidates, width) {
  return takeFirst(candidates.sort((left, right) => candidateHint(right) - candidateHint(left) || candidateKey(left).localeCompare(candidateKey(right))), width);
}

function takeFirst(values, width) {
  const result = [];
  const limit = Math.max(0, Number(width) || 0);
  for (const value of values || []) {
    if (result.length >= limit) break;
    result.push(value);
  }
  return result;
}

function evenlySample(values, capacity) {
  const source = Array.isArray(values) ? values : [];
  const limit = Math.max(0, Math.min(source.length, Number(capacity) || 0));
  if (limit === 0) return [];
  if (limit === source.length) return source.slice();
  const result = [];
  for (let index = 0; index < limit; index += 1) {
    result.push(source[Math.floor(index * source.length / limit)]);
  }
  return result;
}

function selectDiversityReservoir(candidates, capacity) {
  const selected = [];
  const roleUse = new Map();
  for (const candidate of candidates) {
    if (selected.length >= capacity) break;
    const items = candidateItems(candidate);
    const repeated = items.filter((item) => roleUse.get(`${item.outfitSlot}:${item._id}`));
    if (repeated.length > 0 && selected.length < Math.min(8, capacity)) continue;
    selected.push(candidate);
    for (const item of items) roleUse.set(`${item.outfitSlot}:${item._id}`, true);
  }
  if (selected.length < Math.min(8, capacity)) {
    for (const candidate of candidates) {
      if (selected.length >= capacity) break;
      if (!selected.some((entry) => candidateKey(entry) === candidateKey(candidate))) selected.push(candidate);
    }
  }
  return selected;
}

function compatibleWithPartial(item, existing, compatibility, diagnostics) {
  for (const other of existing) if (relationScore(item, [other], compatibility, diagnostics) < 0) return false;
  return true;
}

function relationScore(item, existing, compatibility, diagnostics) {
  const list = Array.isArray(existing) ? existing : [];
  let score = Number(item._scoreHint || 0);
  for (const other of list) {
    const pairKey = [item._id, other._id].sort().join('|');
    if (!diagnostics._pairMemo) diagnostics._pairMemo = new Map();
    if (diagnostics._pairMemo.has(pairKey)) { diagnostics.pairMemoHits += 1; score += diagnostics._pairMemo.get(pairKey); continue; }
    const value = typeof compatibility === 'function' ? Number(compatibility(item, other)) : colorRelation(item, other, diagnostics);
    diagnostics._pairMemo.set(pairKey, Number.isFinite(value) ? value : 0);
    score += Number.isFinite(value) ? value : 0;
  }
  return score;
}

function colorRelation(left, right, diagnostics) {
  const a = colorName(left); const b = colorName(right);
  if (!a || !b) return 0;
  if (!diagnostics._colorMemo) diagnostics._colorMemo = new Map();
  const key = [a, b].sort().join('|');
  if (diagnostics._colorMemo.has(key)) { diagnostics.colorMemoHits += 1; return diagnostics._colorMemo.get(key); }
  const value = a === b ? 1 : (isNeutral(a) || isNeutral(b) ? 0.6 : -0.1);
  diagnostics._colorMemo.set(key, value);
  return value;
}

function classifyRole(item, facts) {
  const raw = String(facts?.normalizedCategoryFacts?.normalizedCategory || item?.category || '').toLowerCase();
  const text = itemText(item, null, facts).toLowerCase();
  if (/袜|sock/.test(text)) return 'socks';
  if (/手套|glove/.test(text)) return 'gloves';
  if (/围巾|scarf/.test(text)) return 'scarf';
  if (/帽|hat|cap/.test(text)) return 'hat';
  if (/包|bag/.test(text)) return 'bag';
  if (/腰带|belt/.test(text)) return 'belt';
  if (/项链|necklace/.test(text)) return 'necklace';
  if (/手链|bracelet/.test(text)) return 'bracelet';
  if (/手表|watch/.test(text)) return 'watch';
  if (raw === 'outerwear' || /外套|风衣|夹克|大衣|coat|jacket|blazer/.test(text)) return 'outerwear';
  if (raw === 'dress') return 'dress';
  if (raw === 'onepiece' || /连衣裙|连体|onepiece|dress/.test(text)) return 'onepiece';
  if (raw === 'shoes' || /鞋|靴|shoe|sneaker|loafer/.test(text)) return 'shoes';
  if (raw === 'skirt' || /裙|skirt/.test(text)) return 'skirt';
  if (raw === 'bottom' || /裤|pants|jeans|bottom/.test(text)) return 'bottom';
  if (raw === 'top' || /上衣|衬衫|t恤|卫衣|shirt|tee|sweater/.test(text)) return 'top';
  if (raw === 'accessory') return 'accessory';
  return '';
}

function roleGroup(role, sourceItem, facts) {
  if (CORE_ROLES.includes(role)) return 'core';
  if (!STRUCTURAL_ROLES.includes(role)) return 'accessory';
  if (!ACCESSORY_ROLES.includes(role) || role === 'outerwear' || role === 'gloves' || role === 'scarf') return 'structural';
  const text = itemText(sourceItem, null, facts).toLowerCase();
  return /保暖|防晒|防雨|功能|运动|thermal|weather|rain|sun|sport|functional/.test(text)
    ? 'structural'
    : 'accessory';
}
function toRef(sourceItem, slot, role, facts) { return { _id: readId(sourceItem), outfitSlot: slot, outfitRole: roleContract(role), _scoreHint: Number(sourceItem.scoreHint || sourceItem.fashionScore || 0), sourceItem, facts }; }
function roleContract(role) { return role === 'core' ? 'core' : role === 'structural' ? 'functional' : 'optional'; }
function readId(item) { return String(item?._id || item?.id || item?.clothingId || item?.itemId || '').trim(); }
function itemText(item, context, ref) { const source = ref?.sourceItem || item; const facts = context?.resolveItemFacts?.({ _id: readId(source) }); return String(facts?.itemText || source?.itemText || [source?.category, source?.subcategory, source?.subCategory, source?.customName, ...(Array.isArray(source?.styleTags) ? source.styleTags : [])].filter(Boolean).join(' ')); }
function colorName(item) { return String(item?.sourceItem?.colorPalette?.[0]?.name || item?.sourceItem?.colors?.[0] || '').toLowerCase(); }
function isNeutral(color) { return /黑|白|灰|米|棕|navy|black|white|gray|beige|brown/.test(color); }
function readTemperature(weather) {
  const raw = weather?.temp ?? weather?.temperature;
  if (raw === null || raw === undefined || raw === '') return Number.NaN;
  const value = Number(raw);
  return Number.isFinite(value) ? value : Number.NaN;
}
function isWeatherHardConflict(item, text, weather) { const temp = readTemperature(weather); if (!Number.isFinite(temp)) return false; return temp >= 28 && /羽绒|大衣|厚外套|down|heavy coat/.test(text) || temp <= 5 && /短袖|背心|短裤|凉鞋|t-shirt|shorts|sandal/.test(text); }
function compareRefs(left, right) { return String(left._id).localeCompare(String(right._id)); }
function candidateItems(candidate) {
  if (Array.isArray(candidate?.items)) return candidate.items;
  return (Array.isArray(candidate?.itemFactRefs) ? candidate.itemFactRefs : []).map((item) => ({
    _id: item.itemId,
    outfitSlot: item.slot,
    outfitRole: item.role,
  }));
}
function candidateKey(candidate) { return candidateItems(candidate).map((item) => item._id).sort().join('_'); }
function candidateHint(candidate) { return candidateItems(candidate).reduce((sum, item) => sum + Number(item._scoreHint || 0), 0); }
function compareCandidates(left, right) { return Number(right.score || 0) - Number(left.score || 0) || candidateKey(left).localeCompare(candidateKey(right)); }
function dedupeCandidates(candidates) { const seen = new Set(); return candidates.filter((candidate) => { const key = candidateKey(candidate); if (seen.has(key)) return false; seen.add(key); return true; }); }
function compactCandidate(candidate) {
  return {
    ...candidate,
    compositionVersion: HIERARCHICAL_SEARCH_VERSION,
    structureType: structureTypeFor(candidate),
    items: candidate.items.map((item) => ({ _id: item._id, outfitSlot: item.outfitSlot, outfitRole: item.outfitRole })),
  };
}

function structureTypeFor(candidate) {
  const slots = new Set(candidateItems(candidate).map((item) => item.outfitSlot));
  if (slots.has('onepiece') || slots.has('dress')) return 'onepiece_shoes';
  if (slots.has('skirt')) return 'separates_skirt_shoes';
  return 'separates_shoes';
}

module.exports = { ALL_ROLES, HIERARCHICAL_SEARCH_VERSION, ITEM_ROLES, buildRoleBuckets, deriveSearchBudget, hierarchicalOutfitSearch, rawCandidateKey: candidateKey, selectDiversityReservoir, structuralPolicy };
