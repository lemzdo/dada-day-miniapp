import type { Clothing, ClothingCategory, UserClothingSubcategory } from '@starter-template/types';
import { SUBCATEGORY_OPTIONS } from '../components/ClothingEditForm/constants';

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
  // 细分类
  tshirt: 'T恤',
  't-shirt': 'T恤',
  short_sleeve_tshirt: '短袖T恤',
  short_sleeve_tee: '短袖T恤',
  shirt: '衬衫',
  sweater: '毛衣',
  hoodie: '卫衣',
  jacket: '夹克',
  blazer: '西装外套',
  vest: '马甲',
  down_jacket: '羽绒服',
  jeans: '牛仔裤',
  trousers: '休闲裤',
  shorts: '短裤',
  skirt: '半身裙',
  dress: '连衣裙',
  jumpsuit: '连体裤',
  suit_set: '套装',
  sneakers: '运动鞋',
  loafers: '休闲鞋',
  boots: '靴子',
  sandals: '凉鞋',
  heels: '高跟鞋',
  flats: '平底鞋',
  hat: '帽子',
  bag: '包包',
  scarf: '围巾',
  belt: '腰带',
  necklace: '项链',
  glasses: '眼镜',
  watch: '手表',
  leggings: '打底裤',
  // 风格
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
  // 季节
  spring: '春季',
  summer: '夏季',
  autumn: '秋季',
  fall: '秋季',
  winter: '冬季',
  all: '四季',
  'all-season': '四季',
  all_season: '四季',
  'all season': '四季',
  // 材质
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
  // 厚薄
  loose: '宽松',
  slim: '修身',
  tiered: '分层',
  // 品类
  top: '上衣',
  bottom: '下装',
  onepiece: '连体',
  accessory: '配饰',
  other: '其他',
  // 颜色
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
  item: Pick<Clothing, 'originalImageUrl' | 'displayImageUrl' | 'aiSegmentImageUrl' | 'manualCropImageUrl' | 'cleanImageUrl' | 'cropImageUrl' | 'croppedImageUrl'> & {
    imageUrl?: string;
    thumbnailUrl?: string;
  },
) {
  return [
    item.cleanImageUrl,
    item.aiSegmentImageUrl,
    item.cropImageUrl,
    item.croppedImageUrl,
    item.displayImageUrl,
    item.imageUrl,
    item.manualCropImageUrl,
    item.originalImageUrl,
    item.thumbnailUrl,
  ].find((value): value is string => typeof value === 'string' && value.trim().length > 0) ?? '';
}

export const getDisplayImage = getClothDisplayImage;

export function getSingleClothRecognizeImage(
  item: Pick<Clothing, 'aiSegmentImageUrl' | 'manualCropImageUrl' | 'segmentStatus' | 'manualCropStatus' | 'cleanImageUrl' | 'cropImageUrl' | 'croppedImageUrl'>,
) {
  if (item.cleanImageUrl && item.segmentStatus === 'success') return item.cleanImageUrl;
  if (item.aiSegmentImageUrl && item.segmentStatus === 'success') return item.aiSegmentImageUrl;
  if (item.cropImageUrl) return item.cropImageUrl;
  if (item.croppedImageUrl) return item.croppedImageUrl;
  if (item.manualCropImageUrl && item.manualCropStatus === 'success') return item.manualCropImageUrl;
  return '';
}

export function canRecognizeSingleClothing(
  item: Pick<Clothing, 'aiSegmentImageUrl' | 'manualCropImageUrl' | 'segmentStatus' | 'manualCropStatus' | 'cleanImageUrl' | 'cropImageUrl' | 'croppedImageUrl'>,
) {
  return Boolean(getSingleClothRecognizeImage(item));
}

/**
 * 细分类 display label 统一处理
 * 优先级：当前大类系统预设 -> 用户自定义 -> 全量系统预设 -> 旧值映射 -> 原值
 */
export function getSubcategoryDisplayLabel(
  category: ClothingCategory | string | undefined,
  value: string | undefined,
  userSubcategories: UserClothingSubcategory[] = [],
): string {
  if (!value) return '';

  const cat = (category || '') as ClothingCategory;
  const trimmed = value.trim();
  const normalized = trimmed.toLowerCase();

  // 1. 先查当前 category 下的系统预设
  const systemOptions = SUBCATEGORY_OPTIONS[cat] ?? [];
  const foundSystem = systemOptions.find(
    (opt) => opt.value === trimmed || opt.value === normalized || opt.label === trimmed
  );
  if (foundSystem) return foundSystem.label;

  // 2. 再查用户私有细分类，兼容 id/name
  const foundUser = userSubcategories.find((item) => {
    const sameCategory = !cat || item.parentCategory === cat;
    if (!sameCategory || item.status !== 'active') return false;
    return item.id === trimmed || item.name === trimmed || item.normalizedName === normalized;
  });
  if (foundUser) return foundUser.name;

  // 3. 再查全量系统预设，避免 category 缺失时漏掉
  for (const options of Object.values(SUBCATEGORY_OPTIONS)) {
    const found = options.find(
      (opt) => opt.value === trimmed || opt.value === normalized || opt.label === trimmed
    );
    if (found) return found.label;
  }

  // 4. 查旧值映射（bag -> 包包，necklace -> 项链等）
  const textLabel = displayClothingText(trimmed);
  if (textLabel && textLabel !== trimmed) return textLabel;

  // 5. 最后返回原值
  return trimmed;
}

export function getDisplayCategory(item: { category?: ClothingCategory | string; subcategory?: string }) {
  const categoryLabel = categoryLabels[item.category || ''] || '其他';
  if (item.subcategory) {
    const subLabel = getSubcategoryDisplayLabel(item.category, item.subcategory);
    return `${categoryLabel} · ${subLabel}`;
  }
  return categoryLabel;
}
