import { Text, View } from '@tarojs/components';
import Taro, { useLoad, useRouter, useUnload } from '@tarojs/taro';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ClothingEditForm, type ClothingEditFormValue } from '@/components/ClothingEditForm';
import { useBoundUserFlow } from '@/hooks/useBoundUserFlow';
import { getClothingById, updateCloudClothing } from '@/lib/cloud';
import { invalidateAfterWardrobeMutation } from '@/lib/cacheInvalidation';
import {
  captureAuthContext,
  isAuthContextCurrent,
  type ActiveAuthContext,
} from '@/lib/userPageCache';
import { setUserStorageSync } from '@/lib/userStorage';
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

function isCurrentAuthContext(authContext: ActiveAuthContext | null | undefined) {
  return Boolean(authContext && isAuthContextCurrent(authContext));
}

export default function ClothingFormPage() {
  const router = useRouter();
  const editId = router.params.id;
  const isEditMode = !!editId;

  const [loading, setLoading] = useState(isEditMode);
  const [submitting, setSubmitting] = useState(false);
  const [clothing, setClothing] = useState<Clothing | null>(null);
  const formInitialValue = useMemo(() => (clothing ? toFormValue(clothing) : null), [clothing]);
  const mountedRef = useRef(true);
  const requestSeqRef = useRef(0);
  const redirectingRef = useRef(false);

  const resetFlowState = useCallback(() => {
    requestSeqRef.current += 1;
    setLoading(false);
    setSubmitting(false);
    setClothing(null);
    Taro.hideLoading();
  }, []);

  const navigateToWardrobe = useCallback(() => {
    if (redirectingRef.current) return;
    redirectingRef.current = true;
    Taro.switchTab({ url: '/pages/wardrobe/index' }).catch((error) => {
      console.warn('Navigate to wardrobe failed:', error);
      redirectingRef.current = false;
    });
  }, []);

  const {
    boundRuntimeKeyRef,
    isFlowActive,
  } = useBoundUserFlow({
    onBind: () => {
      if (isEditMode) {
        void fetchClothing(editId);
        return;
      }
      setLoading(false);
    },
    onInvalidate: () => {
      resetFlowState();
      navigateToWardrobe();
    },
  });

  useLoad(() => {
    mountedRef.current = true;
  });

  useUnload(() => {
    mountedRef.current = false;
  });

  function isFlowCurrent(
    authContext: ActiveAuthContext | null | undefined,
    flowRuntimeKey: string | null,
    requestSeq?: number,
  ) {
    return Boolean(
      mountedRef.current
        && authContext
        && isCurrentAuthContext(authContext)
        && isFlowActive(flowRuntimeKey)
        && boundRuntimeKeyRef.current === flowRuntimeKey
        && (requestSeq === undefined || requestSeqRef.current === requestSeq),
    );
  }

  async function fetchClothing(id: string) {
    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!id || !authContext || !isFlowActive(flowRuntimeKey)) return;
    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    try {
      const item = await getClothingById(id);
      if (!isFlowCurrent(authContext, flowRuntimeKey, requestSeq)) return;
      setClothing(item);
    } catch (err) {
      console.error('Fetch clothing error:', err);
      if (isFlowCurrent(authContext, flowRuntimeKey, requestSeq)) {
        Taro.showToast({ title: '加载失败', icon: 'none' });
      }
    } finally {
      if (isFlowCurrent(authContext, flowRuntimeKey, requestSeq)) setLoading(false);
    }
  }

  async function handleSave(value: ClothingEditFormValue) {
    if (!clothing || submitting) return;

    const authContext = captureAuthContext();
    const flowRuntimeKey = boundRuntimeKeyRef.current;
    if (!authContext || !isFlowActive(flowRuntimeKey)) return;
    setSubmitting(true);
    Taro.showLoading({ title: '保存中...' });

    try {
      await updateCloudClothing(clothing.id, toUpdateInput(value));
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;
      await invalidateAfterWardrobeMutation({ authContext, source: 'wardrobe_edit' });
      if (!isFlowCurrent(authContext, flowRuntimeKey)) return;

      // 设置刷新标记
      setUserStorageSync(DETAIL_REFRESH_STORAGE_KEY, true, { authContext });
      setUserStorageSync(WARDROBE_REFRESH_STORAGE_KEY, true, { authContext });

      Taro.showToast({ title: '保存成功', icon: 'success' });
      setTimeout(() => {
        if (isFlowCurrent(authContext, flowRuntimeKey)) Taro.navigateBack();
      }, 800);
    } catch (err) {
      console.error('Save clothing error:', err);
      if (isFlowCurrent(authContext, flowRuntimeKey)) {
        Taro.showToast({ title: '保存失败', icon: 'none' });
      }
    } finally {
      Taro.hideLoading();
      if (isFlowCurrent(authContext, flowRuntimeKey)) setSubmitting(false);
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
      const colorName = cp.name?.trim() || cp.hex?.trim();
      if (!colorName) return;
      const colorMeta = normalizeColor(colorName);
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
