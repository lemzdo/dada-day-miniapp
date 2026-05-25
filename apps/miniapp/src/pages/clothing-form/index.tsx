import { View, Text, Input, ScrollView } from '@tarojs/components';
import Taro, { useLoad, useRouter } from '@tarojs/taro';
import { useState } from 'react';
import { getClothingById, updateCloudClothing } from '@/lib/cloud';
import { displayClothingTags, getDisplayImage } from '@/utils/clothingLabels';
import type { Clothing, ClothingCategory } from '@starter-template/types';
import './index.scss';

const categoryOptions: Array<{ key: ClothingCategory; label: string }> = [
  { key: 'top', label: '上衣' },
  { key: 'bottom', label: '下装' },
  { key: 'onepiece', label: '连体' },
  { key: 'shoes', label: '鞋子' },
  { key: 'accessory', label: '配饰' },
  { key: 'other', label: '其他' },
];

export default function ClothingFormPage() {
  const router = useRouter();
  const editId = router.params.id;
  const isEditMode = !!editId;

  const [loading, setLoading] = useState(isEditMode);
  const [submitting, setSubmitting] = useState(false);
  const [clothing, setClothing] = useState<Clothing | null>(null);
  const [customName, setCustomName] = useState('');
  const [customCategory, setCustomCategory] = useState<ClothingCategory>('top');
  const [brand, setBrand] = useState('');
  const [customTagsInput, setCustomTagsInput] = useState('');

  useLoad(() => {
    if (isEditMode) fetchClothing(editId);
  });

  async function fetchClothing(id: string) {
    setLoading(true);
    try {
      const item = await getClothingById(id);
      setClothing(item);
      setCustomName(item.customName ?? '');
      setCustomCategory((item.customCategory as ClothingCategory) ?? item.category);
      setBrand(item.brand ?? '');
      setCustomTagsInput(item.customTags?.join('、') ?? '');
    } catch (err) {
      console.error('Fetch clothing error:', err);
      Taro.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      setLoading(false);
    }
  }

  async function handleSave() {
    if (!clothing || submitting) return;

    setSubmitting(true);
    Taro.showLoading({ title: '保存中...' });

    try {
      const tags = customTagsInput
        .split(/[、,\s]+/)
        .map((tag) => tag.trim())
        .filter(Boolean);

      await updateCloudClothing(clothing.id, {
        customName: customName || undefined,
        customCategory,
        category: customCategory,
        customTags: tags.length > 0 ? tags : undefined,
        brand: brand || undefined,
      });

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
      <ScrollView className="form-scroll" scrollY>
        {isEditMode && clothing && (
          <View className="image-preview">
            <View className="preview-wrapper">
              <View className="preview-img" style={{ backgroundImage: `url(${getDisplayImage(clothing)})` }} />
            </View>
          </View>
        )}

        <View className="form-card">
          <Text className="form-title">{isEditMode ? '编辑信息' : '添加衣服'}</Text>

          <View className="form-item">
            <Text className="item-label">备注名称</Text>
            <Input
              className="item-input"
              value={customName}
              onInput={(event) => setCustomName(event.detail.value)}
              placeholder="例如：我的白T"
              maxlength={64}
            />
          </View>

          <View className="form-item">
            <Text className="item-label">品类</Text>
            <View className="category-grid">
              {categoryOptions.map((opt) => (
                <View
                  key={opt.key}
                  className={`category-chip ${customCategory === opt.key ? 'active' : ''}`}
                  onClick={() => setCustomCategory(opt.key)}
                >
                  <Text className="chip-text">{opt.label}</Text>
                </View>
              ))}
            </View>
          </View>

          <View className="form-item">
            <Text className="item-label">品牌</Text>
            <Input
              className="item-input"
              value={brand}
              onInput={(event) => setBrand(event.detail.value)}
              placeholder="例如：优衣库"
              maxlength={64}
            />
          </View>

          <View className="form-item">
            <Text className="item-label">标签</Text>
            <Input
              className="item-input"
              value={customTagsInput}
              onInput={(event) => setCustomTagsInput(event.detail.value)}
              placeholder="多个标签用顿号或空格分隔"
              maxlength={200}
            />
            <Text className="item-hint">例如：百搭、春秋、通勤</Text>
          </View>
        </View>

        {isEditMode && clothing && (
          <View className="ai-card">
            <Text className="ai-title">小搭整理结果，仅供参考</Text>
            <View className="ai-tags">
              <AiTagRow label="风格" tags={displayClothingTags(clothing.styleTags)} />
              <AiTagRow label="季节" tags={displayClothingTags(clothing.seasonTags)} />
              <AiTagRow label="场景" tags={displayClothingTags(clothing.sceneTags)} />
              {!clothing.styleTags?.length && !clothing.seasonTags?.length && !clothing.sceneTags?.length && (
                <Text className="no-ai">暂无小搭整理数据</Text>
              )}
            </View>
          </View>
        )}
      </ScrollView>

      <View className="action-bar">
        <View className={`save-btn ${submitting ? 'disabled' : ''}`} onClick={handleSave}>
          <Text className="btn-text">{submitting ? '保存中...' : '保存'}</Text>
        </View>
      </View>
    </View>
  );
}

function AiTagRow({ label, tags }: { label: string; tags?: string[] }) {
  if (!tags?.length) return null;

  return (
    <View className="ai-tag-row">
      <Text className="tag-label">{label}</Text>
      <View className="tag-list">
        {tags.map((tag) => (
          <View key={tag} className="tag-chip">
            <Text className="chip-text">{tag}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}
