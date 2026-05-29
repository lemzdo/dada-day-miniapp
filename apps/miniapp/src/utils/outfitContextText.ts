import type { Outfit } from '@starter-template/types';

const SCENE_HIGHLIGHTS: Record<string, string[]> = {
  居家: ['软糯舒服', '轻松耐看', '清爽不闷', '松弛自然'],
  上班: ['干净利落', '简约得体', '清爽精神', '稳妥耐看'],
  约会: ['温柔显气质', '柔和有细节', '轻盈耐看', '自然有氛围'],
  运动: ['轻便好活动', '清爽不闷', '活力轻盈', '自在舒展'],
};

const TAG_HIGHLIGHTS = [
  { keywords: ['通勤', '正式', '利落', '职场'], labels: ['干净利落', '简约得体'] },
  { keywords: ['约会', '温柔', '甜美', '优雅'], labels: ['温柔显气质', '柔和有细节'] },
  { keywords: ['运动', '轻便', '活力', '户外'], labels: ['轻便好活动', '活力轻盈'] },
  { keywords: ['清爽', '透气', '夏', '凉爽'], labels: ['清爽不闷', '清爽干净'] },
  { keywords: ['休闲', '居家', '舒适', '日常'], labels: ['轻松耐看', '松弛自然'] },
  { keywords: ['简约', '干净', '基础'], labels: ['清爽干净', '简约耐看'] },
];

const TIME_OF_DAY_TEXT: Record<string, string> = {
  all_day: '全天都适合',
  morning: '适合上午',
  afternoon: '适合下午',
  evening: '适合晚上',
};

export function getOutfitHighlight(outfit: Outfit, index = 0) {
  const seed = getOutfitSeed(outfit, index);
  const styleCandidates = unique(getStyleTagHighlights(outfit, seed));
  if (styleCandidates.length > 0) return styleCandidates[seed % styleCandidates.length]!;

  const candidates = unique([
    ...getSceneHighlights(outfit, seed),
    ...getReasonHighlights(outfit, seed),
    ...getScoreHighlights(outfit),
    ...getItemHighlights(outfit),
  ]);

  return candidates[seed % Math.max(candidates.length, 1)] || '适合全天';
}

export function getOutfitPrimaryContext(outfit: Outfit, index = 0) {
  const sceneLabel = outfit.scene ? `今日${outfit.scene}` : '今日推荐';
  return `${sceneLabel} · ${getOutfitHighlight(outfit, index)}`;
}

export function getOutfitSecondaryContext(outfit: Outfit) {
  return [formatTargetDate(outfit.targetDate), formatTimeOfDay(outfit.timeOfDay)].filter(Boolean).join(' · ');
}

export function formatTimeOfDay(value?: string) {
  return value ? TIME_OF_DAY_TEXT[value] || '' : '';
}

function getStyleTagHighlights(outfit: Outfit, seed: number) {
  const text = (outfit.styleTags ?? []).join(' ');
  if (!text) return [];
  return TAG_HIGHLIGHTS.filter((item) => item.keywords.some((keyword) => text.includes(keyword))).map(
    (item) => item.labels[seed % item.labels.length]!,
  );
}

function getReasonHighlights(outfit: Outfit, seed: number) {
  const text = `${outfit.reason ?? ''} ${outfit.reasoning ?? ''}`;
  if (!text.trim()) return [];
  return TAG_HIGHLIGHTS.filter((item) => item.keywords.some((keyword) => text.includes(keyword))).map(
    (item) => item.labels[seed % item.labels.length]!,
  );
}

function getScoreHighlights(outfit: Outfit) {
  const scores = outfit.scores;
  if (!scores) return [];

  const highlights: string[] = [];
  if ((scores.comfort ?? 0) >= 8.4) highlights.push('轻松耐看');
  if ((scores.colorHarmony ?? 0) >= 8.4) highlights.push('清爽干净');
  if ((scores.sceneMatch ?? 0) >= 8.4) highlights.push('很合场景');
  if ((scores.fashion ?? 0) >= 8.4) highlights.push('自然有氛围');
  return highlights;
}

function getItemHighlights(outfit: Outfit) {
  const itemText = [
    ...(outfit.items ?? []).map((item) => `${item.category ?? ''}${item.subcategory ?? ''}`),
    ...(outfit.snapshotItems ?? []).map((item) => `${item.category ?? ''}${item.type ?? ''}${item.name ?? ''}`),
  ].join(' ');

  const highlights: string[] = [];
  if (/裙|连衣裙|半身裙/.test(itemText)) highlights.push('轻盈显气质');
  if (/衬衫|西装|外套/.test(itemText)) highlights.push('简约得体');
  if (/T恤|卫衣|针织|毛衣/.test(itemText)) highlights.push('软糯舒服');
  if (/短裤|运动|鞋/.test(itemText)) highlights.push('轻便好活动');
  return highlights;
}

function getSceneHighlights(outfit: Outfit, seed: number) {
  if (!outfit.scene) return [];
  const highlights = SCENE_HIGHLIGHTS[String(outfit.scene)] ?? [];
  if (highlights.length === 0) return [];
  return [highlights[seed % highlights.length]!];
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
  if (!value) return '';
  if (value === getToday()) return '今天推荐';

  const [, month, day] = value.match(/^(\d{4})-(\d{2})-(\d{2})$/) ?? [];
  if (!month || !day) return '那天推荐';
  return `${Number(month)}月${Number(day)}日推荐`;
}

function getToday() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}
