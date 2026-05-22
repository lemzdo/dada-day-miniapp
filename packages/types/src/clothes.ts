// ── 衣服分类枚举 ──

export type ClothingCategory = 'top' | 'bottom' | 'onepiece' | 'shoes' | 'accessory' | 'other';

export type ClothingSubcategory =
  // 上衣
  | 'tshirt' | 'shirt' | 'sweater' | 'hoodie' | 'jacket' | 'down_jacket' | 'blazer' | 'vest'
  // 下装
  | 'jeans' | 'trousers' | 'shorts' | 'skirt' | 'leggings'
  // 连体
  | 'dress' | 'suit_set' | 'jumpsuit'
  // 鞋子
  | 'sneakers' | 'heels' | 'boots' | 'sandals' | 'loafers' | 'flats'
  // 配饰
  | 'hat' | 'scarf' | 'necklace' | 'bag' | 'glasses' | 'belt' | 'watch'
  // 其他
  | 'other';

export type ClothingStatus = 'active' | 'archived' | 'deleted';

export type ClothingAiStatus = 'pending' | 'recognizing' | 'recognized' | 'failed';
export type ClothingCutoutStatus = 'pending' | 'success' | 'failed' | 'manual' | 'skipped';
export type ClothingRecognizeStatus = 'pending' | 'success' | 'failed' | 'skipped';
export type UploadBatchStatus = 'pending' | 'processing' | 'completed' | 'partial_failed' | 'failed';
export type UploadImageStatus = 'pending' | 'processing' | 'completed' | 'failed';
export type ClothesDraftStatus = 'pending' | 'confirmed' | 'discarded';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';

export type StyleTag =
  | '简约' | '通勤' | '街头' | '甜美' | '学院'
  | '复古' | '运动' | '优雅' | '休闲' | '辣妹'
  | '日系' | '法式' | '中性';

export type SceneTag =
  | '上班' | '开会' | '出游' | '约会' | '逛街'
  | '居家' | '运动' | '正式' | '聚会';

export type Material =
  | '棉' | '麻' | '丝绸' | '羊毛' | '皮革'
  | '牛仔' | '化纤' | '混纺' | '羽绒' | '针织';

// ── 调色板 ──

export interface ColorInfo {
  name: string;
  hex: string;
  ratio: number;
}

export interface ClothingCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ── 衣服实体 ──

export interface Clothing {
  id: string;
  userId: string;
  thumbnailUrl?: string;
  originalImageUrl?: string;
  displayImageUrl?: string;
  cutoutStatus?: ClothingCutoutStatus;
  cutoutProvider?: string;
  cutoutError?: string;
  aiRecognizeStatus?: ClothingRecognizeStatus;
  aiProvider?: string;
  aiRawResult?: unknown;

  // AI 识别结果
  category: ClothingCategory | string;
  subcategory?: ClothingSubcategory | string;
  subCategory?: string;
  colorPalette?: ColorInfo[];
  colors?: string[];
  styleTags?: Array<StyleTag | string>;
  seasonTags?: Array<Season | string>;
  material?: Material | string;
  materialGuess?: string;
  sceneTags?: Array<SceneTag | string>;
  aiStatus?: ClothingAiStatus;
  aiConfidence?: number;
  aiError?: string;
  manualFields?: string[];
  batchId?: string;
  sourceImageId?: string;
  cropBox?: ClothingCropBox;
  confidence?: number;
  thickness?: string;
  warmthScore?: number;
  coolnessScore?: number;
  fashionScore?: number;
  matchTips?: string;

  // 用户自定义
  customName?: string;
  customCategory?: ClothingCategory;
  customTags?: string[];

  capacityCost: number;
  status: ClothingStatus;
  deletedAt?: string;
  brand?: string;
  purchaseDate?: string;

  // 统计
  usageCount: number;
  lastWornAt?: string;

  createdAt: string;
  updatedAt: string;
}

// ── 上传衣服请求（带图片文件） ──

/** 上传衣服表单（Phase 1 实现） */
// 上传衣服使用 multipart/form-data，此处占位
export type ClothingCreateInput = Record<string, unknown>;

// ── 修改衣服请求 ──

export interface ClothingUpdateInput {
  customName?: string;
  customCategory?: ClothingCategory;
  customTags?: string[];
  category?: ClothingCategory;
  subcategory?: ClothingSubcategory;
  styleTags?: Array<StyleTag | string>;
  seasonTags?: Array<Season | string>;
  sceneTags?: Array<SceneTag | string>;
  status?: ClothingStatus;
  brand?: string;
  colorPalette?: ColorInfo[];
  material?: Material;
  displayImageUrl?: string;
  originalImageUrl?: string;
  cutoutStatus?: ClothingCutoutStatus;
  aiRecognizeStatus?: ClothingRecognizeStatus;
  aiError?: string;
}

export interface UploadBatch {
  id: string;
  userId: string;
  totalImages: number;
  processedImages: number;
  totalDetectedClothes: number;
  status: UploadBatchStatus;
  createdAt: string;
  updatedAt: string;
}

export interface UploadImage {
  id: string;
  batchId: string;
  userId: string;
  originalImageUrl: string;
  cloudFileId?: string;
  status: UploadImageStatus;
  detectedCount: number;
  errorMessage?: string;
  aiRawResult?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ClothesDraft {
  id: string;
  userId: string;
  batchId: string;
  sourceImageId: string;
  originalImageUrl: string;
  croppedImageUrl: string;
  cropBox?: ClothingCropBox;
  type: ClothingCategory | string;
  categoryName?: string;
  color?: string;
  colors?: string[];
  material?: string;
  style?: string;
  confidence?: number;
  selected: boolean;
  status: ClothesDraftStatus;
  createdAt: string;
  updatedAt: string;
}

// ── AI 识别结果 ──

export interface AiRecognitionResult {
  category: ClothingCategory;
  subcategory?: ClothingSubcategory;
  colorPalette: ColorInfo[];
  styleTags: StyleTag[];
  seasonTags: Season[];
  material?: Material;
  sceneTags: SceneTag[];
  confidence: number;
}




