import type { Clothing } from '@starter-template/types';

export const categoryLabels: Record<string, string> = {
  top: '上衣',
  bottom: '下装',
  onepiece: '连体',
  dress: '连体',
  shoes: '鞋子',
  accessory: '配饰',
  other: '其他',
  上衣: '上衣',
  外套: '外套',
  裤子: '裤子',
  裙子: '裙子',
  连衣裙: '连衣裙',
  鞋子: '鞋子',
  包: '包',
  帽子: '帽子',
  配饰: '配饰',
  其他: '其他',
};

const textLabels: Record<string, string> = {
  tshirt: 'T恤',
  't-shirt': 'T恤',
  shirt: '衬衫',
  sweater: '毛衣',
  hoodie: '卫衣',
  jacket: '夹克',
  blazer: '西装外套',
  vest: '马甲',
  jeans: '牛仔裤',
  trousers: '长裤',
  shorts: '短裤',
  skirt: '半身裙',
  dress: '连衣裙',
  sneakers: '运动鞋',
  boots: '靴子',
  sandals: '凉鞋',
  casual: '休闲',
  formal: '正式',
  sporty: '运动',
  sport: '运动',
  vintage: '复古',
  street: '街头',
  minimalist: '简约',
  elegant: '优雅',
  commute: '通勤',
  work: '通勤',
  daily: '日常',
  date: '约会',
  party: '聚会',
  home: '居家',
  spring: '春季',
  summer: '夏季',
  autumn: '秋季',
  fall: '秋季',
  winter: '冬季',
  all: '四季',
  'all-season': '四季',
  all_season: '四季',
  'all season': '四季',
  cotton: '棉',
  linen: '麻',
  flax: '亚麻',
  wool: '羊毛',
  denim: '牛仔',
  leather: '皮革',
  silk: '丝绸',
  polyester: '聚酯纤维',
  poly: '聚酯纤维',
  knit: '针织',
  mixed: '混纺',
  loose: '宽松',
  slim: '修身',
  tiered: '分层',
  top: '上衣',
  bottom: '下装',
  onepiece: '连体',
  accessory: '配饰',
  other: '其他',
  black: '黑色',
  white: '白色',
  gray: '灰色',
  grey: '灰色',
  red: '红色',
  blue: '蓝色',
  green: '绿色',
  yellow: '黄色',
  pink: '粉色',
  purple: '紫色',
  brown: '棕色',
  beige: '米色',
  orange: '橙色',
  navy: '藏青色',
};

export function displayClothingText(value?: string) {
  if (!value) return '';
  const key = value.trim().toLowerCase();
  return categoryLabels[key] ?? textLabels[key] ?? value;
}

export function displayClothingTags(tags?: Array<string | undefined>) {
  return tags?.map(displayClothingText).filter(Boolean) ?? [];
}

export function getClothDisplayImage(
  item: Pick<Clothing, 'originalImageUrl' | 'displayImageUrl' | 'aiSegmentImageUrl' | 'manualCropImageUrl'> & {
    imageUrl?: string;
    thumbnailUrl?: string;
  },
) {
  return [
    item.displayImageUrl,
    item.imageUrl,
    item.aiSegmentImageUrl,
    item.manualCropImageUrl,
    item.originalImageUrl,
    item.thumbnailUrl,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? '';
}

export const getDisplayImage = getClothDisplayImage;

export function getSingleClothRecognizeImage(
  item: Pick<Clothing, 'aiSegmentImageUrl' | 'manualCropImageUrl' | 'segmentStatus' | 'manualCropStatus'>,
) {
  if (item.aiSegmentImageUrl && item.segmentStatus === 'success') return item.aiSegmentImageUrl;
  if (item.manualCropImageUrl && item.manualCropStatus === 'success') return item.manualCropImageUrl;
  return '';
}

export function canRecognizeSingleClothing(
  item: Pick<Clothing, 'aiSegmentImageUrl' | 'manualCropImageUrl' | 'segmentStatus' | 'manualCropStatus'>,
) {
  return Boolean(getSingleClothRecognizeImage(item));
}
