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
  Settings2,
  AlertTriangle,
  CheckCircle2,
  Building2,
  WifiOff,
  Server,
  Luggage,
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
import { findMtrRoute, mtrLineName } from '../../shared/journey/mtr';
import { guidanceChunks } from '../../shared/journey/guidance';
import mtrLinesAndStations from '../../data/raw/mtr_lines_and_stations.csv?raw';
import { applyRoutingPreferences } from '../../shared/routing/preferences';
import { eventIsActive } from '../../shared/routing/policies';
import { AgentWorkflows } from './components/AgentWorkflows';
import { applyDemoOverlay } from '../../shared/demo/navigation';
import type { DemoOverlay } from '../../shared/demo/types';
import { DemoLibrary } from './components/DemoLibrary';
import { saveEvent } from './api/genai';
import type { RankedCandidate, WorkflowContext } from '../../shared/genai/workflows';
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
  { id: 'heavy_luggage', name: '重行李', en: 'Heavy luggage', icon: Luggage },
];
type WeatherSnapshot = {
  dataStatus: 'live' | 'stale';
  fetchedAt: string;
  temperatureC: number;
  rainfallLastHourMm: number;
  forecastSummary: string;
  warningMessage: string;
  signals: { rainObserved: boolean; hotForecast: boolean };
  location: { scope: 'territory' | 'nearby' | 'partial'; distanceKm?: number };
};
type AccessibilitySettings = {
  largeText: boolean;
  highContrast: boolean;
  reducedMotion: boolean;
  largeTargets: boolean;
  textOnly: boolean;
};

function parseWeatherSnapshot(input: unknown): WeatherSnapshot {
  if (
    !input ||
    typeof input !== 'object' ||
    !('dataStatus' in input) ||
    (input.dataStatus !== 'live' && input.dataStatus !== 'stale') ||
    !('signals' in input) ||
    !input.signals ||
    typeof input.signals !== 'object' ||
    !('rainObserved' in input.signals) ||
    typeof input.signals.rainObserved !== 'boolean' ||
    !('location' in input) ||
    !input.location ||
    typeof input.location !== 'object'
  )
    throw new Error('天氣服務返回了無法識別的資料');
  const data = input as Record<string, unknown>;
  const signals = input.signals as Record<string, unknown>;
  const location = input.location as Record<string, unknown>;
  if (
    typeof signals.rainObserved !== 'boolean' ||
    typeof data.fetchedAt !== 'string' ||
    typeof data.temperatureC !== 'number' ||
    typeof data.rainfallLastHourMm !== 'number' ||
    typeof data.forecastSummary !== 'string' ||
    typeof data.warningMessage !== 'string' ||
    !['territory', 'nearby', 'partial'].includes(String(location.scope))
  )
    throw new Error('天氣服務返回了不完整的資料');
  return {
    dataStatus: input.dataStatus,
    fetchedAt: data.fetchedAt,
    temperatureC: data.temperatureC,
    rainfallLastHourMm: data.rainfallLastHourMm,
    forecastSummary: data.forecastSummary,
    warningMessage: data.warningMessage,
    signals: {
      rainObserved: signals.rainObserved,
      hotForecast: signals.hotForecast === true,
    },
    location: {
      scope: location.scope as WeatherSnapshot['location']['scope'],
      ...(typeof location.distanceKm === 'number' ? { distanceKm: location.distanceKm } : {}),
    },
  };
}
function LegacyApp() {
  const query = new URLSearchParams(window.location.search);
  const demoOnly = query.get('demo') === '1';
  const debugMode = query.get('debug') === '1';
  const mapOnly = query.get('mapOnly') === '1';
  const requestedMapOrigin = query.get('origin');
  const requestedMapDestination = query.get('destination');
  const requestedMapView = query.get('view');
  const requestedMapLevel = query.get('level');
  const requestedMapRoute = query.get('route');
  const requestedMapWeather = query.get('weather');
  const requestedMapAvoidLifts = query.get('avoidLifts') === 'true';
  const requestedMapClosedFacilities = query.getAll('closedFacility');
  const requestedMapWalkingSpeed = Number(query.get('speed'));
  const walkingSpeedMps =
    Number.isFinite(requestedMapWalkingSpeed) &&
    requestedMapWalkingSpeed >= 0.3 &&
    requestedMapWalkingSpeed <= 2
      ? requestedMapWalkingSpeed
      : undefined;
  const requestedMapSlope = Number(query.get('slope'));
  const requestedMapMaxSlope = [0.05, 0.0833, 0.12].includes(requestedMapSlope)
    ? requestedMapSlope
    : 0.0833;
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
    if (demoOnly || mapOnly) return 'static';
    try {
      const saved = localStorage.getItem('accessroute-provider');
      if (saved === 'http' || saved === 'static') return saved;
    } catch {}
    return import.meta.env.VITE_PROVIDER === 'http' ? 'http' : 'static';
  });
  const [accessibilitySettings, setAccessibilitySettings] = useState<AccessibilitySettings>(() => {
    const defaults: AccessibilitySettings = {
      largeText: false,
      highContrast: false,
      reducedMotion: false,
      largeTargets: false,
      textOnly: false,
    };
    try {
      const saved = JSON.parse(localStorage.getItem('accessroute-accessibility') || '');
      return { ...defaults, ...(saved && typeof saved === 'object' ? saved : {}) };
    } catch {
      return defaults;
    }
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => {
    try {
      localStorage.setItem('accessroute-accessibility', JSON.stringify(accessibilitySettings));
    } catch {
      setNotice('顯示設定只會套用至本次使用。');
    }
    const root = document.documentElement;
    root.classList.toggle('accessibility-large-text', accessibilitySettings.largeText);
    root.classList.toggle('accessibility-high-contrast', accessibilitySettings.highContrast);
    root.classList.toggle('accessibility-reduced-motion', accessibilitySettings.reducedMotion);
    root.classList.toggle('accessibility-large-targets', accessibilitySettings.largeTargets);
    root.classList.toggle('accessibility-text-only', accessibilitySettings.textOnly);
    return () => {
      root.classList.remove(
        'accessibility-large-text',
        'accessibility-high-contrast',
        'accessibility-reduced-motion',
        'accessibility-large-targets',
        'accessibility-text-only',
      );
    };
  }, [accessibilitySettings]);
  const [baseScenes, setBaseScenes] = useState<Scene[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState('');
  const [choice, setChoice] = useState<[string, string]>(['', '']);
  const requestedProfile = query.get('profile');
  const [profile, setProfile] = useState<Profile>(
      () => profiles.find((p) => p.id === requestedProfile)?.id || 'wheelchair',
    ),
    [rain, setRain] = useState(query.get('weather') === 'rain'),
    [weather, setWeather] = useState<WeatherSnapshot | null>(null),
    [weatherLoading, setWeatherLoading] = useState(false),
    [weatherError, setWeatherError] = useState(''),
    [weatherRecommendation, setWeatherRecommendation] = useState(false),
    [strict, setStrict] = useState(false),
    [events, setEvents] = useState<DynamicEvent[]>([]);
  const [objective, setObjective] = useState<NonNullable<RoutingContext['objective']>>(() => {
    if (requestedMapRoute === 'short') return 'shortest';
    if (requestedMapRoute === 'sheltered')
      return requestedMapWeather === 'heat' ? 'indoor' : 'sheltered';
    if (requestedMapWeather === 'heat') return 'indoor';
    if (requestedMapWeather === 'rain') return 'sheltered';
    return 'balanced';
  });
  const [scenario, setScenario] = useState(true);
  const [allowStairs, setAllowStairs] = useState(query.get('stairs') === 'true');
  const [allowEscalators, setAllowEscalators] = useState(query.get('escalators') === 'true');
  const [avoidLifts, setAvoidLifts] = useState(requestedMapAvoidLifts);
  const [maxSlope, setMaxSlope] = useState(requestedMapMaxSlope);
  const [origins, setOrigins] = useState<Record<string, string>>({}),
    [legIndex, setLegIndex] = useState(0),
    [currentSegmentIndex, setCurrentSegmentIndex] = useState(0),
    [started, setStarted] = useState(false),
    [sheetExpanded, setSheetExpanded] = useState(false),
    [complete, setComplete] = useState(false),
    [view, setView] = useState<'macro' | 'floor'>(
      query.get('mapView') === 'floor' ? 'floor' : 'macro',
    ),
    [inspectLevel, setInspectLevel] = useState(requestedMapLevel || ''),
    [zoom, setZoom] = useState(() => (mapOnly ? 3 : 1)),
    [notice, setNotice] = useState(''),
    [details, setDetails] = useState(false),
    [requestedWorkflow, setRequestedWorkflow] = useState<'obstacle' | 'localization' | undefined>(),
    [workflowRequestId, setWorkflowRequestId] = useState(0),
    [reportFacilityId, setReportFacilityId] = useState(''),
    [reportDescription, setReportDescription] = useState(''),
    [reportFormOpen, setReportFormOpen] = useState(false),
    [sidebar, setSidebar] = useState(true),
    [busy, setBusy] = useState(false),
    [clock, setClock] = useState(new Date().toISOString());
  const hasCommittedInitialView = useRef(false);
  useEffect(() => {
    if (!hasCommittedInitialView.current) {
      hasCommittedInitialView.current = true;
      return;
    }
    document.getElementById('main-content')?.focus();
  }, [details]);
  const switchDetails = (next: boolean) => setDetails(next);
  async function loadWeather(useLocation: boolean) {
    setWeatherLoading(true);
    setWeatherError('');
    try {
      let coordinates = '';
      if (useLocation && 'geolocation' in navigator) {
        try {
          const position = await new Promise<GeolocationPosition>((resolve, reject) =>
            navigator.geolocation.getCurrentPosition(resolve, reject, {
              enableHighAccuracy: false,
              maximumAge: 300_000,
              timeout: 8_000,
            }),
          );
          coordinates = `?latitude=${encodeURIComponent(position.coords.latitude)}&longitude=${encodeURIComponent(position.coords.longitude)}`;
        } catch {
          setNotice('未能取得目前位置，改用香港全境天氣資料。');
        }
      }
      const response = await fetch('/api/weather' + coordinates);
      if (!response.ok) throw new Error('香港天文台資料暫時無法取得');
      const snapshot = parseWeatherSnapshot(await response.json());
      setWeather(snapshot);
      setWeatherRecommendation(snapshot.signals.rainObserved);
      if (snapshot.dataStatus === 'stale')
        setNotice('天氣服務暫時離線，現正使用上次成功取得的資料。');
    } catch (error) {
      setWeatherError((error as Error).message);
    } finally {
      setWeatherLoading(false);
    }
  }
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
          const mapOriginScene = mapOnly
            ? loaded.find((scene) => scene.manifest.sceneId === requestedMapOrigin)
            : undefined;
          if (mapOriginScene) {
            const destinationScene = loaded.find(
              (scene) => scene.manifest.sceneId === requestedMapDestination,
            );
            setChoice([
              mapOriginScene.manifest.sceneId,
              destinationScene?.manifest.sceneId ||
                loaded.find((scene) => scene.manifest.sceneId !== mapOriginScene.manifest.sceneId)!
                  .manifest.sceneId,
            ]);
          } else {
            setChoice([loaded[0].manifest.sceneId, loaded[1].manifest.sceneId]);
          }
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
  }, [provider, scenario, mapOnly, requestedMapOrigin, requestedMapDestination]);

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
      ...(mapOnly && walkingSpeedMps !== undefined ? { walkingSpeedMps } : {}),
      strictAccessibility: strict,
      events: [
        ...events,
        ...requestedMapClosedFacilities.map((facilityId) => ({
          id: `paired-${facilityId}`,
          type: 'facility_closed' as const,
          target: { facilityId },
          status: 'active' as const,
          validFrom: '2000-01-01T00:00:00.000Z',
          source: 'demo' as const,
          confidence: 1,
        })),
      ],
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
    requestedMapClosedFacilities.join(','),
    clock,
    aiPreferences,
    objective,
    scenario,
    allowStairs,
    allowEscalators,
    avoidLifts,
    maxSlope,
    mapOnly,
    walkingSpeedMps,
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
  const mapRouteChoices = useMemo(() => {
    if (!mapOnly) return null;
    const originScene = scenes.find((item) => item.manifest.sceneId === choice[0]);
    const destinationScene = scenes.find((item) => item.manifest.sceneId === choice[1]);
    if (!originScene || !destinationScene || originScene === destinationScene) return null;
    const railRoute = findMtrRoute(
      mtrLinesAndStations,
      originScene.manifest.station,
      destinationScene.manifest.station,
    );
    const summarize = (routeObjective: 'shortest' | 'sheltered' | 'indoor') => {
      const originRoute = route(
        originScene.graph,
        origins['0'] || originScene.manifest.defaultStart,
        originScene.manifest.defaultEnd,
        { ...ctx, objective: routeObjective },
      );
      const destinationRoute = route(
        destinationScene.graph,
        origins['1'] || destinationScene.manifest.defaultEnd,
        destinationScene.manifest.defaultStart,
        { ...ctx, objective: routeObjective },
      );
      if (originRoute.status !== 'ok' || destinationRoute.status !== 'ok' || !railRoute)
        return {
          status: 'no_route' as const,
          reasonCodes: [
            ...(originRoute.status === 'no_route' ? originRoute.reasonCodes : []),
            ...(destinationRoute.status === 'no_route' ? destinationRoute.reasonCodes : []),
            ...(!railRoute ? ['NO_MTR_STATION_ROUTE'] : []),
          ],
        };
      return {
        status: 'ok' as const,
        distanceM: originRoute.distanceM + destinationRoute.distanceM,
        durationS:
          (originRoute.metrics?.estimatedDurationS ?? 0) +
          (destinationRoute.metrics?.estimatedDurationS ?? 0),
        edgeIds: [
          ...originRoute.edgeIds.map((id) => `${originScene.manifest.sceneId}:${id}`),
          ...destinationRoute.edgeIds.map((id) => `${destinationScene.manifest.sceneId}:${id}`),
        ],
        warnings: [...new Set([...originRoute.warnings, ...destinationRoute.warnings])],
        legs: [
          { sceneId: originScene.manifest.sceneId, route: originRoute },
          { sceneId: destinationScene.manifest.sceneId, route: destinationRoute },
        ],
      };
    };
    return {
      sceneId: originScene.manifest.sceneId,
      originSceneId: originScene.manifest.sceneId,
      destinationSceneId: destinationScene.manifest.sceneId,
      originStation: originScene.manifest.stationZh,
      destinationStation: destinationScene.manifest.stationZh,
      railRoute,
      shortest: summarize('shortest'),
      sheltered: summarize(requestedMapWeather === 'heat' ? 'indoor' : 'sheltered'),
    };
  }, [mapOnly, scenes, choice, origins, ctx, requestedMapWeather]);
  useEffect(() => {
    if (!mapOnly || window.parent === window || !mapRouteChoices) return;
    const activeRoutes =
      requestedMapRoute === 'short' ? mapRouteChoices.shortest : mapRouteChoices.sheltered;
    const steps: {
      title: string;
      detail: string;
      distanceM: number;
      sceneId: string;
      levelId?: string;
      fromNodeId?: string;
      toNodeId?: string;
    }[] = [];
    if (activeRoutes.status === 'ok') {
      for (const legRoute of activeRoutes.legs) {
        const legScene = scenes.find((item) => item.manifest.sceneId === legRoute.sceneId);
        if (!legScene) continue;
        for (const segment of segmentRoute(legScene.graph, legRoute.route)) {
          const startNode = legScene.graph.nodes.find((node) => node.id === segment.nodeIds[0]);
          const endNode = legScene.graph.nodes.find(
            (node) => node.id === segment.nodeIds[segment.nodeIds.length - 1],
          );
          const level =
            legScene.manifest.levels.find((item) => item.id === segment.levelId)?.label || '';
          const fromLevel =
            legScene.manifest.levels.find((item) => item.id === segment.fromLevel)?.label ||
            '目前樓層';
          const toLevel =
            legScene.manifest.levels.find((item) => item.id === segment.toLevel)?.label ||
            '下一樓層';
          const chunks = guidanceChunks(
            legScene.graph,
            segment,
            walkingSpeedMps ??
              { walking: 1.3, wheelchair: 0.8, elderly: 0.7, stroller: 0.9, heavy_luggage: 0.8 }[
                ctx.profile
              ],
          );
          chunks.forEach((chunk, chunkIndex) => {
            const chunkStart = legScene.graph.nodes.find((node) => node.id === chunk.nodeIds[0]);
            const chunkEnd = legScene.graph.nodes.find(
              (node) => node.id === chunk.nodeIds[chunk.nodeIds.length - 1],
            );
            const title =
              segment.type === 'transition'
                ? transitionText(legScene, segment)
                : segment.type === 'bridge'
                  ? '沿天橋前行'
                  : segment.type === 'outdoor'
                    ? '沿室外路段前行'
                    : `沿 ${level || '室內'} 通道前行`;
            const from = chunkStart?.label || legScene.manifest.nameZh;
            const to =
              chunkEnd?.label ||
              (chunkEnd?.kind === 'stop' ? legScene.manifest.stationZh : '路線下一點');
            const detail =
              segment.type === 'transition'
                ? `由 ${fromLevel} 前往 ${toLevel} · ${from} → ${to}`
                : `${level || title} · ${from} → ${to}${
                    chunks.length > 1 ? `（路段 ${chunkIndex + 1}/${chunks.length}）` : ''
                  }`;
            steps.push({
              title,
              detail,
              distanceM: chunk.distanceM,
              sceneId: legScene.manifest.sceneId,
              ...(segment.type === 'transition'
                ? { levelId: segment.fromLevel }
                : segment.type === 'floor'
                  ? { levelId: segment.levelId }
                  : {}),
              fromNodeId: chunkStart?.id,
              toNodeId: chunkEnd?.id,
            });
          });
        }
        if (legRoute.sceneId === mapRouteChoices.originSceneId) {
          const rail = mapRouteChoices.railRoute;
          if (!rail) break;
          if (rail.hops.length === 0) {
            steps.push({
              title: '前往目的地場景',
              detail:
                '起點和目的地使用同一車站；車站內／站外的步行接駁路線尚未納入此示範，請依現場指示前往。',
              distanceM: 0,
              sceneId: mapRouteChoices.destinationSceneId,
            });
          }
          for (let index = 0; index < rail.hops.length;) {
            const hop = rail.hops[index];
            if (hop.lineCode === 'TRANSFER') {
              const nextHop = rail.hops[index + 1];
              steps.push({
                title: `在 ${hop.to.nameZh} 轉乘`,
                detail: nextHop
                  ? `接乘${mtrLineName(nextHop.lineCode)}；車站內轉乘指示及無障礙設施尚未核實。`
                  : '車站內轉乘指示及無障礙設施尚未核實。',
                distanceM: 0,
                sceneId: mapRouteChoices.originSceneId,
              });
              index += 1;
              continue;
            }
            let endIndex = index;
            while (
              endIndex + 1 < rail.hops.length &&
              rail.hops[endIndex + 1].lineCode === hop.lineCode
            )
              endIndex += 1;
            const end = rail.hops[endIndex].to;
            const intermediateStops = endIndex - index;
            steps.push({
              title: `乘搭${mtrLineName(hop.lineCode)}：前往 ${end.nameZh}`,
              detail: `${intermediateStops ? `由 ${hop.from.nameZh} 經 ${intermediateStops} 個中途站前往 ${end.nameZh}` : `由 ${hop.from.nameZh} 直接前往 ${end.nameZh}`}。班次、車程及車站無障礙設施未有即時核實。`,
              distanceM: 0,
              sceneId: mapRouteChoices.originSceneId,
            });
            index = endIndex + 1;
          }
        }
      }
    }
    window.parent.postMessage(
      {
        type: 'accessroute-map-route-update',
        sceneId: mapRouteChoices.sceneId,
        originSceneId: mapRouteChoices.originSceneId,
        destinationSceneId: mapRouteChoices.destinationSceneId,
        viewSceneId: requestedMapView || mapRouteChoices.originSceneId,
        activeRoute: requestedMapRoute === 'short' ? 'short' : 'sheltered',
        activeStatus: activeRoutes.status,
        profile,
        weather: requestedMapWeather,
        routes: {
          short: mapRouteChoices.shortest,
          sheltered: mapRouteChoices.sheltered,
        },
        transitSummary:
          mapRouteChoices.railRoute?.stations
            .filter((station, index, stations) => station.code !== stations[index - 1]?.code)
            .map((station) => station.nameZh)
            .join(' → ') || '',
        steps,
      },
      window.location.origin,
    );
  }, [mapOnly, mapRouteChoices, objective, requestedMapRoute, requestedMapView, scenes]);
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
    setSheetExpanded(false);
    setComplete(false);
    setView(mapOnly && query.get('mapView') === 'floor' ? 'floor' : 'macro');
    setInspectLevel(mapOnly ? requestedMapLevel || '' : '');
    setZoom(mapOnly ? 3 : 1);
    setNotice('');
    setSidebar(true);
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
    setSheetExpanded(false);
    setSidebar(false);
    setView(segment?.type === 'floor' ? 'floor' : 'macro');
    setInspectLevel('');
    setNotice('模擬導航已開始。請用「已到達」推進，並非即時定位。');
  }
  function next() {
    if (complete) return;
    setSheetExpanded(false);
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

  async function submitTextReport() {
    const description = reportDescription.trim();
    if (!scene) {
      setNotice('場景尚未載入，無法提交設施回報。');
      return;
    }
    if (!reportFacilityId || !description) {
      setNotice('請選擇設施並描述遇到的問題。');
      return;
    }
    const facility = scene.graph.facilities.find((f) => f.id === reportFacilityId);
    if (!facility) {
      setNotice('所選設施不屬於目前場景，請重新選擇。');
      return;
    }
    const event: DynamicEvent = {
      id: 'text-report-' + crypto.randomUUID(),
      type: 'facility_closed',
      target: { facilityId: reportFacilityId },
      status: 'active',
      validFrom: new Date().toISOString(),
      source: 'demo',
      confidence: 1,
    };
    setBusy(true);
    try {
      if (provider === 'http') await saveEvent(event);
      anchor();
      setEvents((old) => [...old, event]);
      setReportDescription('');
      setReportFormOpen(false);
      setNotice(
        `已提交示範文字回報：${facility.label}。剩餘路線已重算；此回報不會送交正式營運單位。`,
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
      ...(mapOnly
        ? {
            getWorkflowContext: (targetSceneId?: string, currentNodeId?: string) => {
              const targetIndex = targetSceneId
                ? choice.findIndex((id) => id === targetSceneId)
                : choice.indexOf(requestedMapView || choice[0]);
              const targetScene = scenes.find(
                (item) => item.manifest.sceneId === choice[targetIndex],
              );
              const targetLeg = legs[targetIndex];
              if (!targetScene || !targetLeg || targetIndex < 0)
                throw new IntegrationError('INVALID_SCENE', '所選地點不在目前旅程內');
              const currentNode = currentNodeId
                ? targetScene.graph.nodes.find((node) => node.id === currentNodeId)
                : undefined;
              if (currentNodeId && !currentNode)
                throw new IntegrationError('INVALID_REFERENCE', '目前位置不屬於所選場景');
              const activeSegment =
                targetLeg.segments.find((item) =>
                  currentNode?.id ? item.nodeIds.includes(currentNode.id) : false,
                ) || targetLeg.segments[0];
              return structuredClone({
                context_id: contextId,
                scene_id: targetScene.manifest.sceneId,
                phase: aiContext.phase,
                profile,
                preferences: aiPreferences,
                current_node_id: currentNode?.id || targetLeg.from,
                destination_node_id: targetLeg.to,
                routing: ctx,
                segment_id: activeSegment?.id || null,
              });
            },
            previewMapCandidate: (targetSceneId: string, candidate: RankedCandidate): Receipt => {
              const targetIndex = choice.indexOf(targetSceneId);
              const targetScene = scenes.find((item) => item.manifest.sceneId === targetSceneId);
              const node = targetScene?.graph.nodes.find((item) => item.id === candidate.node_id);
              if (
                targetIndex < 0 ||
                !node ||
                !Number.isFinite(candidate.lon) ||
                !Number.isFinite(candidate.lat) ||
                candidate.lon < -180 ||
                candidate.lon > 180 ||
                candidate.lat < -90 ||
                candidate.lat > 90
              )
                return {
                  status: 'rejected',
                  code: 'INVALID_REFERENCE',
                  message: '候選位置不屬於目前旅程或地圖座標無效。',
                };
              setCandidatePreview({
                contextId,
                lon: candidate.lon,
                lat: candidate.lat,
                label: candidate.names[0] || node.label || '候選位置',
                level_id: candidate.level_id,
              });
              return {
                status: 'applied',
                request_id: `preview-${candidate.id}`,
                message: '候選位置已標示在地圖上；查看後可返回確認。',
              };
            },
            clearMapCandidatePreview: () => setCandidatePreview(null),
            applyMapObstacleResult: (input: unknown): Receipt => {
              try {
                if (loading || error) throw new IntegrationError('NOT_READY', '場景尚未載入');
                if (applying.current) throw new IntegrationError('BUSY', '路線更新中，請稍候再試');
                const inputSceneId =
                  typeof input === 'object' && input !== null && 'scene_id' in input
                    ? input.scene_id
                    : undefined;
                if (typeof inputSceneId !== 'string' || !choice.includes(inputSceneId))
                  throw new IntegrationError('INVALID_SCENE', '回報場景不在目前旅程內');
                const targetScene = scenes.find((item) => item.manifest.sceneId === inputSceneId);
                if (!targetScene) throw new IntegrationError('INVALID_SCENE', '找不到回報場景');
                const result = validateResult(input, targetScene);
                if (result.agent !== 'obstacle')
                  throw new IntegrationError('INVALID_AGENT', '此畫面只接受路障辨識結果');
                if (result.context_id !== contextId || contextId !== liveContextId.current)
                  throw new IntegrationError('STALE_CONTEXT', '旅程已更新，請重新辨識照片');
                if (acceptedRequests.current.has(result.request_id))
                  throw new IntegrationError('DUPLICATE_REQUEST', '此辨識結果已套用');
                const event = obstacleEvent(result);
                acceptedRequests.current.add(result.request_id);
                setEvents((old) => [...old.filter((item) => item.id !== event.id), event]);
                applying.current = true;
                setNotice('已確認路障並更新首末段路線。');
                return {
                  status: 'applied',
                  request_id: result.request_id,
                  message: '已確認設施問題並重新規劃路線。',
                };
              } catch (cause) {
                return {
                  status: 'rejected',
                  code:
                    cause instanceof IntegrationError
                      ? cause.code
                      : cause instanceof ZodError
                        ? 'INVALID_PAYLOAD'
                        : 'INTEGRATION_ERROR',
                  message: cause instanceof Error ? cause.message : String(cause),
                };
              }
            },
            applyMapLocalizationResult: (input: unknown): Receipt => {
              try {
                if (loading || error) throw new IntegrationError('NOT_READY', '場景尚未載入');
                if (applying.current) throw new IntegrationError('BUSY', '路線更新中，請稍候再試');
                const inputSceneId =
                  typeof input === 'object' && input !== null && 'scene_id' in input
                    ? input.scene_id
                    : undefined;
                if (typeof inputSceneId !== 'string')
                  throw new IntegrationError('INVALID_SCENE', '定位結果沒有有效場景');
                const targetIndex = choice.indexOf(inputSceneId);
                const targetScene = scenes.find((item) => item.manifest.sceneId === inputSceneId);
                if (targetIndex < 0 || !targetScene)
                  throw new IntegrationError('INVALID_SCENE', '定位場景不在目前旅程內');
                const result = validateResult(input, targetScene);
                if (result.agent !== 'localization')
                  throw new IntegrationError('INVALID_AGENT', '此畫面只接受照片定位結果');
                if (result.context_id !== contextId || contextId !== liveContextId.current)
                  throw new IntegrationError('STALE_CONTEXT', '旅程已更新，請重新辨識照片');
                const nodeId = result.payload.map_db_node_id;
                if (result.payload.status !== 'matched' || !nodeId)
                  throw new IntegrationError(
                    'LOCATION_REQUIRES_GPS',
                    '照片未能匹配到地圖位置；請補充線索或使用 GPS 後重新辨識。',
                  );
                if (acceptedRequests.current.has(result.request_id))
                  throw new IntegrationError('DUPLICATE_REQUEST', '此定位結果已套用');
                acceptedRequests.current.add(result.request_id);
                setOrigins((old) => ({ ...old, [String(targetIndex)]: nodeId }));
                setCurrentSegmentIndex(0);
                setCandidatePreview(null);
                applying.current = true;
                setNotice('已確認照片位置；剩餘路線將由該公共通道位置重新計算。');
                return {
                  status: 'applied',
                  request_id: result.request_id,
                  message: '位置已確認，剩餘旅程正在由該地圖位置重新規劃。',
                };
              } catch (cause) {
                return {
                  status: 'rejected',
                  code:
                    cause instanceof IntegrationError
                      ? cause.code
                      : cause instanceof ZodError
                        ? 'INVALID_PAYLOAD'
                        : 'INTEGRATION_ERROR',
                  message: cause instanceof Error ? cause.message : String(cause),
                };
              }
            },
          }
        : {}),
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
  if (mapOnly) {
    const mapScene = scenes.find((item) => item.manifest.sceneId === requestedMapView) || scene;
    const mapLeg = legs.find((item) => item.sceneId === mapScene.manifest.sceneId) || leg;
    const mapLevel = mapScene.manifest.levels.some((item) => item.id === inspectLevel)
      ? inspectLevel
      : mapScene.manifest.levels[0].id;
    const updateMapView = (nextView: 'macro' | 'floor', level = mapLevel) => {
      setView(nextView);
      if (nextView === 'floor') setInspectLevel(level);
      if (window.parent !== window)
        window.parent.postMessage(
          { type: 'accessroute-map-view-change', mapView: nextView, level },
          window.location.origin,
        );
    };
    return (
      <main className="map-only-shell">
        <div className="map-only-toolbar" role="group" aria-label="地圖檢視">
          <button
            type="button"
            aria-pressed={view === 'macro'}
            onClick={() => updateMapView('macro')}
          >
            3D 概覽
          </button>
          <button
            type="button"
            aria-pressed={view === 'floor'}
            onClick={() => updateMapView('floor')}
          >
            樓層導航
          </button>
        </div>
        {view === 'macro' ? (
          <Suspense fallback={<div className="map-loading">載入立體地圖…</div>}>
            <MacroMap
              scene={mapScene}
              segments={mapLeg.segments}
              routeSegments={mapLeg.segments}
              closedFacilities={closed}
              highlight={candidatePreview?.contextId === contextId ? candidatePreview : undefined}
            />
          </Suspense>
        ) : (
          <>
            <div className="map-only-levels" role="group" aria-label="選擇樓層">
              {[...mapScene.manifest.levels].reverse().map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={mapLevel === item.id}
                  onClick={() => updateMapView('floor', item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <FloorMap
              scene={mapScene}
              segments={mapLeg.segments}
              routeSegments={mapLeg.segments}
              levelId={mapLevel}
              closedFacilities={closed}
              zoom={zoom}
              interactive
              highlight={candidatePreview?.contextId === contextId ? candidatePreview : undefined}
            />
            <div className="map-only-zoom-controls" role="group" aria-label="樓層地圖縮放">
              <button
                type="button"
                aria-label="放大樓層地圖"
                title="放大樓層地圖"
                disabled={zoom >= 6}
                onClick={() => setZoom((value) => Math.min(6, value + 0.5))}
              >
                <Plus size={20} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="縮小樓層地圖"
                title="縮小樓層地圖"
                disabled={zoom <= 1}
                onClick={() => setZoom((value) => Math.max(1, value - 0.5))}
              >
                <Minus size={20} aria-hidden="true" />
              </button>
            </div>
          </>
        )}
        <p className="map-only-caption">AccessRoute 本地地圖・示範路線</p>
      </main>
    );
  }
  if (demoOnly)
    return (
      <div className="app-shell">
        <a className="skip-link" href="#main-content">
          略過導覽，前往主要內容
        </a>
        <header className="topbar">
          <a className="brand" href={import.meta.env.BASE_URL}>
            AccessRoute HK
          </a>
          <nav>
            {debugMode && <span className="demo-badge">離線案例演示</span>}
            <a href={import.meta.env.BASE_URL}>返回旅程規劃</a>
          </nav>
        </header>
        <section
          className="map-demo-entry"
          id="main-content"
          tabIndex={-1}
          aria-labelledby="map-demo-title"
        >
          <div>
            {debugMode && <span className="demo-badge">互動介面示範</span>}
            <h1 id="map-demo-title">地圖優先・分步旅程</h1>
            <p>以接近地圖導航 App 的簡潔畫面，逐頁體驗設定、選路、導航與求助。</p>
          </div>
          <a className="primary" href={import.meta.env.BASE_URL + 'map-demo/'}>
            開始地圖介面示範
            <ArrowRight size={18} />
          </a>
        </section>
        {debugMode && <DemoLibrary scenes={baseScenes} defaultOpen />}
      </div>
    );
  const level =
    inspectLevel ||
    (segment?.type === 'transition' ? segment.fromLevel : segment?.levelId) ||
    scene.manifest.levels[0].id;
  const currentFacility = scene.graph.facilities.find((f) => f.id === segment?.facilityId);
  const currentNeeds = [
    profiles.find((p) => p.id === profile)?.name || '步行',
    allowStairs ? '可走樓梯' : '避開樓梯',
    allowEscalators ? '可用扶手電梯' : '避開扶手電梯',
    avoidLifts ? '避開升降機' : '可使用升降機',
    rain ? '雨天優先有蓋' : '',
    objective === 'shortest'
      ? '最短距離'
      : objective === 'sheltered'
        ? '最少露天'
        : objective === 'indoor'
          ? '優先室內'
          : objective === 'least_effort'
            ? '減少體力負擔'
            : objective === 'fastest'
              ? '最快到達（估算）'
              : '綜合舒適',
  ].filter(Boolean);
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
    <div
      className={`app-shell ${started ? 'navigation-mode' : ''} ${
        sheetExpanded ? 'navigation-sheet-expanded' : 'navigation-sheet-collapsed'
      }`}
    >
      <a className="skip-link" href="#main-content">
        略過導覽，前往主要內容
      </a>
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
        <nav aria-label="主要導覽">
          <a className="nav-item" href="?demo=1">
            離線案例演示
          </a>
          <button
            className={!details ? 'nav-item active' : 'nav-item'}
            aria-pressed={!details}
            onClick={() => switchDetails(false)}
          >
            <Navigation size={17} />
            旅程規劃
          </button>
          <button
            className={details ? 'nav-item active' : 'nav-item'}
            aria-pressed={details}
            onClick={() => switchDetails(true)}
          >
            <Info size={17} />
            資料與說明
          </button>
          <button
            className={settingsOpen ? 'nav-item active' : 'nav-item'}
            aria-expanded={settingsOpen}
            aria-controls="accessibility-settings"
            onClick={() => setSettingsOpen((open) => !open)}
          >
            <Settings2 size={17} />
            顯示與操作
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
      {settingsOpen && (
        <section className="accessibility-settings" id="accessibility-settings">
          <div>
            <h2>顯示與操作</h2>
            <p>設定會保存在這部裝置，並套用至下次使用。</p>
          </div>
          <label>
            <input
              type="checkbox"
              checked={accessibilitySettings.largeText}
              onChange={(event) =>
                setAccessibilitySettings((settings) => ({
                  ...settings,
                  largeText: event.target.checked,
                }))
              }
            />
            大字
          </label>
          <label>
            <input
              type="checkbox"
              checked={accessibilitySettings.highContrast}
              onChange={(event) =>
                setAccessibilitySettings((settings) => ({
                  ...settings,
                  highContrast: event.target.checked,
                }))
              }
            />
            高對比
          </label>
          <label>
            <input
              type="checkbox"
              checked={accessibilitySettings.reducedMotion}
              onChange={(event) =>
                setAccessibilitySettings((settings) => ({
                  ...settings,
                  reducedMotion: event.target.checked,
                }))
              }
            />
            減少動畫
          </label>
          <label>
            <input
              type="checkbox"
              checked={accessibilitySettings.largeTargets}
              onChange={(event) =>
                setAccessibilitySettings((settings) => ({
                  ...settings,
                  largeTargets: event.target.checked,
                }))
              }
            />
            放大按鈕
          </label>
          <label>
            <input
              type="checkbox"
              checked={accessibilitySettings.textOnly}
              onChange={(event) =>
                setAccessibilitySettings((settings) => ({
                  ...settings,
                  textOnly: event.target.checked,
                }))
              }
            />
            文字導航模式
          </label>
        </section>
      )}
      {details ? (
        <main
          className="info-page"
          id="main-content"
          tabIndex={-1}
          aria-labelledby="info-title"
        >
          <button className="text-button" onClick={() => switchDetails(false)}>
            ← 返回旅程
          </button>
          <h1 id="info-title">資料透明，才能安心出發。</h1>
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
              <div className="eyebrow">ACCESSIBLE JOURNEY</div>
              <h1 id="workspace-title">
                {started ? '跟隨目前指引' : '規劃你的無障礙旅程'}
              </h1>
              <p>
                {started
                  ? '每次只需完成目前一步；地圖以外亦可使用文字路線。'
                  : '先設定出發地、目的地和出行需要，再檢視路線。'}
              </p>
            </div>
            <button className="secondary compact" onClick={() => setSidebar((x) => !x)}>
              <PanelLeftClose size={16} />
              {sidebar ? '收起設定' : '展開設定'}
            </button>
          </div>
          <main
            className={`workspace ${sidebar ? '' : 'sidebar-hidden'}`}
            id="main-content"
            tabIndex={-1}
            aria-labelledby="workspace-title"
          >
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
                  <details className="advanced-preferences">
                    <summary>更多路線條件（坡度、樓梯、天氣）</summary>
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
                  </details>
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
              <nav className="journey-flow" aria-label="旅程流程">
                <ol>
                  <li aria-label="已完成：設定旅程">
                    <span>1</span>
                    <strong>設定旅程</strong>
                  </li>
                  <li
                    aria-current={!started && !complete ? 'step' : undefined}
                    aria-label={!started && !complete ? '目前步驟：檢視路線' : '已完成：檢視路線'}
                  >
                    <span>2</span>
                    <strong>檢視路線</strong>
                  </li>
                  <li
                    aria-current={started && !complete ? 'step' : undefined}
                    aria-label={
                      complete
                        ? '已完成：逐步導航'
                        : started
                          ? '目前步驟：逐步導航'
                          : '尚未開始：逐步導航'
                    }
                  >
                    <span>3</span>
                    <strong>逐步導航</strong>
                  </li>
                </ol>
              </nav>
              <section className="journey-context" aria-label="目前旅程摘要">
                <div>
                  <strong>{started ? '目前出行需要' : '本次路線條件'}</strong>
                  <ul aria-label="已套用的出行需要">
                    {currentNeeds.map((need) => (
                      <li key={need}>{need}</li>
                    ))}
                  </ul>
                </div>
                <p>
                  天氣偏好：{rain ? '已選擇雨天，優先有蓋路線' : '未選擇雨天偏好'}。
                  {weather
                    ? ` ${weather.dataStatus === 'stale' ? '上次資料' : '香港天文台'}：${weather.temperatureC}°C，${weather.forecastSummary}`
                    : ' 尚未讀取香港天文台資料。'}
                  {started && ' 此為導航演示，沒有 GPS 或室內定位。'}
                </p>
                <div className="weather-actions" aria-label="天氣資料">
                  <button
                    className="secondary"
                    disabled={weatherLoading}
                    onClick={() => loadWeather(false)}
                  >
                    <RefreshCw size={15} />
                    {weatherLoading ? '讀取中…' : '讀取香港天文台'}
                  </button>
                  <button
                    className="secondary"
                    disabled={weatherLoading}
                    onClick={() => loadWeather(true)}
                  >
                    <MapPin size={15} />
                    使用目前位置
                  </button>
                  {weatherRecommendation && !rain && (
                    <button
                      className="secondary"
                      onClick={() => {
                        setPreference(() => setRain(true));
                        setWeatherRecommendation(false);
                      }}
                    >
                      <CloudRain size={15} />
                      套用雨天路線
                    </button>
                  )}
                </div>
                {weatherError && (
                  <p role="alert" className="inline-error">
                    {weatherError}。你仍可手動選擇雨天偏好。
                  </p>
                )}
              </section>
              <div className="journey-strip" role="list" aria-label="旅程階段">
                {journey.legs.map((l, i) => (
                  <div
                    key={l.id}
                    className={`journey-stop ${legIndex === i ? 'current' : ''} ${legIndex > i || complete ? 'done' : ''}`}
                    role="listitem"
                    aria-current={legIndex === i ? 'step' : undefined}
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
              {started && (
                <section className="active-trip-needs" aria-label="導航中的出行需要">
                  <strong>本次導航條件</strong>
                  <p>{currentNeeds.join(' · ')}</p>
                </section>
              )}
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
                <div
                  className={`navigation-card ${started ? 'active-navigation' : ''} ${
                    sheetExpanded ? 'sheet-expanded' : 'sheet-collapsed'
                  }`}
                >
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
                  <div
                    className="navigation-copy"
                    role="status"
                    aria-live="polite"
                    aria-atomic="true"
                  >
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
                  {started && !complete && (
                    <button
                      className="secondary sheet-toggle"
                      aria-expanded={sheetExpanded}
                      aria-controls="navigation-help"
                      onClick={() => setSheetExpanded((expanded) => !expanded)}
                    >
                      {sheetExpanded ? '收合路線詳情' : '展開路線詳情'}
                    </button>
                  )}
                  {started && !complete && (
                    <div className="navigation-help" id="navigation-help" aria-label="導航協助">
                      <strong>需要協助？</strong>
                      <button
                        className="secondary"
                        onClick={() => {
                          setRequestedWorkflow('obstacle');
                          setWorkflowRequestId((id) => id + 1);
                        }}
                      >
                        報告設施問題
                      </button>
                      <button
                        className="secondary"
                        onClick={() => {
                          setRequestedWorkflow('localization');
                          setWorkflowRequestId((id) => id + 1);
                        }}
                      >
                        我迷路了
                      </button>
                      <details
                        className="navigation-text-report"
                        open={reportFormOpen}
                        onToggle={(event) => setReportFormOpen(event.currentTarget.open)}
                      >
                        <summary>文字回報設施問題（示範）</summary>
                        <label>
                          出現問題的設施
                          <select
                            value={reportFacilityId}
                            onChange={(event) => setReportFacilityId(event.target.value)}
                          >
                            <option value="">請選擇設施</option>
                            {scene.graph.facilities.map((facility) => (
                              <option key={facility.id} value={facility.id}>
                                {facility.label}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          問題描述
                          <textarea
                            rows={2}
                            maxLength={500}
                            value={reportDescription}
                            onChange={(event) => setReportDescription(event.target.value)}
                            placeholder="例如：升降機顯示暫停服務"
                          />
                        </label>
                        <button
                          className="primary"
                          disabled={busy || !reportFacilityId || !reportDescription.trim()}
                          onClick={submitTextReport}
                        >
                          {busy ? '提交中…' : '提交示範回報並重算路線'}
                        </button>
                        <p>
                          示範事件會停用所選設施以重算路線；不會通知設施營運方。照片辨識需要已設定的後端服務。
                        </p>
                      </details>
                    </div>
                  )}
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
                <button className="text-button" onClick={() => switchDetails(true)}>
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
              AccessRoute HK <span className="footer-divider" aria-hidden="true">/</span>{' '}
              首末段無障礙導航研究
            </span>
            <span>官方幾何 · 可追溯資料 · 模擬導航</span>
          </footer>
        </>
      )}
      <DemoLibrary scenes={baseScenes} />
      {aiContext && (
        <AgentWorkflows
          requestedWorkflow={requestedWorkflow}
          workflowRequestId={workflowRequestId}
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
    </div>
  );
}

function MapDemoRedirect() {
  useEffect(() => {
    const target = new URL(
      `${import.meta.env.BASE_URL}map-demo/index.html`,
      window.location.href,
    );
    window.location.replace(target);
  }, []);
  return (
    <main className="loading" role="status">
      正在開啟地圖導航介面…
    </main>
  );
}

export default function App() {
  const query = new URLSearchParams(window.location.search);
  if (query.has('legacy') || query.has('demo') || query.has('mapOnly'))
    return <LegacyApp />;
  return <MapDemoRedirect />;
}
