// ============================================================
// 搭一搭 · AI 服务入口
// ============================================================

export { siliconFlowProvider } from './providers/siliconflow';
export { deepseekProvider } from './providers/deepseek';
export { mockProvider } from './providers/mock';
export {
  dashScopeModelConfig,
  generateStructuredText,
  type StructuredTextInput,
  type StructuredTextOutput,
  type StructuredTextTask,
} from './providers/dashscope';

// 默认导出 SiliconFlow（用于衣服识别）
export { siliconFlowProvider as default } from './providers/siliconflow';

// 智能 Provider：优先使用 SiliconFlow，失败时回退到 Mock
// 用法：import { smartProvider } from '@starter-template/ai';
import { mockProvider } from './providers/mock';
import { siliconFlowProvider } from './providers/siliconflow';
import type {
  AIService,
  RecognizeInput,
  RecognizeOutput,
  RecommendInput,
  RecommendOutput,
  AnalyzeInput,
  AnalyzeOutput,
  CopywriteInput,
  CopywriteOutput,
} from '@starter-template/types';

export const smartProvider: AIService = {
  async recognizeClothing(input: RecognizeInput): Promise<RecognizeOutput> {
    try {
      return await siliconFlowProvider.recognizeClothing(input);
    } catch (error) {
      console.warn('[AI] SiliconFlow failed, falling back to mock:', error);
      return mockProvider.recognizeClothing(input);
    }
  },

  async *recognizeClothingStream(input: RecognizeInput): AsyncGenerator<RecognizeOutput> {
    try {
      // siliconFlowProvider.recognizeClothingStream 可能不存在，使用普通方法
      const result = await siliconFlowProvider.recognizeClothing(input);
      yield result;
    } catch (error) {
      console.warn('[AI] SiliconFlow stream failed, falling back to mock:', error);
      // mockProvider.recognizeClothingStream 是可选的，直接使用普通方法
      const result = await mockProvider.recognizeClothing(input);
      yield result;
    }
  },

  async recommendOutfits(input: RecommendInput): Promise<RecommendOutput> {
    return mockProvider.recommendOutfits(input);
  },

  async *recommendOutfitsStream(input: RecommendInput): AsyncGenerator<RecommendOutput> {
    // mockProvider.recommendOutfitsStream 是可选的，直接使用普通方法
    const result = await mockProvider.recommendOutfits(input);
    yield result;
  },

  async analyzeWardrobe(input: AnalyzeInput): Promise<AnalyzeOutput> {
    return mockProvider.analyzeWardrobe(input);
  },

  async generateCopywrite(input: CopywriteInput): Promise<CopywriteOutput> {
    return mockProvider.generateCopywrite(input);
  },
};
