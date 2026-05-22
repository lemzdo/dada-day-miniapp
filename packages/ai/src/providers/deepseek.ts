// ============================================================
// DeepSeek — 穿搭推荐 / 分析 Provider（桩）
// API Key: DEEPSEEK_API_KEY
// ============================================================

import type { AIService, RecognizeInput, RecognizeOutput } from '../types';
import type {
  AnalyzeInput,
  AnalyzeOutput,
  CopywriteInput,
  CopywriteOutput,
  RecommendInput,
  RecommendOutput,
} from '../types';

function getApiKey(): string {
  const key = process.env['DEEPSEEK_API_KEY'] ?? '';
  if (!key) {
    console.warn('[AI:DeepSeek] DEEPSEEK_API_KEY not configured');
  }
  return key;
}

const BASE_URL = 'https://api.deepseek.com/v1';
const MODEL = 'deepseek-chat';

async function recognizeClothing(_input: RecognizeInput): Promise<RecognizeOutput> {
  throw new Error('DeepSeek does not support recognizeClothing — use SiliconFlow provider');
}

async function recommendOutfit(input: RecommendInput): Promise<RecommendOutput> {
  const apiKey = getApiKey();

  // TODO: Phase 2 实现 — 规则引擎过滤后，Top-K 送 DeepSeek 精排
  // POST {baseUrl}/chat/completions
  // Body: { model, messages: [{ role: "system", content }, { role: "user", content }] }

  throw new Error(
    'DeepSeek recommendOutfit not implemented. Set DEEPSEEK_API_KEY and implement Phase 2.',
  );
}

async function analyzeWardrobe(input: AnalyzeInput): Promise<AnalyzeOutput> {
  const apiKey = getApiKey();

  // TODO: Phase 3 实现 — 统计数据 + LLM 总结

  throw new Error(
    'DeepSeek analyzeWardrobe not implemented. Set DEEPSEEK_API_KEY and implement Phase 3.',
  );
}

async function generateCopywrite(_input: CopywriteInput): Promise<CopywriteOutput> {
  throw new Error('DeepSeek does not support generateCopywrite — use DashScope provider');
}

export const deepseekProvider: AIService = {
  recognizeClothing,
  recommendOutfit,
  analyzeWardrobe,
  generateCopywrite,
};
