import { useEffect, useRef, useState } from 'react';
import type { AgentResult } from '../../../shared/genai/contracts';
import type {
  WorkflowContext,
  WorkflowResponse,
  PhotoInput,
  RankedCandidate,
} from '../../../shared/genai/workflows';
import { apiWorkflowClient, confirmCandidate, capabilities } from '../api/genai';
import { speak } from '../genai/speech';
import type { Receipt } from './GenAIConsole';
const labels = {
  preferences: '出行需求',
  obstacle: '拍照報告路障',
  localization: '拍照找位置',
  guidance: '語音導航',
};
export function AgentWorkflows({
  context,
  levels,
  preview,
  apply,
}: {
  context: WorkflowContext;
  levels: { id: string; label: string }[];
  preview: (candidate: RankedCandidate) => void;
  apply: (result: AgentResult) => Promise<Receipt>;
}) {
  const [workflow, setWorkflow] = useState<AgentResult['agent']>('preferences');
  const [text, setText] = useState('');
  const [photo, setPhoto] = useState<PhotoInput | null>(null);
  const [response, setResponse] = useState<WorkflowResponse | null>(null);
  const [notice, setNotice] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const live = useRef(context.context_id);
  live.current = context.context_id;
  useEffect(() => {
    capabilities()
      .then((r) => setConfigured(r.configured))
      .catch((e) => setNotice(e.message));
  }, []);
  const photoWorkflow = workflow === 'obstacle' || workflow === 'localization';
  async function execute() {
    const snapshot = context;
    setBusy(true);
    setNotice('');
    setResponse(null);
    setApplied(false);
    try {
      const result = await apiWorkflowClient.run(
        workflow,
        snapshot,
        photoWorkflow ? photo! : workflow === 'preferences' ? { text } : {},
      );
      if (live.current !== snapshot.context_id) throw new Error('導航已改變，請重新提交');
      setResponse(result);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function confirm(candidateId: string) {
    setBusy(true);
    setNotice('');
    const snapshot = context;
    try {
      const result = await confirmCandidate(response!.confirmation_id!, candidateId, snapshot);
      if (live.current !== snapshot.context_id) throw new Error('導航已改變，請重新提交');
      setResponse(result);
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function applyResult() {
    setBusy(true);
    try {
      const receipt = await apply(response!.result!);
      setNotice(receipt.message);
      setApplied(receipt.status === 'applied');
      if (
        receipt.status === 'applied' &&
        response!.speech &&
        response!.result!.agent === 'guidance'
      ) {
        await speak(response!.result!.payload.text, response!.speech);
      }
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function locate() {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPhoto(
          (previous) =>
            previous && {
              ...previous,
              position: {
                lat: position.coords.latitude,
                lon: position.coords.longitude,
                accuracy_m: position.coords.accuracy,
              },
            },
        );
        setResponse(null);
        setApplied(false);
        setNotice('已取得拍照位置');
      },
      (error) => setNotice(error.message),
      { enableHighAccuracy: true },
    );
  }
  return (
    <details className="genai-console agent-workflows" open>
      <summary>智能導航助手</summary>
      {configured === false && <p>請在本機後端設定 Qwen API Key 後使用。</p>}
      <div className="genai-actions">
        {(Object.keys(labels) as AgentResult['agent'][]).map((key) => (
          <button
            key={key}
            aria-pressed={workflow === key}
            disabled={busy}
            onClick={() => {
              setWorkflow(key);
              setResponse(null);
              setNotice('');
              setApplied(false);
            }}
          >
            {labels[key]}
          </button>
        ))}
      </div>
      {workflow === 'preferences' && (
        <label>
          告訴我們你的出行需要
          <textarea
            rows={3}
            value={text}
            placeholder="例如：我坐輪椅，想避開樓梯，下雨時盡量走有蓋通道。"
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
      {photoWorkflow && (
        <div className="agent-photo-input">
          <label>
            拍攝或選擇照片
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                if (file.size > 8_000_000) {
                  setNotice('請選擇小於 8 MB 的照片');
                  return;
                }
                const reader = new FileReader();
                reader.onload = () => {
                  setPhoto({ image: reader.result as string });
                  setResponse(null);
                  setApplied(false);
                };
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {photo && (
            <>
              <img className="agent-photo" src={photo.image} alt="待識別照片" />
              <label>
                已知樓層
                <select
                  value={photo.level_id || ''}
                  disabled={busy}
                  onChange={(e) => {
                    setPhoto({ ...photo, level_id: e.target.value || undefined });
                    setResponse(null);
                    setApplied(false);
                  }}
                >
                  <option value="">由照片辨識</option>
                  {levels.map((level) => (
                    <option key={level.id} value={level.id}>
                      {level.label}
                    </option>
                  ))}
                </select>
              </label>
              <button onClick={locate} disabled={busy || !navigator.geolocation}>
                使用目前 GPS 位置
              </button>
              <p>
                {photo.position
                  ? `GPS 精度約 ${Math.round(photo.position.accuracy_m)} 米`
                  : '將使用目前導航位置與附近路線搜尋。'}
              </p>
            </>
          )}
        </div>
      )}
      {workflow === 'guidance' && <p>根據目前路段與附近地標生成粵語指引，套用後播報。</p>}
      <button
        className="primary"
        onClick={execute}
        disabled={
          busy ||
          configured !== true ||
          ['transit', 'complete'].includes(context.phase) ||
          (workflow === 'preferences' && !text.trim()) ||
          (photoWorkflow && !photo) ||
          (workflow === 'guidance' && !context.segment_id)
        }
      >
        {busy ? '處理中…' : '開始處理'}
      </button>
      {response && (
        <div>
          <p role="status">{response.message}</p>
          {response.candidates.length > 0 && (
            <div className="agent-candidates">
              {response.candidates.slice(0, 8).map((candidate) => (
                <div key={candidate.id}>
                  <p>
                    {candidate.level_id
                      ? levels.find((level) => level.id === candidate.level_id)?.label
                      : '室外'}{' '}
                    · 候選位置
                  </p>
                  <strong>{candidate.names.join(' / ')}</strong>
                  <span>
                    {' '}
                    匹配分數 {candidate.score.toFixed(2)} · 距離約{' '}
                    {Math.round(candidate.distance_m)} 米
                  </span>
                  <small>{candidate.evidence.join('；') || '尚無可核對的文字證據'}</small>
                  <button onClick={() => preview(candidate)}>在地圖查看</button>
                  {response.status === 'needs_confirmation' && (
                    <button disabled={busy} onClick={() => confirm(candidate.id)}>
                      我確認是這個位置
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
          {response.result && (
            <>
              {response.result.agent === 'guidance' && <p>{response.result.payload.text}</p>}
              <button
                className="primary"
                disabled={busy || applied || response.result.context_id !== context.context_id}
                onClick={applyResult}
              >
                {applied
                  ? '已套用'
                  : response.result.agent === 'guidance'
                    ? response.speech?.selection === 'text_only'
                      ? '套用指引'
                      : '套用並播報'
                    : '套用到導航'}
              </button>
              {applied &&
                response.speech &&
                response.speech.selection !== 'text_only' &&
                response.result.agent === 'guidance' && (
                  <button
                    disabled={busy || response.result.context_id !== context.context_id}
                    onClick={() => {
                      void speak(
                        response.result!.agent === 'guidance' ? response.result!.payload.text : '',
                        response.speech!,
                      ).catch((e) => setNotice(e.message));
                    }}
                  >
                    再次播報
                  </button>
                )}
            </>
          )}
          <details>
            <summary>查看辨識與匹配過程</summary>
            <ol>
              {response.trace.map((step, i) => (
                <li key={i}>{step.summary}</li>
              ))}
            </ol>
          </details>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      <details>
        <summary>查看呼叫上下文</summary>
        <pre>{JSON.stringify(context, null, 2)}</pre>
      </details>
    </details>
  );
}
