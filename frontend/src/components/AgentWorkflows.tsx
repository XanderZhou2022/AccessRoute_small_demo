import { useEffect, useRef, useState } from 'react';
import type { AgentResult, Preferences } from '../../../shared/genai/contracts';
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
const mobilityNames: Record<
  Preferences['mobility_type'],
  string
> = {
  walking: '步行',
  wheelchair: '輪椅',
  manual_wheelchair: '手動輪椅',
  elderly: '長者',
  stroller: '嬰兒車',
  heavy_luggage: '重行李',
  other: '其他（按具體需要規劃）',
};
const objectiveNames: Record<NonNullable<Preferences['route_objective']>, string> = {
  balanced: '平衡',
  shortest: '最短距離',
  sheltered: '有蓋優先',
  indoor: '室內優先',
  least_effort: '省力',
  fastest: '較快',
};
const narrationNames: Record<Preferences['tts_selection'], string> = {
  cantonese_female: '粵語女聲',
  cantonese_male: '粵語男聲',
  text_only: '只顯示文字',
};
export function AgentWorkflows({
  context,
  levels,
  preview,
  apply,
  requestedWorkflow,
  workflowRequestId,
}: {
  context: WorkflowContext;
  levels: { id: string; label: string }[];
  preview: (candidate: RankedCandidate) => void;
  apply: (result: AgentResult) => Promise<Receipt>;
  requestedWorkflow?: 'obstacle' | 'localization';
  workflowRequestId: number;
}) {
  const [workflow, setWorkflow] = useState<AgentResult['agent']>('preferences');
  const [text, setText] = useState('');
  const [photoDescription, setPhotoDescription] = useState('');
  const [photo, setPhoto] = useState<PhotoInput | null>(null);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [response, setResponse] = useState<WorkflowResponse | null>(null);
  const [notice, setNotice] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const live = useRef(context.context_id);
  live.current = context.context_id;
  useEffect(() => {
    capabilities()
      .then((r) => setConfigured(r.configured))
      .catch((e) => setNotice(e.message));
  }, []);
  useEffect(() => {
    if (!requestedWorkflow) return;
    setWorkflow(requestedWorkflow);
    setResponse(null);
    setNotice('');
    setApplied(false);
    setExpanded(true);
  }, [requestedWorkflow, workflowRequestId]);
  useEffect(() => {
    if (!requestedWorkflow || !expanded || workflow !== requestedWorkflow) return;
    const panel = document.getElementById('agent-workflows');
    if (!panel) return;
    panel.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
    panel.querySelector<HTMLButtonElement>('.genai-actions button[aria-pressed="true"]')?.focus();
  }, [expanded, requestedWorkflow, workflow, workflowRequestId]);
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
        photoWorkflow
          ? {
              ...photo!,
              ...(photoDescription.trim() ? { description: photoDescription.trim() } : {}),
            }
          : workflow === 'preferences'
            ? { text }
            : {},
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
        setPhotoConsent(false);
        setResponse(null);
        setApplied(false);
        setNotice('已取得拍照位置');
      },
      (error) => setNotice(error.message),
      { enableHighAccuracy: true },
    );
  }
  return (
    <details
      id="agent-workflows"
      className="genai-console agent-workflows"
      open={expanded}
      onToggle={(event) => setExpanded(event.currentTarget.open)}
    >
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
                setPhotoConsent(false);
                if (!file) {
                  setPhoto(null);
                  return;
                }
                if (
                  !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
                  file.size > 6_000_000
                ) {
                  setNotice('請選擇不超過 6 MB 的照片');
                  setPhoto(null);
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
              地標或故障線索（可選）
              <textarea
                rows={2}
                maxLength={1000}
                value={photoDescription}
                disabled={busy}
                onChange={(e) => {
                  setPhotoDescription(e.target.value);
                  setPhotoConsent(false);
                  setResponse(null);
                  setApplied(false);
                }}
              />
            </label>
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
              <label>
                <input
                  type="checkbox"
                  checked={photoConsent}
                  disabled={busy}
                  onChange={(e) => setPhotoConsent(e.target.checked)}
                />
                我同意將此照片、可選 GPS 位置及線索傳送至已設定的 AI 辨識服務。修改照片、線索或 GPS 後需重新同意。
              </label>
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
          (photoWorkflow && (!photo || !photoConsent)) ||
          (workflow === 'guidance' && !context.segment_id)
        }
      >
        {busy ? '處理中…' : '開始處理'}
      </button>
      {response && (
        <div>
          <p role="status">{response.message}</p>
          {response.result?.agent === 'preferences' && (
            <section aria-labelledby="preference-review-title">
              <h3 id="preference-review-title">請核對辨識出的出行要求</h3>
              <ul>
                <li>出行方式：{mobilityNames[response.result.payload.mobility_type]}</li>
                <li>避開樓梯：{response.result.payload.avoid_stairs ? '是' : '否'}</li>
                <li>
                  扶手電梯：
                  {response.result.payload.allow_escalators === undefined
                    ? '未指定'
                    : response.result.payload.allow_escalators
                      ? '可使用'
                      : '避開'}
                </li>
                <li>
                  升降機：
                  {response.result.payload.avoid_lifts === undefined
                    ? '未指定'
                    : response.result.payload.avoid_lifts
                      ? '避開'
                      : '可使用'}
                </li>
                <li>
                  路線目標：
                  {response.result.payload.route_objective
                    ? objectiveNames[response.result.payload.route_objective]
                    : '沿用目前設定'}
                </li>
                <li>
                  最大坡度：
                  {response.result.payload.max_slope === undefined
                    ? '未指定'
                    : `${(response.result.payload.max_slope * 100).toFixed(1)}%`}
                </li>
                <li>
                  最小通道闊度：
                  {response.result.payload.min_width_m === undefined
                    ? '未指定'
                    : `${response.result.payload.min_width_m} 米`}
                </li>
                <li>
                  避開陡坡：{response.result.payload.avoid_steep_slopes ? '是' : '否'}
                </li>
                <li>
                  偏好有蓋通道：{response.result.payload.prefer_covered_shelter ? '是' : '否'}
                </li>
                <li>語音偏好：{narrationNames[response.result.payload.tts_selection]}</li>
              </ul>
              {response.speech?.voice_selection === 'single_default' && (
                <p role="status">自架粵語語音目前只有一把預設聲線；男聲／女聲偏好不會改變聲音。</p>
              )}
            </section>
          )}
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
                  : response.result.agent === 'preferences'
                    ? '確認並套用出行要求'
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
