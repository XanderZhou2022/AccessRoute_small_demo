import { useEffect, useMemo, useState } from 'react';
import type { DynamicEvent, Scene } from '../../../shared/domain/schema';
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
        <>
          {defaultOpen && (
            <DemoServicesSimulator
              key={`services-${example.id}`}
              initialState={example.initial_state}
              scenes={demoScenes}
              knowledge={knowledge}
            />
          )}
          <DemoPlayer
            key={example.id}
            example={example}
            scenes={demoScenes}
            overlays={overlays}
            media={index!.media}
            knowledge={knowledge}
          />
        </>
      ) : (
        <p>正在讀取本地例子…</p>
      )}
    </details>
  );
}

function DemoServicesSimulator({
  initialState,
  scenes,
  knowledge,
}: {
  initialState: DemoState;
  scenes: Map<string, Scene>;
  knowledge: KnowledgeRecord[];
}) {
  const [state, setState] = useState(initialState);
  const [weather, setWeather] = useState<'sunny' | 'rain' | 'heat'>('sunny');
  const [candidateNode, setCandidateNode] = useState('');
  const [facilityId, setFacilityId] = useState('');
  const [description, setDescription] = useState('');
  const [notice, setNotice] = useState('');
  const [largeText, setLargeText] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const scene = scenes.get(state.scene_id);
  const routeState = useMemo(
    () => ({
      ...state,
      routing: {
        ...state.routing,
        rain: weather !== 'sunny',
        objective:
          weather === 'sunny' && state.routing.objective === 'sheltered'
            ? 'balanced'
            : weather === 'sunny'
              ? state.routing.objective
              : 'sheltered',
      },
    }),
    [state, weather],
  );
  useEffect(() => {
    setState(initialState);
    setWeather('sunny');
    setCandidateNode('');
    setFacilityId('');
    setDescription('');
    setNotice('');
  }, [initialState]);

  function changeWeather(value: typeof weather) {
    setWeather(value);
    setNotice(
      value === 'sunny'
        ? '模擬天氣已設為晴天；路線以目前出行條件重新計算。'
        : `模擬香港天文台${value === 'rain' ? '降雨' : '高溫'}資料已套用；優先搜尋有蓋路段並更新路線。`,
    );
  }

  function confirmLocation() {
    const candidate = candidates.find((record) => record.node_id === candidateNode);
    if (!candidate?.node_id) {
      setNotice('請先選擇一個示範定位候選。');
      return;
    }
    setState((previous) => ({ ...previous, current_node_id: candidate.node_id! }));
    setNotice(
      `模擬使用者確認位置：${candidate.names.join(' / ')}。目前位置已移動至示範公共節點，剩餘路線已重算。`,
    );
  }

  function submitReport() {
    if (!scene) return;
    if (!facilityId || !description.trim()) {
      setNotice('請選擇設施並輸入問題描述。');
      return;
    }
    const facility = scene.graph.facilities.find((item) => item.id === facilityId);
    if (!facility) {
      setNotice('所選設施不屬於目前場景。');
      return;
    }
    const event: DynamicEvent = {
      id: `simulated-report-${facility.id}`,
      type: 'facility_closed',
      target: { facilityId: facility.id },
      status: 'active',
      validFrom: new Date().toISOString(),
      source: 'demo',
      confidence: 1,
    };
    setState((previous) => ({
      ...previous,
      routing: {
        ...previous.routing,
        events: [...previous.routing.events.filter((item) => item.id !== event.id), event],
      },
    }));
    setNotice(
      `示範回報已送至「模擬設施服務台」：${facility.label}。路線引擎已避開此設施並重算；沒有實際通知營運方。`,
    );
    setDescription('');
  }

  if (!scene) return null;
  const snapshot = demoRoute(scene, routeState);
  const original = demoRoute(scene, initialState);
  const currentNode = scene.graph.nodes.find((node) => node.id === state.current_node_id);
  const candidates = knowledge
    .filter((record) => record.scene_id === state.scene_id && record.node_id)
    .slice(0, 80);
  const closed = routeState.routing.events
    .filter((event) => event.status === 'active' && event.target.facilityId)
    .map((event) => event.target.facilityId!);
  const distance = (value: ReturnType<typeof demoRoute>) =>
    value.result.status === 'ok'
      ? `${Math.round(value.result.distanceM)} m`
      : '目前沒有符合條件的路線';

  return (
    <section
      className={`demo-services ${largeText ? 'demo-large-text' : ''} ${highContrast ? 'demo-high-contrast' : ''}`}
      aria-labelledby="demo-services-title"
    >
      <span className="demo-simulation-label">SIMULATION ONLY · 不連接即時服務</span>
      <h2 id="demo-services-title">即時服務與無障礙操作示範</h2>
      <p className="demo-services-intro">
        以下在此離線演示頁模擬天氣、定位及設施通報，並以同一個本地路線引擎重新計算。資料不會傳送到香港天文台、GPS
        或設施營運方。
      </p>

      <div className="demo-accessibility-controls" aria-label="輔助顯示示範">
        <strong>顯示輔助預覽</strong>
        <button
          type="button"
          aria-pressed={largeText}
          onClick={() => setLargeText((value) => !value)}
        >
          {largeText ? '關閉大字' : '放大示範文字'}
        </button>
        <button
          type="button"
          aria-pressed={highContrast}
          onClick={() => setHighContrast((value) => !value)}
        >
          {highContrast ? '關閉高對比' : '示範高對比'}
        </button>
        <p>VoiceOver / TalkBack 的實際操作仍需在支援的手機和讀屏軟件上測試。</p>
      </div>

      <div className="demo-service-grid">
        <section className="demo-service-card" aria-labelledby="demo-weather-title">
          <h3 id="demo-weather-title">天氣改道</h3>
          <p>示範資料源：香港天文台觀測情境（非即時；時間為虛構示例）。</p>
          <div className="demo-service-actions" role="group" aria-label="選擇示範天氣">
            {(
              [
                ['sunny', '晴天'],
                ['rain', '大雨'],
                ['heat', '高溫'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={weather === value}
                onClick={() => changeWeather(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <p>
            示範觀測：
            {weather === 'rain'
              ? '降雨警告 · 32 mm/h'
              : weather === 'heat'
                ? '氣溫 · 34°C'
                : '晴朗 · 29°C'}
            {' · '}更新時間：2026-10-13 09:00 HKT（示例）
          </p>
        </section>

        <section className="demo-service-card" aria-labelledby="demo-location-title">
          <h3 id="demo-location-title">迷路後確認位置</h3>
          <p>模擬照片辨識已找到附近地標；由使用者選擇並確認位置，不模擬真實相機或 GPS。</p>
          <label>
            示範位置候選
            <select
              value={candidateNode}
              onChange={(event) => setCandidateNode(event.target.value)}
            >
              <option value="">選擇地標候選</option>
              {candidates.map((record) => (
                <option key={record.id} value={record.node_id!}>
                  {record.names.join(' / ')} · {record.level_id || '室外'}
                </option>
              ))}
            </select>
          </label>
          <p>目前節點：{currentNode?.label || currentNode?.id || '未知'}</p>
          <button
            type="button"
            className="primary"
            disabled={!candidateNode}
            onClick={confirmLocation}
          >
            確認示範位置並更新路線
          </button>
        </section>

        <section className="demo-service-card" aria-labelledby="demo-report-title">
          <h3 id="demo-report-title">設施問題與替代路線</h3>
          <label>
            問題設施
            <select value={facilityId} onChange={(event) => setFacilityId(event.target.value)}>
              <option value="">選擇設施</option>
              {scene.graph.facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            問題描述
            <input
              value={description}
              maxLength={300}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="例如：升降機暫停服務"
            />
          </label>
          <button
            type="button"
            className="primary"
            disabled={!facilityId || !description.trim()}
            onClick={submitReport}
          >
            送出示範回報並改道
          </button>
          <p>此操作只修改本示範路線，不會提交給真實客服或營運單位。</p>
        </section>
      </div>

      <div className="demo-route-result" aria-label="示範路線結果">
        <p>
          目前位置：{currentNode?.label || currentNode?.id || '未知'} →{' '}
          {scene.graph.nodes.find((node) => node.id === state.destination_node_id)?.label ||
            '目的地'}
        </p>
        <p>
          原始路線：{distance(original)} · 目前示範路線：{distance(snapshot)}
        </p>
        <p>
          露天距離：{Math.round(snapshot.exposed_m)} m · 使用設施：
          {snapshot.facilities.join('、') || '無跨層設施'}
        </p>
        {!!closed.length && <p>示範中已停用：{closed.join('、')}</p>}
      </div>
      <p className="demo-service-status" role="status" aria-live="polite" aria-atomic="true">
        {notice || '選擇一項服務示範，查看確認流程及路線更新。'}
      </p>
    </section>
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
