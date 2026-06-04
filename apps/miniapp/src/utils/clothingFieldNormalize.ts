import type { ClothingCategory } from '@starter-template/types';

// ==================== 标准颜色库 ====================
export interface ColorMeta {
  key: string;
  label: string;
  hex: string;
  border: string;
}

export const STANDARD_COLORS = [
  { key: 'black', label: '黑色', hex: '#1A1A1A', border: '#333333' },
  { key: 'white', label: '白色', hex: '#FFFFFF', border: '#E0E0E0' },
  { key: 'cream', label: '奶油白', hex: '#FFFDD0', border: '#F0E6B0' },
  { key: 'beige', label: '米色', hex: '#F5F5DC', border: '#E5E5CC' },
  { key: 'oat', label: '燕麦色', hex: '#D9C7B5', border: '#C9B7A5' },
  { key: 'gray', label: '灰色', hex: '#888888', border: '#666666' },
  { key: 'blue', label: '蓝色', hex: '#4A90D9', border: '#3A80C9' },
  { key: 'denim', label: '牛仔蓝', hex: '#4169E1', border: '#3159D1' },
  { key: 'navy', label: '藏青', hex: '#001F3F', border: '#002F4F' },
  { key: 'red', label: '红色', hex: '#E63946', border: '#D62936' },
  { key: 'wine', label: '酒红', hex: '#722F37', border: '#621F27' },
  { key: 'lightPink', label: '浅粉', hex: '#F6B7C8', border: '#E7A6B8' },
  { key: 'pink', label: '玫粉', hex: '#E94B92', border: '#D83B82' },
  { key: 'brown', label: '棕色', hex: '#8B4513', border: '#7B3503' },
  { key: 'darkBrown', label: '深棕', hex: '#5A321E', border: '#4A2818' },
  { key: 'caramel', label: '焦糖棕', hex: '#C4965E', border: '#B4864E' },
  { key: 'green', label: '绿色', hex: '#2E8B57', border: '#1E7B47' },
  { key: 'mint', label: '薄荷绿', hex: '#B8E6D0', border: '#A4D3BD' },
  { key: 'brightGreen', label: '亮绿', hex: '#70C850', border: '#60B840' },
  { key: 'darkGreen', label: '墨绿', hex: '#174A35', border: '#123C2B' },
  { key: 'dustyBlue', label: '雾霾蓝', hex: '#91AFC6', border: '#7F9DB4' },
  { key: 'orange', label: '橙色', hex: '#F28C38', border: '#E07A28' },
  { key: 'yellow', label: '黄色', hex: '#FFD700', border: '#EFC700' },
  { key: 'purple', label: '紫色', hex: '#9370DB', border: '#8360CB' },
  { key: 'multicolor', label: '多色', hex: '#E0E0E0', border: '#D0D0D0' },
] as const satisfies readonly ColorMeta[];

export type StandardColorKey = typeof STANDARD_COLORS[number]['key'];

export const STANDARD_COLOR_GROUPS = [
  { name: '基础色', colorKeys: ['black', 'white', 'gray', 'beige', 'brown', 'blue'] },
  { name: '柔和色', colorKeys: ['cream', 'oat', 'lightPink', 'mint', 'dustyBlue'] },
  { name: '亮彩色', colorKeys: ['red', 'orange', 'yellow', 'brightGreen', 'purple', 'pink'] },
  { name: '深色', colorKeys: ['navy', 'wine', 'darkGreen', 'darkBrown'] },
  { name: '花色 / 多色', colorKeys: ['multicolor'] },
] as const;

// ==================== 标准材质库 ====================
export const STANDARD_MATERIALS = [
  { key: 'cotton', label: '棉质' },
  { key: 'linen', label: '亚麻' },
  { key: 'silk', label: '丝绸' },
  { key: 'wool', label: '羊毛' },
  { key: 'leather', label: '皮革' },
  { key: 'denim', label: '牛仔' },
  { key: 'chemical', label: '化纤' },
  { key: 'blend', label: '混纺' },
  { key: 'down', label: '羽绒' },
  { key: 'knit', label: '针织' },
  { key: 'polyester', label: '聚酯纤维' },
  { key: 'modal', label: '莫代尔' },
  { key: 'acetate', label: '醋酸' },
  { key: 'corduroy', label: '灯芯绒' },
  { key: 'fleece', label: '摇粒绒' },
  { key: 'iceSilk', label: '冰丝' },
  { key: 'cashmere', label: '羊绒' },
] as const;

export type StandardMaterialKey = typeof STANDARD_MATERIALS[number]['key'];

// ==================== 标准厚薄库 ====================
export const STANDARD_THICKNESS = [
  { key: 'thin', label: '薄款' },
  { key: 'medium', label: '适中' },
  { key: 'thick', label: '厚款' },
] as const;

export type StandardThicknessKey = typeof STANDARD_THICKNESS[number]['key'];

// ==================== 标准季节库 ====================
export const STANDARD_SEASONS = [
  { key: 'spring', label: '春' },
  { key: 'summer', label: '夏' },
  { key: 'autumn', label: '秋' },
  { key: 'winter', label: '冬' },
] as const;

export type StandardSeasonKey = typeof STANDARD_SEASONS[number]['key'];

// ==================== 标准风格库 ====================
export const STANDARD_STYLES = [
  { key: '简约', label: '简约' },
  { key: '极简', label: '极简' },
  { key: '休闲', label: '休闲' },
  { key: '通勤', label: '通勤' },
  { key: '运动', label: '运动' },
  { key: '街头', label: '街头' },
  { key: '甜酷', label: '甜酷' },
  { key: '温柔', label: '温柔' },
  { key: '轻熟', label: '轻熟' },
  { key: '复古', label: '复古' },
  { key: '美式复古', label: '美式复古' },
  { key: '法式', label: '法式' },
  { key: '日系', label: '日系' },
  { key: '韩系', label: '韩系' },
  { key: '学院', label: '学院' },
  { key: '工装', label: '工装' },
  { key: '商务', label: '商务' },
  { key: '户外', label: '户外' },
  { key: '机能', label: '机能' },
  { key: 'Clean Fit', label: 'Clean Fit' },
  { key: 'Cityboy', label: 'Cityboy' },
  { key: '优雅', label: '优雅' },
  { key: '辣妹', label: '辣妹' },
  { key: '中性', label: '中性' },
] as const;

export type StandardStyleKey = typeof STANDARD_STYLES[number]['key'];

// ==================== 标准场景库 ====================
export const STANDARD_SCENES = [
  { key: '日常', label: '日常' },
  { key: '通勤', label: '通勤' },
  { key: '运动', label: '运动' },
  { key: '约会', label: '约会' },
  { key: '居家', label: '居家' },
  { key: '校园', label: '校园' },
  { key: '旅行', label: '旅行' },
  { key: '正式', label: '正式' },
  { key: '聚会', label: '聚会' },
  { key: '户外', label: '户外' },
] as const;

export type StandardSceneKey = typeof STANDARD_SCENES[number]['key'];

// ==================== Category Normalize 函数 ====================

export function normalizeCategory(input: string): ClothingCategory {
  const map: Record<string, ClothingCategory> = {
    'top': 'top',
    '上衣': 'top',
    '外套': 'top',
    'bottom': 'bottom',
    '下装': 'bottom',
    '裤子': 'bottom',
    '裙子': 'bottom',
    'onepiece': 'onepiece',
    '连体': 'onepiece',
    '连衣裙': 'onepiece',
    'shoes': 'shoes',
    '鞋子': 'shoes',
    '鞋': 'shoes',
    'accessory': 'accessory',
    '配饰': 'accessory',
    '包': 'accessory',
    '帽子': 'accessory',
    'other': 'other',
    '其他': 'other',
  };
  return map[input?.trim()?.toLowerCase?.() || input?.trim() || ''] || 'other';
}

// ==================== Material Normalize 函数 ====================

export function normalizeMaterial(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  const map: Record<string, string> = {
    '棉': 'cotton',
    '棉质': 'cotton',
    'cotton': 'cotton',
    '麻': 'linen',
    '亚麻': 'linen',
    'linen': 'linen',
    '丝绸': 'silk',
    'silk': 'silk',
    '羊毛': 'wool',
    'wool': 'wool',
    '皮革': 'leather',
    'leather': 'leather',
    '牛仔': 'denim',
    'denim': 'denim',
    '化纤': 'chemical',
    'chemical': 'chemical',
    '混纺': 'blend',
    'blend': 'blend',
    '羽绒': 'down',
    'down': 'down',
    '针织': 'knit',
    'knit': 'knit',
    '聚酯纤维': 'polyester',
    'polyester': 'polyester',
    '莫代尔': 'modal',
    'modal': 'modal',
    '醋酸': 'acetate',
    'acetate': 'acetate',
    '灯芯绒': 'corduroy',
    'corduroy': 'corduroy',
    '摇粒绒': 'fleece',
    'fleece': 'fleece',
    '冰丝': 'iceSilk',
    'icesilk': 'iceSilk',
    '羊绒': 'cashmere',
    'cashmere': 'cashmere',
  };

  return map[trimmed] || map[lower] || trimmed;
}

export function getMaterialLabel(keyOrText: string): string {
  if (!keyOrText) return '';
  const material = STANDARD_MATERIALS.find(m => m.key === keyOrText);
  if (material) return material.label;
  return keyOrText;
}

interface MaterialNameRecord {
  id?: string;
  _id?: string;
  name?: string;
  normalizedName?: string;
}

export function isLikelyMaterialUid(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  if (/[\u4e00-\u9fa5]/.test(trimmed)) return false;
  if (STANDARD_MATERIALS.some(m => m.key === trimmed || m.label === trimmed)) return false;
  return /^[a-z0-9_-]{16,}$/i.test(trimmed) || /^[a-f0-9]{24}$/i.test(trimmed);
}

export function resolveMaterialDisplayName(
  input?: string,
  userMaterials: MaterialNameRecord[] = [],
  fallback = '',
): string {
  if (!input) return '';
  const trimmed = input.trim();
  if (!trimmed) return '';
  const normalizedName = trimmed.toLowerCase().replace(/\s+/g, '');

  const byId = userMaterials.find((item) => item.name && (item.id === trimmed || item._id === trimmed));
  if (byId?.name) return byId.name.trim();

  const normalized = normalizeMaterial(trimmed);
  const standard = STANDARD_MATERIALS.find((item) => item.key === normalized || item.label === trimmed);
  if (standard) return standard.label;

  const byName = userMaterials.find((item) => (
    item.name &&
    (item.name === trimmed || item.normalizedName === normalizedName)
  ));
  if (byName?.name) return byName.name.trim();

  if (isLikelyMaterialUid(trimmed)) return fallback;
  return trimmed;
}

export function getMaterialStorageName(input?: string, userMaterials: MaterialNameRecord[] = []): string {
  return resolveMaterialDisplayName(input, userMaterials, '');
}

// ==================== Thickness Normalize 函数 ====================

export function normalizeThickness(input: string): StandardThicknessKey {
  if (!input) return 'medium';
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  const map: Record<string, StandardThicknessKey> = {
    '薄': 'thin',
    '薄款': 'thin',
    'thin': 'thin',
    'light': 'thin',
    '适中': 'medium',
    'medium': 'medium',
    'normal': 'medium',
    '厚': 'thick',
    '厚款': 'thick',
    'thick': 'thick',
    'heavy': 'thick',
  };

  return map[trimmed] || map[lower] || 'medium';
}

export function getThicknessLabel(key: string): string {
  const thickness = STANDARD_THICKNESS.find(t => t.key === key);
  return thickness?.label || '适中';
}

// ==================== Season Normalize 函数 ====================

export function normalizeSeason(input: string): StandardSeasonKey {
  if (!input) return 'spring';
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();

  const map: Record<string, StandardSeasonKey> = {
    '春': 'spring',
    '春季': 'spring',
    'spring': 'spring',
    '夏': 'summer',
    '夏季': 'summer',
    'summer': 'summer',
    '秋': 'autumn',
    '秋季': 'autumn',
    'autumn': 'autumn',
    'fall': 'autumn',
    '冬': 'winter',
    '冬季': 'winter',
    'winter': 'winter',
  };

  return map[trimmed] || map[lower] || 'spring';
}

export function getSeasonLabel(key: string): string {
  const season = STANDARD_SEASONS.find(s => s.key === key);
  return season?.label || '春';
}

// ==================== Style Normalize 函数 ====================

export function normalizeStyleTag(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const style = STANDARD_STYLES.find(s => s.key === trimmed || s.label === trimmed);
  return style?.key || trimmed;
}

// ==================== Scene Normalize 函数 ====================

export function normalizeSceneTag(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const scene = STANDARD_SCENES.find(s => s.key === trimmed || s.label === trimmed);
  return scene?.key || trimmed;
}

// ==================== Color Normalize 函数 ====================

export function normalizeColor(input: string): ColorMeta {
  if (!input) {
    return { key: '', label: '', hex: '#F4EFE8', border: '#D8C8B8' };
  }
  const trimmed = input.trim();
  const lower = trimmed.toLowerCase();
  const aliasMap: Record<string, string> = {
    cream_white: 'cream',
    oatmeal: 'oat',
    light_pink: 'lightPink',
    rose_pink: 'pink',
    mint_green: 'mint',
    dusty_blue: 'dustyBlue',
    bright_green: 'brightGreen',
    dark_green: 'darkGreen',
    dark_brown: 'darkBrown',
    caramel_brown: 'caramel',
    wine_red: 'wine',
    multi_color: 'multicolor',
    multi_colour: 'multicolor',
    black: 'black',
    white: 'white',
    gray: 'gray',
    grey: 'gray',
    blue: 'blue',
    denim_blue: 'denim',
    navy_blue: 'navy',
  };
  const color = STANDARD_COLORS.find(c => 
    c.key === trimmed || c.key === lower || c.key === aliasMap[lower] || c.label === trimmed
  );
  if (color) return color;

  return {
    key: trimmed,
    label: trimmed,
    hex: '#F4EFE8',
    border: '#D8C8B8',
  };
}

export function getColorSummaryLabel(colorNames: string[]): string {
  const names = colorNames.map((item) => item.trim()).filter(Boolean);
  if (names.length <= 3) return names.join('、');
  return `${names.slice(0, 3).join('、')}等 ${names.length} 色`;
}

export function getColorMeta(input: string): ColorMeta {
  return normalizeColor(input);
}

export function getColorByKey(key: string): ColorMeta | undefined {
  return STANDARD_COLORS.find(c => c.key === key);
}

export function getColorByLabel(label: string): ColorMeta | undefined {
  return STANDARD_COLORS.find(c => c.label === label);
}
