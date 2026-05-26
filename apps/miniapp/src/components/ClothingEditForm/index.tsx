import { Image, Input, ScrollView, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useMemo, useState } from 'react';
import { displayClothingText } from '@/utils/clothingLabels';
import type { ClothingCategory } from '@starter-template/types';
import {
  CATEGORY_OPTIONS,
  COLOR_OPTIONS,
  MATERIAL_OPTIONS,
  SEASON_OPTIONS,
  STYLE_OPTIONS,
  SUBCATEGORY_OPTIONS,
  THICKNESS_OPTIONS,
  type SelectOption,
} from './constants';
import './index.scss';

export interface ClothingEditFormValue {
  imageUrl?: string;
  customName?: string;
  brand?: string;
  customTags?: string[];
  category: ClothingCategory;
  subcategory?: string;
  colors: string[];
  seasonTags: string[];
  styleTags: string[];
  material?: string;
  thickness?: string;
}

export interface ClothingEditFormProps {
  initialValue: ClothingEditFormValue;
  showImage?: boolean;
  showMetaFields?: boolean;
  submitText?: string;
  submitting?: boolean;
  onSave: (value: ClothingEditFormValue) => void | Promise<void>;
  onCancel?: () => void;
}

export function ClothingEditForm({
  initialValue,
  showImage = false,
  showMetaFields = true,
  submitText = '保存',
  submitting = false,
  onSave,
  onCancel,
}: ClothingEditFormProps) {
  const [value, setValue] = useState<ClothingEditFormValue>(() => normalizeInitialValue(initialValue));
  const [customTagsInput, setCustomTagsInput] = useState(() => initialValue.customTags?.join('、') ?? '');

  useEffect(() => {
    setValue(normalizeInitialValue(initialValue));
    setCustomTagsInput(initialValue.customTags?.join('、') ?? '');
  }, [initialValue]);

  const subcategoryOptions = useMemo(() => {
    return withCurrentOption(SUBCATEGORY_OPTIONS[value.category] ?? [], value.subcategory);
  }, [value.category, value.subcategory]);

  function updateCategory(category: ClothingCategory) {
    setValue((prev) => {
      const nextOptions = SUBCATEGORY_OPTIONS[category] ?? [];
      const subcategory = isOptionValue(nextOptions, prev.subcategory) ? prev.subcategory : '';
      return { ...prev, category, subcategory };
    });
  }

  function updateSingle(field: 'subcategory' | 'material' | 'thickness', nextValue: string) {
    setValue((prev) => ({
      ...prev,
      [field]: prev[field] === nextValue ? '' : nextValue,
    }));
  }

  function toggleArray(field: 'colors' | 'seasonTags' | 'styleTags', optionValue: string) {
    setValue((prev) => {
      const current = prev[field];
      const next = current.includes(optionValue)
        ? current.filter((item) => item !== optionValue)
        : [...current, optionValue];
      return { ...prev, [field]: next };
    });
  }

  async function handleSubmit() {
    if (!value.category) {
      Taro.showToast({ title: '请选择品类', icon: 'none' });
      return;
    }

    await onSave({
      ...value,
      customName: trimToUndefined(value.customName),
      brand: trimToUndefined(value.brand),
      customTags: splitTags(customTagsInput),
      subcategory: trimToUndefined(value.subcategory),
      material: trimToUndefined(value.material),
      thickness: trimToUndefined(value.thickness),
    });
  }

  return (
    <View className="clothing-edit-form">
      <ScrollView className="edit-form-scroll" scrollY>
        {showImage && value.imageUrl && (
          <View className="image-preview">
            <View className="preview-wrapper">
              <Image className="preview-img" src={value.imageUrl} mode="aspectFit" />
            </View>
          </View>
        )}

        <View className="form-card">
          <Text className="form-title">编辑信息</Text>

          {showMetaFields && (
            <View className="form-item">
              <Text className="item-label">备注名称</Text>
              <Input
                className="item-input"
                value={value.customName ?? ''}
                onInput={(event) => setValue((prev) => ({ ...prev, customName: String(event.detail.value ?? '') }))}
                placeholder="例如：我的白T"
                maxlength={64}
              />
            </View>
          )}

          <ChipGroup
            label="品类"
            options={CATEGORY_OPTIONS}
            selected={[value.category]}
            onToggle={(item) => updateCategory(item as ClothingCategory)}
          />

          <ChipGroup
            label="子类"
            options={subcategoryOptions}
            selected={value.subcategory ? [value.subcategory] : []}
            emptyText="先选择品类，再选择更具体的衣服类型"
            onToggle={(item) => updateSingle('subcategory', item)}
          />

          {showMetaFields && (
            <View className="form-item">
              <Text className="item-label">品牌</Text>
              <Input
                className="item-input"
                value={value.brand ?? ''}
                onInput={(event) => setValue((prev) => ({ ...prev, brand: String(event.detail.value ?? '') }))}
                placeholder="例如：优衣库"
                maxlength={64}
              />
            </View>
          )}

          <ChipGroup
            label="颜色"
            options={withCurrentOptions(COLOR_OPTIONS, value.colors)}
            selected={value.colors}
            onToggle={(item) => toggleArray('colors', item)}
          />

          <ChipGroup
            label="材质"
            options={withCurrentOption(MATERIAL_OPTIONS, value.material)}
            selected={value.material ? [value.material] : []}
            onToggle={(item) => updateSingle('material', item)}
          />

          <ChipGroup
            label="厚薄"
            options={withCurrentOption(THICKNESS_OPTIONS, value.thickness)}
            selected={value.thickness ? [value.thickness] : []}
            onToggle={(item) => updateSingle('thickness', item)}
          />

          <ChipGroup
            label="风格"
            options={withCurrentOptions(STYLE_OPTIONS, value.styleTags)}
            selected={value.styleTags}
            onToggle={(item) => toggleArray('styleTags', item)}
          />

          <ChipGroup
            label="季节"
            options={withCurrentOptions(SEASON_OPTIONS, value.seasonTags)}
            selected={value.seasonTags}
            onToggle={(item) => toggleArray('seasonTags', item)}
          />

          {showMetaFields && (
            <View className="form-item">
              <Text className="item-label">标签</Text>
              <Input
                className="item-input"
                value={customTagsInput}
                onInput={(event) => setCustomTagsInput(String(event.detail.value ?? ''))}
                placeholder="多个标签用顿号或空格分隔"
                maxlength={200}
              />
              <Text className="item-hint">例如：百搭、春秋、通勤</Text>
            </View>
          )}
        </View>
      </ScrollView>

      <View className="action-bar">
        {onCancel && (
          <View className={`cancel-btn ${submitting ? 'disabled' : ''}`} onClick={onCancel}>
            <Text className="cancel-text">取消</Text>
          </View>
        )}
        <View className={`save-btn ${submitting ? 'disabled' : ''}`} onClick={handleSubmit}>
          <Text className="btn-text">{submitting ? '保存中...' : submitText}</Text>
        </View>
      </View>
    </View>
  );
}

function ChipGroup({
  label,
  options,
  selected,
  emptyText,
  onToggle,
}: {
  label: string;
  options: Array<SelectOption<string>>;
  selected: string[];
  emptyText?: string;
  onToggle: (value: string) => void;
}) {
  return (
    <View className="form-item">
      <Text className="item-label">{label}</Text>
      {options.length > 0 ? (
        <View className="chip-grid">
          {options.map((option) => (
            <View
              key={option.value}
              className={`select-chip ${selected.includes(option.value) ? 'active' : ''}`}
              onClick={() => onToggle(option.value)}
            >
              <Text className="chip-text">{option.label}</Text>
            </View>
          ))}
        </View>
      ) : (
        <Text className="item-hint">{emptyText ?? '暂无可选项'}</Text>
      )}
    </View>
  );
}

function normalizeInitialValue(input: ClothingEditFormValue): ClothingEditFormValue {
  return {
    ...input,
    category: input.category || 'other',
    customName: input.customName ?? '',
    brand: input.brand ?? '',
    customTags: input.customTags ?? [],
    subcategory: input.subcategory ?? '',
    colors: normalizeStringArray(input.colors),
    seasonTags: normalizeStringArray(input.seasonTags),
    styleTags: normalizeStringArray(input.styleTags),
    material: input.material ?? '',
    thickness: input.thickness ?? '',
  };
}

function withCurrentOptions<T extends string>(options: Array<SelectOption<T>>, currentValues: string[]) {
  return currentValues.reduce<Array<SelectOption<string>>>((result, current) => withCurrentOption(result, current), options);
}

function withCurrentOption<T extends string>(options: Array<SelectOption<T>>, current?: string) {
  const normalized = current?.trim();
  if (!normalized || options.some((option) => option.value === normalized)) {
    return options;
  }

  return [
    { value: normalized, label: `当前：${displayClothingText(normalized)}` },
    ...options,
  ];
}

function isOptionValue(options: Array<SelectOption<string>>, current?: string) {
  if (!current) return false;
  return options.some((option) => option.value === current || option.label === current);
}

function splitTags(value: string) {
  return value
    .split(/[、,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeStringArray(value?: string[]) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function trimToUndefined(value?: string) {
  const trimmed = value?.trim();
  return trimmed || undefined;
}
