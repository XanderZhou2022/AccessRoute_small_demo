import { useEffect, useLayoutEffect, useMemo, useRef, useState, lazy, Suspense } from 'react';
import {
  ArrowRight,
  ArrowUpDown,
  Check,
  ChevronRight,
  CloudRain,
  Footprints,
  Layers,
  MapPin,
  Navigation,
  RefreshCw,
  Route as RouteIcon,
  ShieldCheck,
  TrainFront,
  Accessibility,
  PersonStanding,
  Baby,
  Info,
  ArrowUp,
  ArrowDown,
  Plus,
  Minus,
  PanelLeftClose,
  AlertTriangle,
  CheckCircle2,
  Building2,
  WifiOff,
  Server,
} from 'lucide-react';
import { StaticSceneDataProvider, HttpSceneDataProvider } from '../../shared/providers';
import {
  type Scene,
  type Profile,
  type DynamicEvent,
  type RoutingContext,
  type RouteSegment,
  type NavigationLeg,
  type Journey,
} from '../../shared/domain/schema';
import { route } from '../../shared/routing/route';
import { segmentRoute } from '../../shared/journey/segment';
import { applyRoutingPreferences } from '../../shared/routing/preferences';
import { eventIsActive } from '../../shared/routing/policies';
import { AgentWorkflows } from './components/AgentWorkflows';
import { applyDemoOverlay } from '../../shared/demo/navigation';
import type { DemoOverlay } from '../../shared/demo/types';
import { DemoLibrary } from './components/DemoLibrary';
import { saveEvent } from './api/genai';
import type { WorkflowContext } from '../../shared/genai/workflows';
import { GenAIConsole, type Receipt } from './components/GenAIConsole';
import {
  validateResult,
  obstacleEvent,
  examples,
  IntegrationError,
  type Preferences,
  type IntegrationContext,
} from '../../shared/genai/contracts';
import { ZodError } from 'zod';
import { FloorMap } from './renderers/FloorMap';
import { RouteGuide } from './renderers/RouteGuide';
import { transitionText } from './renderers/routePresentation';
const MacroMap = lazy(() => import('./renderers/MacroMap'));
const profiles: { id: Profile; name: string; en: string; icon: typeof Accessibility }[] = [
  { id: 'walking', name: '步行', en: 'Walking', icon: Footprints },
  { id: 'wheelchair', name: '輪椅', en: 'Wheelchair', icon: Accessibility },
  { id: 'elderly', name: '長者', en: 'Elderly', icon: PersonStanding },
  { id: 'stroller', name: '嬰兒車', en: 'Stroller', icon: Baby },
  { id: 'heavy_luggage', name: '重行李', en: 'Heavy luggage', icon: Accessibility },
];
export default function App() {
  const demoOnly = new URLSearchParams(window.location.search).get('demo') === '1';
  const [candidatePreview, setCandidatePreview] = useState<{
    contextId: string;
    lon: number;
    lat: number;
    label: string;
    level_id?: string;
  } | null>(null);
  const mapCanvas = useRef<HTMLDivElement>(null);
  const [aiPreferences, setAiPreferences] = useState<Preferences | null>(null);
  const [guidance, setGuidance] = useState<{
    contextId: string;
    text: string;
    audioUrl?: string;
  } | null>(null);
  const acceptedRequests = useRef(new Set<string>());
  const applying = useRef(false);
  const liveContextId = useRef('');
  const [provider, setProvider] = useState<'static' | 'http'>(() => {
    if (demoOnly) return 'static';
    try {
      const saved = localStorage.getItem('accessroute-provider');
      if (saved === 'http' || saved === 'static') return saved;
    } catch {}
    return import.meta.env.VITE_PROVIDER === 'http' ? 'http' : 'static';
  });
  const [baseScenes, setBaseScenes] = useState<Scene[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [choice, setChoice] = useState<[string, string]>(['', '']);
  const [profile, setProfile] = useState<Profile>('wheelchair'),
    [rain, setRain] = useState(false),
    [strict, setStrict] = useState(false),
    [events, setEvents] = useState<DynamicEvent[]>([]);
  const [objective, setObjective] = useState<NonNullable<RoutingContext['objective']>>('balanced');
  const [scenario, setScenario] = useState(true);
  const [allowStairs, setAllowStairs] = useState(false);
  const [allowEscalators, setAllowEscalators] = useState(false);
  const [avoidLifts, setAvoidLifts] = useState(false);
  const [maxSlope, setMaxSlope] = useState(0.0833);
  const [origins, setOrigins] = useState<Record<string, string>>({}),
    [legIndex, setLegIndex] = useState(0),
    [currentSegmentIndex, setCurrentSegmentIndex] = useState(0),
    [started, setStarted] = useState(false),
    [complete, setComplete] = useState(false),
    [view, setView] = useState<'macro' | 'floor'>('macro'),
    [inspectLevel, setInspectLevel] = useState(''),
    [zoom, setZoom] = useState(1),
    [notice, setNotice] = useState(''),
    [details, setDetails] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [busy, setBusy] = useState(false),
    [clock, setClock] = useState(new Date().toISOString());
  useEffect(() => {
    try {
      localStorage.setItem('accessroute-provider', provider);
    } catch {}
    let stale = false;
    setLoading(true);
    setError('');
    const p =
      provider === 'static'
        ? new StaticSceneDataProvider(import.meta.env.BASE_URL + 'data/scenes')
        : new HttpSceneDataProvider();
    p.list()
      .then(async (manifests) => {
        let loaded = await Promise.all(manifests.map((m) => p.load(m.sceneId)));
        const original = loaded;
        if (scenario) {
          const response = await fetch(import.meta.env.BASE_URL + 'data/demo/overlays.json');
          if (!response.ok) throw new Error('無法讀取規劃場景');
          const overlays: DemoOverlay[] = await response.json();
          loaded = loaded.map((s) =>
            applyDemoOverlay(
              s,
              overlays.find((o) => o.scene_id === s.manifest.sceneId)!,
            ),
          );
        }
        let ev: DynamicEvent[] = [];
        if (provider === 'http') {
          const r = await fetch('/api/events');
          if (!r.ok) throw new Error('無法讀取後端事件');
          ev = await r.json();
        }
        if (!stale) {
          if (loaded.length < 2) throw new Error('至少需要兩個可用場景');
          setBaseScenes(original);
          setScenes(loaded);
          setChoice([loaded[0].manifest.sceneId, loaded[1].manifest.sceneId]);
          setEvents(ev);
          reset();
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!stale) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      stale = true;
    };
  }, [provider, scenario]);

  const selected = choice.map((id) => scenes.find((s) => s.manifest.sceneId === id));
  const ctx: RoutingContext = useMemo(() => {
    const context: RoutingContext = {
      profile,
      rain,
      objective: rain && objective === 'balanced' ? 'sheltered' : objective,
      graphMode: scenario ? 'scenario' : 'base',
      allowStairs,
      allowEscalators,
      avoidLifts,
      maxSlope,
      strictAccessibility: strict,
      events,
      now: clock,
      avoidStairs: aiPreferences?.avoid_stairs,
      avoidSteepSlopes: aiPreferences?.avoid_steep_slopes,
      preferCoveredShelter: aiPreferences?.prefer_covered_shelter,
    };
    return aiPreferences ? applyRoutingPreferences(context, aiPreferences) : context;
  }, [
    profile,
    rain,
    strict,
    events,
    clock,
    aiPreferences,
    objective,
    scenario,
    allowStairs,
    allowEscalators,
    avoidLifts,
    maxSlope,
  ]);
  const legs: NavigationLeg[] = useMemo(
    () =>
      selected
        .filter((s): s is Scene => !!s)
        .map((s, i) => {
          const from =
              origins[String(i)] || (i === 0 ? s.manifest.defaultStart : s.manifest.defaultEnd),
            to = i === 0 ? s.manifest.defaultEnd : s.manifest.defaultStart;
          const result = route(s.graph, from, to, ctx);
          return {
            type: 'navigation',
            id: 'nav-' + i,
            sceneId: s.manifest.sceneId,
            from,
            to,
            route: result,
            segments: segmentRoute(s.graph, result),
          };
        }),
    [scenes, choice, origins, ctx],
  );
  const journey: Journey = {
    id: 'demo-journey',
    legs:
      legs.length === 2
        ? [
            legs[0],
            {
              type: 'transit',
              id: 'transit',
              abstract: true,
              from: selected[0]!.manifest.station,
              to: selected[1]!.manifest.station,
              label: '公共交通接駁示意',
            },
            legs[1],
          ]
        : [],
  };
  const currentNav = legIndex === 2 ? 1 : 0,
    scene = selected[currentNav],
    leg = legs[currentNav],
    segment = leg?.segments[currentSegmentIndex];
  const visibleSegments = useMemo(
    () => leg?.segments.slice(currentSegmentIndex) || [],
    [leg, currentSegmentIndex],
  );
  const closed = events
    .filter((e) => e.type === 'facility_closed' && eventIsActive(e, clock))
    .map((e) => e.target.facilityId!)
    .filter(Boolean);
  const noRoute =
    !complete && legs.slice(legIndex === 0 ? 0 : 1).some((l) => l.route.status === 'no_route');
  const total = legs.reduce((v, l) => v + (l.route.status === 'ok' ? l.route.distanceM : 0), 0);
  const levelName = (id?: string) =>
    scene?.manifest.levels.find((l) => l.id === id)?.label || id || 'G/F';
  function reset() {
    setOrigins({});
    setLegIndex(0);
    setCurrentSegmentIndex(0);
    setStarted(false);
    setComplete(false);
    setView('macro');
    setInspectLevel('');
    setZoom(1);
    setNotice('');
  }
  function anchor() {
    if (started && !complete && legIndex !== 1 && segment) {
      setOrigins((o) => ({ ...o, [String(currentNav)]: segment.nodeIds[0] }));
      setCurrentSegmentIndex(0);
    }
    setClock(new Date().toISOString());
  }
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date().toISOString();
      if (events.some((e) => eventIsActive(e, now) !== eventIsActive(e, clock))) anchor();
    }, 1000);
    return () => clearInterval(timer);
  }, [events, clock, started, complete, legIndex, segment]);
  function setPreference(fn: () => void) {
    anchor();
    fn();
    setNotice(started ? '已從目前路段起點重新規劃。' : '已更新路線偏好。');
  }
  function start() {
    setStarted(true);
    setView(segment?.type === 'floor' ? 'floor' : 'macro');
    setInspectLevel('');
    setNotice('模擬導航已開始。請用「已到達」推進，並非即時定位。');
  }
  function next() {
    if (complete) return;
    if (legIndex === 1) {
      setLegIndex(2);
      setCurrentSegmentIndex(0);
      setView(legs[1]?.segments[0]?.type === 'floor' ? 'floor' : 'macro');
      setInspectLevel('');
      return;
    }
    if (!segment || leg.route.status === 'no_route') return;
    if (currentSegmentIndex < leg.segments.length - 1) {
      const s = leg.segments[currentSegmentIndex + 1];
      setCurrentSegmentIndex((i) => i + 1);
      setView(s.type === 'floor' || s.type === 'transition' ? 'floor' : 'macro');
      setInspectLevel('');
      setZoom(1);
    } else if (legIndex === 0) {
      setLegIndex(1);
      setView('macro');
      setInspectLevel('');
    } else {
      setComplete(true);
      setNotice('旅程演示完成。你已完成兩個場景的樓層與電梯導航。');
    }
  }
  async function toggleLift(facilityId: string) {
    const restoring = closed.includes(facilityId);
    const changes: DynamicEvent[] = restoring
      ? events
          .filter(
            (e) =>
              e.type === 'facility_closed' &&
              e.target.facilityId === facilityId &&
              eventIsActive(e, clock),
          )
          .map((e) => ({ ...e, status: 'resolved' as const }))
      : [
          {
            id: 'demo-' + facilityId,
            type: 'facility_closed',
            target: { facilityId },
            status: 'active',
            validFrom: new Date().toISOString(),
            source: 'demo',
            confidence: 1,
          },
        ];
    setBusy(true);
    try {
      if (provider === 'http') await Promise.all(changes.map(saveEvent));
      anchor();
      const ids = new Set(changes.map((e) => e.id));
      setEvents((old) => [...old.filter((e) => !ids.has(e.id)), ...changes]);
      setNotice(
        restoring ? '電梯停用事件已解除，路線已更新。' : '模擬電梯停用：已重新計算剩餘路線。',
      );
    } catch (err) {
      setNotice((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function selectScene(index: number, id: string) {
    const next = [...choice] as [string, string];
    next[index] = id;
    if (next[0] === next[1]) next[1 - index] = choice[index];
    setChoice(next);
    reset();
  }
  const contextId = useMemo(
    () => crypto.randomUUID(),
    [
      scenes,
      choice,
      profile,
      rain,
      objective,
      scenario,
      allowStairs,
      allowEscalators,
      avoidLifts,
      maxSlope,
      strict,
      events,
      origins,
      legIndex,
      currentSegmentIndex,
      started,
      complete,
      aiPreferences,
      clock,
    ],
  );
  const aiContext: IntegrationContext | null =
    scene && leg
      ? {
          version: '1.0',
          context_id: contextId,
          scene_id: scene.manifest.sceneId,
          phase: complete
            ? 'complete'
            : legIndex === 1
              ? 'transit'
              : started
                ? 'navigation'
                : 'planning',
          profile,
          preferences: aiPreferences,
          current_node_id: segment?.nodeIds[0] || leg.from,
          destination_node_id: leg.to,
          segment: segment || null,
          levels: scene.manifest.levels,
          facilities: scene.graph.facilities,
        }
      : null;
  function applyAgentResult(input: unknown): Receipt {
    try {
      if (!scene || !aiContext || loading || error)
        throw new IntegrationError('NOT_READY', '場景尚未載入');
      const r = validateResult(input, scene);
      if (acceptedRequests.current.has(r.request_id))
        throw new IntegrationError('DUPLICATE_REQUEST', 'request_id 已使用，請勿重複套用');
      if (applying.current)
        throw new IntegrationError('BUSY', '上一筆結果更新中，請在下一個畫面更新後重試');
      if (r.context_id !== contextId || contextId !== liveContextId.current)
        throw new IntegrationError('STALE_CONTEXT', '導航已改變，請重新取得上下文');
      if (aiContext.phase === 'complete' || aiContext.phase === 'transit')
        throw new IntegrationError('INVALID_PHASE', '請於規劃或兩端步行導航階段接入');
      if (r.agent === 'preferences') {
        anchor();
        setAiPreferences(r.payload);
        setAllowStairs(!r.payload.avoid_stairs);
        setAllowEscalators(r.payload.allow_escalators ?? !r.payload.avoid_stairs);
        if (r.payload.avoid_lifts !== undefined) setAvoidLifts(r.payload.avoid_lifts);
        if (r.payload.route_objective !== undefined) setObjective(r.payload.route_objective);
        if (r.payload.max_slope !== undefined) setMaxSlope(r.payload.max_slope);
        setProfile(
          r.payload.mobility_type === 'manual_wheelchair' ? 'wheelchair' : r.payload.mobility_type,
        );
      } else if (r.agent === 'obstacle') {
        anchor();
        const event = obstacleEvent(r);
        setEvents((old) => [...old.filter((e) => e.id !== event.id), event]);
      } else if (r.agent === 'localization') {
        if (r.payload.status === 'outdoor_use_gps_directly')
          return {
            status: 'ignored',
            request_id: r.request_id,
            message: '室外定位留給 GPS provider；目前未接入真實 GPS，不移動導航起點。',
          };
        setOrigins((old) => ({ ...old, [String(currentNav)]: r.payload.map_db_node_id! }));
        setCurrentSegmentIndex(0);
        setInspectLevel(r.payload.level_id || '');
        setView(r.payload.is_indoor ? 'floor' : 'macro');
      } else {
        if (!segment || leg.route.status !== 'ok' || r.payload.segment_id !== segment.id)
          throw new IntegrationError('STALE_SEGMENT', '指引必須對應目前可行路段');
        setGuidance({ contextId, text: r.payload.text, audioUrl: r.payload.audio_url });
      }
      acceptedRequests.current.add(r.request_id);
      applying.current = true;
      setNotice('已接收 GenAI ' + r.agent + ' 結果（本頁演示）。');
      return {
        status: 'applied',
        request_id: r.request_id,
        message: '結果已套用；導航將按目前資料更新。',
      };
    } catch (e) {
      return {
        status: 'rejected',
        code:
          e instanceof IntegrationError
            ? e.code
            : e instanceof ZodError
              ? 'INVALID_PAYLOAD'
              : 'INTEGRATION_ERROR',
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
  useLayoutEffect(() => {
    applying.current = false;
    liveContextId.current = contextId;
    if (!aiContext || !scene || loading || error) {
      delete window.accessrouteGenAI;
      return;
    }
    window.accessrouteGenAI = {
      version: '1.0',
      getContext: () => structuredClone(aiContext),
      getScene: () => structuredClone(scene),
      getExamples: () => examples(aiContext, scene),
      submit: applyAgentResult,
    };
    return () => {
      liveContextId.current = '';
      delete window.accessrouteGenAI;
    };
  });
  if (loading)
    return (
      <main className="loading">
        <div className="brand-symbol">
          <RouteIcon />
        </div>
        <h1>AccessRoute HK</h1>
        <p>正在載入本地場景與樓層資料…</p>
      </main>
    );
  if (error)
    return (
      <main className="loading">
        <AlertTriangle size={36} />
        <h1>場景未能載入</h1>
        <p>{error}</p>
        <button
          className="primary"
          onClick={() => {
            if (provider === 'http') setProvider('static');
            else location.reload();
          }}
        >
          使用本地資料重新載入
        </button>
      </main>
    );
  if (!scene || !leg) return <main className="loading">沒有可用場景</main>;
  if (demoOnly)
    return (
      <div className="app-shell">
        <header className="topbar">
          <a className="brand" href={import.meta.env.BASE_URL}>
            AccessRoute HK
          </a>
          <nav>
            <span className="demo-badge">離線案例演示</span>
            <a href={import.meta.env.BASE_URL}>返回旅程規劃</a>
          </nav>
        </header>
        <DemoLibrary scenes={baseScenes} defaultOpen />
      </div>
    );
  const level =
    inspectLevel ||
    (segment?.type === 'transition' ? segment.fromLevel : segment?.levelId) ||
    scene.manifest.levels[0].id;
  const currentFacility = scene.graph.facilities.find((f) => f.id === segment?.facilityId);
  const heading = complete
    ? '已到達目的地'
    : legIndex === 1
      ? '搭乘公共交通接駁'
      : segment?.type === 'transition'
        ? transitionText(scene, segment)
        : segment?.type === 'floor'
          ? `沿 ${levelName(segment.levelId)} 走廊前進`
          : currentNav === 0
            ? '前往交通接駁點'
            : '前往建築接駁點';
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            reset();
          }}
        >
          <span className="brand-symbol">
            <RouteIcon size={24} />
          </span>
          <span>
            AccessRoute <b>HK</b>
            <small>無障礙・每一程</small>
          </span>
        </a>
        <nav>
          <a className="nav-item" href="?demo=1">
            離線案例演示
          </a>
          <button
            className={!details ? 'nav-item active' : 'nav-item'}
            onClick={() => setDetails(false)}
          >
            <Navigation size={17} />
            旅程規劃
          </button>
          <button
            className={details ? 'nav-item active' : 'nav-item'}
            onClick={() => setDetails(true)}
          >
            <Info size={17} />
            資料與說明
          </button>
        </nav>
        <div className="header-meta">
          <span className="demo-badge">RESEARCH DEMO</span>
          <span className="provider-label">
            {provider === 'static' ? <WifiOff size={14} /> : <Server size={14} />}{' '}
            {provider === 'static' ? '本地資料' : 'API 已連接'}
          </span>
        </div>
      </header>
      <DemoLibrary scenes={baseScenes} />
      {aiContext && (
        <AgentWorkflows
          context={
            {
              context_id: contextId,
              scene_id: aiContext.scene_id,
              current_node_id: aiContext.current_node_id,
              destination_node_id: aiContext.destination_node_id,
              phase: aiContext.phase,
              routing: ctx,
              preferences: aiPreferences,
              segment_id: segment?.id || null,
            } satisfies WorkflowContext
          }
          levels={scene.manifest.levels}
          preview={(candidate) => {
            setCandidatePreview({
              contextId,
              lon: candidate.lon,
              lat: candidate.lat,
              label: candidate.names[0],
              level_id: candidate.level_id,
            });
            setView(candidate.level_id ? 'floor' : 'macro');
            setInspectLevel(candidate.level_id || '');
            mapCanvas.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }}
          apply={async (result) => {
            if (liveContextId.current !== result.context_id)
              return {
                status: 'rejected',
                code: 'STALE_CONTEXT',
                message: '導航已改變，請重新提交',
              };
            if (result.agent === 'obstacle' && provider === 'http')
              await saveEvent(obstacleEvent(result));
            return applyAgentResult(result);
          }}
        />
      )}
      {aiContext && (
        <GenAIConsole
          context={aiContext}
          samples={examples(aiContext, scene)}
          apply={applyAgentResult}
          clear={() => {
            anchor();
            setAiPreferences(null);
            setGuidance(null);
            setEvents((old) => old.filter((e) => !e.id.startsWith('genai-')));
            setNotice('已清除本頁 GenAI 結果；目前出行類型保留，可手動切換。');
          }}
        />
      )}
      {guidance?.contextId === contextId && (
        <aside className="genai-guidance" aria-live="polite">
          <strong>粵語導航指引</strong>
          <p>{guidance.text}</p>
          {guidance.audioUrl && aiPreferences?.tts_selection !== 'text_only' && (
            <audio key={guidance.audioUrl} controls src={guidance.audioUrl}>
              瀏覽器不支援音訊播放
            </audio>
          )}
        </aside>
      )}
      {details ? (
        <main className="info-page">
          <button className="text-button" onClick={() => setDetails(false)}>
            ← 返回旅程
          </button>
          <h1>資料透明，才能安心出發。</h1>
          <p className="intro-copy">
            這是一個無障礙導航研究演示。地圖採用香港地政總署公開資料；通行條件尚未經實地核實。
          </p>
          <div className="info-grid">
            {selected.map(
              (s) =>
                s && (
                  <article className="info-card" key={s.manifest.sceneId}>
                    <Building2 />
                    <h2>{s.manifest.nameZh}</h2>
                    <p>{s.manifest.name}</p>
                    <dl>
                      <dt>樓層</dt>
                      <dd>{s.manifest.levels.map((l) => l.label).join(' / ')}</dd>
                      <dt>圖節點 / 連線</dt>
                      <dd>
                        {s.graph.nodes.length} / {s.graph.edges.length}
                      </dd>
                      <dt>室內幾何</dt>
                      <dd>地政總署官方資料</dd>
                      <dt>無障礙屬性</dt>
                      <dd>未知，未經實地核實</dd>
                      <dt>電梯跨層與站口銜接</dt>
                      <dd>演示補充，來源另行標記</dd>
                    </dl>
                  </article>
                ),
            )}
          </div>
          <section className="info-card">
            <h2>如何閱讀演示路線</h2>
            <p>
              「演示模式」允許未知通行條件並加入成本懲罰；「僅使用已核實通道」會阻擋未知路段，因此目前可能找不到可行路線。地圖上的綠色「起點」、粉紅色「終點」標示本段位置；各樓層採不同路線顏色，橙色標記表示電梯或其他換層設施。
            </p>
            <p>
              室內路線根據官方走廊幾何生成；電梯是否服務指定樓層、門寬、坡度、開放時間和站口連接尚未核實。雨天偏好會重算最少露天路線；完整演示場景提供有蓋繞路和多種換層方式。
            </p>
            <p>
              公共交通段只展示兩站的接駁關係，不提供實際線路、班次或換乘指引。此演示沒有 GPS
              或室內定位。
            </p>
            <h3>官方來源</h3>
            <a
              href="https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-indoor-map-api"
              target="_blank"
              rel="noreferrer"
            >
              地政總署 3D 室內地圖 ↗
            </a>
            <br />
            <a
              href="https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-pedestrian-route-search"
              target="_blank"
              rel="noreferrer"
            >
              地政總署 3D 行人路線 API ↗
            </a>
            <br />
            <a
              href="https://data.gov.hk/en-data/dataset/mtr-data-routes-fares-barrier-free-facilities"
              target="_blank"
              rel="noreferrer"
            >
              港鐵無障礙設施公開資料 ↗
            </a>
            <p className="small">
              資料擷取：2026-09-27（香港時間）。Map from Lands Department © HKSARG. 港鐵 CSV
              不等同逐邊通行驗證。
            </p>
          </section>
        </main>
      ) : (
        <>
          <div className="workspace-heading">
            <div>
              <div className="eyebrow">POINT TO POINT · FIRST & LAST MILE</div>
              <h1>規劃你的無障礙旅程</h1>
              <p>從室內樓層，到下一段旅程。</p>
            </div>
            <button className="secondary compact" onClick={() => setSidebar((x) => !x)}>
              <PanelLeftClose size={16} />
              {sidebar ? '收起設定' : '展開設定'}
            </button>
          </div>
          <main className={`workspace ${sidebar ? '' : 'sidebar-hidden'}`}>
            {sidebar && (
              <aside className="planner">
                <section className="planner-section">
                  <div className="section-title">
                    <h2>你的行程</h2>
                    <span className="mini-label">01 — 02</span>
                  </div>
                  <div className="location-form">
                    <span className="endpoint-mark start">起</span>
                    <label>
                      出發建築
                      <select
                        aria-label="出發建築"
                        value={choice[0]}
                        onChange={(e) => selectScene(0, e.target.value)}
                      >
                        {scenes.map((s) => (
                          <option key={s.manifest.sceneId} value={s.manifest.sceneId}>
                            {s.manifest.nameZh}
                          </option>
                        ))}
                      </select>
                      <span className="field-detail">
                        {selected[0]?.graph.nodes.find(
                          (n) => n.id === selected[0]?.manifest.defaultStart,
                        )?.label || '公共通道演示點'}
                      </span>
                    </label>
                  </div>
                  <div className="route-dots">
                    <i />
                    <i />
                    <i />
                    <button
                      aria-label="交換起點終點"
                      onClick={() => {
                        setChoice([choice[1], choice[0]]);
                        reset();
                      }}
                    >
                      <ArrowUpDown size={15} />
                    </button>
                  </div>
                  <div className="location-form">
                    <span className="endpoint-mark end">終</span>
                    <label>
                      目的建築
                      <select
                        aria-label="目的建築"
                        value={choice[1]}
                        onChange={(e) => selectScene(1, e.target.value)}
                      >
                        {scenes.map((s) => (
                          <option key={s.manifest.sceneId} value={s.manifest.sceneId}>
                            {s.manifest.nameZh}
                          </option>
                        ))}
                      </select>
                      <span className="field-detail">
                        {selected[1]?.graph.nodes.find(
                          (n) => n.id === selected[1]?.manifest.defaultStart,
                        )?.label || '公共通道演示點'}
                      </span>
                    </label>
                  </div>
                </section>
                <section className="planner-section">
                  <h2>出行需要</h2>
                  <div className="profile-grid">
                    {profiles.map((p) => (
                      <button
                        key={p.id}
                        aria-pressed={profile === p.id}
                        className={`profile ${profile === p.id ? 'selected' : ''}`}
                        onClick={() =>
                          setPreference(() => {
                            setProfile(p.id);
                            setAiPreferences(null);
                            setAllowStairs(p.id === 'walking' || p.id === 'elderly');
                            setAllowEscalators(p.id === 'walking' || p.id === 'elderly');
                          })
                        }
                      >
                        <p.icon size={23} />
                        <strong>{p.name}</strong>
                        <small>{p.en}</small>
                      </button>
                    ))}
                  </div>
                  <label className="planning-option">
                    選線目標
                    <select
                      aria-label="選線目標"
                      value={objective}
                      onChange={(e) =>
                        setPreference(() => {
                          setAiPreferences(null);
                          setObjective(e.target.value as typeof objective);
                        })
                      }
                    >
                      <option value="balanced">綜合舒適（雨天優先遮雨）</option>
                      <option value="shortest">最短距離</option>
                      <option value="sheltered">最少露天距離</option>
                      <option value="indoor">優先室內</option>
                      <option value="least_effort">減少體力負擔</option>
                      <option value="fastest">最快到達（估計）</option>
                    </select>
                  </label>
                  <label className="planning-option">
                    <input
                      type="checkbox"
                      checked={allowStairs}
                      disabled={profile === 'wheelchair'}
                      onChange={(e) =>
                        setPreference(() => {
                          setAllowStairs(e.target.checked);
                          setAiPreferences(null);
                        })
                      }
                    />
                    可走樓梯
                  </label>
                  <label className="planning-option">
                    <input
                      type="checkbox"
                      checked={allowEscalators}
                      disabled={profile === 'wheelchair'}
                      onChange={(e) =>
                        setPreference(() => {
                          setAllowEscalators(e.target.checked);
                          setAiPreferences(null);
                        })
                      }
                    />
                    可使用扶手電梯
                  </label>
                  <label className="planning-option">
                    <input
                      type="checkbox"
                      checked={avoidLifts}
                      onChange={(e) =>
                        setPreference(() => {
                          setAiPreferences(null);
                          setAvoidLifts(e.target.checked);
                        })
                      }
                    />
                    避開升降機（優先其他通道）
                  </label>
                  <label className="planning-option">
                    最大可接受坡度
                    <select
                      aria-label="最大可接受坡度"
                      value={maxSlope}
                      onChange={(e) =>
                        setPreference(() => {
                          setAiPreferences(null);
                          setMaxSlope(Number(e.target.value));
                        })
                      }
                    >
                      <option value={0.05}>5% 緩坡</option>
                      <option value={0.0833}>8.33%</option>
                      <option value={0.12}>12%</option>
                    </select>
                  </label>
                  <div className="preference">
                    <span>
                      <CloudRain size={18} />
                      <span>
                        雨天優先有蓋<small>重新計算最少露天路線</small>
                      </span>
                    </span>
                    <button
                      className={`switch ${rain ? 'on' : ''}`}
                      role="switch"
                      aria-checked={rain}
                      aria-label="雨天優先有蓋"
                      onClick={() => setPreference(() => setRain(!rain))}
                    >
                      <i />
                    </button>
                  </div>
                  <div className="preference">
                    <span>
                      <ShieldCheck size={18} />
                      <span>
                        僅使用已核實通道<small>阻擋未知無障礙屬性</small>
                      </span>
                    </span>
                    <button
                      className={`switch ${strict ? 'on' : ''}`}
                      role="switch"
                      aria-checked={strict}
                      aria-label="僅使用已核實通道"
                      onClick={() => setPreference(() => setStrict(!strict))}
                    >
                      <i />
                    </button>
                  </div>
                </section>
                <section className="planner-section route-summary">
                  <div>
                    <span>規劃路線距離</span>
                    <strong>
                      {noRoute ? '—' : Math.round(total)}
                      <small> m</small>
                    </strong>
                  </div>
                  <div>
                    <span>樓層導航</span>
                    <strong>
                      2<small> 個場景</small>
                    </strong>
                  </div>
                </section>
                <p className="small">
                  露天{' '}
                  {Math.round(
                    legs.reduce(
                      (n, l) =>
                        n + (l.route.status === 'ok' ? (l.route.metrics?.exposedM ?? 0) : 0),
                      0,
                    ),
                  )}{' '}
                  m · 室內{' '}
                  {Math.round(
                    legs.reduce(
                      (n, l) => n + (l.route.status === 'ok' ? (l.route.metrics?.indoorM ?? 0) : 0),
                      0,
                    ),
                  )}{' '}
                  m · 約{' '}
                  {Math.ceil(
                    legs.reduce(
                      (n, l) =>
                        n +
                        (l.route.status === 'ok' ? (l.route.metrics?.estimatedDurationS ?? 0) : 0),
                      0,
                    ) / 60,
                  )}{' '}
                  分鐘步行／換層
                </p>
                <div className="planner-action">
                  <button className="primary" disabled={noRoute || started} onClick={start}>
                    <Navigation size={18} />
                    {started ? '導航演示中' : '開始導航演示'}
                    <ArrowRight size={18} />
                  </button>
                  <p>
                    <Info size={13} />
                    未知通行條件已標記，請勿作實地導航。
                  </p>
                </div>
                <section className="simulation">
                  <div className="section-title">
                    <h2>設施故障與改道</h2>
                    <span className="mini-label">DEMO</span>
                  </div>
                  <p>停用電梯、坡道、樓梯或扶梯，從目前位置重新規劃。</p>
                  {scene.graph.facilities.map((f) => (
                    <div className="facility-row" key={f.id}>
                      <span>
                        <span className={`status-dot ${closed.includes(f.id) ? 'closed' : ''}`} />
                        {f.label}
                      </span>
                      <button
                        disabled={busy}
                        className={closed.includes(f.id) ? 'restore' : 'close-lift'}
                        onClick={() => toggleLift(f.id)}
                      >
                        {closed.includes(f.id) ? '恢復服務' : '模擬停用'}
                      </button>
                    </div>
                  ))}
                </section>
                <div className="provider-picker">
                  <label>
                    <input
                      type="checkbox"
                      checked={scenario}
                      onChange={(e) => setScenario(e.target.checked)}
                    />
                    完整規劃演示場景
                  </label>
                  <p className="small">
                    包含有蓋繞路、緩坡、樓梯及扶梯；補充通道屬演示設定。關閉後使用原始地圖。
                  </p>
                  <label htmlFor="provider">資料模式</label>
                  <select
                    id="provider"
                    value={provider}
                    onChange={(e) => setProvider(e.target.value as 'static' | 'http')}
                  >
                    <option value="static">本地離線場景</option>
                    <option value="http">本機後端 API</option>
                  </select>
                </div>
              </aside>
            )}
            <section className="journey-area">
              <div className="journey-strip" aria-label="旅程階段">
                {journey.legs.map((l, i) => (
                  <div
                    key={l.id}
                    className={`journey-stop ${legIndex === i ? 'current' : ''} ${legIndex > i || complete ? 'done' : ''}`}
                  >
                    <span className="step-circle">
                      {legIndex > i || complete ? (
                        <Check size={14} />
                      ) : l.type === 'transit' ? (
                        <TrainFront size={15} />
                      ) : i === 0 ? (
                        '起'
                      ) : (
                        '終'
                      )}
                    </span>
                    <div>
                      <strong>
                        {l.type === 'transit'
                          ? '公共交通'
                          : selected[i === 0 ? 0 : 1]?.manifest.nameZh}
                      </strong>
                      <small>
                        {l.type === 'transit'
                          ? '接駁示意'
                          : i === 0
                            ? '出發段 · 建築 → 車站'
                            : '到達段 · 車站 → 建築'}
                      </small>
                    </div>
                    {i < 2 && <ChevronRight className="step-chevron" size={17} />}
                  </div>
                ))}
              </div>
              <div className="map-panel">
                <div className="map-toolbar">
                  <div>
                    <span className="map-title">{scene.manifest.nameZh}</span>
                    <span className="map-subtitle">{scene.manifest.stationZh}周邊</span>
                  </div>
                  <div className="view-tabs">
                    <button
                      aria-pressed={view === 'macro'}
                      className={view === 'macro' ? 'active' : ''}
                      onClick={() => setView('macro')}
                    >
                      <Building2 size={15} />
                      立體概覽
                    </button>
                    <button
                      aria-pressed={view === 'floor'}
                      className={view === 'floor' ? 'active' : ''}
                      onClick={() => setView('floor')}
                    >
                      <Layers size={15} />
                      樓層導航
                    </button>
                  </div>
                </div>
                <div className="map-canvas" ref={mapCanvas}>
                  {view === 'macro' ? (
                    <Suspense fallback={<div className="map-loading">載入本地地圖…</div>}>
                      <MacroMap
                        scene={scene}
                        segments={visibleSegments}
                        routeSegments={leg.segments}
                        closedFacilities={closed}
                        highlight={
                          candidatePreview?.contextId === contextId ? candidatePreview : undefined
                        }
                      />
                    </Suspense>
                  ) : (
                    <FloorMap
                      scene={scene}
                      segments={leg.segments}
                      routeSegments={leg.segments}
                      levelId={level}
                      closedFacilities={closed}
                      zoom={zoom}
                      highlight={
                        candidatePreview?.contextId === contextId ? candidatePreview : undefined
                      }
                    />
                  )}
                  <div className="map-chip">
                    <span className="status-dot" />
                    {view === 'floor'
                      ? scene.levels.features
                          .filter((f) => f.properties.level_id === level)
                          .every((f) => f.geometry.type === 'LineString')
                        ? '官方路網中心線'
                        : '官方樓層平面'
                      : '本地建築幾何'}
                    <span className="chip-divider" />
                    演示路線
                  </div>
                  {view === 'floor' && (
                    <>
                      <div className="floor-selector">
                        <span>樓層</span>
                        {[...scene.manifest.levels].reverse().map((l) => (
                          <button
                            key={l.id}
                            className={level === l.id ? 'active' : ''}
                            onClick={() => {
                              setInspectLevel(l.id);
                              setZoom(1);
                            }}
                          >
                            {l.label}
                          </button>
                        ))}
                      </div>
                      <div className="zoom-controls">
                        <button
                          aria-label="放大樓層"
                          disabled={zoom >= 2}
                          onClick={() => setZoom((z) => Math.min(2, z + 0.25))}
                        >
                          <Plus size={18} />
                        </button>
                        <button
                          aria-label="縮小樓層"
                          disabled={zoom <= 0.75}
                          onClick={() => setZoom((z) => Math.max(0.75, z - 0.25))}
                        >
                          <Minus size={18} />
                        </button>
                      </div>
                    </>
                  )}
                  {segment?.type === 'transition' && legIndex !== 1 && !complete && (
                    <div className="transition-overlay">
                      <span className="transition-icon">
                        <ArrowUpDown size={27} />
                      </span>
                      <div>
                        <span className="eyebrow">樓層轉換</span>
                        <h3>
                          {currentFacility?.label} · {levelName(segment.fromLevel)}{' '}
                          <ArrowRight size={17} /> {levelName(segment.toLevel)}
                        </h3>
                        <p>請確認已到達目標樓層後繼續。</p>
                      </div>
                    </div>
                  )}
                  {legIndex === 1 && !complete && (
                    <div className="transit-overlay">
                      <TrainFront size={36} />
                      <span className="eyebrow">TRANSIT LEG</span>
                      <h2>
                        {selected[0]?.manifest.stationZh}
                        <ArrowRight size={20} />
                        {selected[1]?.manifest.stationZh}
                      </h2>
                      <p>公共交通接駁示意</p>
                      <small>此段不包含實際線路、班次或換乘規劃。</small>
                    </div>
                  )}
                  {complete && (
                    <div className="transit-overlay">
                      <CheckCircle2 size={45} />
                      <h2>已完成旅程演示</h2>
                      <p>你已到達 {selected[1]?.manifest.nameZh}</p>
                      <button className="primary" onClick={reset}>
                        <RefreshCw size={16} />
                        重新體驗
                      </button>
                    </div>
                  )}
                  {noRoute && (
                    <div className="no-route" role="alert">
                      <AlertTriangle size={34} />
                      <h2>暫無可行無障礙路線</h2>
                      <p>
                        {strict
                          ? '目前路段的無障礙屬性未經核實，嚴格模式已阻擋。'
                          : '可用通道已被事件阻擋。請恢復電梯或調整出行條件。'}
                      </p>
                      <small>系統不會改走樓梯來替代輪椅路線。</small>
                    </div>
                  )}
                  <div className="attribution">
                    <a href="https://www.landsd.gov.hk/" target="_blank" rel="noreferrer">
                      <img
                        src={import.meta.env.BASE_URL + 'landsd-logo.svg'}
                        alt="地政總署 Lands Department"
                      />
                    </a>{' '}
                    · Map from Lands Department © HKSARG
                  </div>
                </div>
                <RouteGuide
                  scene={scene}
                  segments={leg.segments}
                  activeId={segment?.id}
                  view={view}
                  onInspect={(s) => {
                    if (s.type === 'floor' || s.type === 'transition') {
                      setInspectLevel(s.levelId || s.fromLevel || '');
                      setView('floor');
                      setZoom(1);
                    } else setView('macro');
                  }}
                />
                <div className="navigation-card">
                  <span className="direction-icon">
                    {complete ? (
                      <Check />
                    ) : segment?.type === 'transition' ? (
                      <ArrowUpDown />
                    ) : legIndex === 1 ? (
                      <TrainFront />
                    ) : (
                      <Navigation />
                    )}
                  </span>
                  <div className="navigation-copy">
                    <span className="eyebrow">
                      {complete
                        ? 'JOURNEY COMPLETE'
                        : started
                          ? '模擬導航 · ' +
                            (legIndex === 1
                              ? '交通接駁'
                              : `路段 ${currentSegmentIndex + 1} / ${leg.segments.length}`)
                          : '路線預覽'}
                    </span>
                    <h2>{heading}</h2>
                    <p>
                      {complete
                        ? '感謝體驗 AccessRoute HK。'
                        : noRoute
                          ? '請先調整條件，再開始導航。'
                          : legIndex === 1
                            ? '到達下一站後，繼續最後一段導航。'
                            : segment?.type === 'transition'
                              ? `${levelName(segment.fromLevel)} → ${levelName(segment.toLevel)} · 電梯跨層服務待核實`
                              : segment
                                ? `${Math.round(segment.distanceM)} m · ${segment.type === 'floor' ? '室內路段' : '室外銜接待核實'}`
                                : '目的地已到達'}
                    </p>
                  </div>
                  <button
                    className="primary next-button"
                    disabled={noRoute || complete}
                    onClick={started ? next : start}
                  >
                    {!started
                      ? '開始演示'
                      : legIndex === 1
                        ? '已到達下一站'
                        : segment?.type === 'transition'
                          ? `已到達 ${levelName(segment.toLevel)}`
                          : '已到達 · 下一步'}
                    <ArrowRight size={17} />
                  </button>
                </div>
              </div>
              <div className="route-footnote">
                <ShieldCheck size={19} />
                <div>
                  <strong>
                    {profile === 'wheelchair'
                      ? '輪椅路線避開樓梯及扶手電梯'
                      : profile === 'stroller'
                        ? '嬰兒車路線避開樓梯及扶手電梯'
                        : '長者路線提高樓梯成本'}
                  </strong>
                  <p>通行條件未知的路段仍需核實；電梯狀態為演示模擬。</p>
                </div>
                <button className="text-button" onClick={() => setDetails(true)}>
                  查看資料
                  <ChevronRight size={15} />
                </button>
              </div>
              <div className="status-message" role="status" aria-live="polite">
                {notice || '選擇出行需要，開始兩端首末段導航演示。'}
              </div>
              {started && (
                <button className="text-button restart" onClick={reset}>
                  <RefreshCw size={14} />
                  重設旅程
                </button>
              )}
            </section>
          </main>
          <footer className="page-footer">
            <span>
              AccessRoute HK <span className="footer-divider">/</span> 首末段無障礙導航研究
            </span>
            <span>官方幾何 · 可追溯資料 · 模擬導航</span>
          </footer>
        </>
      )}
    </div>
  );
}
