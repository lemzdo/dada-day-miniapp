import type { ClothingCategory, ClothingSubcategory } from '@starter-template/types';
import {
  STANDARD_COLORS,
  STANDARD_MATERIALS,
  STANDARD_THICKNESS,
  STANDARD_SEASONS,
  STANDARD_STYLES,
  STANDARD_SCENES,
} from '../../utils/clothingFieldNormalize';

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
    { value: 'necklace', label: '项链' },
    { value: 'glasses', label: '眼镜' },
    { value: 'watch', label: '手表' },
  ],
  other: [
    { value: 'other', label: '其他' },
  ],
};

export const COLOR_OPTIONS: Array<SelectOption> = STANDARD_COLORS.map(c => ({
  value: c.key,
  label: c.label,
}));

export const SEASON_OPTIONS: Array<SelectOption> = STANDARD_SEASONS.map(s => ({
  value: s.key,
  label: s.label,
}));

export const STYLE_OPTIONS: Array<SelectOption> = STANDARD_STYLES.map(s => ({
  value: s.key,
  label: s.label,
}));

export const SCENE_OPTIONS: Array<SelectOption> = STANDARD_SCENES.map(s => ({
  value: s.key,
  label: s.label,
}));

export const MATERIAL_OPTIONS: Array<SelectOption> = STANDARD_MATERIALS.map(m => ({
  value: m.key,
  label: m.label,
}));

export const THICKNESS_OPTIONS: Array<SelectOption> = STANDARD_THICKNESS.map(t => ({
  value: t.key,
  label: t.label,
}));
