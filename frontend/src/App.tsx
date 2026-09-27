import { useEffect, useMemo, useState, lazy, Suspense } from 'react';
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
import { eventIsActive } from '../../shared/routing/policies';
import { FloorMap } from './renderers/FloorMap';
const MacroMap = lazy(() => import('./renderers/MacroMap'));
const profiles: { id: Profile; name: string; en: string; icon: typeof Accessibility }[] = [
  { id: 'wheelchair', name: '輪椅', en: 'Wheelchair', icon: Accessibility },
  { id: 'elderly', name: '長者', en: 'Elderly', icon: PersonStanding },
  { id: 'stroller', name: '嬰兒車', en: 'Stroller', icon: Baby },
];
export default function App() {
  const [provider, setProvider] = useState<'static' | 'http'>(() => {
    try {
      const saved = localStorage.getItem('accessroute-provider');
      if (saved === 'http' || saved === 'static') return saved;
    } catch {}
    return import.meta.env.VITE_PROVIDER === 'http' ? 'http' : 'static';
  });
  const [scenes, setScenes] = useState<Scene[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [choice, setChoice] = useState<[string, string]>(['', '']);
  const [profile, setProfile] = useState<Profile>('wheelchair'),
    [rain, setRain] = useState(false),
    [strict, setStrict] = useState(false),
    [events, setEvents] = useState<DynamicEvent[]>([]);
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
        const loaded = await Promise.all(manifests.map((m) => p.load(m.sceneId)));
        let ev: DynamicEvent[] = [];
        if (provider === 'http') {
          const r = await fetch('/api/events');
          if (!r.ok) throw new Error('無法讀取後端事件');
          ev = await r.json();
        }
        if (!stale) {
          if (loaded.length < 2) throw new Error('至少需要兩個可用場景');
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
  }, [provider]);

  const selected = choice.map((id) => scenes.find((s) => s.manifest.sceneId === id));
  const ctx: RoutingContext = useMemo(
    () => ({ profile, rain, strictAccessibility: strict, events, now: clock }),
    [profile, rain, strict, events, clock],
  );
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
    const previous = events.find((e) => e.id === 'demo-' + facilityId);
    const e: DynamicEvent = {
      id: 'demo-' + facilityId,
      type: 'facility_closed',
      target: { facilityId },
      status: closed.includes(facilityId) ? 'resolved' : 'active',
      validFrom: previous?.validFrom || new Date().toISOString(),
      source: 'demo',
      confidence: 1,
    };
    setBusy(true);
    try {
      if (provider === 'http') {
        const r = await fetch('/api/events', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(e),
        });
        if (!r.ok) throw new Error('後端未接受事件，狀態未更改');
      }
      anchor();
      setEvents((old) => [...old.filter((x) => x.id !== e.id), e]);
      setNotice(
        e.status === 'active'
          ? '模擬電梯停用：已重新計算剩餘路線。有替代電梯時會改道，否則顯示無可行路線。'
          : '電梯演示事件已解除，路線已更新。',
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
        ? `乘搭 ${currentFacility?.label || '電梯'}`
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
              「演示模式」允許未知通行條件並加入成本懲罰；「僅使用已核實通道」會阻擋未知路段，因此目前可能找不到可行路線。電梯
              A / B 為演示編號，並非官方電梯編號。
            </p>
            <p>
              室內路線根據官方走廊幾何生成；電梯是否服務指定樓層、門寬、坡度、開放時間和站口連接尚未核實。雨天偏好使用模擬情境，並非即時天氣。
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
                    <span className="endpoint-mark start">A</span>
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
                      <span className="field-detail">1/F 公共走廊演示點</span>
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
                    <span className="endpoint-mark end">B</span>
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
                      <span className="field-detail">1/F 公共走廊演示點</span>
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
                        onClick={() => setPreference(() => setProfile(p.id))}
                      >
                        <p.icon size={23} />
                        <strong>{p.name}</strong>
                        <small>{p.en}</small>
                      </button>
                    ))}
                  </div>
                  <div className="preference">
                    <span>
                      <CloudRain size={18} />
                      <span>
                        雨天優先有蓋<small>模擬天氣情境</small>
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
                    <h2>電梯事件模擬</h2>
                    <span className="mini-label">DEMO</span>
                  </div>
                  <p>關閉目前場景的電梯，觀察路線變化。</p>
                  {scene.graph.facilities
                    .filter((f) => f.kind === 'lift')
                    .map((f) => (
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
                        'A'
                      ) : (
                        'B'
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
                            ? '建築 → 交通節點'
                            : '交通節點 → 建築'}
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
                <div className="map-canvas">
                  {view === 'macro' ? (
                    <Suspense fallback={<div className="map-loading">載入本地地圖…</div>}>
                      <MacroMap
                        scene={scene}
                        segments={visibleSegments}
                        closedFacilities={closed}
                      />
                    </Suspense>
                  ) : (
                    <FloorMap
                      scene={scene}
                      segments={visibleSegments}
                      levelId={level}
                      closedFacilities={closed}
                      zoom={zoom}
                    />
                  )}
                  <div className="map-chip">
                    <span className="status-dot" />
                    {view === 'floor' ? '官方樓層平面' : '本地建築幾何'}
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
                  <div className="map-legend">
                    <span>
                      <i className="legend-route" />
                      演示路線
                    </span>
                    <span>
                      <i className="legend-lift">A</i>電梯
                    </span>
                    <span>
                      <i className="legend-unit" />
                      室內單元
                    </span>
                  </div>
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
