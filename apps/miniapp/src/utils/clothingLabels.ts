import type { Clothing } from '@starter-template/types';

export const categoryLabels: Record<string, string> = {
  top: '上衣',
  bottom: '下装',
  onepiece: '连体',
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
  spring: '春',
  summer: '夏',
  autumn: '秋',
  fall: '秋',
  winter: '冬',
  cotton: '棉',
  linen: '麻',
  wool: '羊毛',
  denim: '牛仔',
  leather: '皮革',
  silk: '丝绸',
  polyester: '聚酯纤维',
  knit: '针织',
  mixed: '混纺',
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
  return textLabels[value.toLowerCase()] ?? value;
}

export function displayClothingTags(tags?: Array<string | undefined>) {
  return tags?.map(displayClothingText).filter(Boolean) ?? [];
}

export function getDisplayImage(item: Pick<Clothing, 'originalImageUrl' | 'displayImageUrl'>) {
  return item.displayImageUrl || item.originalImageUrl || '';
}
