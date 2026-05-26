import { View } from '@tarojs/components';
import Taro, { useLoad, useRouter } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import { ClothingEditForm, type ClothingEditFormValue } from '@/components/ClothingEditForm';
import { getClothingById, updateCloudClothing } from '@/lib/cloud';
import { getDisplayImage } from '@/utils/clothingLabels';
import type { Clothing, ClothingCategory, ClothingUpdateInput } from '@starter-template/types';
import './index.scss';

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
          submitText="保存"
          submitting={submitting}
          onSave={handleSave}
        />
      )}
    </View>
  );
}

function normalizeCategory(value?: string): ClothingCategory {
  const map: Record<string, ClothingCategory> = {
    top: 'top',
    上衣: 'top',
    外套: 'top',
    bottom: 'bottom',
    下装: 'bottom',
    裤子: 'bottom',
    裙子: 'bottom',
    onepiece: 'onepiece',
    dress: 'onepiece',
    连体: 'onepiece',
    连衣裙: 'onepiece',
    shoes: 'shoes',
    鞋子: 'shoes',
    accessory: 'accessory',
    配饰: 'accessory',
    包: 'accessory',
    帽子: 'accessory',
    other: 'other',
    其他: 'other',
  };
  return map[value || ''] || 'other';
}

function toFormValue(item: Clothing): ClothingEditFormValue {
  return {
    imageUrl: getDisplayImage(item),
    customName: item.customName ?? '',
    brand: item.brand ?? '',
    customTags: item.customTags ?? [],
    category: normalizeCategory((item.customCategory as string) || item.category),
    subcategory: item.subcategory ?? '',
    colors: item.colors ?? item.colorPalette?.map((color) => color.name).filter(Boolean) ?? [],
    seasonTags: (item.seasonTags ?? []).map(String),
    styleTags: (item.styleTags ?? []).map(String),
    material: item.materialGuess || item.material || '',
    thickness: item.thickness || '',
  };
}

function toUpdateInput(value: ClothingEditFormValue): ClothingUpdateInput {
  const colors = value.colors.filter(Boolean);
  const styleTags = value.styleTags.filter(Boolean);
  const seasonTags = value.seasonTags.filter(Boolean);
  const customTags = value.customTags?.filter(Boolean) ?? [];

  return {
    customName: value.customName || undefined,
    customCategory: value.category,
    category: value.category,
    subcategory: value.subcategory as ClothingUpdateInput['subcategory'],
    customTags: customTags.length > 0 ? customTags : undefined,
    brand: value.brand || undefined,
    colors: colors.length > 0 ? colors : undefined,
    colorPalette: colors.length > 0
      ? colors.map((name, index) => ({ name, hex: '#8A8A8A', ratio: index === 0 ? 1 : 0 }))
      : undefined,
    material: value.material || undefined,
    materialGuess: value.material || undefined,
    thickness: value.thickness || undefined,
    styleTags: styleTags.length > 0 ? styleTags : undefined,
    seasonTags: seasonTags.length > 0 ? seasonTags : undefined,
  };
}
