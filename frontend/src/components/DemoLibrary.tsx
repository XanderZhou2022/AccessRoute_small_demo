import { useEffect, useMemo, useState } from 'react';
import type { Scene } from '../../../shared/domain/schema';
import type {
  DemoCase,
  DemoMedia,
  DemoOverlay,
  DemoState,
  KnowledgeRecord,
} from '../../../shared/demo/types';
import { ExampleWorkflowClient } from '../../../shared/demo/provider';
import { applyDemoResult, applyDemoOverlay, demoRoute } from '../../../shared/demo/navigation';
import { searchKnowledge } from '../../../shared/demo/knowledge';
import { FloorMap } from '../renderers/FloorMap';
import { speak } from '../genai/speech';

type Card = Pick<
  DemoCase,
  'id' | 'title' | 'person' | 'origin_scene_id' | 'destination_scene_id' | 'tags'
>;
type Index = {
  cases: Card[];
  media: DemoMedia[];
  counts: { cases: number; steps: number; knowledge_records: number; historical_photos: number };
};
const base = import.meta.env.BASE_URL + 'data/';
async function load<T>(path: string): Promise<T> {
  const response = await fetch(base + path);
  if (!response.ok) throw new Error(`例子資料載入失敗：${path}`);
  return response.json();
}

export function DemoLibrary({
  scenes,
  defaultOpen = false,
}: {
  scenes: Scene[];
  defaultOpen?: boolean;
}) {
  const [index, setIndex] = useState<Index | null>(null);
  const [overlays, setOverlays] = useState<DemoOverlay[]>([]);
  const [selected, setSelected] = useState('');
  const [sceneFilter, setSceneFilter] = useState('');
  const [profileFilter, setProfileFilter] = useState('');
  const [example, setExample] = useState<DemoCase | null>(null);
  const [knowledge, setKnowledge] = useState<KnowledgeRecord[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    Promise.all([load<Index>('demo/index.json'), load<DemoOverlay[]>('demo/overlays.json')])
      .then(([library, layers]) => {
        setIndex(library);
        setOverlays(layers);
        setSelected(library.cases[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    if (!selected) return;
    let stale = false;
    setExample(null);
    setError('');
    load<DemoCase>(`demo/cases/${selected}.json`)
      .then(async (record) => {
        const data = await Promise.all(
          [record.origin_scene_id, record.destination_scene_id].map((id) =>
            load<{ records: KnowledgeRecord[] }>(`knowledge/${id}.json`),
          ),
        );
        if (!stale) {
          setExample(record);
          setKnowledge(data.flatMap((d) => d.records));
        }
      })
      .catch((e) => {
        if (!stale) setError(e.message);
      });
    return () => {
      stale = true;
    };
  }, [selected]);
  const demoScenes = useMemo(
    () =>
      new Map(
        scenes.map((scene) => [
          scene.manifest.sceneId,
          overlays.length
            ? applyDemoOverlay(
                scene,
                overlays.find((o) => o.scene_id === scene.manifest.sceneId)!,
              )
            : scene,
        ]),
      ),
    [scenes, overlays],
  );
  const cards =
    index?.cases.filter(
      (c) =>
        (!sceneFilter || c.origin_scene_id === sceneFilter) &&
        (!profileFilter || c.tags.includes(profileFilter)),
    ) || [];
  return (
    <details className="demo-library" open={defaultOpen || undefined}>
      <summary>離線案例演示 · {index?.counts.cases || '…'} 個故事</summary>
      <p>
        按階段播放人物需求、雨天選線、設施故障、定位與到達。資料來源選用例子庫，全程不呼叫模型 API。
      </p>
      {index && (
        <div className="demo-counts">
          <span>{index.counts.cases} 個故事</span>
          <span>{index.counts.steps} 個階段</span>
          <span>{index.counts.knowledge_records} 條知識記錄</span>
          <span>{index.counts.historical_photos} 張實景參考照片</span>
        </div>
      )}
      <div className="demo-filters">
        <label>
          出發場景
          <select
            value={sceneFilter}
            onChange={(e) => {
              setSceneFilter(e.target.value);
              setSelected(
                index!.cases.find((c) => !e.target.value || c.origin_scene_id === e.target.value)!
                  .id,
              );
              setProfileFilter('');
            }}
          >
            <option value="">全部場景</option>
            {scenes.map((s) => (
              <option key={s.manifest.sceneId} value={s.manifest.sceneId}>
                {s.manifest.nameZh}
              </option>
            ))}
          </select>
        </label>
        <label>
          人物需求
          <select
            value={profileFilter}
            onChange={(e) => {
              setProfileFilter(e.target.value);
              setSelected(
                index!.cases.find(
                  (c) =>
                    (!sceneFilter || c.origin_scene_id === sceneFilter) &&
                    (!e.target.value || c.tags.includes(e.target.value)),
                )!.id,
              );
            }}
          >
            <option value="">全部需求</option>
            <option value="manual_wheelchair">手動輪椅</option>
            <option value="heavy_luggage">重行李</option>
            <option value="elderly">長者</option>
            <option value="stroller">嬰兒車</option>
          </select>
        </label>
        <label>
          演示故事
          <select value={selected} onChange={(e) => setSelected(e.target.value)}>
            {cards.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      {example && overlays.length ? (
        <DemoPlayer
          key={example.id}
          example={example}
          scenes={demoScenes}
          overlays={overlays}
          media={index!.media}
          knowledge={knowledge}
        />
      ) : (
        <p>正在讀取本地例子…</p>
      )}
    </details>
  );
}

function DemoPlayer({
  example,
  scenes,
  overlays,
  media,
  knowledge,
}: {
  example: DemoCase;
  scenes: Map<string, Scene>;
  overlays: DemoOverlay[];
  media: DemoMedia[];
  knowledge: KnowledgeRecord[];
}) {
  const [stepIndex, setStepIndex] = useState(0),
    [state, setState] = useState<DemoState>(example.steps[0].state);
  const [level, setLevel] = useState(''),
    [query, setQuery] = useState(''),
    [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const step = example.steps[stepIndex],
    scene = scenes.get(state.scene_id)!;
  const snapshot = useMemo(() => demoRoute(scene, state), [scene, state]);
  const previous = stepIndex ? example.steps[stepIndex - 1] : null;
  const photos = step.media_ids
    .map((id) => media.find((m) => m.id === id)!)
    .filter((m) => m.kind !== 'map_view');
  const mapView = step.media_ids
    .map((id) => media.find((m) => m.id === id)!)
    .find((m) => m.kind === 'map_view');
  const floor =
    level ||
    scene.graph.nodes.find((n) => n.id === state.current_node_id)?.levelId ||
    scene.manifest.levels[0].id;
  const selectedKnowledge = knowledge.filter((r) => step.knowledge_ids.includes(r.id));
  const matches = searchKnowledge(
    knowledge.filter((r) => r.scene_id === state.scene_id),
    query,
  );
  async function selectStep(index: number) {
    setBusy(true);
    setNotice('');
    try {
      const next = example.steps[index];
      if (next.response) {
        const client = new ExampleWorkflowClient(example, next.id);
        const response = await client.run(next.response.workflow, next.context);
        let consumed = applyDemoResult(
          scenes.get(next.context.scene_id)!,
          index ? example.steps[index - 1].state : example.initial_state,
          response.result!,
        );
        // Weather is scenario input, independent of the intent agent's preference result.
        if (next.id === 'rain')
          consumed = { ...consumed, routing: { ...consumed.routing, rain: true } };
        setState(consumed);
      } else setState(next.state);
      setStepIndex(index);
      setLevel('');
      setQuery('');
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const closed = state.routing.events
    .filter((e) => e.status === 'active')
    .map((e) => e.target.facilityId!)
    .filter((id) => scene.graph.facilities.some((f) => f.id === id));
  const distanceText = (r: typeof snapshot) =>
    r.result.status === 'ok' ? `${Math.round(r.result.distanceM)} m` : '無可行路線';
  return (
    <div className="demo-player">
      <h2>{example.title}</h2>
      <p>{example.narrative}</p>
      <details className="demo-assumptions">
        <summary>情境地圖：現有底圖＋預設通行條件</summary>
        <ul>
          {overlays
            .find((o) => o.scene_id === state.scene_id)!
            .assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
        </ul>
      </details>
      <div className="demo-timeline" aria-label="演示階段">
        {example.steps.map((s, i) => (
          <button
            key={s.id}
            aria-pressed={i === stepIndex}
            disabled={busy}
            onClick={() => selectStep(i)}
          >
            {i + 1}. {s.title}
          </button>
        ))}
      </div>
      <div className="demo-controls">
        <button onClick={() => selectStep(0)} disabled={busy}>
          重新開始故事
        </button>
        <button onClick={() => selectStep(stepIndex - 1)} disabled={busy || stepIndex === 0}>
          上一階段
        </button>
        <button
          className="primary"
          onClick={() => selectStep(stepIndex + 1)}
          disabled={busy || stepIndex === example.steps.length - 1}
        >
          下一階段
        </button>
        <span>
          {stepIndex + 1} / {example.steps.length} · 例子庫返回
        </span>
      </div>
      <div className="demo-dialogue">
        <span>{example.person}說</span>
        <blockquote>{step.utterance}</blockquote>
        <strong>{step.title}</strong>
        <p>{step.explanation}</p>
        {step.response && (
          <p>
            預設 workflow：{step.response.workflow} · 結果狀態：{step.response.status}
          </p>
        )}
        {state.guidance && <p className="demo-guidance">{state.guidance}</p>}
        {step.id === 'guidance' && (
          <button
            onClick={async () => {
              try {
                await speak(state.guidance, {
                  mode: 'browser',
                  language: 'zh-HK',
                  selection: 'cantonese_female',
                });
              } catch (e) {
                setNotice((e as Error).message);
              }
            }}
          >
            播放粵語指引
          </button>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
      <div className="demo-counts">
        <span>目前路線 {distanceText(snapshot)}</span>
        <span>露天 {Math.round(snapshot.exposed_m)} m</span>
        <span>{state.routing.rain ? '雨天' : '晴天'}</span>
        <span>{state.routing.profile}</span>
        {previous && previous.state.scene_id === state.scene_id && (
          <span>
            上階段 {distanceText(previous.route)} ·{' '}
            {step.route_changed ? '路線已改變' : '路線維持，更新條件'}
          </span>
        )}
      </div>
      <p>
        使用設施：
        {snapshot.facilities
          .map((id) => scene.graph.facilities.find((f) => f.id === id)!.label)
          .join(' → ') || '無跨層設施'}
        {closed.length
          ? `；停用：${closed.map((id) => scene.graph.facilities.find((f) => f.id === id)?.label || id).join('、')}`
          : ''}
      </p>
      <div className="demo-map-grid">
        <div>
          <label>
            查看樓層
            <select value={floor} onChange={(e) => setLevel(e.target.value)}>
              {scene.manifest.levels.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <FloorMap
            scene={scene}
            segments={snapshot.segments}
            levelId={floor}
            closedFacilities={closed}
            highlight={{
              ...scene.graph.nodes.find((n) => n.id === state.current_node_id)!,
              label: '目前位置',
              level_id: scene.graph.nodes.find((n) => n.id === state.current_node_id)!.levelId,
            }}
          />
        </div>
        {mapView && (
          <figure>
            <img src={base + 'demo/' + mapView.path} alt={mapView.title} />
            <figcaption>整段路線位置投影（跨樓層請參照左圖）</figcaption>
          </figure>
        )}
      </div>
      {!!photos.length && (
        <div className="demo-photo-grid">
          {photos.map((photo) => (
            <figure key={photo.id}>
              <img src={base + 'demo/' + photo.path} alt={photo.title} />
              <figcaption>
                <strong>
                  {photo.kind === 'historical_photo' ? '實景歷史參考照片' : '預設故障告示'}
                </strong>{' '}
                · {photo.title}
                {photo.captured_at && <span>拍攝：{photo.captured_at}</span>}
                <span>
                  {photo.author} · {photo.license}
                </span>
                {photo.kind === 'historical_photo' && (
                  <>
                    <a href={photo.source_url} target="_blank" rel="noreferrer">
                      照片來源
                    </a>{' '}
                    ·{' '}
                    <a href={photo.license_url} target="_blank" rel="noreferrer">
                      授權
                    </a>
                    <span>外觀參考；精確拍攝節點尚未標定。</span>
                  </>
                )}
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      {!!selectedKnowledge.length && (
        <div className="demo-knowledge-hit">
          <strong>本階段定位知識</strong>
          {selectedKnowledge.map((r) => (
            <p key={r.id}>
              {r.names.join(' / ')} ·{' '}
              {scene.manifest.levels.find((l) => l.id === r.level_id)?.label} · 同層候選距離{' '}
              {r.association_distance_m} m · 使用者已確認
            </p>
          ))}
        </div>
      )}
      <details>
        <summary>查看本場景尋路知識庫</summary>
        <label>
          搜尋店舖或設施名稱
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="例如 Apple、肯德基、Lift"
          />
        </label>
        <p>
          {knowledge.filter((r) => r.scene_id === state.scene_id).length}{' '}
          條記錄；名稱支持部分文字匹配。
        </p>
        <div className="demo-knowledge-list">
          {matches.map(({ record: r }) => (
            <article key={r.id}>
              <strong>{r.names.join(' / ')}</strong>
              <p>
                {scene.manifest.levels.find((l) => l.id === r.level_id)?.label || '室外'} ·{' '}
                {r.node_id
                  ? `近似公共節點，距離 ${r.association_distance_m} m，需確認`
                  : '未映射地圖節點'}
              </p>
              {r.verified_url && (
                <a href={r.verified_url} target="_blank" rel="noreferrer">
                  正式店舖頁面
                </a>
              )}
              <small>來源：{r.source}</small>
            </article>
          ))}
        </div>
      </details>
      <div className="demo-agent-records">
        <strong>這一階段如何處理</strong>
        {step.agent_records.map((record, i) => (
          <details key={`${step.id}-${i}`}>
            <summary>
              {i + 1}. {record.agent} ·{' '}
                {record.source === 'computed' ? '地圖計算／檢索結果' : '例子庫預設返回'}
            </summary>
            <pre>{JSON.stringify({ input: record.input, output: record.output }, null, 2)}</pre>
          </details>
        ))}
      </div>
      <details>
        <summary>查看各 agent 的預設返回與路線依據</summary>
        <p>
          這些是有標記的演示 fixture；API 與例子庫返回相同 WorkflowResponse / AgentResult 契約。
        </p>
        <pre>
          {JSON.stringify(
            {
              input: step.context,
              response: step.response,
              applied_state: state,
              route: snapshot.result,
              purpose: example.purpose,
            },
            null,
            2,
          )}
        </pre>
      </details>
    </div>
  );
}
