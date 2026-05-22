// ============================================================
// 搭一搭 · SiliconFlow AI Provider
// 基于 openai.js-compatible API
// ============================================================

import type {
  AIService,
  RecognizeInput,
  RecognizeOutput,
  RecommendInput,
} from '@starter-template/types';

// SiliconFlow API 配置
const SILICONFLOW_BASE_URL = 'https://api.siliconflow.cn/v1';
const SILICONFLOW_API_KEY = process.env['SILICONFLOW_API_KEY'] ?? '';

// 默认模型：Qwen/Qwen2.5-VL-32B-Instruct（支持图片理解，有赠送额度）
// 备选：Qwen/Qwen2.5-VL-72B-Instruct, Pro/Qwen/Qwen2.5-VL-7B-Instruct
const DEFAULT_MODEL = 'Qwen/Qwen2.5-VL-32B-Instruct';

// ── 类型定义 ─────────────────────────────────────────────────

interface SiliconFlowMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<Record<string, unknown>>;
}

interface SiliconFlowRequest {
  model: string;
  messages: SiliconFlowMessage[];
  temperature?: number;
  max_tokens?: number;
  response_format?: { type: 'json_schema'; json_schema: { name: string; strict: boolean; schema: Record<string, unknown> } };
}

interface SiliconFlowResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string };
    finish_reason: string;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  error?: { message: string; type: string };
}

// ── Vision Prompt ────────────────────────────────────────────

const SYSTEM_PROMPT = `你是一个专业的服装图像识别专家。你的任务是根据用户上传的衣服图片，准确识别并返回结构化的服装信息。

你必须严格返回以下 JSON 格式，不要添加任何解释或额外内容：

{
  "category": "top|bottom|onepiece|shoes|accessory|other",
  "subcategory": "具体子类，如 tshirt/hoodie/jeans/skirt/dress 等",
  "colors": [
    {"name": "颜色中文名", "hex": "#RRGGBB", "ratio": 0.0-1.0}
  ],
  "styleTags": ["casual", "formal", "sporty", "vintage", "street", "minimalist", "bohemian", "preppy", "punk", "academic", "youth", "mature", "中性", "休闲", "正式", "运动", "街头" 等],
  "seasonTags": ["spring", "summer", "autumn", "winter"],
  "material": "主要材质，如 棉/涤纶/羊毛/真丝/牛仔布/皮革/针织 等",
  "sceneTags": ["work", "daily", "party", "sport", "outdoor", "date", "travel", "home", "正式场合", "日常休闲", "派对聚会", "运动健身" 等],
  "confidence": 0.0-1.0
}

注意事项：
- category 必须是 top/bottom/onepiece/shoes/accessory/other 之一
- colors 数组至少包含 1 个颜色，最多 5 个，按占比从高到低排列
- styleTags 最多 5 个，选择最相关的
- seasonTags 最多 4 个（春夏秋冬）
- sceneTags 最多 5 个，选择最相关的穿着场景
- confidence 表示你对识别结果的置信度`;

function buildUserMessage(imageUrl: string, hint?: string): SiliconFlowMessage {
  const text = hint
    ? `请识别这张衣服图片的详细信息。\n提示：用户选择了「${hint}」品类。`
    : '请识别这张衣服图片的详细信息。';

  return {
    role: 'user',
    content: [
      {
        type: 'image_url',
        image_url: { url: imageUrl, detail: 'high' },
      },
      {
        type: 'text',
        text: `${text}

If the photo contains a person/model wearing clothes, detect each visible clothing item separately.
Return items[] when possible. Each item must include category, subcategory, colors, material, styleTags, seasonTags, thickness, confidence, and bbox.
bbox should tightly cover only the clothing item, exclude face/skin/background as much as possible, and prefer normalized coordinates: {x,y,width,height,confidence,coordinateType:"normalized"}.`,
      },
    ],
  };
}

// ── SiliconFlow API 调用 ─────────────────────────────────────

async function callSiliconFlow(
  model: string,
  messages: SiliconFlowMessage[],
  expectJson = false,
): Promise<SiliconFlowResponse> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${SILICONFLOW_API_KEY}`,
    'Content-Type': 'application/json',
  };

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.1, // 低温度保证稳定性
    max_tokens: 1024,
  };

  if (expectJson) {
    body['response_format'] = {
      type: 'json_schema',
      json_schema: {
        name: 'clothing_recognition',
        strict: true,
        schema: {
          type: 'object',
          required: ['category', 'colors', 'styleTags', 'seasonTags', 'sceneTags', 'confidence'],
          properties: {
            category: { type: 'string', enum: ['top', 'bottom', 'onepiece', 'shoes', 'accessory', 'other'] },
            subcategory: { type: 'string' },
            colors: {
              type: 'array',
              items: {
                type: 'object',
                required: ['name', 'hex', 'ratio'],
                properties: {
                  name: { type: 'string' },
                  hex: { type: 'string' },
                  ratio: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
            },
            styleTags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
            seasonTags: { type: 'array', items: { type: 'string' }, maxItems: 4 },
            material: { type: 'string' },
            sceneTags: { type: 'array', items: { type: 'string' }, maxItems: 5 },
            confidence: { type: 'number', minimum: 0, maximum: 1 },
            thickness: { type: 'string' },
            bbox: {
              type: 'object',
              required: ['x', 'y', 'width', 'height', 'confidence'],
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                width: { type: 'number' },
                height: { type: 'number' },
                confidence: { type: 'number', minimum: 0, maximum: 1 },
                coordinateType: { type: 'string', enum: ['normalized', 'pixel'] },
              },
            },
            items: {
              type: 'array',
              items: {
                type: 'object',
                required: ['category', 'colors', 'styleTags', 'seasonTags', 'confidence', 'bbox'],
                properties: {
                  category: { type: 'string', enum: ['top', 'bottom', 'onepiece', 'shoes', 'accessory', 'other'] },
                  subcategory: { type: 'string' },
                  colors: { type: 'array', items: { type: 'object' } },
                  styleTags: { type: 'array', items: { type: 'string' } },
                  seasonTags: { type: 'array', items: { type: 'string' } },
                  material: { type: 'string' },
                  sceneTags: { type: 'array', items: { type: 'string' } },
                  thickness: { type: 'string' },
                  confidence: { type: 'number', minimum: 0, maximum: 1 },
                  bbox: { type: 'object' },
                },
              },
            },
          },
        },
      },
    };
  }

  const res = await fetch(`${SILICONFLOW_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`SiliconFlow API error: ${res.status} ${errorText}`);
  }

  return res.json() as Promise<SiliconFlowResponse>;
}

// ── 响应解析 ─────────────────────────────────────────────────

function parseResponse(content: string): Partial<RecognizeOutput> {
  try {
    // 尝试提取 JSON（模型可能返回带 markdown 代码块的内容）
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/) ?? content.match(/^\s*(\{[\s\S]*\})\s*$/);
    const jsonStr = jsonMatch ? (jsonMatch[1] ?? jsonMatch[0]) : content;
    const data = JSON.parse(jsonStr) as Partial<RecognizeOutput>;

    return {
      category: data.category ?? 'other',
      subcategory: data.subcategory,
      colors: Array.isArray(data.colors) ? data.colors : [],
      styleTags: Array.isArray(data.styleTags) ? data.styleTags : [],
      seasonTags: Array.isArray(data.seasonTags) ? data.seasonTags : [],
      material: data.material,
      sceneTags: Array.isArray(data.sceneTags) ? data.sceneTags : [],
      confidence: typeof data.confidence === 'number' ? data.confidence : 0.5,
      bbox: data.bbox,
      thickness: data.thickness,
      items: Array.isArray(data.items) ? data.items : undefined,
    };
  } catch {
    console.error('[SiliconFlow] Parse error, raw content:', content.substring(0, 200));
    return {};
  }
}

// ── SiliconFlow Provider ─────────────────────────────────────

export const siliconFlowProvider: AIService = {
  async recognizeClothing(input: RecognizeInput): Promise<RecognizeOutput> {
    if (!SILICONFLOW_API_KEY) {
      throw new Error('SILICONFLOW_API_KEY 环境变量未设置');
    }

    const model = input.model ?? DEFAULT_MODEL;
    const messages: SiliconFlowMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      buildUserMessage(input.imageUrl, input.hint),
    ];

    // 先尝试结构化输出（如果模型支持）
    try {
      const response = await callSiliconFlow(model, messages, true);

      if (response.error) {
        throw new Error(response.error.message);
      }

      const content = response.choices[0]?.message?.content ?? '';
      const parsed = parseResponse(content);

      const category = parsed.category ?? input.hint ?? 'other';
      return {
        category: category as RecognizeOutput['category'],
        subcategory: parsed.subcategory,
        colors: parsed.colors ?? [],
        styleTags: parsed.styleTags ?? [],
        seasonTags: parsed.seasonTags ?? [],
        material: parsed.material,
        sceneTags: parsed.sceneTags ?? [],
        confidence: parsed.confidence ?? 0.5,
        bbox: parsed.bbox,
        thickness: parsed.thickness,
        items: parsed.items,
      };
    } catch (structuredError) {
      console.warn('[SiliconFlow] Structured output failed, falling back to text:', structuredError);

      // fallback: 不使用结构化格式，让模型自由返回
      const response = await callSiliconFlow(model, messages, false);
      const content = response.choices[0]?.message?.content ?? '';
      const parsed = parseResponse(content);

      const category = parsed.category ?? input.hint ?? 'other';
      return {
        category: category as RecognizeOutput['category'],
        subcategory: parsed.subcategory,
        colors: parsed.colors ?? [],
        styleTags: parsed.styleTags ?? [],
        seasonTags: parsed.seasonTags ?? [],
        material: parsed.material,
        sceneTags: parsed.sceneTags ?? [],
        confidence: parsed.confidence ?? 0.3,
        bbox: parsed.bbox,
        thickness: parsed.thickness,
        items: parsed.items,
      };
    }
  },

  async *recognizeClothingStream(_input: RecognizeInput): AsyncGenerator<RecognizeOutput> {
    // SiliconFlow 流式暂不支持，直接返回完整结果
    const result = await this.recognizeClothing(_input);
    yield result;
  },

  async recommendOutfits(_input: unknown) {
    throw new Error('recommendOutfits not implemented yet. 请使用 DeepSeek Provider。');
  },

  async *recommendOutfitsStream(_input: RecommendInput) {
    yield await this.recommendOutfits(_input);
  },

  async analyzeWardrobe(_input: unknown) {
    throw new Error('analyzeWardrobe not implemented yet. 请使用 DeepSeek Provider。');
  },

  async generateCopywrite(_input: unknown) {
    throw new Error('generateCopywrite not implemented yet。');
  },
};
