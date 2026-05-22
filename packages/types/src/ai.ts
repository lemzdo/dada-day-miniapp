// ============================================================
// 搭一搭 · AI 服务类型定义
// ============================================================

// ── 衣服识别 ─────────────────────────────────────────────────

export interface RecognizeInput {
  /** 衣服图片 URL（支持 http/https/data URI） */
  imageUrl: string;
  /** 用户选择的品类提示（可选） */
  hint?: string;
  /** 指定模型（可选） */
  model?: string;
}

export interface ClothingBBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence?: number;
  coordinateType?: 'normalized' | 'pixel';
}

export interface AiClothingCropBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RecognizedClothingItem {
  /** Single item type used by draft upload flow. */
  type?: 'top' | 'bottom' | 'onepiece' | 'shoes' | 'accessory' | 'other' | string;
  /** User-facing category name returned by the vision model. */
  categoryName?: string;
  /** 品类：上衣/下装/连体/鞋子/配饰/其他 */
  category: 'top' | 'bottom' | 'onepiece' | 'shoes' | 'accessory' | 'other';
  /** 子品类，如 tshirt/hoodie/jeans */
  subcategory?: string;
  /** 颜色调色板 */
  colors?: Array<{
    name: string;
    hex: string;
    ratio: number;
  }>;
  /** 风格标签 */
  styleTags?: string[];
  /** 季节标签 */
  seasonTags?: string[];
  /** 材质 */
  material?: string;
  /** Primary style label used by draft upload flow. */
  style?: string;
  /** 适用场景 */
  sceneTags?: string[];
  /** 置信度 0-1 */
  confidence?: number;
  bbox?: ClothingBBox;
  /** Pixel coordinates in the original image. */
  cropBox?: AiClothingCropBox;
  thickness?: 'thin' | 'regular' | 'thick' | 'unknown' | string;
}

export interface RecognizeOutput extends RecognizedClothingItem {
  items?: RecognizedClothingItem[];
}

// ── 穿搭推荐 ─────────────────────────────────────────────────

export interface RecommendInput {
  /** 用户衣柜中的衣服 ID 列表 */
  clothingIds: string[];
  /** 可选：指定场景 */
  scene?: string;
  /** 可选：指定日期（用于获取天气） */
  date?: string;
  /** 可选：指定时段 */
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
  /** 可选：天气信息 */
  weather?: {
    temp: number;
    condition: string;
    rainChance?: number;
  };
}

export interface RecommendOutput {
  /** 推荐穿搭方案 */
  outfits: Array<{
    id: string;
    clothingIds: string[];
    title: string;
    scene: string;
    scores: {
      overall: number;
      color: number;
      style: number;
      weather: number;
    };
    explanations: string[];
  }>;
}

// ── 衣柜分析 ─────────────────────────────────────────────────

export interface AnalyzeInput {
  /** 用户衣服列表 */
  clothes: Array<{
    id: string;
    category: string;
    styleTags: string[];
    colorPalette: Array<{ name: string; hex: string }>;
    usageCount: number;
  }>;
  /** 历史穿搭记录 */
  history?: Array<{
    clothingIds: string[];
    date: string;
    satisfaction: number;
  }>;
}

export interface AnalyzeOutput {
  /** 风格分布 */
  styleBreakdown: Record<string, number>;
  /** 颜色分布 */
  colorBreakdown: Record<string, number>;
  /** 品类数量 */
  categoryCounts: Record<string, number>;
  /** 最常穿的衣服 */
  topUsed: string[];
  /** 从未穿过的衣服 */
  unusedItems: string[];
  /** 缺失建议 */
  missingSuggestions: Array<{
    category: string;
    reason: string;
    examples: string[];
  }>;
  /** 整体评分 */
  overallScore: number;
}

// ── 文案生成 ─────────────────────────────────────────────────

export interface CopywriteInput {
  /** 穿搭方案 */
  outfit: {
    clothingIds: string[];
    scene: string;
  };
  /** 文案风格 */
  style?: 'cute' | 'elegant' | 'casual' | 'professional';
  /** 目标平台 */
  platform?: 'moments' | 'xiaohongshu' | 'weibo';
}

export interface CopywriteOutput {
  /** 标题 */
  title: string;
  /** 正文 */
  content: string;
  /** 标签 */
  hashtags: string[];
}

// ── AI 服务接口 ──────────────────────────────────────────────

export interface AIService {
  /** 识别衣服图片 */
  recognizeClothing(input: RecognizeInput): Promise<RecognizeOutput>;
  /** 流式识别（可选） */
  recognizeClothingStream?(input: RecognizeInput): AsyncGenerator<RecognizeOutput>;

  /** 推荐穿搭方案 */
  recommendOutfits(input: RecommendInput): Promise<RecommendOutput>;
  /** 流式推荐（可选） */
  recommendOutfitsStream?(input: RecommendInput): AsyncGenerator<RecommendOutput>;

  /** 分析衣柜 */
  analyzeWardrobe(input: AnalyzeInput): Promise<AnalyzeOutput>;

  /** 生成分享文案 */
  generateCopywrite(input: CopywriteInput): Promise<CopywriteOutput>;
}
