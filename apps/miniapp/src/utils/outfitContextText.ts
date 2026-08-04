import type { Outfit } from '@starter-template/types';

export interface OutfitWeatherSummary {
  chip: string;
  title: string;
  tip: string;
}

export interface OutfitScoreLabel {
  label: string;
  value: number;
  text: string;
}

const STYLE_TAG_ALLOWLIST = ['休闲', '简约', '运动', '通勤', '甜美', '复古', '街头', '优雅'];
const PATTERN_TAGS: Record<string, string> = {
  graphic: '印花',
  floral: '印花',
  print: '印花',
  printed: '印花',
  solid: '纯色',
  plain: '纯色',
  stripe: '条纹',
  striped: '条纹',
  plaid: '格纹',
  check: '格纹',
};
const FIT_TAGS: Record<string, string> = {
  relaxed: '宽松',
  loose: '宽松',
  oversized: '宽松',
  straight: '利落',
  clean: '利落',
  fitted: '修身',
  slim: '修身',
  layered: '层次',
};
const SCENE_STRUCTURED_TAGS: Record<string, string> = {
  上班: '通勤',
  运动: '运动',
};

const TIME_OF_DAY_TEXT: Record<string, string> = {
  all_day: '全天舒适',
  morning: '适合上午',
  afternoon: '适合下午',
  evening: '适合晚上',
};

export function getSceneLabel(outfit: Outfit) {
  return outfit.scene ? String(outfit.scene) : '推荐';
}

export function getItemCountText(outfit: Outfit) {
  const count = getItemCount(outfit);
  return count > 0 ? `${count}件单品` : '多件单品';
}

export function getDateLabel(outfit: Outfit) {
  return formatTargetDate(outfit.targetDate);
}

export function getTimeLabel(outfit: Outfit) {
  return formatTimeOfDay(outfit.timeOfDay) || '全天舒适';
}

export function getOutfitStyleTags(outfit: Outfit, _index = 0) {
  // V6 presentation is a saved recommendation snapshot. Do not infer new tags
  // from live wardrobe items on a detail, favorite, or history read.
  return normalizeTags(outfit.styleTags ?? []);
}

export function getOutfitHighlight(outfit: Outfit, index = 0) {
  return getOutfitStyleTags(outfit, index)[0] || '适合全天';
}

export function getOutfitPrimaryContext(outfit: Outfit, index = 0) {
  return `今日${getSceneLabel(outfit)} · ${getOutfitHighlight(outfit, index)}`;
}

export function getOutfitSecondaryContext(outfit: Outfit) {
  return [getDateLabel(outfit), getTimeLabel(outfit)].filter(Boolean).join(' · ');
}

export function getOutfitWeatherSummary(outfit: Outfit): OutfitWeatherSummary {
  const weather = outfit.weatherSnapshot;
  const timeLabel = getTimeLabel(outfit);

  if (!weather) {
    return {
      chip: timeLabel,
      title: '按今日体感搭配',
      tip: '没有天气明细时，先按日常舒适度来搭，出门前再看一眼实时天气。',
    };
  }

  const temp = Math.round(weather.temp);
  const weatherText = weather.weather || '天气舒适';
  return {
    chip: `${temp}℃舒适`,
    title: `${temp}℃ · ${weatherText}`,
    tip: getWeatherTip(temp),
  };
}

export function getOutfitScoreLabels(outfit: Outfit): OutfitScoreLabel[] {
  const scores = outfit.scores;
  if (!scores) return [];

  return [
    { label: '舒适度', value: formatScore(scores.comfort), text: describeScore(scores.comfort) },
    { label: '场景适配', value: formatScore(scores.sceneMatch), text: describeScore(scores.sceneMatch) },
    { label: '时髦感', value: formatScore(scores.fashion), text: describeScore(scores.fashion) },
  ];
}

export function formatTimeOfDay(value?: string) {
  return value ? TIME_OF_DAY_TEXT[value] || '' : '';
}

function normalizeTags(tags: string[]) {
  return tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 3);
}

function getPatternTags(outfit: Outfit) {
  return getStructuredItems(outfit)
    .map((item) => PATTERN_TAGS[String(readNestedValue(item, 'aestheticFeatures.patternType') ?? item.patternType ?? '').toLowerCase()])
    .filter(isNonEmptyString);
}

function getFitTags(outfit: Outfit) {
  return getStructuredItems(outfit)
    .flatMap((item) => [
      FIT_TAGS[String(readNestedValue(item, 'aestheticFeatures.fit') ?? item.fit ?? '').toLowerCase()],
      FIT_TAGS[String(readNestedValue(item, 'aestheticFeatures.silhouette') ?? item.silhouette ?? '').toLowerCase()],
    ])
    .filter(isNonEmptyString);
}

function getSceneStructuredTag(outfit: Outfit) {
  return SCENE_STRUCTURED_TAGS[getSceneLabel(outfit)] ?? '';
}

function getStructuredItems(outfit: Outfit) {
  return [
    ...(outfit.items ?? []),
    ...(outfit.snapshotItems ?? []),
    ...(outfit.itemsSnapshot ?? []),
  ] as unknown as Array<Record<string, unknown>>;
}

function isNonEmptyString(value: string | undefined): value is string {
  return Boolean(value);
}

function readNestedValue(source: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((value, key) => {
    if (!value || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function getItemCount(outfit: Outfit) {
  if (outfit.items?.length) return outfit.items.length;
  if (outfit.snapshotItems?.length) return outfit.snapshotItems.length;
  if (outfit.itemsSnapshot?.length) return outfit.itemsSnapshot.length;
  return outfit.clothingIds?.length ?? 0;
}

function unique(values: string[]) {
  return values.filter((value, index, array) => Boolean(value) && array.indexOf(value) === index);
}

function formatTargetDate(value?: string) {
  if (!value || value === getToday()) return '今天推荐';

  const [, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  if (!month || !day) return '那天推荐';
  return `${Number(month)}月${Number(day)}日推荐`;
}

function getWeatherTip(temp: number) {
  if (temp >= 28) return '清爽透气更重要，今天穿不会太闷。';
  if (temp <= 10) return '注意保暖，层次稍厚一点会更稳妥。';
  if (temp <= 18) return '薄外套或稍厚单品更合适，早晚也舒服。';
  return '厚薄刚好，今天穿起来轻松不累。';
}

function describeScore(value: number) {
  const score = formatScore(value);
  if (score >= 8.6) return '很适合';
  if (score >= 7.4) return '还不错';
  return '可尝试';
}

function formatScore(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(10, Math.round(value * 10) / 10));
}

function getToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
