import type { ClothingCategory, ClothingSubcategory, Material, StyleTag } from '@starter-template/types';

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
}

export const CATEGORY_OPTIONS: Array<SelectOption<ClothingCategory>> = [
  { value: 'top', label: '上衣' },
  { value: 'bottom', label: '下装' },
  { value: 'onepiece', label: '连体' },
  { value: 'shoes', label: '鞋子' },
  { value: 'accessory', label: '配饰' },
  { value: 'other', label: '其他' },
];

export const SUBCATEGORY_OPTIONS: Record<ClothingCategory, Array<SelectOption<ClothingSubcategory>>> = {
  top: [
    { value: 'tshirt', label: 'T恤' },
    { value: 'shirt', label: '衬衫' },
    { value: 'hoodie', label: '卫衣' },
    { value: 'sweater', label: '针织衫' },
    { value: 'jacket', label: '外套' },
    { value: 'vest', label: '背心' },
    { value: 'blazer', label: '西装外套' },
    { value: 'down_jacket', label: '羽绒服' },
  ],
  bottom: [
    { value: 'jeans', label: '牛仔裤' },
    { value: 'trousers', label: '休闲裤' },
    { value: 'shorts', label: '短裤' },
    { value: 'skirt', label: '半身裙' },
    { value: 'leggings', label: '打底裤' },
  ],
  onepiece: [
    { value: 'dress', label: '连衣裙' },
    { value: 'jumpsuit', label: '连体裤' },
    { value: 'suit_set', label: '套装' },
  ],
  shoes: [
    { value: 'sneakers', label: '运动鞋' },
    { value: 'loafers', label: '休闲鞋' },
    { value: 'boots', label: '靴子' },
    { value: 'sandals', label: '凉鞋' },
    { value: 'heels', label: '高跟鞋' },
    { value: 'flats', label: '平底鞋' },
  ],
  accessory: [
    { value: 'hat', label: '帽子' },
    { value: 'bag', label: '包包' },
    { value: 'scarf', label: '围巾' },
    { value: 'belt', label: '腰带' },
    { value: 'necklace', label: '首饰' },
    { value: 'glasses', label: '眼镜' },
    { value: 'watch', label: '手表' },
  ],
  other: [
    { value: 'other', label: '其他' },
  ],
};

export const COLOR_OPTIONS: Array<SelectOption> = [
  { value: '黑色', label: '黑色' },
  { value: '白色', label: '白色' },
  { value: '灰色', label: '灰色' },
  { value: '蓝色', label: '蓝色' },
  { value: '藏青色', label: '藏青' },
  { value: '绿色', label: '绿色' },
  { value: '黄色', label: '黄色' },
  { value: '粉色', label: '粉色' },
  { value: '红色', label: '红色' },
  { value: '紫色', label: '紫色' },
  { value: '棕色', label: '棕色' },
  { value: '米色', label: '米色' },
  { value: '橙色', label: '橙色' },
];

export const SEASON_OPTIONS: Array<SelectOption> = [
  { value: '春', label: '春' },
  { value: '夏', label: '夏' },
  { value: '秋', label: '秋' },
  { value: '冬', label: '冬' },
];

export const STYLE_OPTIONS: Array<SelectOption<StyleTag | string>> = [
  { value: '简约', label: '简约' },
  { value: '通勤', label: '通勤' },
  { value: '街头', label: '街头' },
  { value: '甜美', label: '甜美' },
  { value: '学院', label: '学院' },
  { value: '复古', label: '复古' },
  { value: '运动', label: '运动' },
  { value: '优雅', label: '优雅' },
  { value: '休闲', label: '休闲' },
  { value: '辣妹', label: '辣妹' },
  { value: '日系', label: '日系' },
  { value: '法式', label: '法式' },
  { value: '中性', label: '中性' },
];

export const MATERIAL_OPTIONS: Array<SelectOption<Material | string>> = [
  { value: '棉', label: '棉' },
  { value: '麻', label: '麻' },
  { value: '丝绸', label: '丝绸' },
  { value: '羊毛', label: '羊毛' },
  { value: '皮革', label: '皮革' },
  { value: '牛仔', label: '牛仔' },
  { value: '化纤', label: '化纤' },
  { value: '混纺', label: '混纺' },
  { value: '羽绒', label: '羽绒' },
  { value: '针织', label: '针织' },
];

export const THICKNESS_OPTIONS: Array<SelectOption> = [
  { value: '薄', label: '薄' },
  { value: '适中', label: '适中' },
  { value: '厚', label: '厚' },
];
