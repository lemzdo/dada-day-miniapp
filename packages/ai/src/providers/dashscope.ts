const DASHSCOPE_BASE_URL = process.env['DASHSCOPE_BASE_URL'] ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const DASHSCOPE_API_KEY = process.env['DASHSCOPE_API_KEY'] ?? '';
const AI_TIMEOUT_MS = Number(process.env['AI_TIMEOUT_MS'] ?? 25000);
const AI_MAX_TOKENS = Math.min(800, Number(process.env['AI_MAX_TOKENS'] ?? 800));

export const dashScopeModelConfig = {
  textModel: process.env['DASHSCOPE_TEXT_MODEL'] ?? 'qwen3.6-plus',
  textFallbackModels: readModelList(process.env['DASHSCOPE_TEXT_FALLBACK_MODELS'], ['qwen3.5-plus', 'qwen-plus']),
  visionModel: process.env['DASHSCOPE_VISION_MODEL'] ?? 'qwen3-vl-flash',
  visionFallbackModels: readModelList(process.env['DASHSCOPE_VISION_FALLBACK_MODELS'], ['qwen-vl-plus']),
  timeoutMs: AI_TIMEOUT_MS,
  maxTokens: AI_MAX_TOKENS,
} as const;

export type StructuredTextTask =
  | 'outfit_recommendation'
  | 'clothing_description'
  | 'score_reason'
  | 'weather_outfit_advice';

export interface StructuredTextInput {
  task: StructuredTextTask;
  prompt: string;
  schemaHint?: string;
}

export interface StructuredTextOutput<T = unknown> {
  data: T;
  model: string;
  rawText: string;
}

export async function generateStructuredText<T = unknown>(
  input: StructuredTextInput,
): Promise<StructuredTextOutput<T>> {
  if (!DASHSCOPE_API_KEY) {
    throw new Error('DASHSCOPE_API_KEY is not configured');
  }

  const models = uniqueList([dashScopeModelConfig.textModel, ...dashScopeModelConfig.textFallbackModels]);
  let lastError: unknown;

  for (const model of models) {
    try {
      const rawText = await callDashScopeText(model, input);
      return {
        data: parseJson<T>(rawText),
        model,
        rawText,
      };
    } catch (error) {
      lastError = error;
      console.warn('[DashScope] structured text model failed:', { model, error });
    }
  }

  throw lastError instanceof Error ? lastError : new Error('DashScope structured text failed');
}

async function callDashScopeText(model: string, input: StructuredTextInput): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

  try {
    const response = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: 'system',
            content: [
              'You are the structured text provider for d1d.',
              'The product does not provide free-form user chat.',
              'Only support outfit recommendation, clothing description, score reason, and weather outfit advice.',
              'Return strict JSON only. Do not return Markdown, code fences, comments, explanations, or extra text.',
            ].join('\n'),
          },
          {
            role: 'user',
            content: [
              `task: ${input.task}`,
              input.schemaHint ? `schema: ${input.schemaHint}` : '',
              input.prompt,
            ].filter(Boolean).join('\n'),
          },
        ],
        temperature: 0.2,
        max_tokens: dashScopeModelConfig.maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`DashScope text API error ${response.status}: ${body.slice(0, 500)}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content ?? '{}';
  } finally {
    clearTimeout(timer);
  }
}

function parseJson<T>(text: string): T {
  const cleaned = text.replace(/```json|```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  const jsonText = start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned;
  return JSON.parse(jsonText) as T;
}

function readModelList(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;
  return value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueList(items: readonly string[]) {
  return [...new Set(items.filter(Boolean))];
}
