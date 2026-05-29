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

const SCENE_TAGS: Record<string, string[]> = {
  居家: ['轻松好穿', '软糯舒服', '适合居家'],
  上班: ['干净利落', '简约得体', '适合通勤'],
  约会: ['温柔显气质', '柔和有细节', '自然有氛围'],
  运动: ['轻便好活动', '清爽透气', '自在舒展'],
};

const KEYWORD_TAGS = [
  { keywords: ['通勤', '上班', '正式', '利落', '职场'], tags: ['干净利落', '简约得体'] },
  { keywords: ['约会', '温柔', '甜美', '优雅'], tags: ['温柔显气质', '柔和有细节'] },
  { keywords: ['运动', '轻便', '活力', '户外'], tags: ['轻便好活动', '自在舒展'] },
  { keywords: ['清爽', '透气', '夏', '凉爽', '不闷'], tags: ['清爽透气', '清爽不闷'] },
  { keywords: ['休闲', '居家', '舒适', '日常'], tags: ['轻松好穿', '软糯舒服'] },
  { keywords: ['简约', '干净', '基础'], tags: ['简约耐看', '清爽干净'] },
];

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

export function getOutfitStyleTags(outfit: Outfit, index = 0) {
  const seed = getOutfitSeed(outfit, index);
  const explicitTags = normalizeTags(outfit.styleTags ?? []);
  const inferredTags = unique([
    ...getKeywordTags(`${outfit.reason ?? ''} ${outfit.reasoning ?? ''}`),
    ...getItemTags(outfit),
    ...getSceneTags(outfit, seed),
    ...getScoreTags(outfit),
  ]);

  return unique([...explicitTags, ...inferredTags]).slice(0, 3);
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

function getKeywordTags(text: string) {
  if (!text.trim()) return [];
  return KEYWORD_TAGS.flatMap((item) => (item.keywords.some((keyword) => text.includes(keyword)) ? item.tags : []));
}

function getItemTags(outfit: Outfit) {
  const itemText = [
    ...(outfit.items ?? []).map((item) => `${item.category ?? ''}${item.subcategory ?? ''}`),
    ...(outfit.snapshotItems ?? []).map((item) => `${item.category ?? ''}${item.type ?? ''}${item.name ?? ''}`),
  ].join(' ');

  const tags: string[] = [];
  if (/裙|连衣裙|半身裙/.test(itemText)) tags.push('轻盈显气质');
  if (/衬衫|西装|外套/.test(itemText)) tags.push('简约得体');
  if (/T恤|卫衣|针织|毛衣/.test(itemText)) tags.push('软糯舒服');
  if (/短裤|运动|鞋/.test(itemText)) tags.push('轻便好活动');
  return tags;
}

function getSceneTags(outfit: Outfit, seed: number) {
  const tags = SCENE_TAGS[getSceneLabel(outfit)] ?? [];
  if (tags.length === 0) return [];
  return [tags[seed % tags.length]!];
}

function getScoreTags(outfit: Outfit) {
  const scores = outfit.scores;
  if (!scores) return [];

  const tags: string[] = [];
  if ((scores.comfort ?? 0) >= 8.4) tags.push('轻松好穿');
  if ((scores.colorHarmony ?? 0) >= 8.4) tags.push('清爽耐看');
  if ((scores.sceneMatch ?? 0) >= 8.4) tags.push(`适合${getSceneLabel(outfit)}`);
  return tags;
}

function getItemCount(outfit: Outfit) {
  if (outfit.items?.length) return outfit.items.length;
  if (outfit.snapshotItems?.length) return outfit.snapshotItems.length;
  if (outfit.itemsSnapshot?.length) return outfit.itemsSnapshot.length;
  return outfit.clothingIds?.length ?? 0;
}

function getOutfitSeed(outfit: Outfit, index: number) {
  const source = outfit.outfitKey || outfit.id || outfit.clothingIds?.join('-') || String(index);
  return Math.abs(hashText(`${source}:${index}`));
}

function hashText(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return hash;
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
