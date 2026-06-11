import { Text, View } from '@tarojs/components';
import Taro, { useLoad, useRouter } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import { ClothingEditForm, type ClothingEditFormValue } from '@/components/ClothingEditForm';
import { getClothingById, updateCloudClothing } from '@/lib/cloud';
import { invalidateAfterWardrobeMutation } from '@/lib/cacheInvalidation';
import { getDisplayImage } from '@/utils/clothingLabels';
import {
  normalizeCategory,
  normalizeThickness,
  normalizeSeason,
  normalizeStyleTag,
  normalizeSceneTag,
  normalizeColor,
  getColorByKey,
  getMaterialStorageName,
  isLikelyMaterialUid
} from '@/utils/clothingFieldNormalize';
import type { Clothing, ClothingUpdateInput } from '@starter-template/types';
import './index.scss';

const DETAIL_REFRESH_STORAGE_KEY = 'detailNeedsRefresh';
const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';

export default function ClothingFormPage() {
  const router = useRouter();
  const editId = router.params.id;
  const isEditMode = !!editId;

  const [loading, setLoading] = useState(isEditMode);
  const [submitting, setSubmitting] = useState(false);
  const [clothing, setClothing] = useState<Clothing | null>(null);
  const formInitialValue = useMemo(() => (clothing ? toFormValue(clothing) : null), [clothing]);

  useLoad(() => {
    if (isEditMode) fetchClothing(editId);
  });

  async function fetchClothing(id: string) {
    setLoading(true);
    try {
      const item = await getClothingById(id);
      setClothing(item);
    } catch (err) {
      console.error('Fetch clothing error:', err);
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(value: ClothingEditFormValue) {
    if (!clothing || submitting) return;

    setSubmitting(true);
    Taro.showLoading({ title: '保存中...' });

    try {
      await updateCloudClothing(clothing.id, toUpdateInput(value));
      await invalidateAfterWardrobeMutation();

      // 设置刷新标记
      Taro.setStorageSync(DETAIL_REFRESH_STORAGE_KEY, true);
      Taro.setStorageSync(WARDROBE_REFRESH_STORAGE_KEY, true);

      Taro.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => Taro.navigateBack(), 800);
    } catch (err) {
      console.error('Save clothing error:', err);
      Taro.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      setSubmitting(false);
      Taro.hideLoading();
    }
  }

  if (loading) {
    return (
      <View className="clothing-form-page loading">
        <View className="skeleton-line" />
        <View className="skeleton-line short" />
        <View className="skeleton-line" />
      </View>
    );
  }

  return (
    <View className="clothing-form-page">
      {formInitialValue && (
        <ClothingEditForm
          initialValue={formInitialValue}
          showImage={isEditMode}
          showMetaFields={true}
          submitText="保存衣物档案"
          submitting={submitting}
          onSave={handleSave}
        />
      )}
    </View>
  );
}

function toFormValue(item: Clothing): ClothingEditFormValue {
  const colors: string[] = [];
  
  if (item.colors && item.colors.length > 0) {
    item.colors.forEach(c => {
      const colorMeta = normalizeColor(c);
      if (colorMeta) colors.push(colorMeta.key);
    });
  } else if (item.colorPalette && item.colorPalette.length > 0) {
    item.colorPalette.forEach(cp => {
      const colorMeta = normalizeColor(cp.name || cp.hex);
      if (colorMeta) colors.push(colorMeta.key);
    });
  }

  const seasonTags = (item.seasonTags || []).map(tag => normalizeSeason(tag));
  const styleTags = (item.styleTags || []).map(tag => normalizeStyleTag(tag));
  const sceneTags = (item.sceneTags || []).map(tag => normalizeSceneTag(tag));

  const rawMaterial = item.material && !isLikelyMaterialUid(item.material)
    ? item.material
    : item.materialGuess || item.material;
  const material = rawMaterial || '';

  let thickness = '';
  if (item.thickness) {
    thickness = normalizeThickness(item.thickness);
  }

  return {
    imageUrl: getDisplayImage(item),
    customName: item.customName ?? '',
    brand: item.brand ?? '',
    customTags: item.customTags ?? [],
    category: normalizeCategory((item.customCategory as string) || item.category),
    subcategory: item.subcategory ?? '',
    subcategoryId: item.subcategoryId,
    colors: colors,
    seasonTags: seasonTags,
    styleTags: styleTags,
    sceneTags: sceneTags,
    material: material,
    thickness: thickness,
  };
}

function toUpdateInput(value: ClothingEditFormValue): ClothingUpdateInput {
  const colors = value.colors.filter(Boolean);
  
  const colorPalette: Array<{ name: string; hex: string; ratio: number }> = [];
  colors.forEach((colorKey, index) => {
    const colorMeta = getColorByKey(colorKey);
    if (colorMeta) {
      colorPalette.push({
        name: colorMeta.label,
        hex: colorMeta.hex,
        ratio: index === 0 ? 1 : 0
      });
    }
  });

  const styleTags = value.styleTags.map(normalizeStyleTag).filter(Boolean);
  const seasonTags = value.seasonTags.map(normalizeSeason).filter(Boolean);
  const sceneTags = (value.sceneTags || []).map(normalizeSceneTag).filter(Boolean);
  const customTags = (value.customTags || []).filter(Boolean);

  return {
    customName: value.customName || undefined,
    customCategory: normalizeCategory(value.category),
    category: normalizeCategory(value.category),
    subcategory: value.subcategory as ClothingUpdateInput['subcategory'],
    subcategoryId: value.subcategoryId,
    customTags: customTags.length > 0 ? customTags : undefined,
    brand: value.brand || undefined,
    colors: colors.length > 0 ? colors : undefined,
    colorPalette: colorPalette.length > 0 ? colorPalette : undefined,
    material: getMaterialStorageName(value.material) || undefined,
    materialGuess: getMaterialStorageName(value.material) || undefined,
    thickness: value.thickness ? normalizeThickness(value.thickness) : undefined,
    styleTags: styleTags.length > 0 ? styleTags : undefined,
    seasonTags: seasonTags.length > 0 ? seasonTags : undefined,
    sceneTags: sceneTags.length > 0 ? sceneTags : undefined,
  };
}
