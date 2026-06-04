import { Image, Text, View, ScrollView } from '@tarojs/components';
import Taro, { useDidShow, useLoad, useRouter } from '@tarojs/taro';
import { useCallback, useEffect, useState } from 'react';
import {
  getDisplayCategory,
  getDisplayImage,
  getSubcategoryDisplayLabel,
} from '@/utils/clothingLabels';
import {
  normalizeCategory,
  normalizeThickness,
  getThicknessLabel,
  normalizeSeason,
  getSeasonLabel,
  normalizeStyleTag,
  normalizeSceneTag,
  normalizeColor,
  getColorSummaryLabel,
  resolveMaterialDisplayName,
} from '@/utils/clothingFieldNormalize';
import {
  getClothingById,
  getUserClothingMaterials,
  deleteCloudClothing,
  segmentCloudClothing,
  recognizeClothAttributes,
  inspectCloudClothingDelete,
} from '@/lib/cloud';
import type { Clothing, UserClothingMaterial } from '@starter-template/types';
import './index.scss';

const WARDROBE_REFRESH_STORAGE_KEY = 'wardrobeNeedsRefresh';
const DETAIL_REFRESH_STORAGE_KEY = 'detailNeedsRefresh';

export default function ClothingDetailPage() {
  const router = useRouter();
  const id = router.params.id as string;
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [clothing, setClothing] = useState<Clothing | null>(null);
  const [userMaterials, setUserMaterials] = useState<UserClothingMaterial[]>([]);
  const [colorExpanded, setColorExpanded] = useState(false);

  const fetchClothing = useCallback(async (itemId: string) => {
    setLoading(true);
    try {
      const item = await getClothingById(itemId);
      setClothing(item);
    } catch (err) {
      console.error('Fetch clothing error:', err);
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }, []);

  useLoad(() => fetchClothing(id));

  useEffect(() => {
    getUserClothingMaterials()
      .then(setUserMaterials)
      .catch((err) => {
        console.error('Load user materials error:', err);
      });
  }, []);

  useEffect(() => {
    setColorExpanded(false);
  }, [clothing?.id]);

  useDidShow(() => {
    // 检查是否需要强制刷新（从编辑页返回）
    try {
      const needsRefresh = Taro.getStorageSync(DETAIL_REFRESH_STORAGE_KEY);
      if (needsRefresh) {
        // 清除标记并强制刷新
        Taro.removeStorageSync(DETAIL_REFRESH_STORAGE_KEY);
        fetchClothing(id);
      }
    } catch (err) {
      console.error('Check refresh flag error:', err);
    }
  });

  const handleEdit = useCallback(() => {
    if (!clothing) return;
    Taro.navigateTo({ url: `/pages/clothing-form/index?id=${clothing.id}` });
  }, [clothing]);

  const handleDelete = useCallback(async () => {
    if (!clothing) return;
    try {
      const impact = await inspectCloudClothingDelete(clothing.id);
      
      let content = '删除后这件衣服会从衣柜和推荐中移除，7天后清理图片。';
      const impacts: string[] = [];
      if (impact.affectedFavoriteCount > 0) {
        impacts.push(`${impact.affectedFavoriteCount} 个收藏穿搭`);
      }
      if (impact.affectedHistoryCount > 0) {
        impacts.push(`${impact.affectedHistoryCount} 个历史穿搭`);
      }
      if (impacts.length > 0) {
        content = `这件衣服被 ${impacts.join('、')} 使用。删除后会保留穿搭快照，并标记为不完整，7天后清理衣服图片。`;
      }
      
      const modalRes = await Taro.showModal({
        title: '删除这件衣服',
        content,
        confirmColor: '#D4635E',
      });
      
      if (modalRes.confirm) {
        await deleteCloudClothing(clothing.id);
        // 标记需要刷新衣橱
        Taro.setStorageSync(WARDROBE_REFRESH_STORAGE_KEY, true);
        Taro.showToast({ title: '已删除', icon: 'success' });
        setTimeout(() => Taro.navigateBack(), 600);
      }
    } catch (err) {
      console.error('Delete error:', err);
      Taro.showToast({ title: '删除失败', icon: 'none' });
    }
  }, [clothing]);

  const handleReprocessImage = useCallback(async () => {
    if (!clothing) return;
    
    const isProcessing = isAiProcessing(clothing);
    if (isProcessing) {
      Taro.showToast({ title: '正在处理中，请稍后...', icon: 'none' });
      return;
    }
    
    const modalRes = await Taro.showModal({
      title: '重新处理图片',
      content: '需要重新处理这张图片吗？',
    });
    
    if (modalRes.confirm) {
      try {
        setProcessing(true);
        await segmentCloudClothing(clothing.id);
        Taro.showToast({ title: '开始处理...', icon: 'none' });
        // 立即刷新页面
        await fetchClothing(id);
        Taro.showToast({ title: '处理完成', icon: 'success' });
      } catch (err) {
        console.error('Reprocess error:', err);
        Taro.showToast({ title: '处理失败', icon: 'none' });
      } finally {
        setProcessing(false);
      }
    }
  }, [clothing, id, fetchClothing]);

  const handleReRecognize = useCallback(async () => {
    if (!clothing) return;
    
    const isProcessing = isAiProcessing(clothing);
    if (isProcessing) {
      Taro.showToast({ title: '正在识别中，请稍后...', icon: 'none' });
      return;
    }
    
    const modalRes = await Taro.showModal({
      title: '重新识别属性',
      content: '让AI重新识别这张图片的属性吗？',
    });
    
    if (modalRes.confirm) {
      try {
        setProcessing(true);
        await recognizeClothAttributes(clothing.id);
        Taro.showToast({ title: '开始识别...', icon: 'none' });
        // 立即刷新页面
        await fetchClothing(id);
        Taro.showToast({ title: '识别完成', icon: 'success' });
      } catch (err) {
        console.error('Re-recognize error:', err);
        Taro.showToast({ title: '识别失败', icon: 'none' });
      } finally {
        setProcessing(false);
      }
    }
  }, [clothing, id, fetchClothing]);

  if (loading) {
    return (
      <View className="clothing-detail-page">
        <View className="detail-header">
          <Text className="page-title">衣物小档案</Text>
        </View>
        <ScrollView className="detail-content" scrollY>
          <View className="main-card">
            <View className="skeleton-image" />
            <View className="skeleton-line" />
            <View className="skeleton-line short" />
          </View>
        </ScrollView>
      </View>
    );
  }

  if (!clothing) {
    return (
      <View className="clothing-detail-page">
        <View className="detail-header">
          <Text className="page-title">衣物小档案</Text>
        </View>
        <ScrollView className="detail-content" scrollY>
          <View className="empty-state">
            <Text className="empty-text">衣物不存在</Text>
          </View>
        </ScrollView>
      </View>
    );
  }

  const colorPaletteItems = getColorItems(clothing);
  const colorSummaryText = getColorSummaryText(colorPaletteItems);
  const visibleColorItems = colorExpanded ? colorPaletteItems : colorPaletteItems.slice(0, 3);
  const canToggleColors = colorPaletteItems.length > 3;
  const featureTags = getFeatureTags(clothing, userMaterials);
  const styleTags = getNormalizedStyleTags(clothing);
  const sceneTags = getNormalizedSceneTags(clothing);
  const seasonTags = clothing.seasonTags?.map(tag => getSeasonLabel(normalizeSeason(tag))) || [];
  const allFitTags = [...styleTags, ...seasonTags, ...sceneTags];
  const customTags = (clothing.customTags || []).map(tag => tag.trim()).filter(Boolean);
  const isProcessingState = isAiProcessing(clothing);

  return (
    <View className="clothing-detail-page">
      <View className="detail-header">
        <Text className="page-title">衣物小档案</Text>
        <View className="detail-edit-link" onClick={handleEdit}>
          <Text className="detail-edit-link-text">编辑</Text>
        </View>
      </View>

      <ScrollView className="detail-content" scrollY>
        {/* 主视觉卡 */}
        <View className="main-card">
          <View className="image-wrapper">
            <Image
              className="clothing-image"
              src={getDisplayImage(clothing)}
              mode="aspectFit"
            />
            {isProcessingState && (
              <View className="ai-status-badge processing">
                <Text className="ai-status-text">处理中</Text>
              </View>
            )}
          </View>

          <View className="identity-section">
            <View className="identity-header">
              <View className="identity-text">
                <Text className="clothing-name">
                  {clothing.customName || getSubcategoryDisplayLabel(normalizeCategory(clothing.category), clothing.subcategory) || '未命名衣物'}
                </Text>
                <Text className="clothing-category">
                  {getDisplayCategory({
                    category: normalizeCategory(clothing.category),
                    subcategory: clothing.subcategory,
                  })}
                </Text>
              </View>
            </View>

            <View className="core-tags">
              {featureTags.map((tag, idx) => (
                <Text key={idx} className="core-tag">{tag}</Text>
              ))}
              {seasonTags.slice(0, 2).map((tag, idx) => (
                <Text key={`season-${idx}`} className="core-tag">{tag}</Text>
              ))}
            </View>
          </View>
        </View>

        {/* 主色调 */}
        {colorPaletteItems.length > 0 && (
          <View className="section-card">
            <Text className="section-title">主色调</Text>
            <View className="color-summary-card">
              <View className="color-summary-main">
                <View className="color-swatch-row">
                  {visibleColorItems.slice(0, 3).map((item, idx) => (
                    <View
                      key={`${item.key}-${idx}`}
                      className="color-swatch"
                      style={{ backgroundColor: item.hex, borderColor: item.border }}
                    />
                  ))}
                </View>
                <Text className="color-summary-name">{colorSummaryText}</Text>
                {canToggleColors && (
                  <Text className="color-toggle" onClick={() => setColorExpanded(prev => !prev)}>
                    {colorExpanded ? '收起' : '展开'}
                  </Text>
                )}
              </View>
              {colorExpanded && (
                <View className="color-detail-list">
                  {colorPaletteItems.map((item, idx) => (
                    <View key={`${item.key}-${idx}`} className="color-detail-chip">
                      <View
                        className="color-detail-swatch"
                        style={{ backgroundColor: item.hex, borderColor: item.border }}
                      />
                      <Text className="color-detail-name">{item.name}</Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          </View>
        )}

        {/* 适合穿去 */}
        {allFitTags.length > 0 && (
          <View className="section-card">
            <Text className="section-title">适合穿去</Text>
            <View className="fit-tags">
              {allFitTags.map((tag, idx) => (
                <Text key={idx} className="fit-tag">{tag}</Text>
              ))}
            </View>
          </View>
        )}

        {/* 我的标签 */}
        {customTags.length > 0 && (
          <View className="section-card">
            <Text className="section-title">我的标签</Text>
            <View className="custom-tags-section">
              {customTags.map((tag, idx) => (
                <Text key={idx} className="custom-tag-chip">{tag}</Text>
              ))}
            </View>
          </View>
        )}

        {/* 更多整理 */}
        <View className="section-card manage-card">
          <Text className="section-title">更多整理</Text>
          <View className="manage-list">
            <View 
              className={`manage-item ${isProcessingState ? 'disabled' : ''}`} 
              onClick={isProcessingState ? undefined : handleReprocessImage}
            >
              <View className="manage-item-content">
                <Text className="manage-text">重新处理图片</Text>
                <Text className="manage-desc">图片不自然时，让小搭重新整理</Text>
              </View>
              {isProcessingState ? (
                <View className="status-badge">
                  <Text className="status-text">处理中</Text>
                </View>
              ) : (
                <Text className="manage-arrow">›</Text>
              )}
            </View>

            <View 
              className={`manage-item ${isProcessingState ? 'disabled' : ''}`} 
              onClick={isProcessingState ? undefined : handleReRecognize}
            >
              <View className="manage-item-content">
                <Text className="manage-text">重新识别属性</Text>
                <Text className="manage-desc">颜色、材质或风格不准时，可以再识别</Text>
              </View>
              {isProcessingState ? (
                <View className="status-badge">
                  <Text className="status-text">识别中</Text>
                </View>
              ) : (
                <Text className="manage-arrow">›</Text>
              )}
            </View>

            <View className="manage-item danger" onClick={handleDelete}>
              <View className="manage-item-content">
                <Text className="manage-text">删除这件衣服</Text>
                <Text className="manage-desc">从衣橱移除，已保存的搭配尽量保留灵感记录</Text>
              </View>
              <Text className="manage-arrow">›</Text>
            </View>
          </View>
        </View>

        <View className="bottom-padding" />
      </ScrollView>

      {processing && (
        <View className="loading-overlay">
          <View className="loading-spinner" />
          <Text className="loading-text">处理中...</Text>
        </View>
      )}
    </View>
  );
}

function isAiProcessing(item: Clothing): boolean {
  const status = item.aiStatus || item.aiRecognizeStatus;
  return status === 'pending' || status === 'recognizing';
}

interface DetailColorItem {
  name: string;
  key: string;
  hex: string;
  border: string;
}

function getColorItems(item: Clothing): DetailColorItem[] {
  const palette = item.colorPalette;
  if (palette && palette.length > 0) {
    return palette.map((cp) => {
      const colorMeta = normalizeColor(cp.name || cp.hex);
      return {
        name: colorMeta.label || cp.name || cp.hex || '',
        key: colorMeta.key,
        hex: cp.hex || colorMeta.hex,
        border: colorMeta.border,
      };
    });
  }

  const colors = item.colors;
  if (colors && colors.length > 0) {
    return colors.map((c) => {
      const colorMeta = normalizeColor(c);
      return { name: colorMeta.label || c, key: colorMeta.key, hex: colorMeta.hex, border: colorMeta.border };
    });
  }

  return [];
}

function getColorSummaryText(colors: DetailColorItem[]) {
  return getColorSummaryLabel(colors.map((item) => item.name));
}

function getFeatureTags(item: Clothing, userMaterials: UserClothingMaterial[]): string[] {
  const tags: string[] = [];
  const material = item.material || item.materialGuess;
  if (material) {
    const label = resolveMaterialDisplayName(material, userMaterials, '自定义材质');
    if (label) tags.push(label);
  }
  if (item.thickness) {
    const normalized = normalizeThickness(item.thickness);
    tags.push(getThicknessLabel(normalized));
  }
  if (item.brand) {
    tags.push(item.brand);
  }
  return tags;
}

function getNormalizedStyleTags(item: Clothing): string[] {
  if (!item.styleTags || item.styleTags.length === 0) return [];
  return item.styleTags.map(tag => {
    const normalized = normalizeStyleTag(tag);
    return normalized;
  }).filter(Boolean);
}

function getNormalizedSceneTags(item: Clothing): string[] {
  if (!item.sceneTags || item.sceneTags.length === 0) return [];
  return item.sceneTags.map(tag => {
    const normalized = normalizeSceneTag(tag);
    return normalized;
  }).filter(Boolean);
}
