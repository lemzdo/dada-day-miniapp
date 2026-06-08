import { Input, Text, View, ScrollView } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useMemo, useState } from 'react';
import { SafeImage } from '@/components/SafeImage';
import {
  normalizeCategory,
  normalizeMaterial,
  getMaterialLabel,
  getMaterialStorageName,
  resolveMaterialDisplayName,
  normalizeThickness,
  getThicknessLabel,
  normalizeSeason,
  getSeasonLabel,
  normalizeStyleTag,
  normalizeSceneTag,
  normalizeColor,
  getColorSummaryLabel,
  STANDARD_COLOR_GROUPS,
  STANDARD_COLORS
} from '../../utils/clothingFieldNormalize';
import { displayClothingText, getSubcategoryDisplayLabel } from '../../utils/clothingLabels';
import {
  archiveUserClothingMaterial,
  createUserClothingMaterial,
  createUserClothingSubcategory,
  getUserClothingMaterials,
  getUserClothingSubcategories,
} from '../../lib/cloud';
import type { SelectOption } from './constants';
import type { ClothingCategory, UserClothingSubcategory, UserClothingMaterial } from '@starter-template/types';
import {
  CATEGORY_OPTIONS,
  MATERIAL_OPTIONS,
  SEASON_OPTIONS,
  STYLE_OPTIONS,
  SCENE_OPTIONS,
  SUBCATEGORY_OPTIONS,
  THICKNESS_OPTIONS
} from './constants';
import './index.scss';

export interface ClothingEditFormValue {
  imageUrl?: string;
  customName?: string;
  brand?: string;
  customTags?: string[];
  category: string;
  subcategory?: string;
  subcategoryId?: string;
  colors: string[];
  seasonTags: string[];
  styleTags: string[];
  sceneTags?: string[];
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
  mode?: 'detail-edit' | 'draft-confirm';
}

type PopupType = 
  | 'category' 
  | 'subcategory' 
  | 'colors' 
  | 'material' 
  | 'thickness' 
  | 'styleTags' 
  | 'seasonTags' 
  | 'sceneTags' 
  | 'addTag' 
  | null;

interface SessionCustomSubcategory {
  id?: string;
  name: string;
  normalizedName?: string;
  parentCategory: ClothingCategory;
}

interface MaterialSelectOption extends SelectOption<string> {
  id?: string;
}

export function ClothingEditForm({
  initialValue,
  showImage = false,
  showMetaFields = true,
  submitText = '保存衣物档案',
  submitting = false,
  onSave,
  onCancel,
  mode = 'detail-edit'
}: ClothingEditFormProps) {
  const [value, setValue] = useState<ClothingEditFormValue>(() => normalizeInitialValue(initialValue));
  const [popup, setPopup] = useState<PopupType>(null);
  const [tempValue, setTempValue] = useState<any>(null);
  const [userSubcategories, setUserSubcategories] = useState<UserClothingSubcategory[]>([]);
  const [userMaterials, setUserMaterials] = useState<UserClothingMaterial[]>([]);
  const [sessionCustomSubcategories, setSessionCustomSubcategories] = useState<SessionCustomSubcategory[]>([]);
  const [sessionCustomMaterials, setSessionCustomMaterials] = useState<string[]>([]);
  const [newSubcategoryName, setNewSubcategoryName] = useState('');
  const [newMaterialName, setNewMaterialName] = useState('');
  const [newTagName, setNewTagName] = useState('');
  const [addingSubcategory, setAddingSubcategory] = useState(false);
  const [addingMaterial, setAddingMaterial] = useState(false);
  const [managingMaterials, setManagingMaterials] = useState(false);
  const [archivingMaterialIds, setArchivingMaterialIds] = useState<string[]>([]);
  const [rejoiningMaterial, setRejoiningMaterial] = useState(false);

  const isDraftConfirm = mode === 'draft-confirm';

  useEffect(() => {
    setValue(normalizeInitialValue(initialValue));
  }, [initialValue]);

  useEffect(() => {
    if (!isDraftConfirm) {
      loadUserSubcategories();
      loadUserMaterials();
    }
  }, [isDraftConfirm]);

  useEffect(() => {
    if (userMaterials.length === 0 || !value.material) return;
    const materialName = getMaterialStorageName(value.material, userMaterials);
    if (materialName && materialName !== value.material) {
      setValue(prev => ({ ...prev, material: materialName }));
    }
  }, [userMaterials, value.material]);

  async function loadUserSubcategories() {
    try {
      const categories = await getUserClothingSubcategories();
      setUserSubcategories(categories);
    } catch (err) {
      console.error('Load user subcategories error:', err);
    }
  }

  async function loadUserMaterials() {
    try {
      const materials = await getUserClothingMaterials();
      setUserMaterials(materials);
    } catch (err) {
      console.error('Load user materials error:', err);
    }
  }

  const subcategoryOptions = useMemo(() => {
    const systemOptions = SUBCATEGORY_OPTIONS[value.category as ClothingCategory] ?? [];
    const userOptions = userSubcategories
      .filter((cat) => cat.parentCategory === value.category && cat.status === 'active')
      .map((cat) => ({ value: cat.name, label: cat.name, id: cat.id, isCustom: true }));
    
    const sessionOptions = sessionCustomSubcategories.filter((opt) => {
      if (opt.parentCategory !== value.category) return false;
      const existsInSystem = systemOptions.some(s => s.value === opt.name || s.label === opt.name);
      const existsInUser = userOptions.some(u => u.value === opt.name || u.label === opt.name);
      return !existsInSystem && !existsInUser;
    }).map((opt) => ({
      value: opt.name,
      label: getSubcategoryDisplayLabel(value.category, opt.name, userSubcategories),
      isCustom: true,
    }));

    const hasCurrentNonPreset = value.subcategory && !isPresetSubcategory(value.category, value.subcategory);
    let options: Array<SelectOption<string> & { isCustom?: boolean }> = [];

    if (hasCurrentNonPreset && value.subcategory) {
      const existsInOptions = 
        options.some(o => o.value === value.subcategory || o.label === getSubcategoryDisplayLabel(value.category, value.subcategory, userSubcategories)) ||
        systemOptions.some(s => s.value === value.subcategory || s.label === value.subcategory) ||
        userOptions.some(u => u.value === value.subcategory || u.label === value.subcategory) ||
        sessionOptions.some(s => s.value === value.subcategory || s.label === getSubcategoryDisplayLabel(value.category, value.subcategory, userSubcategories));
      
      if (!existsInOptions) {
        options.push({
          value: value.subcategory,
          label: getSubcategoryDisplayLabel(value.category, value.subcategory, userSubcategories),
          isCustom: true,
        });
      }
    }

    // 为 systemOptions 也确保标签显示正确
    const processedSystemOptions = systemOptions.map(opt => ({
      ...opt,
      label: getSubcategoryDisplayLabel(value.category, opt.value, userSubcategories)
    }));

    options = [...options, ...userOptions, ...sessionOptions, ...processedSystemOptions];
    return options;
  }, [value.category, value.subcategory, userSubcategories, sessionCustomSubcategories]);

  function isPresetSubcategory(category: string, subcategory: string): boolean {
    const options = SUBCATEGORY_OPTIONS[category as ClothingCategory] ?? [];
    return options.some((opt: SelectOption<any>) => opt.value === subcategory || opt.label === subcategory);
  }

  function normalizeCustomSubcategoryName(name: string) {
    return name.trim().toLowerCase().replace(/\s+/g, '');
  }

  function normalizeCustomMaterialName(name: string) {
    return name.trim().toLowerCase().replace(/\s+/g, '');
  }

  function isSubcategoryAllowedForCategory(category: string, subcategory: string, subcategoryId?: string): boolean {
    const normalizedName = normalizeCustomSubcategoryName(subcategory);
    const systemOptions = SUBCATEGORY_OPTIONS[category as ClothingCategory] ?? [];
    if (systemOptions.some((opt) => opt.value === subcategory || opt.label === subcategory || normalizeCustomSubcategoryName(opt.label) === normalizedName)) {
      return true;
    }

    if (userSubcategories.some((item) => (
      item.status === 'active' &&
      item.parentCategory === category &&
      (item.id === subcategoryId || item.id === subcategory || item.name === subcategory || item.normalizedName === normalizedName)
    ))) {
      return true;
    }

    return sessionCustomSubcategories.some((item) => (
      item.parentCategory === category &&
      (item.id === subcategoryId || item.name === subcategory || item.normalizedName === normalizedName)
    ));
  }

  function isPresetMaterial(material: string): boolean {
    return MATERIAL_OPTIONS.some((opt) => opt.value === material || opt.label === material);
  }

  function openPopup(type: PopupType) {
    if (type === 'category') {
      setTempValue(value.category);
    } else if (type === 'subcategory') {
      setTempValue(value.subcategory);
    } else if (type === 'colors') {
      setTempValue([...value.colors]);
    } else if (type === 'material') {
      setTempValue(value.material);
    } else if (type === 'thickness') {
      setTempValue(value.thickness);
    } else if (type === 'styleTags') {
      setTempValue([...value.styleTags]);
    } else if (type === 'seasonTags') {
      setTempValue([...value.seasonTags]);
    } else if (type === 'sceneTags') {
      setTempValue([...(value.sceneTags || [])]);
    }
    setPopup(type);
  }

  function closePopup() {
    setPopup(null);
    setTempValue(null);
    setNewSubcategoryName('');
    setNewMaterialName('');
    setNewTagName('');
    setManagingMaterials(false);
  }

  function updateTempValue(newVal: any) {
    setTempValue(newVal);
  }

  function confirmSingle(type: PopupType, val: string) {
    setValue(prev => {
      const update: Partial<ClothingEditFormValue> = {};
      if (type === 'category') {
        // 切换大类时，如果当前细分类不属于新大类，清空细分类
        const currentSubcategory = prev.subcategory;
        if (currentSubcategory && !isSubcategoryAllowedForCategory(val, currentSubcategory, prev.subcategoryId)) {
          update.subcategory = '';
          update.subcategoryId = '';
        }
        update.category = val;
      } else if (type === 'subcategory') {
        const userSubcategory = userSubcategories.find(
          item => item.status === 'active' && item.parentCategory === value.category && (item.id === val || item.name === val),
        );
        update.subcategory = userSubcategory?.name ?? val;
        update.subcategoryId = userSubcategory?.id ?? '';
      } else if (type === 'material') {
        update.material = getMaterialStorageName(val, userMaterials);
      } else if (type === 'thickness') {
        update.thickness = val;
      }
      return { ...prev, ...update };
    });
    closePopup();
  }

  function confirmMultiple(type: PopupType) {
    setValue(prev => {
      const update: Partial<ClothingEditFormValue> = {};
      if (type === 'colors') update.colors = tempValue;
      else if (type === 'styleTags') update.styleTags = tempValue;
      else if (type === 'seasonTags') update.seasonTags = tempValue;
      else if (type === 'sceneTags') update.sceneTags = tempValue;
      return { ...prev, ...update };
    });
    closePopup();
  }

  async function handleAddSubcategory() {
    const trimmedName = newSubcategoryName.trim();
    const normalizedName = normalizeCustomSubcategoryName(trimmedName);

    if (!trimmedName) {
      Taro.showToast({ title: '请输入细分类名称', icon: 'none' });
      return;
    }

    if (trimmedName.length > 8) {
      Taro.showToast({ title: '最多8个字', icon: 'none' });
      return;
    }

    // 先检查是否是系统预设的细分类
    const systemOptions = SUBCATEGORY_OPTIONS[value.category as ClothingCategory] ?? [];
    const foundSystemOption = systemOptions.find(
      opt => 
        opt.value === trimmedName || 
        opt.label === trimmedName
    );
    
    if (foundSystemOption) {
      setValue(prev => ({
        ...prev,
        subcategory: foundSystemOption.value,
        subcategoryId: '',
      }));
      Taro.showToast({ title: '已选择该细分类', icon: 'success' });
      closePopup();
      return;
    }
    
    // 再检查是否已经是用户的自定义细分类
    const foundUserSubcategory = userSubcategories.find(
      cat => 
        cat.parentCategory === value.category && 
        cat.status === 'active' && 
        (cat.name === trimmedName || cat.normalizedName === normalizedName)
    );
    
    if (foundUserSubcategory) {
      setValue(prev => ({
        ...prev,
        subcategory: foundUserSubcategory.name,
        subcategoryId: foundUserSubcategory.id,
      }));
      Taro.showToast({ title: '这个分类已经在你的衣柜里啦', icon: 'success' });
      closePopup();
      return;
    }

    // 检查 session 自定义细分类
    if (sessionCustomSubcategories.some(item => item.parentCategory === value.category && item.normalizedName === normalizedName)) {
      setValue(prev => ({
        ...prev,
        subcategory: trimmedName,
        subcategoryId: '',
      }));
      Taro.showToast({ title: '这个分类已经在你的衣柜里啦', icon: 'success' });
      closePopup();
      return;
    }

    setAddingSubcategory(true);
    try {
      const result = await createUserClothingSubcategory({
        name: trimmedName,
        parentCategory: value.category as ClothingCategory,
      });

      setSessionCustomSubcategories(prev => {
        if (prev.some(item => item.parentCategory === value.category && item.normalizedName === normalizedName)) return prev;
        return [{
          id: result.id,
          name: result.name ?? trimmedName,
          normalizedName: result.normalizedName ?? normalizedName,
          parentCategory: value.category as ClothingCategory,
        }, ...prev];
      });

      setValue(prev => ({
        ...prev,
        subcategory: result.name ?? trimmedName,
        subcategoryId: result.id,
      }));

      Taro.showToast({ title: '添加成功', icon: 'success' });
      closePopup();
      await loadUserSubcategories();
    } catch (err) {
      console.error('Add subcategory error:', err);
      Taro.showToast({ title: '细分类没添加成功，稍后再试试', icon: 'none' });
    } finally {
      setAddingSubcategory(false);
    }
  }

  async function handleAddMaterial() {
    const trimmedName = newMaterialName.trim();
    const normalizedName = normalizeCustomMaterialName(trimmedName);

    if (!trimmedName) {
      Taro.showToast({ title: '请输入材质名称', icon: 'none' });
      return;
    }

    if (trimmedName.length > 12) {
      Taro.showToast({ title: '材质名称最多12个字', icon: 'none' });
      return;
    }

    const normalized = normalizeMaterial(trimmedName);
    const isPreset = isPresetMaterial(normalized) || isPresetMaterial(trimmedName);
    
    if (isPreset) {
      setValue(prev => ({ ...prev, material: getMaterialLabel(normalized) }));
      Taro.showToast({ title: '已选择该材质', icon: 'success' });
      closePopup();
      return;
    }
    
    // 检查是否已经是用户的自定义材质
    const foundUserMaterial = userMaterials.find(
      m => 
        m.status === 'active' && 
        (m.name === trimmedName || m.normalizedName === normalizedName)
    );
    
    if (foundUserMaterial) {
      setValue(prev => ({
        ...prev,
        material: foundUserMaterial.name,
      }));
      Taro.showToast({ title: '这个材质已经在你的衣柜里啦', icon: 'success' });
      closePopup();
      return;
    }

    // 检查 session 自定义材质
    if (sessionCustomMaterials.some(item => normalizeCustomMaterialName(item) === normalizedName)) {
      setValue(prev => ({
        ...prev,
        material: trimmedName,
      }));
      Taro.showToast({ title: '这个材质已经在你的衣柜里啦', icon: 'success' });
      closePopup();
      return;
    }

    setAddingMaterial(true);
    try {
      const result = await createUserClothingMaterial({
        name: trimmedName,
      });

      setSessionCustomMaterials(prev => {
        if (prev.some(item => normalizeCustomMaterialName(item) === normalizedName)) return prev;
        return [result.name ?? trimmedName, ...prev];
      });

      setUserMaterials(prev => {
        const nextMaterial = {
          id: result.id,
          userId: result.userId,
          name: result.name ?? trimmedName,
          normalizedName: result.normalizedName ?? normalizedName,
          status: 'active' as const,
          createdAt: result.createdAt,
          updatedAt: result.updatedAt,
        };
        return [nextMaterial, ...prev.filter(item => item.id !== result.id && item.normalizedName !== nextMaterial.normalizedName)];
      });

      setValue(prev => ({
        ...prev,
        material: result.name ?? trimmedName,
      }));

      Taro.showToast({ title: result.reused ? '这个材质已经在你的衣橱里啦' : '添加成功', icon: 'success' });
      closePopup();
      await loadUserMaterials();
    } catch (err) {
      console.error('Add material error:', err);
      Taro.showToast({ title: '材质没添加成功，稍后再试试', icon: 'none' });
    } finally {
      setAddingMaterial(false);
    }
  }

  async function handleArchiveMaterial(option: MaterialSelectOption) {
    if (!option.id || archivingMaterialIds.includes(option.id)) return;
    const isCurrent = value.material === option.value || value.material === option.label;

    if (isCurrent) {
      const modalRes = await Taro.showModal({
        title: '移除这个材质？',
        content: '这个材质正在这件衣服上使用。移出后，这件衣服会暂时不设置材质，其他已保存衣服不受影响。',
        confirmText: '确认移除',
        confirmColor: '#D4635E',
      });
      if (!modalRes.confirm) return;
    }

    setArchivingMaterialIds(prev => [...prev, option.id as string]);
    try {
      await archiveUserClothingMaterial(option.id);
      setUserMaterials(prev => prev.filter(item => item.id !== option.id));
      setSessionCustomMaterials(prev => (
        prev.filter(item => normalizeCustomMaterialName(item) !== normalizeCustomMaterialName(option.label))
      ));
      if (isCurrent) {
        setValue(prev => ({ ...prev, material: '' }));
        setTempValue('');
      }
      Taro.showToast({ title: '已从你的材质里移出', icon: 'success' });
    } catch (err) {
      console.error('Archive material error:', err);
      Taro.showToast({ title: '材质没移出成功，稍后再试试', icon: 'none' });
    } finally {
      setArchivingMaterialIds(prev => prev.filter(id => id !== option.id));
    }
  }

  async function handleRejoinCurrentMaterial() {
    const materialName = getMaterialStorageName(value.material, userMaterials);
    if (!materialName || rejoiningMaterial) return;

    setRejoiningMaterial(true);
    try {
      const result = await createUserClothingMaterial({ name: materialName });
      const nextMaterial = {
        id: result.id,
        userId: result.userId,
        name: result.name ?? materialName,
        normalizedName: result.normalizedName ?? normalizeCustomMaterialName(materialName),
        status: 'active' as const,
        createdAt: result.createdAt,
        updatedAt: result.updatedAt,
      };
      setUserMaterials(prev => [
        nextMaterial,
        ...prev.filter(item => item.id !== nextMaterial.id && item.normalizedName !== nextMaterial.normalizedName),
      ]);
      setValue(prev => ({ ...prev, material: nextMaterial.name }));
      setTempValue(nextMaterial.name);
      Taro.showToast({ title: '已重新加入你的材质', icon: 'success' });
    } catch (err) {
      console.error('Rejoin material error:', err);
      Taro.showToast({ title: '材质没加入成功，稍后再试试', icon: 'none' });
    } finally {
      setRejoiningMaterial(false);
    }
  }

  function handleAddTag() {
    const trimmedName = newTagName.trim();

    if (!trimmedName) {
      Taro.showToast({ title: '请输入标签', icon: 'none' });
      return;
    }

    if (trimmedName.length > 8) {
      Taro.showToast({ title: '标签最多8个字', icon: 'none' });
      return;
    }

    if ((value.customTags?.length || 0) >= 10) {
      Taro.showToast({ title: '最多10个标签', icon: 'none' });
      return;
    }

    if (value.customTags?.includes(trimmedName)) {
      Taro.showToast({ title: '标签已存在', icon: 'none' });
      return;
    }

    setValue(prev => ({
      ...prev,
      customTags: [...(prev.customTags || []), trimmedName]
    }));
    closePopup();
  }

  function removeCustomTag(tagToRemove: string) {
    setValue(prev => ({
      ...prev,
      customTags: (prev.customTags || []).filter(tag => tag !== tagToRemove)
    }));
  }

  async function handleSubmit() {
    if (!value.category) {
      Taro.showToast({ title: '请选择品类', icon: 'none' });
      return;
    }

    await onSave({
      ...value,
      customTags: normalizeCustomTags(value.customTags),
      material: getMaterialStorageName(value.material, userMaterials),
    });
  }

  function getCategoryLabel() {
    const option = CATEGORY_OPTIONS.find(o => o.value === value.category);
    return option?.label || '请选择';
  }

  function getSubcategoryLabel() {
    if (!value.subcategory) return '请选择';
    return getSubcategoryDisplayLabel(value.category, value.subcategory, userSubcategories);
  }

  function getColorsDisplay() {
    if (value.colors.length === 0) return '请选择';
    const labels = value.colors.map(c => {
      const colorMeta = normalizeColor(c);
      return colorMeta.label || c;
    });
    return getColorSummaryLabel(labels);
  }

  function getMaterialDisplay() {
    if (!value.material) return '请选择';
    return resolveMaterialDisplayName(value.material, userMaterials, '自定义材质') || '请选择';
  }

  function getThicknessDisplay() {
    if (!value.thickness) return '请选择';
    return getThicknessLabel(value.thickness);
  }

  function getStyleTagsDisplay() {
    if (value.styleTags.length === 0) return '请选择';
    const tags = value.styleTags.map(displayClothingText);
    if (tags.length <= 3) {
      return tags.join('、');
    }
    return tags.slice(0, 3).join('、') + `等 ${tags.length} 个`;
  }

  function getSeasonTagsDisplay() {
    if (value.seasonTags.length === 0) return '请选择';
    return value.seasonTags.map(getSeasonLabel).join('、');
  }

  function getSceneTagsDisplay() {
    const tags = value.sceneTags || [];
    if (tags.length === 0) return '请选择';
    const labels = tags.map(displayClothingText);
    if (labels.length <= 3) {
      return labels.join('、');
    }
    return labels.slice(0, 3).join('、') + `等 ${labels.length} 个`;
  }

  const colorGroups = useMemo(() => {
    return STANDARD_COLOR_GROUPS.map((group) => ({
      ...group,
      colors: group.colorKeys
        .map((key) => STANDARD_COLORS.find((color) => color.key === key))
        .filter((color): color is (typeof STANDARD_COLORS)[number] => Boolean(color)),
    }));
  }, []);

  const myCommonSubcategories = useMemo(() => {
    const currentSelection: SelectOption<string>[] = [];
    if (value.subcategory) {
      currentSelection.push({
        value: value.subcategory,
        label: getSubcategoryDisplayLabel(value.category, value.subcategory, userSubcategories),
      });
    }

    const userAdded: SelectOption<string>[] = [];
    userSubcategories
      .filter(cat => cat.parentCategory === value.category && cat.status === 'active')
      .slice(0, 10)
      .forEach(cat => {
        if (!currentSelection.find(r => r.value === cat.name || r.label === cat.name)) {
          userAdded.push({ value: cat.name, label: cat.name });
        }
      });

    const sessionAdded: SelectOption<string>[] = [];
    sessionCustomSubcategories
      .filter(item => item.parentCategory === value.category)
      .slice(0, 5)
      .forEach(item => {
      const label = getSubcategoryDisplayLabel(value.category, item.name, userSubcategories);
      if (!currentSelection.find(r => r.value === item.name || r.label === label) &&
          !userAdded.find(r => r.value === item.name || r.label === item.name)) {
        sessionAdded.push({ value: item.name, label });
      }
    });

    return { currentSelection, userAdded: [...userAdded, ...sessionAdded] };
  }, [value.category, value.subcategory, userSubcategories, sessionCustomSubcategories]);

  const myCommonMaterials = useMemo(() => {
    const currentSelection: MaterialSelectOption[] = [];
    if (value.material) {
      currentSelection.push({ value: value.material, label: resolveMaterialDisplayName(value.material, userMaterials, '自定义材质') });
    }

    const userAdded: MaterialSelectOption[] = [];
    userMaterials
      .filter(m => m.status === 'active')
      .slice(0, 10)
      .forEach(m => {
        userAdded.push({ value: m.name, label: m.name, id: m.id });
      });

    const sessionAdded: MaterialSelectOption[] = [];
    sessionCustomMaterials.slice(0, 5).forEach(label => {
      if (!currentSelection.find(r => r.value === label || r.label === label) &&
          !userAdded.find(r => r.value === label || r.label === label)) {
        sessionAdded.push({ value: label, label: getMaterialLabel(label) });
      }
    });

    return { currentSelection, userAdded: [...userAdded, ...sessionAdded] };
  }, [value.material, userMaterials, sessionCustomMaterials]);

  const currentMaterialName = value.material ? getMaterialStorageName(value.material, userMaterials) : '';
  const currentMaterialInActiveUserList = Boolean(currentMaterialName && userMaterials.some(item => (
    item.status === 'active' &&
    (item.name === currentMaterialName || item.normalizedName === normalizeCustomMaterialName(currentMaterialName))
  )));
  const currentMaterialIsPreset = Boolean(currentMaterialName && (
    isPresetMaterial(currentMaterialName) || isPresetMaterial(normalizeMaterial(currentMaterialName))
  ));
  const currentMaterialNeedsRejoin = Boolean(
    currentMaterialName &&
    !currentMaterialIsPreset &&
    !currentMaterialInActiveUserList
  );

  const materialPresetOptions = getMaterialPresetOptions();
  const commonMaterials = materialPresetOptions.slice(0, 10);
  const moreMaterials = materialPresetOptions.slice(10);

  const recommendedStyles = STYLE_OPTIONS.slice(0, 12);

  return (
    <View className="clothing-edit-form">
      <ScrollView className="edit-form-scroll" scrollY>
        {showImage && value.imageUrl && !isDraftConfirm && (
          <View className="preview-card">
            <View className="preview-image-wrapper">
              <SafeImage className="preview-image" src={value.imageUrl} mode="aspectFit" />
            </View>
            <Text className="preview-title">编辑衣物档案</Text>
            <Text className="preview-subtitle">把这件衣服整理得更懂你</Text>
          </View>
        )}

        {showImage && value.imageUrl && isDraftConfirm && (
          <View className="preview-card">
            <View className="preview-image-wrapper">
              <SafeImage className="preview-image" src={value.imageUrl} mode="aspectFit" />
            </View>
            <Text className="preview-title">编辑属性</Text>
            <Text className="preview-subtitle">调整一下这件衣服的信息</Text>
          </View>
        )}

        <View className="form-section">
          <Text className="section-title">基础档案</Text>

          {showMetaFields && !isDraftConfirm && (
            <View className="form-item">
              <Text className="item-label">备注名称</Text>
              <Input
                className="item-input"
                value={value.customName ?? ''}
                onInput={(event) => setValue(prev => ({ ...prev, customName: String(event.detail.value ?? '') }))}
                placeholder="给这件衣服起个名字"
                maxlength={64}
              />
            </View>
          )}

          <View className="summary-item" onClick={() => openPopup('category')}>
            <View className="summary-item-left">
              <Text className="summary-item-label">品类</Text>
              <Text className="summary-item-value">{getCategoryLabel()}</Text>
            </View>
            <Text className="summary-item-arrow">调整</Text>
          </View>

          <View className="summary-item" onClick={() => openPopup('subcategory')}>
            <View className="summary-item-left">
              <Text className="summary-item-label">细分类</Text>
              <Text className="summary-item-value">{getSubcategoryLabel()}</Text>
            </View>
            <Text className="summary-item-arrow">调整</Text>
          </View>

          {showMetaFields && !isDraftConfirm && (
            <View className="form-item">
              <Text className="item-label">品牌</Text>
              <Input
                className="item-input"
                value={value.brand ?? ''}
                onInput={(event) => setValue(prev => ({ ...prev, brand: String(event.detail.value ?? '') }))}
                placeholder="品牌名称"
                maxlength={64}
              />
            </View>
          )}
        </View>

        <View className="form-section">
          <Text className="section-title">外观属性</Text>

          <View className="summary-item" onClick={() => openPopup('colors')}>
            <View className="summary-item-left">
              <Text className="summary-item-label">主色调</Text>
              <View className="color-summary">
                {value.colors.slice(0, 3).map(c => {
                  const colorMeta = normalizeColor(c);
                  return (
                    <View 
                      key={c} 
                      className="color-summary-dot"
                      style={{
                        backgroundColor: colorMeta.hex,
                        borderColor: colorMeta.border
                      }}
                    />
                  );
                })}
                <Text className="color-summary-text">{getColorsDisplay()}</Text>
              </View>
            </View>
            <Text className="summary-item-arrow">调整</Text>
          </View>

          <View className="summary-item" onClick={() => openPopup('material')}>
            <View className="summary-item-left">
              <Text className="summary-item-label">材质</Text>
              <Text className="summary-item-value">{getMaterialDisplay()}</Text>
            </View>
            <Text className="summary-item-arrow">调整</Text>
          </View>

          <View className="summary-item" onClick={() => openPopup('thickness')}>
            <View className="summary-item-left">
              <Text className="summary-item-label">厚薄</Text>
              <Text className="summary-item-value">{getThicknessDisplay()}</Text>
            </View>
            <Text className="summary-item-arrow">调整</Text>
          </View>
        </View>

        <View className="form-section">
          <Text className="section-title">穿搭标签</Text>

          <View className="summary-item" onClick={() => openPopup('styleTags')}>
            <View className="summary-item-left">
              <Text className="summary-item-label">风格</Text>
              <Text className="summary-item-value">{getStyleTagsDisplay()}</Text>
            </View>
            <Text className="summary-item-arrow">调整</Text>
          </View>

          <View className="summary-item" onClick={() => openPopup('seasonTags')}>
            <View className="summary-item-left">
              <Text className="summary-item-label">季节</Text>
              <Text className="summary-item-value">{getSeasonTagsDisplay()}</Text>
            </View>
            <Text className="summary-item-arrow">调整</Text>
          </View>

          {!isDraftConfirm && (
            <View className="summary-item" onClick={() => openPopup('sceneTags')}>
              <View className="summary-item-left">
                <Text className="summary-item-label">适合场景</Text>
                <Text className="summary-item-value">{getSceneTagsDisplay()}</Text>
              </View>
              <Text className="summary-item-arrow">调整</Text>
            </View>
          )}
        </View>

        {!isDraftConfirm && (
          <View className="form-section">
            <Text className="section-title">我的标签</Text>
            <View className="custom-tags-section">
              <View className="custom-tags-grid">
                {(value.customTags || []).map(tag => (
                  <View key={tag} className="custom-tag-chip">
                    <Text className="custom-tag-text">{tag}</Text>
                    <View className="custom-tag-remove" onClick={() => removeCustomTag(tag)}>
                      <Text className="custom-tag-remove-text">×</Text>
                    </View>
                  </View>
                ))}
                <View className="add-tag-chip" onClick={() => openPopup('addTag')}>
                  <Text className="add-tag-chip-text">+ 添加标签</Text>
                </View>
              </View>
            </View>
          </View>
        )}

        <View className="bottom-padding" />
      </ScrollView>

      <View className="save-button-bar">
        {isDraftConfirm && onCancel && (
          <View className="cancel-button" onClick={onCancel}>
            <Text className="cancel-button-text">取消</Text>
          </View>
        )}
        <View className="save-button" onClick={submitting ? undefined : handleSubmit}>
          <Text className="save-button-text">{submitting ? '保存中...' : submitText}</Text>
        </View>
      </View>

      {popup === 'category' && (
        <View className="bottom-popup-overlay" onClick={closePopup}>
          <View className="bottom-popup" onClick={(e) => e.stopPropagation()}>
            <View className="popup-header">
              <Text className="popup-title">选择品类</Text>
              <View className="popup-close" onClick={closePopup}>
                <Text className="popup-close-text">×</Text>
              </View>
            </View>
            <ScrollView className="popup-content" scrollY>
              <View className="options-grid">
                {CATEGORY_OPTIONS.map(opt => (
                  <View
                    key={opt.value}
                    className={`option-chip ${tempValue === opt.value ? 'active' : ''}`}
                    onClick={() => confirmSingle('category', opt.value)}
                  >
                    <Text className="option-chip-text">{opt.label}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {popup === 'subcategory' && (
        <View className="bottom-popup-overlay" onClick={closePopup}>
          <View className="bottom-popup" onClick={(e) => e.stopPropagation()}>
            <View className="popup-header">
              <Text className="popup-title">选择细分类</Text>
              <View className="popup-close" onClick={closePopup}>
                <Text className="popup-close-text">×</Text>
              </View>
            </View>
            <View className="popup-current-category">
              <Text className="popup-current-category-text">
                当前品类：{CATEGORY_OPTIONS.find(o => o.value === value.category)?.label}
              </Text>
            </View>
            <ScrollView className="popup-content" scrollY>
              {myCommonSubcategories.currentSelection.length > 0 && (
                <View className="options-group">
                  <Text className="options-group-title">当前选择</Text>
                  <View className="options-grid">
                    {myCommonSubcategories.currentSelection.map(opt => (
                      <View
                        key={opt.value}
                        className={`option-chip ${tempValue === opt.value || tempValue === opt.label ? 'active' : ''}`}
                        onClick={() => confirmSingle('subcategory', opt.value || opt.label)}
                      >
                        <Text className="option-chip-text">{opt.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {myCommonSubcategories.userAdded.length > 0 && (
                <View className="options-group">
                  <Text className="options-group-title">我添加的分类</Text>
                  <View className="options-grid">
                    {myCommonSubcategories.userAdded.map(opt => (
                      <View
                        key={opt.value}
                        className={`option-chip ${tempValue === opt.value || tempValue === opt.label ? 'active' : ''}`}
                        onClick={() => confirmSingle('subcategory', opt.value || opt.label)}
                      >
                        <Text className="option-chip-text">{opt.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View className="options-group">
                <Text className="options-group-title">常用分类</Text>
                <View className="options-grid">
                  {subcategoryOptions.slice(0, 20).filter(o => !o.isCustom).map(opt => (
                    <View
                      key={opt.value}
                      className={`option-chip ${tempValue === opt.value || tempValue === opt.label ? 'active' : ''}`}
                      onClick={() => confirmSingle('subcategory', opt.value || opt.label)}
                    >
                      <Text className="option-chip-text">{opt.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View className="add-option-section">
                <Input
                  className="add-option-input"
                  value={newSubcategoryName}
                  onInput={(e) => setNewSubcategoryName(String(e.detail.value ?? ''))}
                  placeholder="输入新的细分类名称"
                  maxlength={24}
                />
                <View 
                  className={`add-option-button ${addingSubcategory ? 'disabled' : ''}`}
                  onClick={addingSubcategory ? undefined : handleAddSubcategory}
                >
                  <Text className="add-option-button-text">{addingSubcategory ? '添加中...' : '添加并使用'}</Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {popup === 'colors' && (
        <View className="bottom-popup-overlay" onClick={closePopup}>
          <View className="bottom-popup" onClick={(e) => e.stopPropagation()}>
            <View className="popup-header">
              <Text className="popup-title">选择主色调</Text>
              <View className="popup-close" onClick={closePopup}>
                <Text className="popup-close-text">×</Text>
              </View>
            </View>
            <ScrollView className="popup-content" scrollY>
              {colorGroups.map((group) => (
                <View key={group.name} className="options-group color-options-group">
                  <Text className="options-group-title">{group.name}</Text>
                  <View className="color-options-grid">
                    {group.colors.map(c => {
                      const selectedColors = Array.isArray(tempValue) ? tempValue : [];
                      const isSelected = selectedColors.includes(c.key);
                      return (
                        <View
                          key={c.key}
                          className={`color-option-chip ${isSelected ? 'active' : ''}`}
                          onClick={() => {
                            if (isSelected) {
                              updateTempValue(selectedColors.filter((v: string) => v !== c.key));
                            } else {
                              updateTempValue([...selectedColors, c.key]);
                            }
                          }}
                        >
                          <View 
                            className="color-option-dot"
                            style={{ backgroundColor: c.hex, borderColor: c.border }}
                          >
                            {isSelected && <View className="color-option-mark" />}
                          </View>
                          <Text className="color-option-label">{c.label}</Text>
                        </View>
                      );
                    })}
                  </View>
                </View>
              ))}
            </ScrollView>
            <View className="popup-footer">
              <View className="popup-confirm-button" onClick={() => confirmMultiple('colors')}>
                <Text className="popup-confirm-button-text">确定</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {popup === 'material' && (
        <View className="bottom-popup-overlay" onClick={closePopup}>
          <View className="bottom-popup" onClick={(e) => e.stopPropagation()}>
            <View className="popup-header">
              <Text className="popup-title">选择材质</Text>
              <View className="popup-close" onClick={closePopup}>
                <Text className="popup-close-text">×</Text>
              </View>
            </View>
            <ScrollView className="popup-content" scrollY>
              {myCommonMaterials.currentSelection.length > 0 && (
                <View className="options-group">
                  <Text className="options-group-title">当前选择</Text>
                  <View className="options-grid">
                    {myCommonMaterials.currentSelection.map(opt => (
                      <View
                        key={opt.value}
                        className={`option-chip ${tempValue === opt.value || tempValue === opt.label ? 'active' : ''}`}
                        onClick={() => confirmSingle('material', opt.value || opt.label)}
                      >
                        <Text className="option-chip-text">{opt.label}</Text>
                      </View>
                    ))}
                  </View>
                  {currentMaterialNeedsRejoin && (
                    <View className="material-rejoin-row">
                      <Text className="material-rejoin-hint">仅保留在这件衣服上</Text>
                      <View
                        className={`material-rejoin-button ${rejoiningMaterial ? 'disabled' : ''}`}
                        onClick={rejoiningMaterial ? undefined : handleRejoinCurrentMaterial}
                      >
                        <Text className="material-rejoin-button-text">
                          {rejoiningMaterial ? '加入中...' : '重新加入'}
                        </Text>
                      </View>
                    </View>
                  )}
                </View>
              )}

              {myCommonMaterials.userAdded.length > 0 && (
                <View className="options-group">
                  <View className="options-group-header">
                    <Text className="options-group-title">我添加的材质</Text>
                    <View className="options-manage-toggle" onClick={() => setManagingMaterials(prev => !prev)}>
                      <Text className="options-manage-toggle-text">{managingMaterials ? '完成' : '整理'}</Text>
                    </View>
                  </View>
                  <View className="options-grid">
                    {myCommonMaterials.userAdded.map(opt => (
                      <View
                        key={opt.value}
                        className={`option-chip managed ${tempValue === opt.value || tempValue === opt.label ? 'active' : ''} ${archivingMaterialIds.includes(opt.id ?? '') ? 'disabled' : ''}`}
                        onClick={() => confirmSingle('material', opt.value || opt.label)}
                      >
                        <Text className="option-chip-text">{opt.label}</Text>
                        {managingMaterials && opt.id && (
                          <View
                            className="option-chip-remove"
                            onClick={(event) => {
                              event.stopPropagation();
                              handleArchiveMaterial(opt);
                            }}
                          >
                            <Text className="option-chip-remove-text">×</Text>
                          </View>
                        )}
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View className="options-group">
                <Text className="options-group-title">常用材质</Text>
                <View className="options-grid">
                  {commonMaterials.map(opt => (
                    <View
                      key={opt.value}
                      className={`option-chip ${tempValue === opt.value || tempValue === opt.label ? 'active' : ''}`}
                      onClick={() => confirmSingle('material', opt.value || opt.label)}
                    >
                      <Text className="option-chip-text">{opt.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {moreMaterials.length > 0 && (
                <View className="options-group">
                  <Text className="options-group-title">更多材质</Text>
                  <View className="options-grid">
                    {moreMaterials.map(opt => (
                      <View
                        key={opt.value}
                        className={`option-chip ${tempValue === opt.value || tempValue === opt.label ? 'active' : ''}`}
                        onClick={() => confirmSingle('material', opt.value || opt.label)}
                      >
                        <Text className="option-chip-text">{opt.label}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View className="add-option-section">
                <Input
                  className="add-option-input"
                  value={newMaterialName}
                  onInput={(e) => setNewMaterialName(String(e.detail.value ?? ''))}
                  placeholder="输入新的材质名称"
                  maxlength={24}
                />
                <View 
                  className={`add-option-button ${addingMaterial ? 'disabled' : ''}`}
                  onClick={addingMaterial ? undefined : handleAddMaterial}
                >
                  <Text className="add-option-button-text">{addingMaterial ? '添加中...' : '添加并使用'}</Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {popup === 'thickness' && (
        <View className="bottom-popup-overlay" onClick={closePopup}>
          <View className="bottom-popup" onClick={(e) => e.stopPropagation()}>
            <View className="popup-header">
              <Text className="popup-title">选择厚薄</Text>
              <View className="popup-close" onClick={closePopup}>
                <Text className="popup-close-text">×</Text>
              </View>
            </View>
            <ScrollView className="popup-content" scrollY>
              <View className="options-grid">
                {THICKNESS_OPTIONS.map(opt => (
                  <View
                    key={opt.value}
                    className={`option-chip ${tempValue === opt.value ? 'active' : ''}`}
                    onClick={() => confirmSingle('thickness', opt.value)}
                  >
                    <Text className="option-chip-text">{opt.label}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      )}

      {popup === 'styleTags' && (
        <View className="bottom-popup-overlay" onClick={closePopup}>
          <View className="bottom-popup" onClick={(e) => e.stopPropagation()}>
            <View className="popup-header">
              <Text className="popup-title">选择风格</Text>
              <View className="popup-close" onClick={closePopup}>
                <Text className="popup-close-text">×</Text>
              </View>
            </View>
            <ScrollView className="popup-content" scrollY>
              <View className="options-group">
                <Text className="options-group-title">推荐风格</Text>
                <View className="options-grid">
                  {recommendedStyles.map(opt => (
                    <View
                      key={opt.value}
                      className={`option-chip ${tempValue.includes(opt.value) ? 'active' : ''}`}
                      onClick={() => {
                        if (tempValue.includes(opt.value)) {
                          updateTempValue(tempValue.filter((v: string) => v !== opt.value));
                        } else {
                          updateTempValue([...tempValue, opt.value]);
                        }
                      }}
                    >
                      <Text className="option-chip-text">{opt.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              <View className="options-group">
                <Text className="options-group-title">全部风格</Text>
                <View className="options-grid">
                  {STYLE_OPTIONS.map(opt => (
                    <View
                      key={opt.value}
                      className={`option-chip ${tempValue.includes(opt.value) ? 'active' : ''}`}
                      onClick={() => {
                        if (tempValue.includes(opt.value)) {
                          updateTempValue(tempValue.filter((v: string) => v !== opt.value));
                        } else {
                          updateTempValue([...tempValue, opt.value]);
                        }
                      }}
                    >
                      <Text className="option-chip-text">{opt.label}</Text>
                    </View>
                  ))}
                </View>
              </View>
            </ScrollView>
            <View className="popup-footer">
              <View className="popup-confirm-button" onClick={() => confirmMultiple('styleTags')}>
                <Text className="popup-confirm-button-text">确定</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {popup === 'seasonTags' && (
        <View className="bottom-popup-overlay" onClick={closePopup}>
          <View className="bottom-popup" onClick={(e) => e.stopPropagation()}>
            <View className="popup-header">
              <Text className="popup-title">选择季节</Text>
              <View className="popup-close" onClick={closePopup}>
                <Text className="popup-close-text">×</Text>
              </View>
            </View>
            <ScrollView className="popup-content" scrollY>
              <View className="options-grid">
                {SEASON_OPTIONS.map(opt => (
                  <View
                    key={opt.value}
                    className={`option-chip ${tempValue.includes(opt.value) ? 'active' : ''}`}
                    onClick={() => {
                      if (tempValue.includes(opt.value)) {
                        updateTempValue(tempValue.filter((v: string) => v !== opt.value));
                      } else {
                        updateTempValue([...tempValue, opt.value]);
                      }
                    }}
                  >
                    <Text className="option-chip-text">{opt.label}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <View className="popup-footer">
              <View className="popup-confirm-button" onClick={() => confirmMultiple('seasonTags')}>
                <Text className="popup-confirm-button-text">确定</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {popup === 'sceneTags' && (
        <View className="bottom-popup-overlay" onClick={closePopup}>
          <View className="bottom-popup" onClick={(e) => e.stopPropagation()}>
            <View className="popup-header">
              <Text className="popup-title">选择适合场景</Text>
              <View className="popup-close" onClick={closePopup}>
                <Text className="popup-close-text">×</Text>
              </View>
            </View>
            <ScrollView className="popup-content" scrollY>
              <View className="options-grid">
                {SCENE_OPTIONS.map(opt => (
                  <View
                    key={opt.value}
                    className={`option-chip ${(tempValue || []).includes(opt.value) ? 'active' : ''}`}
                    onClick={() => {
                      const currentTemp = tempValue || [];
                      if (currentTemp.includes(opt.value)) {
                        updateTempValue(currentTemp.filter((v: string) => v !== opt.value));
                      } else {
                        updateTempValue([...currentTemp, opt.value]);
                      }
                    }}
                  >
                    <Text className="option-chip-text">{opt.label}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <View className="popup-footer">
              <View className="popup-confirm-button" onClick={() => confirmMultiple('sceneTags')}>
                <Text className="popup-confirm-button-text">确定</Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {popup === 'addTag' && (
        <View className="bottom-popup-overlay" onClick={closePopup}>
          <View className="bottom-popup small" onClick={(e) => e.stopPropagation()}>
            <View className="popup-header">
              <Text className="popup-title">添加标签</Text>
              <View className="popup-close" onClick={closePopup}>
                <Text className="popup-close-text">×</Text>
              </View>
            </View>
            <ScrollView className="popup-content" scrollY>
              <Input
                className="add-tag-popup-input"
                value={newTagName}
                onInput={(e) => setNewTagName(String(e.detail.value ?? ''))}
                placeholder="例如：显瘦、通勤、春秋"
                maxlength={8}
              />
            </ScrollView>
            <View className="popup-footer">
              <View className="popup-confirm-button" onClick={handleAddTag}>
                <Text className="popup-confirm-button-text">添加</Text>
              </View>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

function normalizeInitialValue(input: ClothingEditFormValue): ClothingEditFormValue {
  return {
    ...input,
    category: normalizeCategory(input.category),
    customName: input.customName ?? '',
    brand: input.brand ?? '',
    customTags: normalizeCustomTags(input.customTags),
    subcategory: input.subcategory ?? '',
    subcategoryId: input.subcategoryId,
    colors: normalizeStringArray(input.colors).map(normalizeColor).map(c => c.key),
    seasonTags: normalizeStringArray(input.seasonTags).map(normalizeSeason),
    styleTags: normalizeStringArray(input.styleTags).map(normalizeStyleTag),
    sceneTags: normalizeStringArray(input.sceneTags).map(normalizeSceneTag),
    material: input.material ? resolveMaterialDisplayName(input.material, [], input.material) : '',
    thickness: input.thickness ? normalizeThickness(input.thickness) : ''
  };
}

function normalizeStringArray(value?: string[]): string[] {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.trim()) : [];
}

function normalizeCustomTags(value?: string[]): string[] {
  const seen = new Set<string>();
  return normalizeStringArray(value).reduce<string[]>((tags, item) => {
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) return tags;
    seen.add(trimmed);
    return [...tags, trimmed];
  }, []);
}

function getMaterialPresetOptions(): Array<SelectOption<string>> {
  return MATERIAL_OPTIONS.map((option) => ({
    ...option,
    value: option.label,
  }));
}
