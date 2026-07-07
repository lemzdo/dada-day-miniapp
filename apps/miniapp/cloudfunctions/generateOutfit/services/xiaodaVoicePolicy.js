const VOICE_POLICY_VERSION = 'xiaoda-voice-v1';

const USER_BENEFIT_CODES = [
  'HOT_DAY_LIGHT_AND_EASY',
  'HOT_DAY_EASY_TO_MOVE',
  'COOL_DAY_MORE_COVERED',
  'COLD_DAY_LAYERING_READY',
  'HOME_COMFORT_WITHOUT_LOOKING_SLOPPY',
  'HOME_READY_FOR_QUICK_OUTING',
  'WORK_CLEAN_WITHOUT_FEELING_STIFF',
  'WORK_EASY_TO_WEAR',
  'DATE_SOFT_AND_EASY',
  'DATE_HAS_A_CLEAR_HIGHLIGHT',
  'SPORT_EASY_TO_MOVE',
  'SPORT_LOOKS_ACTIVE',
  'EASY_TO_PUT_ON',
  'LOW_EFFORT_COHERENT_LOOK',
  'READY_FOR_CASUAL_OUTING',
  'NOT_TOO_DRESSED_UP',
  'EASY_FOR_EVERYDAY',
];

const MECHANICAL_VOICE_TERMS = [
  '克制',
  '稳定',
  '干净稳定',
  '比较稳定',
  '明显冲突',
  '基础单品',
  '延续休闲感',
  '更完整',
  '正式度接近',
  '视觉重量',
  '视觉关系',
  '色彩关系',
  '视觉重点',
  '完成度',
  '保持统一',
  '保持简单',
  '形成平衡',
  '增强层次',
  '整体有秩序',
  '主要观察点',
  '关系清楚',
  '主线',
  '清楚的亮点',
  '亮点已经落在',
  '更稳',
  '单品和单品',
  '想再明确一点',
];

const OVER_CUTE_TERMS = ['宝宝', '绝绝子', '拿捏'];
const UNSUPPORTED_SENSATION_TERMS = ['不闷', '透气', '保暖', '柔软', '软糯', '不勒', '亲肤', '吸汗'];

function deriveUserBenefitsV1(facts = {}, insights = [], context = {}) {
  const sourceItems = Array.isArray(facts.items) ? facts.items : [];
  const items = sourceItems
    .map((entry, index) => normalizeItem(entry, index))
    .sort((a, b) => `${a.slot}:${a.name}:${a.id}`.localeCompare(`${b.slot}:${b.name}:${b.id}`));
  const insightCodes = new Set((Array.isArray(insights) ? insights : []).map((entry) => entry && entry.code).filter(Boolean));
  const scene = normalizeScene(context.scene || facts.context?.scene);
  const temperatureBand = context.temperatureBand || facts.context?.temperatureBand || getTemperatureBand(context.weather || facts.context?.weather);
  const hasPatternCompetition = insightCodes.has('PATTERN_COMPETITION') || countPatterned(items) >= 2;
  const benefits = [];
  const add = (code, strength, sourceInsightCodes = [], subjectSlots = [], extraFacts = {}) => {
    if (!USER_BENEFIT_CODES.includes(code)) return;
    benefits.push({
      code,
      strength: clampStrength(strength),
      sourceInsightCodes: uniqueStrings(sourceInsightCodes).sort(),
      subjectSlots: uniqueStrings(subjectSlots).sort(compareSlot),
      facts: stripNonFinite(extraFacts),
    });
  };

  const hotItems = items.filter((entry) => isShortSleeve(entry) || isShortBottom(entry) || isLightThickness(entry) || isSportItem(entry));
  if (temperatureBand === 'hot' && hotItems.length > 0) {
    add('HOT_DAY_LIGHT_AND_EASY', 3, relatedInsights(insightCodes, ['WEATHER_THICKNESS_MATCH']), hotItems.map((entry) => entry.slot), {
      temperatureBand,
      items: hotItems.map(toBenefitFact),
    });
    if (items.some(isSportItem)) {
      add('HOT_DAY_EASY_TO_MOVE', 2, relatedInsights(insightCodes, ['STYLE_CASUAL_EASY']), items.filter(isSportItem).map((entry) => entry.slot), {
        temperatureBand,
        items: items.filter(isSportItem).map(toBenefitFact),
      });
    }
  }

  const coveredItems = items.filter((entry) => isOuterwear(entry) || isLongSleeve(entry) || isThick(entry));
  if (temperatureBand === 'cool' && coveredItems.length > 0) {
    add('COOL_DAY_MORE_COVERED', 2, relatedInsights(insightCodes, ['WEATHER_LAYERING_MATCH']), coveredItems.map((entry) => entry.slot), {
      temperatureBand,
      items: coveredItems.map(toBenefitFact),
    });
  }
  if (temperatureBand === 'cold' && (coveredItems.length > 0 || hasLayering(items))) {
    add('COLD_DAY_LAYERING_READY', 3, relatedInsights(insightCodes, ['WEATHER_LAYERING_MATCH']), coveredItems.map((entry) => entry.slot), {
      temperatureBand,
      items: coveredItems.map(toBenefitFact),
    });
  }

  const complete = hasCompleteOutfit(items);
  if (scene === '居家' && hasCasualItem(items) && complete) {
    add('HOME_COMFORT_WITHOUT_LOOKING_SLOPPY', 2, relatedInsights(insightCodes, ['SCENE_HOME_EASY']), items.map((entry) => entry.slot), { scene });
    add('HOME_READY_FOR_QUICK_OUTING', 3, relatedInsights(insightCodes, ['SCENE_HOME_EASY']), items.map((entry) => entry.slot), { scene });
  }
  if (scene === '上班' && (hasWorkItem(items) || hasFormalityFacts(items))) {
    add('WORK_CLEAN_WITHOUT_FEELING_STIFF', 2, relatedInsights(insightCodes, ['SCENE_WORK_CLEAN', 'FORMALITY_ALIGNED']), items.map((entry) => entry.slot), { scene });
    add('WORK_EASY_TO_WEAR', 2, relatedInsights(insightCodes, ['SCENE_WORK_CLEAN']), items.map((entry) => entry.slot), { scene });
  }
  if (scene === '约会') {
    if (hasSoftColors(items)) add('DATE_SOFT_AND_EASY', 2, relatedInsights(insightCodes, ['SCENE_DATE_SOFT']), items.map((entry) => entry.slot), { scene });
    if (hasSingleFocus(items, insightCodes)) add('DATE_HAS_A_CLEAR_HIGHLIGHT', 2, relatedInsights(insightCodes, ['PATTERN_SINGLE_FOCUS', 'DETAIL_SINGLE_FOCUS']), items.map((entry) => entry.slot), { scene });
  }
  if (scene === '运动' && (items.some(isSportItem) || insightCodes.has('SCENE_SPORT_ACTIVE'))) {
    add('SPORT_LOOKS_ACTIVE', 2, relatedInsights(insightCodes, ['SCENE_SPORT_ACTIVE']), items.map((entry) => entry.slot), { scene });
    if (items.some(isSportItem)) add('SPORT_EASY_TO_MOVE', 3, relatedInsights(insightCodes, ['SCENE_SPORT_ACTIVE']), items.filter(isSportItem).map((entry) => entry.slot), { scene });
  }

  const colorCount = uniqueStrings(items.flatMap((entry) => entry.colors)).length;
  if (colorCount > 0 && colorCount <= 2 && !hasPatternCompetition) {
    add('EASY_TO_PUT_ON', 2, relatedInsights(insightCodes, ['COLOR_LIGHT_NEUTRAL_BALANCE', 'STYLE_COHERENT']), items.map((entry) => entry.slot), { colorCount });
  }
  if (colorCount > 0 && colorCount <= 2 && !hasPatternCompetition && hasStyleCoherence(items, insightCodes)) {
    add('LOW_EFFORT_COHERENT_LOOK', 3, relatedInsights(insightCodes, ['STYLE_COHERENT', 'COLOR_LIGHT_NEUTRAL_BALANCE']), items.map((entry) => entry.slot), { colorCount });
  }
  if (hasCasualItem(items) || scene === '居家') add('READY_FOR_CASUAL_OUTING', 2, relatedInsights(insightCodes, ['STYLE_CASUAL_EASY']), items.map((entry) => entry.slot), { scene });
  if (items.some((entry) => Number.isFinite(entry.formalityLevel) && entry.formalityLevel <= 2) || scene === '居家') {
    add('NOT_TOO_DRESSED_UP', 2, relatedInsights(insightCodes, ['FORMALITY_CASUAL_BALANCE']), items.map((entry) => entry.slot), { scene });
  }
  if (complete && (hasCasualItem(items) || colorCount <= 2)) add('EASY_FOR_EVERYDAY', 2, relatedInsights(insightCodes, ['STYLE_CASUAL_EASY']), items.map((entry) => entry.slot), { scene });

  return dedupeBenefits(benefits);
}

function renderXiaodaTodayCopy({ facts = {}, insights = [], benefits = [], batchIndex = 0 } = {}) {
  const items = normalizedItems(facts);
  const top = findSlot(items, 'top') || items[0];
  const bottom = findSlot(items, 'bottom') || findSlot(items, 'skirt');
  const shoes = findSlot(items, 'shoes');
  const benefitCodes = new Set(benefits.map((entry) => entry.code));
  const insightCodes = new Set((Array.isArray(insights) ? insights : []).map((entry) => entry.code));

  if (benefitCodes.has('HOT_DAY_LIGHT_AND_EASY')) {
    return ensureXiaodaCopy(`今天温度高，${shortItemName(top)}配${shortItemName(bottom)}穿着更轻松${shoes ? `，${shortItemName(shoes)}也方便临时出门` : ''}。`, facts);
  }
  if (insightCodes.has('PATTERN_COMPETITION')) {
    return ensureXiaodaCopy(`${shortItemName(top)}和${shortItemName(bottom)}都很醒目，今天想穿得耐看一点，其他部分就适合简单些。`, facts);
  }
  if (benefitCodes.has('HOME_READY_FOR_QUICK_OUTING')) {
    return ensureXiaodaCopy(pickByIndex([
      `${shortItemName(top)}配${shortItemName(bottom)}够日常，待在家轻松，临时出门也不会显得随便。`,
      `待在家穿${shortItemName(top)}和${shortItemName(bottom)}不费心，临时下楼也还算利落。`,
      `${shortItemName(top)}和${shortItemName(bottom)}放在一起很轻松，今天居家和短暂出门都能用。`,
      `${shortItemName(top)}搭${shortItemName(bottom)}简单直接，居家穿不会太正式，也不显得随便。`,
      `今天在家穿${shortItemName(top)}和${shortItemName(bottom)}正合适，临时出门也不用重新换。`,
      `${shortItemName(top)}配${shortItemName(bottom)}很日常，待在家自在，出门拿快递也不突兀。`,
      `这身用${shortItemName(top)}和${shortItemName(bottom)}就够了，居家穿轻松，短暂外出也顺眼。`,
      `${shortItemName(bottom)}让${shortItemName(top)}更日常，今天在家或附近出门都能穿。`,
      `${shortItemName(top)}和${shortItemName(bottom)}不用刻意搭，今天待在家也能保持清爽。`,
      `居家时选${shortItemName(top)}配${shortItemName(bottom)}很省心，临时出门也不会乱。`,
    ], batchIndex), facts);
  }
  if (benefitCodes.has('WORK_CLEAN_WITHOUT_FEELING_STIFF')) {
    return ensureXiaodaCopy(`${shortItemName(top)}和${shortItemName(bottom)}都偏利落，上班穿清爽，也不会太紧绷。`, facts);
  }
  if (benefitCodes.has('DATE_HAS_A_CLEAR_HIGHLIGHT')) {
    return ensureXiaodaCopy(`${shortItemName(top)}是最抢眼的一件，其他单品简单些，约会时看起来柔和又有重点。`, facts);
  }
  if (benefitCodes.has('SPORT_EASY_TO_MOVE')) {
    return ensureXiaodaCopy(`${shortItemName(top)}配${shortItemName(bottom)}偏运动，${shoes ? `${shortItemName(shoes)}也` : ''}适合今天多走动。`, facts);
  }
  if (benefitCodes.has('LOW_EFFORT_COHERENT_LOOK')) {
    return ensureXiaodaCopy(`${shortItemName(top)}和${shortItemName(bottom)}颜色放在一起很顺眼，出门前不用多想。`, facts);
  }
  return ensureXiaodaCopy(fallbackToday(items, batchIndex), facts);
}

function renderXiaodaDetailCopy({ facts = {}, insights = [], benefits = [] } = {}) {
  const items = normalizedItems(facts);
  const top = findSlot(items, 'top') || items[0];
  const bottom = findSlot(items, 'bottom') || findSlot(items, 'skirt') || items[1];
  const shoes = findSlot(items, 'shoes');
  const hasAnyColor = uniqueStrings(items.flatMap((entry) => entry.colors)).length > 0;
  const benefitCodes = new Set(benefits.map((entry) => entry.code));
  const insightCodes = new Set((Array.isArray(insights) ? insights : []).map((entry) => entry.code));
  let first = hasAnyColor
    ? `${shortItemName(top)}和${shortItemName(bottom)}放在一起很日常，颜色不会互相抢。`
    : `${shortItemName(top)}和${shortItemName(bottom)}都是能确认的单品，组合起来比较日常。`;
  if (insightCodes.has('PATTERN_COMPETITION')) {
    first = `${shortItemName(top)}和${shortItemName(bottom)}都带图案，放在一起会比较热闹，所以其他部分要简单一点。`;
  } else if (insightCodes.has('PATTERN_FOCUS_WITH_SIMPLE_BOTTOM')) {
    first = `${shortItemName(top)}已经很抢眼，${shortItemName(bottom)}简单一点，整套有亮点但不会显得太乱。`;
  } else if (insightCodes.has('COLOR_NEUTRAL_BALANCES_ACCENT')) {
    first = `${shortItemName(top)}把${shortItemName(shoes || bottom)}的亮色压得刚刚好，有重点但不会太满。`;
  } else if (insightCodes.has('COLOR_SOFT_HARMONY')) {
    first = `${shortItemName(top)}和${shortItemName(bottom)}都偏浅，放在一起很柔和，看起来清爽。`;
  }

  let second = `今天这样穿不需要太费心，${sceneTail(facts)}。`;
  if (benefitCodes.has('HOT_DAY_LIGHT_AND_EASY')) {
    second = `今天温度比较高，短袖、短裤这类单品穿起来更轻松${shoes ? '，运动鞋也方便临时出门' : ''}。`;
  } else if (benefitCodes.has('HOME_READY_FOR_QUICK_OUTING')) {
    second = '待在家足够轻松，临时下楼或出门也不会显得随便。';
  } else if (benefitCodes.has('WORK_CLEAN_WITHOUT_FEELING_STIFF')) {
    second = '上班穿看起来清楚利落，又不会像刻意准备得太正式。';
  } else if (benefitCodes.has('SPORT_EASY_TO_MOVE')) {
    second = '如果今天要多走动，这样穿也比较顺手。';
  }
  return ensureXiaodaCopy(`${first}${second}`, facts);
}

function renderXiaodaStylistFallback({ facts = {}, insights = [], benefits = [], batchIndex = 0 } = {}) {
  const items = normalizedItems(facts);
  const top = findSlot(items, 'top') || items[0];
  const bottom = findSlot(items, 'bottom') || findSlot(items, 'skirt') || items[1];
  const shoes = findSlot(items, 'shoes');
  const benefitCodes = new Set(benefits.map((entry) => entry.code));
  const insightCodes = new Set((Array.isArray(insights) ? insights : []).map((entry) => entry.code));

  let overallComment = pickByIndex([
    `${shortItemName(top)}和${shortItemName(bottom)}放在一起很日常，属于不用多想就能穿出门的类型。`,
    `这套看起来轻松直接，${shortItemName(top)}和${shortItemName(bottom)}都不会让人觉得太刻意。`,
    `${shortItemName(top)}加${shortItemName(bottom)}是很顺手的日常组合，适合想简单一点的时候。`,
    `这套重点不复杂，${shortItemName(top)}和${shortItemName(bottom)}放在一起很容易穿出门。`,
    `${shortItemName(top)}和${shortItemName(bottom)}的搭法很省心，适合今天不想花太多时间纠结。`,
    `这身给人的感觉很放松，${shortItemName(top)}和${shortItemName(bottom)}都偏日常。`,
    `${shortItemName(top)}配${shortItemName(bottom)}不挑场景，待在家或附近走走都合适。`,
    `这套没有太多负担，${shortItemName(top)}和${shortItemName(bottom)}放在一起很自然。`,
    `${shortItemName(top)}和${shortItemName(bottom)}是容易穿好的组合，今天选它会比较省事。`,
    `这身看起来亲近日常，${shortItemName(top)}和${shortItemName(bottom)}都不会太用力。`,
  ], batchIndex);
  if (benefitCodes.has('HOT_DAY_LIGHT_AND_EASY')) {
    overallComment = `${shortItemName(top)}配${shortItemName(bottom)}很适合今天想穿得简单一点的时候，颜色清爽，出门也不费劲。`;
  } else if (insightCodes.has('PATTERN_COMPETITION')) {
    overallComment = `${shortItemName(top)}和${shortItemName(bottom)}都很有存在感，这套会更热闹，适合想让衣服有记忆点的时候。`;
  } else if (benefitCodes.has('WORK_CLEAN_WITHOUT_FEELING_STIFF')) {
    overallComment = `${shortItemName(top)}和${shortItemName(bottom)}看起来清楚利落，适合今天想穿得干净一点的时候。`;
  }

  const accentColor = firstAccentColor(items);
  const hasAnyColor = uniqueStrings(items.flatMap((entry) => entry.colors)).length > 0;
  const advice = accentColor
    ? pickByIndex([
        `想再有精神一点，可以让袜子或小包呼应${accentColor}。`,
        `想让亮点更集中一点，可以把小包或袜子选到${accentColor}附近。`,
      ], batchIndex)
    : shoes
      ? pickByIndex([
          `想再利落一点，可以让上衣或小包呼应${shortItemName(shoes)}里的颜色。`,
          `想多一点呼应，可以让袜子、小包或发饰靠近${shortItemName(shoes)}的颜色。`,
          `想让这套更有记忆点，可以在小包或袜子里带一点${shortItemName(shoes)}的颜色。`,
          `想再清楚一点，可以让帽子或小包跟${shortItemName(shoes)}里的颜色接上。`,
          `想让细节更有心思，可以用袜子轻轻接一下${shortItemName(shoes)}的颜色。`,
          `想临时出门更利落一点，可以让小包选到接近${shortItemName(shoes)}的颜色。`,
          `想少一点随意感，可以让上衣图案或配饰回应${shortItemName(shoes)}。`,
          `想让这身更像一套，可以在小配饰里带一点${shortItemName(shoes)}的颜色。`,
          `想增加一点小亮点，可以让袜子或发饰靠近${shortItemName(shoes)}的颜色。`,
          `想更耐看一点，可以让外层或小包和${shortItemName(shoes)}有一点呼应。`,
        ], batchIndex)
      : !hasAnyColor
        ? pickByIndex([
            '想再明确一点，可以补一双样子简单的鞋子，让这套更像能直接出门。',
            '想让这套更有重点，可以加一件款式简单的小外层。',
          ], batchIndex)
      : pickByIndex([
          `想再有重点一点，可以选一处小面积颜色来呼应上衣。`,
          `想再清楚一点，可以让鞋子或外层延续上衣的颜色方向。`,
        ], batchIndex);

  return {
    overallComment: ensureXiaodaCopy(overallComment, facts),
    advice: ensureXiaodaCopy(advice, facts),
    reviewVersion: 'stylist-explanation-v4',
    promptVersion: 'stylist-prompt-v4',
    copyPolicyVersion: 'human-copy-v1',
    voicePolicyVersion: VOICE_POLICY_VERSION,
  };
}

function findXiaodaVoicePolicyViolations(value) {
  const text = normalizeText(value);
  if (!text) return [];
  return uniqueStrings([...MECHANICAL_VOICE_TERMS, ...OVER_CUTE_TERMS, ...UNSUPPORTED_SENSATION_TERMS]
    .filter((term) => text.includes(term)));
}

function ensureXiaodaCopy(text, facts = {}) {
  const clean = cleanSentence(text);
  if (!clean || findXiaodaVoicePolicyViolations(clean).length > 0 || repeatsOverall(clean)) {
    return cleanSentence(fallbackToday(normalizedItems(facts), 0));
  }
  return clean;
}

function normalizedItems(facts = {}) {
  return (Array.isArray(facts.items) ? facts.items : []).map((entry, index) => normalizeItem(entry, index));
}

function normalizeItem(entry = {}, index = 0) {
  const colors = uniqueStrings(Array.isArray(entry.colors) ? entry.colors : [entry.primaryColor, entry.color].filter(Boolean));
  return {
    id: readString(entry.id || entry.clothingId || entry.itemId) || `item-${index}`,
    slot: readString(entry.slot || entry.category) || 'other',
    name: readString(entry.name || entry.subcategory || entry.category) || '单品',
    colors,
    styleTags: uniqueStrings(entry.styleTags || entry.styles || []),
    patternType: readString(entry.patternType),
    thickness: readString(entry.thickness),
    material: readString(entry.material),
    fit: readString(entry.fit || entry.silhouette),
    length: readString(entry.length),
    formalityLevel: Number.isFinite(Number(entry.formalityLevel)) ? Number(entry.formalityLevel) : null,
  };
}

function fallbackToday(items, index) {
  const first = items[index % Math.max(items.length, 1)] || items[0];
  const second = items.find((entry) => entry.id !== first?.id) || items[1];
  if (first && second) return `${shortItemName(first)}和${shortItemName(second)}组合简单，今天穿起来不用太费心。`;
  if (first) return `${shortItemName(first)}是这套里最明确的单品，今天先从简单日常穿起。`;
  return '这套信息还比较少，先按日常场景轻松穿就好。';
}

function pickByIndex(values, index = 0) {
  return values[Math.abs(index) % values.length] || values[0];
}

function cleanSentence(value) {
  const text = readString(value).replace(/\s+/g, '');
  if (!text) return '';
  return /[。！？]$/.test(text) ? text : `${text}。`;
}

function repeatsOverall(text) {
  return (text.match(/整体/g) || []).length > 1 || /A形成B|进一步强化|使整体更/.test(text);
}

function sceneTail(facts = {}) {
  const scene = normalizeScene(facts.context?.scene);
  if (scene === '居家') return '待在家或临时出门都合适';
  if (scene === '上班') return '上班通勤也能直接穿';
  if (scene === '约会') return '约会时看起来温和自然';
  if (scene === '运动') return '运动场景里也不突兀';
  return '日常出门也不突兀';
}

function shortItemName(item) {
  if (!item) return '单品';
  return readString(item.name)
    .replace('白色短袖T恤', '白T')
    .replace('印花T恤', '印花上衣')
    .replace('灰白下装', '灰色短裤');
}

function findSlot(items, slot) {
  return (items || []).find((entry) => entry.slot === slot);
}

function isShortSleeve(item) {
  return /短袖|T恤|T|tee/i.test(item.name) || /short/i.test(item.length);
}

function isShortBottom(item) {
  return item.slot === 'bottom' && (/短裤|短裙/.test(item.name) || /short/i.test(item.length));
}

function isLightThickness(item) {
  return /薄|轻薄|light|thin/i.test(item.thickness);
}

function isSportItem(item) {
  return /运动|sneaker|jogger|hoodie/i.test(`${item.name} ${item.styleTags.join(' ')}`) || item.slot === 'shoes' && /运动鞋/.test(item.name);
}

function isOuterwear(item) {
  return item.slot === 'outerwear' || /外套|大衣|夹克|羽绒|coat|jacket/i.test(item.name);
}

function isLongSleeve(item) {
  return /长袖|长裤|长裙|long/i.test(`${item.name} ${item.length}`);
}

function isThick(item) {
  return /厚|加绒|羽绒|wool|thick/i.test(`${item.name} ${item.thickness} ${item.material}`);
}

function hasLayering(items) {
  return items.some(isOuterwear) && items.some((entry) => ['top', 'onepiece'].includes(entry.slot));
}

function hasCompleteOutfit(items) {
  const hasTopAndBottom = items.some((entry) => entry.slot === 'top') && items.some((entry) => entry.slot === 'bottom' || entry.slot === 'skirt');
  return hasTopAndBottom || items.some((entry) => entry.slot === 'onepiece') || items.some((entry) => entry.slot === 'shoes');
}

function hasCasualItem(items) {
  return items.some((entry) => /休闲|运动|T恤|牛仔|短裤|卫衣/.test(`${entry.name} ${entry.styleTags.join(' ')}`));
}

function hasWorkItem(items) {
  return items.some((entry) => /通勤|衬衫|西裤|西装|乐福|皮鞋/.test(`${entry.name} ${entry.styleTags.join(' ')}`));
}

function hasFormalityFacts(items) {
  return items.some((entry) => Number.isFinite(entry.formalityLevel));
}

function hasSoftColors(items) {
  return items.some((entry) => entry.colors.some((color) => /粉|米|白|浅/.test(color)));
}

function hasSingleFocus(items, insightCodes) {
  return insightCodes.has('PATTERN_SINGLE_FOCUS') || insightCodes.has('PATTERN_FOCUS_WITH_SIMPLE_BOTTOM') || items.filter((entry) => isPatterned(entry.patternType)).length === 1;
}

function hasStyleCoherence(items, insightCodes) {
  if (insightCodes.has('STYLE_COHERENT')) return true;
  const tags = uniqueStrings(items.flatMap((entry) => entry.styleTags));
  return tags.length > 0 && tags.some((tag) => items.filter((entry) => entry.styleTags.includes(tag)).length >= 2);
}

function countPatterned(items) {
  return items.filter((entry) => isPatterned(entry.patternType)).length;
}

function isPatterned(value) {
  const text = readString(value).toLowerCase();
  return Boolean(text && !['solid', 'plain', 'none', '纯色'].includes(text));
}

function firstAccentColor(items) {
  const colors = uniqueStrings(items.flatMap((entry) => entry.colors));
  return colors.find((color) => !/白|灰|黑|米|卡其|棕/.test(color)) || '';
}

function toBenefitFact(item) {
  return {
    slot: item.slot,
    name: item.name,
    colors: item.colors,
    thickness: item.thickness,
  };
}

function relatedInsights(insightCodes, candidates) {
  return candidates.filter((code) => insightCodes.has(code));
}

function dedupeBenefits(benefits) {
  const byCode = new Map();
  for (const benefit of benefits) {
    const current = byCode.get(benefit.code);
    if (!current || benefit.strength > current.strength) byCode.set(benefit.code, benefit);
  }
  return Array.from(byCode.values()).sort((a, b) => USER_BENEFIT_CODES.indexOf(a.code) - USER_BENEFIT_CODES.indexOf(b.code));
}

function normalizeScene(value) {
  const text = readString(value).toLowerCase();
  return { home: '居家', work: '上班', date: '约会', sport: '运动', sports: '运动' }[text] || readString(value);
}

function getTemperatureBand(weather = {}) {
  const temp = Number(weather.temp ?? weather.temperature);
  if (!Number.isFinite(temp)) return '';
  if (temp < 12) return 'cold';
  if (temp < 22) return 'cool';
  if (temp <= 28) return 'mild';
  return 'hot';
}

function clampStrength(value) {
  return Math.max(1, Math.min(3, Math.round(Number(value) || 1)));
}

function compareSlot(a, b) {
  const order = ['top', 'outerwear', 'onepiece', 'bottom', 'skirt', 'shoes', 'accessory', 'other'];
  return (order.indexOf(a) === -1 ? 99 : order.indexOf(a)) - (order.indexOf(b) === -1 ? 99 : order.indexOf(b));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, '') : '';
}

function readString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueStrings(values) {
  const result = [];
  const seen = new Set();
  for (const value of values || []) {
    const text = readString(value);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}

function stripNonFinite(value) {
  if (Array.isArray(value)) return value.map(stripNonFinite);
  if (!value || typeof value !== 'object') return typeof value === 'number' && !Number.isFinite(value) ? null : value;
  const result = {};
  for (const [key, entry] of Object.entries(value)) result[key] = stripNonFinite(entry);
  return result;
}

module.exports = {
  MECHANICAL_VOICE_TERMS,
  UNSUPPORTED_SENSATION_TERMS,
  USER_BENEFIT_CODES,
  VOICE_POLICY_VERSION,
  deriveUserBenefitsV1,
  findXiaodaVoicePolicyViolations,
  renderXiaodaDetailCopy,
  renderXiaodaStylistFallback,
  renderXiaodaTodayCopy,
};
