import { type ModelProvider, type ModelRequest, ProviderError } from './model';
export type QwenConfig = {
  apiKey: string;
  baseUrl: string;
  textModel: string;
  visionModel: string;
};
export class QwenProvider implements ModelProvider {
  constructor(
    private readonly config: QwenConfig,
    private readonly send = fetch,
  ) {}
  async json(request: ModelRequest): Promise<unknown> {
    if (!this.config.apiKey) {
      throw Object.assign(new Error('請在後端 .env 設定 DASHSCOPE_API_KEY'), {
        status: 503,
        code: 'MODEL_NOT_CONFIGURED',
      });
    }
    const text = JSON.stringify(request.input);
    const content = request.image
      ? [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: request.image } },
        ]
      : text;
    const response = await this.send(`${this.config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: request.image ? this.config.visionModel : this.config.textModel,
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
      signal: AbortSignal.timeout(60_000),
    }).catch(() => {
      throw new ProviderError('Qwen API 連接失敗或請求逾時');
    });
    if (!response.ok) throw new ProviderError(`Qwen API HTTP ${response.status}`);
    const body = (await response.json()) as { choices: { message: { content: string } }[] };
    try {
      return JSON.parse(body.choices[0].message.content);
    } catch {
      throw new ProviderError('Qwen 回傳的內容不是 JSON');
    }
  }
}
export function configuredQwen() {
  return new QwenProvider({
    apiKey: process.env.DASHSCOPE_API_KEY || '',
    baseUrl: process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
    textModel: process.env.QWEN_TEXT_MODEL || 'qwen-plus',
    visionModel: process.env.QWEN_VISION_MODEL || 'qwen-vl-max',
  });
}
