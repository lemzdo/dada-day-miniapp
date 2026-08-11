const STYLE_TAG_ALLOWLIST = new Set([
  '休闲', '简约', '运动', '通勤', '甜美', '复古', '街头', '优雅',
  '纯色', '印花', '条纹', '格纹', '宽松', '利落', '修身', '层次',
]);

const PRESENTATION_DIAGNOSTIC_KEY = '__presentationDiagnostic';

const {
  assignPresentationDifferentiators,
  applyPresentationPlan,
  buildPresentationFactModel,
  buildPresentationPlan,
  readPresentationPlan,
} = require('./presentationFactModel');
const { evaluateCopyNaturalness } = require('./copyNaturalnessGate');
const {
  BATCH_EDITORIAL_PASS,
  reviewBatchEditorialNaturalness,
  selectBatchEditorialCandidates,
} = require('./batchEditorialReview');

const SCENE_PREFIX = Object.freeze({
  home: '居家',
  work: '通勤',
  date: '约会',
  sport: '轻运动',
});

function canonicalizeRecommendationBatch(outfits, { scene } = {}) {
  const source = Array.isArray(outfits) ? outfits : [];
  const models = source.map((outfit) => buildPresentationFactModel({
    ...outfit,
    scene: normalizeScene(scene || outfit?.scene),
  }));
  const editorialSelection = selectBatchEditorialCandidates(models);
  const canonical = source.map((outfit, index) => canonicalizeRecommendation(outfit, {
    scene,
    model: models[index],
    selectedMessageCandidateId: editorialSelection.selectedCandidateIds[index],
  }));
  const editorialReview = reviewBatchEditorialNaturalness(
    canonical.map((outfit) => readPresentationPlan(outfit)?.reasonClaim?.copyPlan),
    editorialSelection.candidatePools,
  );
  if (editorialReview.result !== BATCH_EDITORIAL_PASS) {
    throw new Error(`batch editorial review failed: ${editorialReview.riskFlags.join(',')} ${JSON.stringify(editorialReview.metrics)}`);
  }
  canonical.forEach((outfit) => applyBatchEditorialReview(outfit, editorialReview));
  assertHomeQuickOutingRatio(canonical, scene);
  assertFinalPresentation(canonical, scene);
  return canonical;
}

function canonicalizeRecommendation(outfit, { scene, model, selectedDifferentiator, selectedMessageCandidateId } = {}) {
  if (!outfit || typeof outfit !== 'object' || Array.isArray(outfit)) return outfit;
  const sceneKey = normalizeScene(scene || outfit.scene);
  const factModel = model || buildPresentationFactModel({ ...outfit, scene: sceneKey });
  const assignedDifferentiator = selectedDifferentiator === undefined
    ? assignPresentationDifferentiators([factModel])[0]
    : selectedDifferentiator;
  const plan = buildPresentationPlan(factModel, {
    selectedDifferentiator: assignedDifferentiator,
    selectedMessageCandidateId,
  });
  if (plan.naturalnessGateResult !== 'PASS'
    || (plan.detailNaturalnessGateResult && plan.detailNaturalnessGateResult !== 'PASS')) {
    throw new Error(`copy naturalness gate failed: ${[
      ...(plan.naturalnessRiskFlags || []),
      ...(plan.detailNaturalnessRiskFlags || []),
    ].join(',')}`);
  }
  const tags = canonicalizeTags(outfit.styleTags, sceneKey);
  const next = {
    ...outfit,
    styleTags: tags,
  };
  applyPresentationPlan(next, factModel, plan);
  setPresentationDiagnostic(next, {
    model: factModel,
    plan,
    availableDifferentiators: factModel.availableDifferentiators,
    selectedDifferentiator: assignedDifferentiator,
  });
  return next;
}

function applyBatchEditorialReview(outfit, review) {
  if (!outfit || typeof outfit !== 'object' || Array.isArray(outfit)) return;
  const patch = {
    structuralNaturalnessVersion: review.version,
    structuralNaturalnessResult: review.result,
    structuralNaturalnessRiskFlags: review.riskFlags.slice(),
    structuralNaturalnessWarningFlags: review.warningFlags.slice(),
  };
  Object.assign(outfit, patch);
  if (outfit.copyContract && typeof outfit.copyContract === 'object') Object.assign(outfit.copyContract, patch);
  if (outfit.contentPlan && typeof outfit.contentPlan === 'object') Object.assign(outfit.contentPlan, patch);
  if (outfit.presentationPlan && typeof outfit.presentationPlan === 'object') Object.assign(outfit.presentationPlan, patch);
}

function buildCanonicalTitle(items, scene, outfit = {}) {
  const model = buildPresentationFactModel({ ...outfit, items, scene });
  return buildPresentationPlan(model).titleConcept;
}

function buildFactualTitleParts(items, outfit, scene) {
  const model = buildPresentationFactModel({ ...outfit, items, scene });
  return model.items.map((item) => item.canonicalSubtype).filter(Boolean);
}

function buildCanonicalTitleFacts(items, outfit = {}) {
  const model = buildPresentationFactModel({ ...outfit, items });
  const facts = Object.fromEntries(model.items.map((item) => [item.role, {
    subtype: item.canonicalSubtype,
    color: item.normalizedColor,
    label: `${item.normalizedColor || ''}${item.canonicalSubtype || item.canonicalName}`,
  }]));
  facts.relationCode = model.primaryRelationCode;
  facts.archetype = model.items.map((item) => item.role).join('+');
  return facts;
}

function factualItemLabel(item, category) {
  return [factualColorLabel(item), factualSubtypeLabel(item, category)]
    .filter(Boolean)
    .join('');
}

function factualSubtypeLabel(item, category) {
  const raw = [
    item?.subcategory,
    item?.subCategory,
    item?.name,
    item?.displayName,
    item?.customName,
    item?.shoeType,
    item?.type,
    item?.silhouette,
    item?.fit,
  ].filter((value) => typeof value === 'string' && value.trim()).join(' ').toLowerCase();
  const patterns = category === 'top'
    ? [[/tshirt|t_shirt|tee/, 'T恤'], [/\u886c\u886b|shirt|blouse/, '衬衫'], [/\u536b\u8863|hoodie|sweatshirt/, '卫衣'], [/\u9488\u7ec7|knit|sweater/, '针织上衣'], [/\u8fd0\u52a8|sport|active/, '运动上衣']]
    : category === 'bottom' || category === 'skirt'
      ? [[/\u77ed\u88e4|shorts/, '短裤'], [/\u725b\u4ed4|jeans|denim/, '牛仔裤'], [/\u76f4\u7b52|straight/, '直筒裤'], [/\u9614\u817f|wide.?leg/, '阔腿裤'], [/\u8fd0\u52a8|sport|jogger|sweatpants/, '运动裤'], [/\u534a\u8eab\u88d9|skirt/, '半身裙']]
      : category === 'shoes'
        ? [[/\u8dd1\u6b65|\u8fd0\u52a8|running|sneaker|sport/, '运动鞋'], [/\u5e06\u5e03|canvas/, '帆布鞋'], [/\u4e50\u798f|loafer/, '乐福鞋'], [/\u51c9\u978b|sandal/, '凉鞋']]
        : category === 'onepiece'
          ? [[/\u8fde\u8863\u88d9|dress|onepiece/, '连衣裙']]
          : [];
  const match = patterns.find(([pattern]) => pattern.test(raw));
  if (match) return match[1];
  // Keep unknown subtype text only when it is a short, stable, non-numeric
  // fact. IDs and fixture counters must never become user-visible copy.
  const subtype = String(item?.subcategory || item?.subCategory || '').trim();
  if (/^[a-z][a-z -]{1,24}$/i.test(subtype) && !/\b\d+\b/.test(subtype)) return subtype.toLowerCase();
  return '';
}

function factualColorLabel(item) {
  const values = [
    item?.color,
    item?.colorName,
    ...(Array.isArray(item?.colors) ? item.colors : []),
    ...(Array.isArray(item?.colorPalette) ? item.colorPalette : []),
  ];
  const raw = values.map((value) => {
    if (typeof value === 'string') return value.trim();
    return typeof value?.name === 'string' ? value.name.trim()
      : typeof value?.color === 'string' ? value.color.trim() : '';
  }).find(Boolean) || '';
  if (!raw || /#[0-9a-f]{3,8}/i.test(raw) || /\d/.test(raw)) return '';
  const normalized = raw.toLowerCase();
  const knownColors = [
    [/黑|black/, '黑色'],
    [/白|white|ivory|cream/, '白色'],
    [/灰|gray|grey/, '灰色'],
    [/藏青|navy/, '藏青色'],
    [/蓝|blue/, '蓝色'],
    [/棕|brown|camel/, '棕色'],
    [/米|beige|khaki/, '米色'],
    [/红|red|burgundy/, '红色'],
    [/绿|green/, '绿色'],
    [/黄|yellow/, '黄色'],
    [/紫|purple/, '紫色'],
    [/粉|pink/, '粉色'],
    [/橙|orange/, '橙色'],
  ];
  const match = knownColors.find(([pattern]) => pattern.test(normalized));
  if (match) return match[1];
  return /^[a-z][a-z -]{1,20}$/i.test(raw) ? raw.toLowerCase() : '';
}

function factualStructureLabel(value) {
  const structure = String(value || '').trim().toLowerCase();
  const labels = [
    [/onepiece\+shoes|dress\+shoes/, '连衣裙鞋履'],
    [/top\+bottom\+shoes/, '上衣下装鞋履'],
    [/top\+bottom/, '上衣下装'],
    [/top\+shoes/, '上衣鞋履'],
    [/bottom\+shoes/, '下装鞋履'],
    [/onepiece/, '连衣裙'],
    [/top/, '上衣'],
    [/bottom/, '下装'],
    [/shoes/, '鞋履'],
  ];
  return labels.find(([pattern]) => pattern.test(structure))?.[1] || '';
}

function factualIntentLabel(value, scene) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'home:quick_outing') return '临时出门';
  if (normalized === 'home:indoor_relax') return '室内放松';
  if (normalized === `${scene}:light_activity`) return '轻运动';
  if (normalized.endsWith(':light_activity')) return '轻运动';
  if (normalized.endsWith(':formal')) return '正式场景';
  return '';
}

function factualRelationLabel(value) {
  const code = String(value || '').trim().toUpperCase();
  const labels = {
    WORK_SHIRT_STRAIGHT_PANTS: '衬衫配直筒裤',
    SPORT_COMPLETE_SET: '运动完整',
    SPORT_LIGHT_ACTIVITY_SET: '轻运动',
  };
  return labels[code] || '';
}

function differentiatorRelationLabel(value) {
  const code = String(value || '').trim().toUpperCase();
  const labels = {
    HOME_HOT_SLEEVELESS_SHORTS: '无袖短裤',
    HOME_SLEEVELESS_SHORTS: '无袖短裤',
    HOME_HOT_SHORT_SLEEVE_SHORTS: '短袖短裤',
    HOME_SHORT_SLEEVE_SHORTS: '短袖短裤',
    HOME_PATTERN_TOP_SOLID_BOTTOM: '图案上衣配纯色下装',
    HOME_LOOSE_TWO_PIECE: '宽松上下装',
    HOME_TSHIRT_LOOSE_PANTS: 'T恤配宽松裤',
    HOME_SHORT_SLEEVE_LONG_PANTS: '短袖配长裤',
    HOME_TOP_LONG_PANTS: '上衣配长裤',
    HOME_LOOSE_DRESS: '宽松连衣裙',
    HOME_DRESS_NORMAL_SHOES: '连衣裙配日常鞋',
    HOME_COOL_LONG_SLEEVE: '长袖配下装',
    HOME_CASUAL_TWO_PIECE: '休闲上下装',
    WORK_SHIRT_STRAIGHT_PANTS: '衬衫配直筒裤',
    WORK_PATTERN_TOP_SOLID_BOTTOM: '图案上衣配纯色裤',
    WORK_SIMPLE_DRESS_SHOES: '简洁连衣裙配鞋',
    WORK_SIMPLE_TOP_PANTS_SHOES: '简洁上衣长裤配鞋',
    WORK_BASELINE_PRESENTABLE: '完整通勤搭配',
    WORK_HOT_SHORT_SLEEVE_PANTS: '短袖配长裤',
    WORK_COOL_LONG_SLEEVE_PANTS: '长袖配长裤',
    DATE_PATTERN_TOP_SIMPLE_SUPPORT: '图案上衣配简洁下装',
    DATE_PATTERN_DRESS_SIMPLE_SHOES: '图案连衣裙配简洁鞋',
    DATE_BRIGHT_TOP_BASIC_SUPPORT: '亮色上衣配基础色下装',
    DATE_BRIGHT_SHOES_BASIC_CLOTHES: '亮色鞋配简洁衣物',
    DATE_COLOR_COORDINATED: '上下装颜色呼应',
    DATE_SIMPLE_DRESS_SHOES: '简洁连衣裙配鞋',
    DATE_SIMPLE_COMPLETE: '简洁衣物配鞋',
    SPORT_COMPLETE_SET: '运动完整',
    SPORT_LIGHT_ACTIVITY_SET: '轻运动',
    SPORT_HOT_SLEEVELESS_SHORTS: '无袖运动短裤',
    SPORT_HOT_SHORT_SLEEVE_SHORTS: '短袖运动短裤',
    SPORT_COOL_OUTERWEAR: '运动外套配运动鞋',
    SPORT_COOL_LONG_SET: '长袖运动上衣配运动裤',
    SPORT_DRESS_SHOES: '运动连衣裙配运动鞋',
  };
  if (labels[code]) return labels[code];
  if (code === 'HOME_COLOR_COORDINATED' || code === 'WORK_COLOR_COORDINATED') return '上下装颜色呼应';
  return '';
}

function applyPresentationBatch(outfits) {
  // Compatibility shim only. Production canonicalization binds each card to
  // the plan created from its selected candidate; this legacy batch adapter
  // must never rebuild or overwrite that plan.
  return Array.isArray(outfits) ? outfits : [];
}

function applyBatchDifferentiatorCopy(outfits) {
  // Legacy compatibility adapter. Batch-level title/reason rewriting is
  // intentionally disabled; every visible field must come from its card plan.
  return Array.isArray(outfits) ? outfits : [];
}

function collectVaryingDimensionKeys(profiles) {
  const valuesByKey = new Map();
  for (const profile of Array.isArray(profiles) ? profiles : []) {
    for (const dimension of profile?.dimensions || []) {
      const values = valuesByKey.get(dimension.key) || new Set();
      values.add(dimension.value);
      valuesByKey.set(dimension.key, values);
    }
  }
  return new Set([...valuesByKey.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([key]) => key));
}

function setPresentationDiagnostic(outfit, diagnostic) {
  if (!outfit || typeof outfit !== 'object' || Array.isArray(outfit)) return;
  Object.defineProperty(outfit, PRESENTATION_DIAGNOSTIC_KEY, {
    value: diagnostic && typeof diagnostic === 'object' ? diagnostic : {},
    enumerable: false,
    configurable: true,
    writable: true,
  });
}

function readPresentationDiagnostic(outfit) {
  const value = outfit?.[PRESENTATION_DIAGNOSTIC_KEY];
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildDifferentiatorProfile(outfit, scene) {
  const items = readItems(outfit);
  const facts = buildCanonicalTitleFacts(items, outfit);
  const dimensions = [];
  const categories = ['onepiece', 'top', 'bottom', 'skirt', 'shoes'];
  for (const category of categories) {
    const itemFacts = facts[category];
    if (!itemFacts) continue;
    const itemLabel = itemFacts.label || categoryLabel(category);
    if (itemFacts.color) {
      dimensions.push({
        key: `${category}:color`,
        value: itemFacts.color,
        titleLabel: itemLabel,
        reasonLabel: itemLabel,
        priority: 0,
      });
    }
    if (itemFacts.subtype) {
      dimensions.push({
        key: `${category}:subtype`,
        value: itemFacts.subtype,
        titleLabel: itemFacts.subtype,
        reasonLabel: itemLabel,
        priority: 1,
      });
    }
  }

  const relation = differentiatorRelationLabel(facts.relationCode)
    || relationFactLabel(outfit?.copyContract?.coreEligibilityRelationFactIds);
  if (relation) {
    dimensions.push({
      key: 'relation',
      value: relation,
      titleLabel: relation,
      reasonLabel: relation,
      priority: 2,
    });
  }

  const archetype = factualStructureLabel(outfit?.archetype || outfit?.structureType)
    || factualStructureLabel(inferArchetype(items));
  if (archetype) {
    dimensions.push({
      key: 'archetype',
      value: archetype,
      titleLabel: archetype,
      reasonLabel: archetype,
      priority: 3,
    });
  }

  return {
    scene: normalizeScene(scene || outfit?.scene),
    dimensions,
  };
}

function selectDifferentiators(profiles) {
  const valuesByKey = new Map();
  for (const profile of profiles) {
    for (const dimension of profile?.dimensions || []) {
      const values = valuesByKey.get(dimension.key) || new Set();
      values.add(dimension.value);
      valuesByKey.set(dimension.key, values);
    }
  }
  const varyingKeys = [...valuesByKey.entries()]
    .filter(([, values]) => values.size > 1)
    .map(([key]) => key);
  const orderedDimensions = profiles.flatMap((profile) => profile?.dimensions || []);
  const orderedKeys = orderedDimensions
    .slice()
    .sort((left, right) => left.priority - right.priority || left.key.localeCompare(right.key))
    .map((dimension) => dimension.key)
    .filter((key, index, values) => varyingKeys.includes(key) && values.indexOf(key) === index) || [];
  return profiles.map((profile) => {
    if (orderedKeys.length === 0) return [];
    for (let size = 1; size <= orderedKeys.length; size += 1) {
      const combinations = combinationsOf(orderedKeys, size);
      for (const keys of combinations) {
        const current = findDimensions(profile, keys);
        if (current.length !== keys.length) continue;
        const signature = keys.map((key) => dimensionValue(profile, key)).join('|');
        const matches = profiles.filter((entry) => (
          keys.every((key) => dimensionValue(entry, key))
          && keys.map((key) => dimensionValue(entry, key)).join('|') === signature
        ));
        if (matches.length === 1) return current;
      }
    }
    return findDimensions(profile, orderedKeys);
  });
}

function findDimensions(profile, keys) {
  return keys.map((key) => (profile?.dimensions || []).find((dimension) => dimension.key === key)).filter(Boolean);
}

function dimensionValue(profile, key) {
  return (profile?.dimensions || []).find((dimension) => dimension.key === key)?.value || '';
}

function combinationsOf(values, size) {
  if (size === 0) return [[]];
  const result = [];
  for (let index = 0; index <= values.length - size; index += 1) {
    const head = values[index];
    for (const tail of combinationsOf(values.slice(index + 1), size - 1)) result.push([head, ...tail]);
  }
  return result;
}

function mergeDifferentiators(left, right) {
  const merged = [];
  for (const dimension of [...(left || []), ...(right || [])]) {
    if (!dimension || merged.some((entry) => entry.key === dimension.key)) continue;
    merged.push(dimension);
  }
  return merged.sort((a, b) => a.priority - b.priority || a.key.localeCompare(b.key));
}

function appendTitleDifferentiator(title, dimensions) {
  const base = readString(title);
  if (!base || !Array.isArray(dimensions) || dimensions.length === 0) return base;
  const labels = uniqueStrings(dimensions.map((dimension) => dimension.titleLabel))
    .filter((label) => label && !base.includes(label));
  if (labels.length === 0) return base;
  const suffix = labels.join('·');
  return base.endsWith('搭配')
    ? `${base.slice(0, -2)}·${suffix}${suffix.endsWith('搭配') ? '' : '搭配'}`
    : `${base}·${suffix}`;
}

function prependReasonDifferentiator(reason, dimensions, scene) {
  const base = readString(reason);
  if (!base || !Array.isArray(dimensions) || dimensions.length === 0) return base;
  const itemLabels = uniqueStrings(dimensions
    .filter((dimension) => dimension.key.includes(':'))
    .map((dimension) => dimension.reasonLabel));
  const relation = dimensions.find((dimension) => dimension.key === 'relation')?.reasonLabel;
  const archetype = dimensions.find((dimension) => dimension.key === 'archetype')?.reasonLabel;
  const prefix = itemLabels.length > 0
    ? `本套${itemLabels.join('、')}的组合`
    : relation
      ? `本套${relation}搭配`
      : archetype
        ? `本套${archetype}结构`
        : `${sceneLabel(scene)}场景搭配`;
  if (base.startsWith(`${prefix}，`) || base.startsWith(`${prefix}。`)) return base;
  return `${prefix}，${base}`;
}

function setCanonicalTitle(outfit, title) {
  const nextTitle = readString(title);
  if (!nextTitle) return;
  outfit.title = nextTitle;
  outfit.displayTitle = nextTitle;
}

function setCanonicalReason(outfit, reason) {
  const nextReason = readString(reason);
  if (!nextReason) return;
  outfit.reason = nextReason;
  outfit.reasoning = outfit.reasoning || nextReason;
  if (outfit.copyContract && typeof outfit.copyContract === 'object' && !Array.isArray(outfit.copyContract)) {
    outfit.copyContract = { ...outfit.copyContract, todayReason: nextReason };
  }
  if (outfit.contentPlan && typeof outfit.contentPlan === 'object' && !Array.isArray(outfit.contentPlan)) {
    outfit.contentPlan = {
      ...outfit.contentPlan,
      defaultTodayReason: nextReason,
      defaultCopy: outfit.contentPlan.defaultCopy && typeof outfit.contentPlan.defaultCopy === 'object'
        ? { ...outfit.contentPlan.defaultCopy, todayReason: nextReason }
        : outfit.contentPlan.defaultCopy,
    };
  }
}

function relationFactLabel(value) {
  const ids = Array.isArray(value) ? value : [];
  if (ids.includes('outfit:color_coordinated')) return '上下装颜色呼应';
  if (ids.includes('outfit:work_eligible')) return '通勤适配';
  return '';
}

function inferArchetype(items) {
  const categories = new Set(items.map(normalizeCategory));
  return ['onepiece', 'top', 'bottom', 'shoes']
    .filter((category) => categories.has(category))
    .join('+');
}

function categoryLabel(category) {
  return { onepiece: '连衣裙', top: '上衣', bottom: '下装', skirt: '半裙', shoes: '鞋子' }[category] || '单品';
}

function sceneLabel(scene) {
  return { home: '居家', work: '通勤', date: '约会', sport: '运动' }[normalizeScene(scene)] || '日常';
}

function groupByText(values, reader) {
  const groups = new Map();
  for (const value of values) {
    const text = readString(reader(value));
    if (!text) continue;
    const group = groups.get(text) || [];
    group.push(value);
    groups.set(text, group);
  }
  return groups;
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canonicalizeTags(tags, scene) {
  const normalized = uniqueStrings(Array.isArray(tags) ? tags : [])
    .filter((tag) => STYLE_TAG_ALLOWLIST.has(tag));
  const sceneTag = scene === 'work' ? '通勤' : scene === 'sport' ? '运动' : '';
  if (sceneTag && normalized.includes(sceneTag)) return normalized;
  return normalized;
}

function assertHomeQuickOutingRatio(outfits, scene) {
  if (normalizeScene(scene) !== 'home' || outfits.length === 0) return;
  const quickOutingCount = outfits.filter((outfit) => outfit?.sceneIntent === 'home:quick_outing').length;
  const allowed = Math.max(1, Math.ceil(outfits.length / 4));
  if (quickOutingCount > allowed) {
    throw new Error('home quick outing archetype ratio exceeded');
  }
}

function assertFinalPresentation(outfits) {
  const visible = Array.isArray(outfits) ? outfits : [];
  for (const outfit of visible) {
    if (!outfit || typeof outfit !== 'object' || Array.isArray(outfit) || readItems(outfit).length === 0) {
      throw new Error('canonical recommendation card structure invariant failed');
    }
    assertAuthorizedTitleFacts(outfit);
    const title = readVisibleTitle(outfit);
    const reason = readTodayReason(outfit);
    const existingPlan = readPresentationPlan(outfit);
    const model = existingPlan?.factModel || buildPresentationFactModel(outfit);
    const plan = existingPlan || buildPresentationPlan(model);
    const todayNaturalness = evaluateCopyNaturalness(plan.reasonClaim?.copyPlan);
    const detailNaturalness = plan.detailClaim?.copyPlan
      ? evaluateCopyNaturalness(plan.detailClaim.copyPlan)
      : null;
    const canonicalTitle = typeof outfit.title === 'string' ? outfit.title.trim() : '';
    const displayTitle = typeof outfit.displayTitle === 'string' ? outfit.displayTitle.trim() : '';
    if (!title || !canonicalTitle || !displayTitle || title !== canonicalTitle || title !== displayTitle
      || isPlaceholderTitle(title) || title !== plan.titleConcept) {
      throw new Error('canonical recommendation title invariant failed');
    }
    if (!Array.isArray(outfit?.styleTags) || outfit.styleTags.some((tag) => !STYLE_TAG_ALLOWLIST.has(tag))) {
      throw new Error('canonical recommendation tags invariant failed');
    }
    if (!reason || reason !== plan.reasonClaim.text || !outfit?.copyContract?.coreEligibilityReasonCode
      || plan.unsupportedClaims.length > 0) {
      throw new Error('canonical recommendation reason invariant failed');
    }
    if (existingPlan && outfit.copyContract && outfit.contentPlan) {
      const expectedSignature = plan.presentationFactSignature || '';
      const copyContract = outfit.copyContract || {};
      const contentPlan = outfit.contentPlan || {};
      if (copyContract.presentationFactSignature !== expectedSignature
        || contentPlan.presentationFactSignature !== expectedSignature
        || copyContract.primaryRelationCode !== plan.primaryRelationCode
        || contentPlan.primaryRelationCode !== plan.primaryRelationCode
        || outfit.todayReasonSource !== 'presentation_plan'
        || copyContract.todayReasonSource !== 'presentation_plan'
        || copyContract.source !== 'presentation_plan'
        || contentPlan.source !== 'presentation_plan'
        || copyContract.todayReason !== plan.todayReason
        || contentPlan.defaultTodayReason !== plan.todayReason
        || copyContract.detailExplanation !== plan.detailExplanation
        || contentPlan.defaultDetailExplanation !== plan.detailExplanation
        || copyContract.naturalnessGateVersion !== plan.naturalnessGateVersion
        || copyContract.naturalnessGateResult !== 'PASS'
        || !Array.isArray(copyContract.naturalnessRiskFlags)
        || copyContract.naturalnessRiskFlags.length > 0
        || todayNaturalness.result !== 'PASS'
        || (detailNaturalness && detailNaturalness.result !== 'PASS')
        || JSON.stringify(copyContract.todayCopyProvenance) !== JSON.stringify(plan.todayCopyProvenance)
        || JSON.stringify(copyContract.detailCopyProvenance) !== JSON.stringify(plan.detailCopyProvenance)
        || !xiaodaStyleInsightMatches(outfit, copyContract, contentPlan, plan)
        || !surfaceMetadataMatchesPlan(outfit, plan)
        || !surfaceMetadataMatchesPlan(copyContract, plan)
        || !surfaceMetadataMatchesPlan(contentPlan, plan)) {
        throw new Error('canonical recommendation presentation plan binding invariant failed');
      }
    }
  }
}

function xiaodaStyleInsightMatches(outfit, copyContract, contentPlan, plan) {
  const planInsight = plan?.xiaodaStyleInsight;
  const primaryCode = planInsight?.primary?.code;
  if (planInsight?.version !== 'xiaoda-style-insight-v3' || !primaryCode) return false;
  const values = [
    outfit?.xiaodaStyleInsight,
    copyContract?.xiaodaStyleInsight,
    contentPlan?.xiaodaStyleInsight,
    plan?.todayCopyProvenance?.xiaodaStyleInsight,
  ];
  if (!values.every((value) => value?.version === planInsight.version
    && value?.primary?.code === primaryCode)) return false;
  if (!plan?.detailExplanation) return !plan?.detailCopyProvenance?.text;
  const detailInsight = plan?.detailCopyProvenance?.xiaodaStyleInsight;
  return detailInsight?.version === planInsight.version
    && detailInsight?.primary?.code === primaryCode;
}

function surfaceMetadataMatchesPlan(source, plan) {
  return source.todayAction === plan.todayAction
    && source.todayDimension === plan.todayDimension
    && source.detailAction === plan.detailAction
    && source.detailDimension === plan.detailDimension
    && source.todaySentenceClusterId === null
    && source.detailSentenceClusterId === null
    && arraysEqual(source.todaySubjectItemIds, plan.todaySubjectItemIds)
    && arraysEqual(source.todayEvidenceFactIds, plan.todayEvidenceFactIds)
    && arraysEqual(source.detailSubjectItemIds, plan.detailSubjectItemIds)
    && arraysEqual(source.detailEvidenceFactIds, plan.detailEvidenceFactIds);
}

function arraysEqual(left, right) {
  return JSON.stringify(Array.isArray(left) ? left : []) === JSON.stringify(Array.isArray(right) ? right : []);
}

function assertAuthorizedTitleFacts(outfit) {
  const titleFacts = getTitleFactNames(outfit);
  const records = readItems(outfit).flatMap((item) => [
    ...(Array.isArray(item?.factRecords) ? item.factRecords : []),
    ...(Array.isArray(item?.factEvidence) ? item.factEvidence : []),
    ...(Array.isArray(item?.factsWithSource) ? item.factsWithSource : []),
  ]);
  for (const fact of titleFacts) {
    const matching = records.filter((record) => normalizeFactName(record?.fact || record?.factId) === fact);
    if (matching.length > 0 && matching.every((record) => record?.authorized === false)) {
      throw new Error('canonical recommendation title authorization invariant failed');
    }
  }
}

function getTitleFactNames(outfit) {
  const items = readItems(outfit);
  const facts = new Set(['category']);
  if (items.some((item) => factualColorLabel(item))) facts.add('color');
  for (const item of items) {
    const category = normalizeCategory(item);
    const raw = [
      item?.subcategory,
      item?.subCategory,
      item?.shoeType,
      item?.type,
      item?.silhouette,
      item?.fit,
    ].filter((value) => typeof value === 'string' && value.trim()).join(' ').toLowerCase();
    if (category === 'onepiece') facts.add('dress');
    if (category === 'top' && /衬衫|衬衣|shirt|blouse/.test(raw)) facts.add('shirt');
    if (category === 'top' && /运动|sport|active/.test(raw)) facts.add('sport_top');
    if ((category === 'bottom' || category === 'skirt') && /短裤|shorts/.test(raw)) facts.add('shorts');
    if ((category === 'bottom' || category === 'skirt') && /运动|jogger|sweatpants/.test(raw)) facts.add('sport_bottom');
    if (category === 'shoes' && /跑步|运动|running|sneaker|sport/.test(raw)) facts.add('sport_shoe');
  }
  return facts;
}

function normalizeFactName(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  const match = /^item:[^:]+:(.+)$/.exec(text);
  return match ? match[1] : text;
}

function diversifyTodayReasons(outfits) {
  // Kept as a compatibility adapter for callers from V6. It must never alter
  // canonical copy or append a synthetic sequence suffix.
  return Array.isArray(outfits) ? outfits.slice() : [];
}

function readItems(outfit) {
  if (Array.isArray(outfit?.items) && outfit.items.length > 0) return outfit.items;
  if (Array.isArray(outfit?.snapshotItems) && outfit.snapshotItems.length > 0) return outfit.snapshotItems;
  if (Array.isArray(outfit?.itemsSnapshot)) return outfit.itemsSnapshot;
  return [];
}

function readTodayReason(outfit) {
  const value = outfit?.copyContract?.todayReason || outfit?.todayReason || outfit?.reason;
  return typeof value === 'string' ? value.trim() : '';
}

function readVisibleTitle(outfit) {
  const value = outfit?.displayTitle || outfit?.userTitle || outfit?.title;
  return typeof value === 'string' ? value.trim() : '';
}

function isUsableVisibleTitle(value) {
  return typeof value === 'string' && value.trim() && !isPlaceholderTitle(value) && !hasRepeatedTitleToken(value);
}

function isPlaceholderTitle(value) {
  return /关系组合|完整标题|默认标题|今日搭配|推荐组合|日常搭配/.test(String(value || ''));
}

function normalizePresentationText(value) {
  return String(value || '')
    .trim()
    .replace(/(?:[（(]\s*\d+\s*[）)]|第\s*\d+\s*[套组款]?|[-—]\s*\d+)\s*$/u, '')
    .replace(/[\s\p{P}\p{S}]+/gu, '')
    .toLowerCase();
}

function hasSyntheticSuffix(value) {
  return /(?:[（(]\s*\d+\s*[）)]|第\s*\d+\s*[套组款]?|[-—]\s*\d+)\s*$/u.test(String(value || '').trim());
}

function hasRepeatedTitleToken(value) {
  const title = String(value || '');
  return /连衣裙连衣裙|上衣上衣|下装下装|组合组合/.test(title)
    || /(.{2,8})\1/.test(title.replace(/[，。·\s]/g, ''));
}

function normalizeCategory(item) {
  const raw = String(item?.category || item?.outfitSlot || item?.slot || '').toLowerCase();
  if (raw === 'onepiece' || /连衣裙|dress|onepiece/.test(`${raw} ${item?.subcategory || item?.subCategory || ''}`.toLowerCase())) return 'onepiece';
  if (raw === 'skirt' || /裙|skirt/.test(`${raw} ${item?.subcategory || item?.subCategory || ''}`.toLowerCase())) return 'skirt';
  if (raw === 'bottom' || /裤|下装|bottom|pants|shorts/.test(`${raw} ${item?.subcategory || item?.subCategory || ''}`.toLowerCase())) return 'bottom';
  if (raw === 'top' || /上衣|衬衫|t恤|shirt|tee|top/.test(`${raw} ${item?.subcategory || item?.subCategory || ''}`.toLowerCase())) return 'top';
  return raw;
}

function normalizeScene(scene) {
  const value = String(scene || '').trim().toLowerCase();
  if (value === '居家' || value === 'home') return 'home';
  if (value === '上班' || value === '通勤' || value === 'work') return 'work';
  if (value === '约会' || value === 'date') return 'date';
  if (value === '运动' || value === 'sport') return 'sport';
  return value || 'home';
}

function uniqueStrings(values) {
  return [...new Set(values
    .filter((value) => typeof value === 'string' && value.trim())
    .map((value) => value.trim()))];
}

module.exports = {
  PRESENTATION_DIAGNOSTIC_KEY,
  STYLE_TAG_ALLOWLIST,
  buildPresentationFactModel,
  buildPresentationPlan,
  assertFinalPresentation,
  assertHomeQuickOutingRatio,
  buildCanonicalTitle,
  buildCanonicalTitleFacts,
  canonicalizeRecommendation,
  canonicalizeRecommendationBatch,
  canonicalizeTags,
  diversifyTodayReasons,
  hasRepeatedTitleToken,
  isPlaceholderTitle,
  hasSyntheticSuffix,
  normalizePresentationText,
  readTodayReason,
};
