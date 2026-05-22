// ============================================================
// 搭一搭 · 穿搭推荐规则引擎
// 基于天气/场景/用户偏好的智能穿搭匹配
// ============================================================

import type {
  ClothingCategory,
  SceneTag,
  Season,
  StyleTag,
  ColorInfo,
} from '@starter-template/types';
import type {
  OutfitScores,
  ScoreExplanation,
  OutfitItemSummary,
  WeatherSnapshot,
  RecommendationProfile,
} from '@starter-template/types';
import { DEFAULT_RECOMMENDATION_PROFILE } from '@starter-template/types';

// ── 内部类型 ─────────────────────────────────────────────────

/** 衣橱中的衣服（引擎内部使用） */
export interface WardrobeItem {
  id: string;
  category: ClothingCategory;
  subcategory?: string;
  colorPalette: ColorInfo[];
  styleTags: StyleTag[];
  seasonTags: Season[];
  material?: string;
  sceneTags: SceneTag[];
  imageUrl: string;
  thumbnailUrl?: string;
  customName?: string;
  thickness?: string;
  warmthScore?: number;
  coolnessScore?: number;
  fashionScore?: number;
  lastWornAt?: string;
  usageCount: number;
}

/** 推荐引擎输入 */
export interface RecommendEngineInput {
  /** 用户衣橱中的所有衣服 */
  wardrobe: WardrobeItem[];
  /** 用户偏好风格 */
  preferredStyles?: string[];
  /** 推荐偏好，不是用户性别；所有字段只参与软评分，不做硬过滤 */
  recommendationProfile?: RecommendationProfile;
  /** 天气快照 */
  weather?: WeatherSnapshot;
  /** 目标场景 */
  scene?: SceneTag;
  /** 时段 */
  timeOfDay?: 'morning' | 'afternoon' | 'evening' | 'all_day';
  /** 最近穿过的衣服 ID（用于去重） */
  recentlyWornIds?: string[];
  /** 本次请求需要排除的已展示衣物组合 */
  excludeClothingIdSets?: string[][];
  /** 最多返回几套 */
  maxResults?: number;
}

/** 推荐引擎输出（单套穿搭） */
export interface RecommendedOutfit {
  clothingIds: string[];
  items: OutfitItemSummary[];
  title: string;
  scene: SceneTag;
  scores: OutfitScores;
  scoreExplanations: ScoreExplanation[];
  reasoning: string;
}

// ── 温度-衣物映射 ────────────────────────────────────────────

type TemperatureRange = 'freezing' | 'cold' | 'cool' | 'mild' | 'warm' | 'hot';

interface TemperatureConfig {
  range: TemperatureRange;
  /** 该温度范围适合的季节标签 */
  seasons: Season[];
  /** 推荐的上衣子品类 */
  topSubcategories: string[];
  /** 推荐的下装子品类 */
  bottomSubcategories: string[];
  /** 推荐的鞋子子品类 */
  shoeSubcategories: string[];
  /** 保暖/清凉评分权重 */
  warmthWeight: number;
  coolnessWeight: number;
  /** 穿衣建议文案 */
  advice: string;
}

const TEMPERATURE_CONFIGS: TemperatureConfig[] = [
  {
    range: 'freezing',
    seasons: ['winter'],
    topSubcategories: ['down_jacket', 'sweater', 'vest', 'jacket'],
    bottomSubcategories: ['trousers', 'jeans', 'leggings'],
    shoeSubcategories: ['boots'],
    warmthWeight: 1.0,
    coolnessWeight: 0,
    advice: '天气寒冷，建议穿厚外套搭配毛衣和保暖裤',
  },
  {
    range: 'cold',
    seasons: ['winter', 'autumn'],
    topSubcategories: ['jacket', 'blazer', 'sweater', 'hoodie'],
    bottomSubcategories: ['trousers', 'jeans'],
    shoeSubcategories: ['boots', 'loafers'],
    warmthWeight: 0.8,
    coolnessWeight: 0.2,
    advice: '天气较冷，建议穿外套搭配长裤',
  },
  {
    range: 'cool',
    seasons: ['autumn', 'spring'],
    topSubcategories: ['hoodie', 'sweater', 'shirt', 'blazer'],
    bottomSubcategories: ['jeans', 'trousers', 'skirt'],
    shoeSubcategories: ['sneakers', 'loafers', 'flats'],
    warmthWeight: 0.5,
    coolnessWeight: 0.5,
    advice: '天气凉爽，建议穿薄外套或卫衣',
  },
  {
    range: 'mild',
    seasons: ['spring', 'autumn'],
    topSubcategories: ['shirt', 'tshirt', 'hoodie'],
    bottomSubcategories: ['jeans', 'trousers', 'skirt', 'shorts'],
    shoeSubcategories: ['sneakers', 'flats', 'loafers'],
    warmthWeight: 0.3,
    coolnessWeight: 0.7,
    advice: '温度适宜，穿着自由度较高',
  },
  {
    range: 'warm',
    seasons: ['summer', 'spring'],
    topSubcategories: ['tshirt', 'shirt'],
    bottomSubcategories: ['shorts', 'skirt', 'jeans', 'trousers'],
    shoeSubcategories: ['sneakers', 'sandals', 'flats'],
    warmthWeight: 0.1,
    coolnessWeight: 0.9,
    advice: '天气较热，建议穿轻薄透气的衣服',
  },
  {
    range: 'hot',
    seasons: ['summer'],
    topSubcategories: ['tshirt', 'shirt', 'vest'],
    bottomSubcategories: ['shorts', 'skirt'],
    shoeSubcategories: ['sandals', 'flats', 'sneakers'],
    warmthWeight: 0,
    coolnessWeight: 1.0,
    advice: '天气炎热，建议穿短袖短裤，注意防晒',
  },
];

function getTemperatureRange(temp: number): TemperatureRange {
  if (temp < 5) return 'freezing';
  if (temp < 15) return 'cold';
  if (temp < 20) return 'cool';
  if (temp < 26) return 'mild';
  if (temp < 32) return 'warm';
  return 'hot';
}

function getTemperatureConfig(temp: number): TemperatureConfig {
  const range = getTemperatureRange(temp);
  return TEMPERATURE_CONFIGS.find((c) => c.range === range) ?? TEMPERATURE_CONFIGS[3]!;
}

// ── 颜色搭配规则 ────────────────────────────────────────────

/** 颜色分类 */
type ColorFamily = 'neutral' | 'warm' | 'cool' | 'vivid';

interface ColorInfo2 {
  hex: string;
  family: ColorFamily;
  name: string;
}

/** 简化的颜色分类（基于 HSL 色相） */
function classifyColor(hex: string): ColorFamily {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min));

  // 低饱和度或极端亮度 → 中性色
  if (s < 0.15 || l < 0.15 || l > 0.85) return 'neutral';

  // 计算色相
  let h = 0;
  if (max === r) h = ((g - b) / (max - min)) % 6;
  else if (max === g) h = (b - r) / (max - min) + 2;
  else h = (r - g) / (max - min) + 4;
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  // 暖色：红/橙/黄 (0-60, 300-360)
  if (h < 60 || h >= 300) return 'warm';
  // 冷色：蓝/紫 (180-300)
  if (h >= 180 && h < 300) return 'cool';
  // 其余（绿/青）归为 vivid
  return 'vivid';
}

/** 评估颜色搭配和谐度 (0-10) */
function evaluateColorHarmony(colors: ColorInfo[]): number {
  if (colors.length === 0) return 5;
  if (colors.length === 1) return 8;

  const classified = colors.map((c) => ({
    hex: c.hex,
    family: classifyColor(c.hex),
    name: c.name,
  }));

  const families = classified.map((c) => c.family);
  const neutralCount = families.filter((f) => f === 'neutral').length;
  const uniqueFamilies = new Set(families.filter((f) => f !== 'neutral'));

  // 规则 1：中性色 + 1-2 个亮色 → 高分
  if (neutralCount >= 1 && uniqueFamilies.size <= 2) return 9;

  // 规则 2：全中性色 → 安全百搭
  if (uniqueFamilies.size === 0) return 8;

  // 规则 3：2-3 种颜色家族 → 较好
  if (uniqueFamilies.size <= 2) return 7;

  // 规则 4：颜色过多 → 扣分
  if (uniqueFamilies.size >= 4) return 4;

  return 6;
}

/** 生成颜色搭配评语 */
function getColorHarmonyText(score: number): string {
  if (score >= 9) return '色彩搭配和谐，简约大方';
  if (score >= 7) return '颜色搭配协调，视觉效果好';
  if (score >= 5) return '颜色搭配尚可，可以尝试更统一的配色';
  return '颜色种类较多，建议减少色彩数量';
}

function getWeatherAdaptationText(score: number, tempConfig: TemperatureConfig): string {
  if (score >= 8) return `${tempConfig.advice}，这一套和当前温度匹配度高`;
  if (score >= 6) return `${tempConfig.advice}，整体温度适配比较稳`;
  return `${tempConfig.advice}，但这套可能需要按体感增减单品`;
}

// ── 场景-风格映射 ────────────────────────────────────────────

const SCENE_STYLE_PREFERENCES: Record<string, StyleTag[]> = {
  '上班': ['简约', '通勤', '优雅'],
  '开会': ['通勤', '简约', '优雅'],
  '出游': ['休闲', '运动', '日系'],
  '约会': ['甜美', '优雅', '法式'],
  '逛街': ['休闲', '街头', '辣妹'],
  '居家': ['休闲', '日系'],
  '运动': ['运动', '休闲'],
  '正式': ['简约', '通勤', '优雅'],
  '聚会': ['辣妹', '街头', '复古'],
};

// ── 核心推荐引擎 ────────────────────────────────────────────

/**
 * 生成穿搭推荐
 */
export function generateRecommendations(input: RecommendEngineInput): RecommendedOutfit[] {
  const {
    wardrobe,
    preferredStyles = [],
    recommendationProfile = DEFAULT_RECOMMENDATION_PROFILE,
    weather,
    scene,
    recentlyWornIds = [],
    excludeClothingIdSets = [],
    maxResults = 3,
  } = input;

  if (wardrobe.length < 2) return [];

  const temp = weather?.temp ?? getDefaultTemp();
  const tempConfig = getTemperatureConfig(temp);
  const sceneStyles = scene ? (SCENE_STYLE_PREFERENCES[scene] ?? []) : [];
  const profileStyles = recommendationProfile.styleTags;
  const effectiveStyles =
    profileStyles.length > 0 ? profileStyles : preferredStyles.length > 0 ? preferredStyles : sceneStyles;

  // 1. 筛选衣服
  const filtered = filterClothes(wardrobe, tempConfig, scene, effectiveStyles, recentlyWornIds);
  if (filtered.length < 2) return [];

  // 2. 按品类分组
  const grouped = groupByCategory(filtered);

  // 3. 生成组合
  const combinations = generateCombinations(grouped, scene ?? '逛街');

  // 4. 评分排序
  const scored = combinations.map((combo) =>
    scoreOutfit(combo, tempConfig, effectiveStyles, scene, recommendationProfile),
  );

  // 5. 排序 + 去重 + 限制数量
  scored.sort((a, b) => {
    const scoreA = a.scores.total ?? (a.scores.fashion + a.scores.comfort + a.scores.sceneMatch + a.scores.colorHarmony) / 4;
    const scoreB = b.scores.total ?? (b.scores.fashion + b.scores.comfort + b.scores.sceneMatch + b.scores.colorHarmony) / 4;
    return scoreB - scoreA;
  });

  // 去重：确保每套穿搭至少有 1 件不同的衣服
  const results: RecommendedOutfit[] = [];
  const usedIdSets = new Set<string>();
  const excludedIdSets = new Set(excludeClothingIdSets.map(getClothingIdsSignature));

  for (const outfit of scored) {
    if (results.length >= maxResults) break;

    const idKey = getClothingIdsSignature(outfit.clothingIds);
    if (excludedIdSets.has(idKey)) continue;

    // 检查是否与已有结果重叠过多（超过 50% 衣服相同）
    const isTooSimilar = Array.from(usedIdSets).some((existingKey) => {
      const existingIds = new Set(existingKey.split('|'));
      const overlap = outfit.clothingIds.filter((id) => existingIds.has(id)).length;
      return overlap / Math.max(outfit.clothingIds.length, 1) > 0.5;
    });

    if (!isTooSimilar) {
      results.push(outfit);
      usedIdSets.add(idKey);
    }
  }

  return results;
}

function getClothingIdsSignature(clothingIds: string[]): string {
  return [...clothingIds].sort().join('|');
}

// ── 衣服筛选 ──────────────────────────────────────────────────

function filterClothes(
  wardrobe: WardrobeItem[],
  tempConfig: TemperatureConfig,
  scene?: SceneTag,
  preferredStyles?: string[],
  recentlyWornIds?: string[],
): WardrobeItem[] {
  const recentlySet = new Set(recentlyWornIds ?? []);

  return wardrobe.filter((item) => {
    // 排除最近穿过的
    if (recentlySet.has(item.id)) return false;

    // 季节匹配：衣服的 seasonTags 至少有一个在推荐季节中
    if (item.seasonTags.length > 0) {
      const seasonMatch = item.seasonTags.some((s) => tempConfig.seasons.includes(s));
      if (!seasonMatch) return false;
    }

    const thicknessValue = getItemThicknessValue(item);
    if ((tempConfig.range === 'hot' || tempConfig.range === 'warm') && thicknessValue >= 2.8) return false;
    if ((tempConfig.range === 'freezing' || tempConfig.range === 'cold') && thicknessValue <= 1.1) return false;

    // 场景匹配（加分项，不硬过滤）
    // 如果指定了场景且衣服有场景标签，优先选择匹配的
    // 这里不做硬过滤，因为很多衣服适合多场景

    return true;
  });
}

// ── 品类分组 ──────────────────────────────────────────────────

function groupByCategory(items: WardrobeItem[]): ClothingGroup {
  const groups: ClothingGroup = {
    top: [],
    bottom: [],
    onepiece: [],
    shoes: [],
    accessory: [],
    other: [],
  };

  for (const item of items) {
    const cat = item.category as keyof ClothingGroup;
    if (groups[cat]) {
      groups[cat].push(item);
    } else {
      groups.other.push(item);
    }
  }

  return groups;
}

// ── 组合生成 ──────────────────────────────────────────────────

interface ClothingGroup {
  top: WardrobeItem[];
  bottom: WardrobeItem[];
  onepiece: WardrobeItem[];
  shoes: WardrobeItem[];
  accessory: WardrobeItem[];
  other: WardrobeItem[];
}

function generateCombinations(
  groups: ClothingGroup,
  scene: SceneTag,
): Array<{ items: WardrobeItem[] }> {
  const combos: Array<{ items: WardrobeItem[] }> = [];
  const tops = groups.top.filter((item) => !isOuterwear(item));
  const outerwear = groups.top.filter(isOuterwear);
  const bottoms = groups.bottom.filter((item) => !isSkirt(item));
  const skirts = groups.bottom.filter(isSkirt);
  const onepieces = groups.onepiece.filter((item) => isDress(item) || item.category === 'onepiece');
  const shoes = groups.shoes;

  if (shoes.length === 0) return [];

  // 结构 1：上衣 + 下装 + 鞋子
  for (const top of tops.slice(0, 6)) {
    for (const bottom of bottoms.slice(0, 6)) {
      for (const shoe of shoes.slice(0, 4)) {
        combos.push({ items: [top, bottom, shoe] });
      }
    }
  }

  // 结构 2：上衣 + 下装 + 外套 + 鞋子
  for (const top of tops.slice(0, 5)) {
    for (const bottom of bottoms.slice(0, 5)) {
      for (const coat of outerwear.slice(0, 4)) {
        for (const shoe of shoes.slice(0, 3)) {
          combos.push({ items: [top, bottom, coat, shoe] });
        }
      }
    }
  }

  // 结构 3：连衣裙 + 外套 + 鞋子。没有外套时不强行生成，避免结构语义不清。
  for (const dress of onepieces.slice(0, 5)) {
    for (const coat of outerwear.slice(0, 4)) {
      for (const shoe of shoes.slice(0, 4)) {
        combos.push({ items: [dress, coat, shoe] });
      }
    }
  }

  // 结构 4：上衣 + 裙子 + 鞋子
  for (const top of tops.slice(0, 6)) {
    for (const skirt of skirts.slice(0, 5)) {
      for (const shoe of shoes.slice(0, 4)) {
        combos.push({ items: [top, skirt, shoe] });
      }
    }
  }

  return combos.slice(0, 80);
}

function isOuterwear(item: WardrobeItem): boolean {
  const text = `${item.category} ${item.subcategory ?? ''} ${item.customName ?? ''}`;
  return ['jacket', 'down_jacket', 'blazer', 'coat', 'trench', 'cardigan', '外套', '夹克', '西装', '羽绒服'].some(
    (hint) => text.includes(hint),
  );
}

function isSkirt(item: WardrobeItem): boolean {
  return `${item.subcategory ?? ''} ${item.customName ?? ''}`.includes('skirt') ||
    `${item.subcategory ?? ''} ${item.customName ?? ''}`.includes('裙');
}

function isDress(item: WardrobeItem): boolean {
  return `${item.subcategory ?? ''} ${item.customName ?? ''}`.includes('dress') ||
    `${item.subcategory ?? ''} ${item.customName ?? ''}`.includes('连衣裙');
}

// ── 评分系统 ──────────────────────────────────────────────────

function scoreOutfit(
  combo: { items: WardrobeItem[] },
  tempConfig: TemperatureConfig,
  preferredStyles: string[],
  scene?: SceneTag,
  recommendationProfile: RecommendationProfile = DEFAULT_RECOMMENDATION_PROFILE,
): RecommendedOutfit {
  const items = combo.items;
  const allColors = items.flatMap((i) => i.colorPalette ?? []);
  const allStyles = items.flatMap((i) => i.styleTags ?? []);
  const allScenes = items.flatMap((i) => i.sceneTags ?? []);

  const weatherAdaptationScore = calculateWeatherAdaptationScore(items, tempConfig);
  const colorHarmonyScore = applyPreferenceScore(
    evaluateColorHarmony(allColors),
    calculateColorPreferenceBoost(allColors, recommendationProfile.colorPreference),
  );
  const styleUnityScore = calculateStyleUnityScore(allStyles, preferredStyles);
  const sceneMatchScore = scene ? calculateSceneMatchScore(allScenes, scene) : 7;
  const freshnessScore = calculateFreshnessScore(items);
  const preferenceBoost = calculateRecommendationPreferenceBoost(items, allStyles, recommendationProfile);
  const preferenceScore = calculatePreferenceScore(items, allStyles, recommendationProfile);
  const comfortScore = calculateComfortScore(items, tempConfig);
  const warmthScore = calculateWarmthScore(items, tempConfig);
  const coolnessScore = calculateCoolnessScore(items, tempConfig);
  const totalScore = calculateWeightedTotal({
    weatherAdaptation: weatherAdaptationScore,
    colorHarmony: colorHarmonyScore,
    styleUnity: styleUnityScore,
    sceneMatch: sceneMatchScore,
    freshness: freshnessScore,
    preference: preferenceScore,
  });

  const scores: OutfitScores = {
    total: totalScore,
    weatherAdaptation: weatherAdaptationScore,
    styleUnity: styleUnityScore,
    freshness: freshnessScore,
    preference: preferenceScore,
    fashion: applyPreferenceScore(styleUnityScore, preferenceBoost.fashion),
    comfort: applyPreferenceScore(comfortScore, preferenceBoost.comfort),
    warmth: applyPreferenceScore(warmthScore, preferenceBoost.temperature),
    coolness: applyPreferenceScore(coolnessScore, preferenceBoost.temperature),
    sceneMatch: sceneMatchScore,
    colorHarmony: colorHarmonyScore,
  };

  // 生成评分解释
  const scoreExplanations: ScoreExplanation[] = [
    { dimension: 'total', score: scores.total ?? totalScore, text: `综合评分 ${(scores.total ?? totalScore).toFixed(1)}，优先考虑天气、配色和风格统一。` },
    { dimension: 'weatherAdaptation', score: weatherAdaptationScore, text: getWeatherAdaptationText(weatherAdaptationScore, tempConfig) },
    { dimension: 'fashion', score: scores.fashion, text: getFashionText(scores.fashion) },
    { dimension: 'comfort', score: scores.comfort, text: getComfortText(scores.comfort) },
    { dimension: 'sceneMatch', score: sceneMatchScore, text: getSceneMatchText(sceneMatchScore, scene) },
    { dimension: 'colorHarmony', score: colorHarmonyScore, text: getColorHarmonyText(colorHarmonyScore) },
    { dimension: 'freshness', score: freshnessScore, text: getFreshnessText(freshnessScore) },
    { dimension: 'preference', score: preferenceScore, text: getPreferenceText(preferenceScore) },
  ];

  if (tempConfig.warmthWeight > 0.5) {
    scoreExplanations.push({ dimension: 'warmth', score: warmthScore, text: getWarmthText(warmthScore) });
  } else if (tempConfig.coolnessWeight > 0.5) {
    scoreExplanations.push({ dimension: 'coolness', score: coolnessScore, text: getCoolnessText(coolnessScore) });
  }

  // 生成标题
  const title = generateTitle(items, scene);

  // AI 辅助位：当前用模板生成，后续可在这里接入 LLM 对候选结果润色，不参与选衣。
  const reasoning = generateTemplateReasoning({
    items,
    scene,
    tempConfig,
    scores,
  });

  // 构建返回数据
  const clothingIds = items.map((i) => i.id);
  const outfitItems: OutfitItemSummary[] = items.map((i) => ({
    clothingId: i.id,
    category: i.category,
    subcategory: i.subcategory,
    imageUrl: i.imageUrl,
    colorPalette: i.colorPalette,
  }));

  return {
    clothingIds,
    items: outfitItems,
    title,
    scene: scene ?? '逛街',
    scores,
    scoreExplanations,
    reasoning,
  };
}

// ── 评分计算函数 ────────────────────────────────────────────

/** 时尚度：风格统一性 + 偏好匹配 */
function calculateFashionScore(allStyles: StyleTag[], preferredStyles: string[]): number {
  if (allStyles.length === 0) return 5;

  // 如果有偏好风格，检查匹配度
  if (preferredStyles.length > 0) {
    const matchCount = allStyles.filter((s) => preferredStyles.includes(s)).length;
    const matchRatio = matchCount / Math.min(allStyles.length, preferredStyles.length);
    return Math.round(5 + matchRatio * 5); // 5-10
  }

  // 无偏好时，风格越统一越高分
  const uniqueStyles = new Set(allStyles);
  if (uniqueStyles.size === 1) return 9;
  if (uniqueStyles.size === 2) return 7;
  return 6;
}

function calculateRecommendationPreferenceBoost(
  items: WardrobeItem[],
  allStyles: StyleTag[],
  profile: RecommendationProfile,
) {
  const styleText = allStyles.join(' ');
  const itemText = items
    .flatMap((item) => [
      item.subcategory,
      item.material,
      item.customName,
      ...item.styleTags,
      ...item.sceneTags,
    ])
    .filter(Boolean)
    .join(' ');

  return {
    fashion:
      calculateGenderPreferenceBoost(styleText, profile.genderPreference) +
      calculateFitPreferenceBoost(itemText, profile.fitPreference) -
      calculateAvoidPenalty(`${styleText} ${itemText}`, profile.avoidTags),
    comfort: calculateFitComfortBoost(itemText, profile.fitPreference),
    temperature: calculateTemperatureSensitivityBoost(profile.temperatureSensitivity),
  };
}

/**
 * Recommendation direction only. This is not the user's gender identity,
 * and it must never filter clothing out. It only nudges ranking.
 */
function calculateGenderPreferenceBoost(
  styleText: string,
  preference: RecommendationProfile['genderPreference'],
) {
  if (preference === 'unknown' || preference === 'all') return 0;

  const maleStyleHints = ['工装', '街头', '运动', '美式复古', '中性', '简约'];
  const femaleStyleHints = ['甜美', '甜酷', '优雅', '法式', '韩系', '日系'];
  const neutralStyleHints = ['中性', '极简', 'Clean Fit', '简约', '休闲'];
  const hints =
    preference === 'male_style'
      ? maleStyleHints
      : preference === 'female_style'
        ? femaleStyleHints
        : neutralStyleHints;

  return hints.some((hint) => styleText.includes(hint)) ? 0.8 : 0;
}

function calculateFitPreferenceBoost(text: string, preference: RecommendationProfile['fitPreference']) {
  if (preference === 'unknown') return 0;
  const hints: Record<Exclude<RecommendationProfile['fitPreference'], 'unknown'>, string[]> = {
    loose: ['宽松', '休闲'],
    regular: ['合身', '简约', '通勤'],
    slim: ['修身', '优雅'],
    oversize: ['Oversize', '宽松', '街头'],
  };
  return hints[preference].some((hint) => text.includes(hint)) ? 0.6 : 0;
}

function calculateFitComfortBoost(text: string, preference: RecommendationProfile['fitPreference']) {
  if (preference === 'loose' || preference === 'oversize') {
    return text.includes('修身') ? -0.4 : 0.4;
  }
  if (preference === 'slim') {
    return text.includes('宽松') || text.includes('Oversize') ? -0.3 : 0.2;
  }
  return 0;
}

function calculateColorPreferenceBoost(colors: ColorInfo[], preference: string[]) {
  if (preference.length === 0 || colors.length === 0) return 0;
  const colorText = colors.map((color) => color.name).join(' ');
  const matched = preference.some((preferredColor) => colorText.includes(preferredColor));
  return matched ? 0.7 : 0;
}

function calculateAvoidPenalty(text: string, avoidTags: string[]) {
  if (avoidTags.length === 0) return 0;
  return Math.min(1.2, avoidTags.filter((tag) => text.includes(tag)).length * 0.6);
}

function calculateTemperatureSensitivityBoost(sensitivity: RecommendationProfile['temperatureSensitivity']) {
  if (sensitivity === 'cold_sensitive') return 0.4;
  if (sensitivity === 'heat_sensitive') return -0.2;
  return 0;
}

function applyPreferenceScore(score: number, boost: number) {
  return Math.max(0, Math.min(10, Math.round((score + boost) * 10) / 10));
}

function calculateWeightedTotal(scores: {
  weatherAdaptation: number;
  colorHarmony: number;
  styleUnity: number;
  sceneMatch: number;
  freshness: number;
  preference: number;
}) {
  const total =
    scores.weatherAdaptation * 0.3 +
    scores.colorHarmony * 0.2 +
    scores.styleUnity * 0.2 +
    scores.sceneMatch * 0.15 +
    scores.freshness * 0.1 +
    scores.preference * 0.05;

  return Math.round(total * 10) / 10;
}

function calculateWeatherAdaptationScore(items: WardrobeItem[], tempConfig: TemperatureConfig): number {
  const weatherSeasonScore = calculateSeasonScore(items, tempConfig);
  const thicknessScore = calculateThicknessScore(items, tempConfig);
  const temperatureShapeScore =
    tempConfig.warmthWeight >= tempConfig.coolnessWeight
      ? calculateWarmthScore(items, tempConfig)
      : calculateCoolnessScore(items, tempConfig);

  return Math.round(((weatherSeasonScore * 0.35 + thicknessScore * 0.35 + temperatureShapeScore * 0.3) * 10)) / 10;
}

function calculateSeasonScore(items: WardrobeItem[], tempConfig: TemperatureConfig): number {
  if (items.every((item) => item.seasonTags.length === 0)) return 7;

  const matched = items.filter(
    (item) => item.seasonTags.length === 0 || item.seasonTags.some((season) => tempConfig.seasons.includes(season)),
  ).length;

  return Math.max(3, Math.round((matched / Math.max(items.length, 1)) * 10));
}

function calculateThicknessScore(items: WardrobeItem[], tempConfig: TemperatureConfig): number {
  const target = getTargetThickness(tempConfig.range);
  const values = items.map(getItemThicknessValue);
  const avg = values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);
  const diff = Math.abs(avg - target);
  return Math.max(2, Math.round((10 - diff * 2.5) * 10) / 10);
}

function getTargetThickness(range: TemperatureRange): number {
  if (range === 'freezing') return 3;
  if (range === 'cold') return 2.6;
  if (range === 'cool') return 2.1;
  if (range === 'mild') return 1.7;
  if (range === 'warm') return 1.2;
  return 1;
}

function getItemThicknessValue(item: WardrobeItem): number {
  if (typeof item.warmthScore === 'number' && item.warmthScore > 0) {
    return Math.min(3, Math.max(1, item.warmthScore / 3.3));
  }

  const text = `${item.thickness ?? ''} ${item.subcategory ?? ''} ${item.material ?? ''}`;
  if (['厚', '羽绒', '羊毛', 'down_jacket', 'sweater', 'coat'].some((hint) => text.includes(hint))) return 3;
  if (['薄', '短袖', '背心', 'tshirt', 'vest', 'shorts', 'sandals'].some((hint) => text.includes(hint))) return 1;
  return 2;
}

function calculateStyleUnityScore(allStyles: StyleTag[], preferredStyles: string[]): number {
  if (allStyles.length === 0) return preferredStyles.length > 0 ? 5 : 7;

  const uniqueStyles = new Set(allStyles);
  const unityScore = uniqueStyles.size === 1 ? 9 : uniqueStyles.size === 2 ? 8 : uniqueStyles.size === 3 ? 6.5 : 5;

  if (preferredStyles.length === 0) return unityScore;

  const matchCount = allStyles.filter((style) => preferredStyles.includes(style)).length;
  const preferenceRatio = matchCount / Math.max(allStyles.length, 1);
  return Math.round((unityScore * 0.65 + (5 + preferenceRatio * 5) * 0.35) * 10) / 10;
}

function calculateFreshnessScore(items: WardrobeItem[]): number {
  if (items.length === 0) return 5;
  const usagePenalty = items.reduce((sum, item) => sum + Math.min(item.usageCount ?? 0, 10) * 0.25, 0);
  const recentPenalty = items.filter((item) => item.lastWornAt && isWithinDays(item.lastWornAt, 7)).length * 1.2;
  return Math.max(3, Math.round((9 - usagePenalty / items.length - recentPenalty) * 10) / 10);
}

function calculatePreferenceScore(
  items: WardrobeItem[],
  allStyles: StyleTag[],
  profile: RecommendationProfile,
): number {
  const text = items
    .flatMap((item) => [
      item.subcategory,
      item.material,
      item.customName,
      ...item.styleTags,
      ...item.sceneTags,
      ...item.colorPalette.map((color) => color.name),
    ])
    .filter(Boolean)
    .join(' ');
  const styleMatches = allStyles.filter((style) => profile.styleTags.includes(style)).length;
  const colorMatches = profile.colorPreference.filter((color) => text.includes(color)).length;
  const avoidMatches = profile.avoidTags.filter((tag) => text.includes(tag)).length;

  return Math.max(1, Math.min(10, Math.round((6 + styleMatches * 1.2 + colorMatches * 0.8 - avoidMatches * 1.5) * 10) / 10));
}

function isWithinDays(dateText: string, days: number): boolean {
  const time = new Date(dateText).getTime();
  if (Number.isNaN(time)) return false;
  return Date.now() - time <= days * 24 * 60 * 60 * 1000;
}

/** 舒适度：基于材质 */
function calculateComfortScore(items: WardrobeItem[], tempConfig: TemperatureConfig): number {
  const comfortableMaterials = ['棉', '麻', '针织', '混纺'];
  let score = 7; // 基础分

  for (const item of items) {
    if (item.material && comfortableMaterials.includes(item.material)) {
      score += 0.5;
    }
    // 羽毛/皮革在炎热天气不舒适
    if (tempConfig.coolnessWeight > 0.5 && (item.material === '羽绒' || item.material === '皮革')) {
      score -= 2;
    }
  }

  return Math.max(3, Math.min(10, Math.round(score)));
}

/** 保暖度 */
function calculateWarmthScore(items: WardrobeItem[], tempConfig: TemperatureConfig): number {
  const warmMaterials = ['羽绒', '羊毛', '皮革', '针织'];
  const warmCategories = ['down_jacket', 'jacket', 'blazer', 'sweater', 'vest'];
  let score = 5;

  for (const item of items) {
    if (item.material && warmMaterials.includes(item.material)) score += 1;
    if (warmCategories.includes(item.subcategory ?? '')) score += 1.5;
  }

  return Math.max(1, Math.min(10, Math.round(score)));
}

/** 清凉度 */
function calculateCoolnessScore(items: WardrobeItem[], tempConfig: TemperatureConfig): number {
  const coolMaterials = ['棉', '麻', '丝绸'];
  const coolCategories = ['tshirt', 'shirt', 'vest', 'shorts', 'skirt', 'sandals'];
  let score = 5;

  for (const item of items) {
    if (item.material && coolMaterials.includes(item.material)) score += 1;
    if (coolCategories.includes(item.subcategory ?? '')) score += 1.5;
    // 厚衣服扣分
    if (['down_jacket', 'jacket', 'sweater'].includes(item.subcategory ?? '')) score -= 2;
  }

  return Math.max(1, Math.min(10, Math.round(score)));
}

/** 场景匹配度 */
function calculateSceneMatchScore(allScenes: SceneTag[], targetScene: SceneTag): number {
  if (allScenes.length === 0) return 5;

  const matchCount = allScenes.filter((s) => s === targetScene).length;
  if (matchCount > 0) return 9;

  // 检查相关场景
  const relatedScenes: Record<string, SceneTag[]> = {
    '上班': ['开会', '正式'],
    '开会': ['上班', '正式'],
    '约会': ['聚会', '逛街'],
    '逛街': ['约会', '出游'],
    '出游': ['逛街', '运动'],
  };

  const related = relatedScenes[targetScene] ?? [];
  const relatedMatch = allScenes.filter((s) => related.includes(s)).length;
  if (relatedMatch > 0) return 7;

  return 5;
}

// ── 文案生成 ──────────────────────────────────────────────────

function generateTitle(items: WardrobeItem[], scene?: SceneTag): string {
  const categories = items.map((i) => i.category);
  const hasOnepiece = categories.includes('onepiece');

  if (hasOnepiece) {
    return '连体装搭配';
  }

  const scenePrefix = scene ? getSceneLabel(scene) : '';
  const stylePrefix = getStylePrefix(items);

  return `${scenePrefix}${stylePrefix}搭配`;
}

function getSceneLabel(scene: SceneTag): string {
  const labels: Record<string, string> = {
    '上班': '职场',
    '开会': '商务',
    '出游': '出游',
    '约会': '约会',
    '逛街': '街头',
    '居家': '居家',
    '运动': '运动',
    '正式': '正式',
    '聚会': '聚会',
  };
  return labels[scene] ?? '';
}

function getStylePrefix(items: WardrobeItem[]): string {
  const styles = items.flatMap((i) => i.styleTags ?? []);
  if (styles.includes('简约')) return '简约';
  if (styles.includes('休闲')) return '休闲';
  if (styles.includes('运动')) return '运动';
  if (styles.includes('优雅')) return '优雅';
  if (styles.includes('甜美')) return '甜美';
  if (styles.includes('街头')) return '街头';
  return '日常';
}

function getFashionText(score: number): string {
  if (score >= 9) return '风格高度统一，时尚感强';
  if (score >= 7) return '风格协调，穿搭有品味';
  if (score >= 5) return '风格尚可，可以更统一';
  return '风格较杂，建议选择同风格单品';
}

function getComfortText(score: number): string {
  if (score >= 9) return '材质舒适，适合全天穿着';
  if (score >= 7) return '穿着舒适';
  return '部分单品材质偏厚重';
}

function getSceneMatchText(score: number, scene?: string): string {
  if (score >= 9) return `非常适合${scene ?? '当前'}场景`;
  if (score >= 7) return `适合${scene ?? '当前'}场景`;
  return '场景适配度一般';
}

function getWarmthText(score: number): string {
  if (score >= 8) return '保暖性很好，适合当前温度';
  if (score >= 5) return '保暖性适中';
  return '保暖性不足，建议添加外套';
}

function getCoolnessText(score: number): string {
  if (score >= 8) return '清凉透气，适合当前温度';
  if (score >= 5) return '透气性适中';
  return '可能偏热，建议选择更轻薄的衣服';
}

function getFreshnessText(score: number): string {
  if (score >= 8) return '近期穿着频率低，有一点新鲜感';
  if (score >= 6) return '新鲜感适中，不会太重复';
  return '部分单品最近出现较多，可以作为备选';
}

function getPreferenceText(score: number): string {
  if (score >= 8) return '贴合你的风格和颜色偏好';
  if (score >= 6) return '基本符合你的偏好';
  return '偏好匹配一般，但可作为换风格尝试';
}

function generateTemplateReasoning(input: {
  items: WardrobeItem[];
  scene?: SceneTag;
  tempConfig: TemperatureConfig;
  scores: OutfitScores;
}): string {
  const itemNames = input.items.map((item) => item.customName || item.subcategory || item.category).join('、');
  const sceneText = input.scene ? `适合${input.scene}场景` : '适合日常场景';
  const weatherText =
    (input.scores.weatherAdaptation ?? 0) >= 8
      ? '温度适配比较稳'
      : '建议根据体感微调厚薄';
  const colorText =
    input.scores.colorHarmony >= 8 ? '配色干净协调' : '配色有层次但不算复杂';
  const styleText =
    (input.scores.styleUnity ?? input.scores.fashion) >= 8
      ? '风格统一'
      : '风格混搭感更明显';

  return `${itemNames} 组合完整，${sceneText}。${input.tempConfig.advice}，${weatherText}；${colorText}，${styleText}。`;
}

// ── 工具函数 ──────────────────────────────────────────────────

/** 获取默认温度（基于当前月份） */
function getDefaultTemp(): number {
  const month = new Date().getMonth() + 1;
  // 上海平均温度（近似）
  const monthlyTemps: Record<number, number> = {
    1: 4, 2: 6, 3: 10, 4: 16, 5: 21, 6: 26,
    7: 30, 8: 30, 9: 25, 10: 19, 11: 13, 12: 6,
  };
  return monthlyTemps[month] ?? 20;
}

/**
 * 将数据库衣服行转换为引擎内部格式
 */
export function toWardrobeItem(row: {
  id: string;
  category: string;
  subcategory: string | null;
  colorPalette: unknown;
  styleTags: unknown;
  seasonTags: unknown;
  material: string | null;
  sceneTags: unknown;
  imageUrl: string;
  thumbnailUrl: string | null;
  customName: string | null;
  thickness?: string | null;
  warmthScore?: number | null;
  coolnessScore?: number | null;
  fashionScore?: number | null;
  lastWornAt?: Date | string | null;
  usageCount: number | null;
}): WardrobeItem {
  return {
    id: row.id,
    category: row.category as ClothingCategory,
    subcategory: row.subcategory ?? undefined,
    colorPalette: (Array.isArray(row.colorPalette) ? row.colorPalette : []) as ColorInfo[],
    styleTags: (Array.isArray(row.styleTags) ? row.styleTags : []) as StyleTag[],
    seasonTags: (Array.isArray(row.seasonTags) ? row.seasonTags : []) as Season[],
    material: row.material ?? undefined,
    sceneTags: (Array.isArray(row.sceneTags) ? row.sceneTags : []) as SceneTag[],
    imageUrl: row.imageUrl,
    thumbnailUrl: row.thumbnailUrl ?? undefined,
    customName: row.customName ?? undefined,
    thickness: row.thickness ?? undefined,
    warmthScore: row.warmthScore ?? undefined,
    coolnessScore: row.coolnessScore ?? undefined,
    fashionScore: row.fashionScore ?? undefined,
    lastWornAt: row.lastWornAt instanceof Date ? row.lastWornAt.toISOString() : row.lastWornAt ?? undefined,
    usageCount: row.usageCount ?? 0,
  };
}
