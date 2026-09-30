import { useState } from 'react';
import type { AgentResult, IntegrationContext } from '../../../shared/genai/contracts';
export type Receipt = {
  status: 'applied' | 'ignored' | 'rejected';
  request_id?: string;
  code?: string;
  message: string;
};
export function GenAIConsole({
  context,
  samples,
  apply,
  clear,
}: {
  context: IntegrationContext;
  samples: AgentResult[];
  apply: (value: unknown) => Receipt;
  clear: () => void;
}) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<Receipt | null>(null);
  const labels = ['1 · 出行偏好', '2 · 電梯路障', '3 · 室內定位', '4 · 粵語指引'];
  return (
    <details className="genai-console">
      <summary>GenAI 接入 · 四個 Agent 聯調</summary>
      <p>
        此面板接收 Agent 結果並更新本頁導航，未連接 Qwen。示例為模擬資料；刷新頁面會清除接入狀態。
      </p>
      <a href={import.meta.env.BASE_URL + 'genai-integration.md'} target="_blank" rel="noreferrer">
        開啟同事接入手冊（含端口、JSON 與呼叫例子）
      </a>
      <div className="genai-actions">
        {samples.map((sample, i) => (
          <button
            key={sample.agent}
            onClick={() => {
              setValue(JSON.stringify(sample, null, 2));
              setResult(null);
            }}
          >
            {labels[i]}示例
          </button>
        ))}
      </div>
      <p>先載入示例，再按套用。路線或進度改變後請重新載入示例，避免使用過期的 context_id。</p>
      <label htmlFor="genai-result">Agent 回傳 JSON</label>
      <textarea
        id="genai-result"
        spellCheck={false}
        rows={12}
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <button
        className="primary"
        onClick={() => {
          try {
            setResult(apply(JSON.parse(value)));
          } catch {
            setResult({ status: 'rejected', code: 'INVALID_JSON', message: '請輸入合法 JSON' });
          }
        }}
      >
        校驗並套用到導航
      </button>
      <button
        onClick={() => {
          clear();
          setResult(null);
        }}
      >
        清除本頁 GenAI 結果
      </button>
      {context.preferences && (
        <p>
          已接收偏好：避階梯 {context.preferences.avoid_stairs ? '開' : '關'} · 避陡坡{' '}
          {context.preferences.avoid_steep_slopes ? '開' : '關'} · 優先有蓋{' '}
          {context.preferences.prefer_covered_shelter ? '開' : '關'} ·{' '}
          {context.preferences.tts_selection}
        </p>
      )}
      {result && (
        <p role="status">
          {result.status} · {result.code || 'OK'} · {result.message}
        </p>
      )}
      <details>
        <summary>查看目前輸入上下文（提供給同事的 Agent）</summary>
        <pre>{JSON.stringify(context, null, 2)}</pre>
      </details>
    </details>
  );
}
