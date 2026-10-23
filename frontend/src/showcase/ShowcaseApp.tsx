import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import {
  Accessibility,
  ArrowLeft,
  ArrowRight,
  Baby,
  Check,
  CheckCircle2,
  CloudRain,
  Compass,
  Layers,
  MapPin,
  Navigation,
  Play,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Volume2,
} from 'lucide-react';
import { validateScene, type Scene } from '../../../shared/domain/schema';
import { applyDemoOverlay, demoRoute } from '../../../shared/demo/navigation';
import type { DemoCase, DemoMedia, DemoOverlay, DemoState } from '../../../shared/demo/types';
import {
  confirmShowcaseStep,
  needsShowcaseConfirmation,
  showcaseCases,
  showcaseChapters,
  showcaseDescriptions,
  showcaseState,
} from '../../../shared/demo/showcase';
import { FloorMap } from '../renderers/FloorMap';
import { readBundledShowcaseJson } from './bundledData';
const MacroMap = lazy(() => import('../renderers/MacroMap'));

const appRoot = new URL('../', window.location.href);
const asset = (path: string) => new URL(path, appRoot).href;
const sceneCache = new Map<string, Promise<Scene>>();
async function readJson<T>(path: string): Promise<T> {
  return readBundledShowcaseJson<T>(path);
}
function loadScene(id: string) {
  if (!sceneCache.has(id)) {
    const promise = (async () => {
      const manifest = await readJson<Scene['manifest']>(`data/scenes/${id}/manifest.json`);
      const files = await Promise.all(
        Object.entries(manifest.files).map(async ([key, file]) => [
          key,
          await readJson(`data/scenes/${id}/${file}`),
        ]),
      );
      return validateScene({ manifest, ...Object.fromEntries(files) } as Scene);
    })();
    sceneCache.set(id, promise);
    void promise.catch(() => sceneCache.delete(id));
  }
  return sceneCache.get(id)!;
}
type StoryBundle = { example: DemoCase; overlays: DemoOverlay[]; media: DemoMedia[] };

export function ShowcaseApp() {
  const initialCase = new URLSearchParams(location.search).get('case');
  const [caseId, setCaseId] = useState<string>(
    showcaseCases.some((c) => c.id === initialCase) ? initialCase! : showcaseCases[0].id,
  );
  const [bundle, setBundle] = useState<StoryBundle | null>(null);
  const [chapterIndex, setChapterIndex] = useState(0);
  const [applied, setApplied] = useState<DemoState | null>(null);
  const [dry, setDry] = useState(false);
  const [baseScene, setBaseScene] = useState<Scene | null>(null);
  const [view, setView] = useState<'floor' | 'macro'>('floor');
  const [level, setLevel] = useState('');
  const [error, setError] = useState('');
  const [audioStatus, setAudioStatus] = useState('');
  const [largeText, setLargeText] = useState(false);
  const audio = useRef<HTMLAudioElement>(null);
  const stopAudio = () => {
    audio.current?.pause();
    setAudioStatus('');
  };

  useEffect(() => {
    let canceled = false;
    setBundle(null);
    setChapterIndex(0);
    setApplied(null);
    setDry(false);
    setError('');
    stopAudio();
    Promise.all([
      readJson<DemoCase>(`data/demo/cases/${caseId}.json`),
      readJson<DemoOverlay[]>('data/demo/overlays.json'),
      readJson<{ media: DemoMedia[] }>('data/demo/index.json'),
    ])
      .then(([example, overlays, index]) => {
        if (!canceled) setBundle({ example, overlays, media: index.media });
      })
      .catch((cause) => {
        if (!canceled) setError((cause as Error).message);
      });
    const url = new URL(location.href);
    url.searchParams.set('case', caseId);
    history.replaceState(null, '', url);
    return () => {
      canceled = true;
      audio.current?.pause();
    };
  }, [caseId]);

  const example = bundle?.example;
  const step = example?.steps[chapterIndex];
  const chapter = showcaseChapters[chapterIndex];
  const state = example
    ? dry && step?.id === 'rain'
      ? example.steps[1].state
      : showcaseState(example, chapterIndex, applied)
    : null;
  const sceneId = state?.scene_id;
  useEffect(() => {
    let canceled = false;
    setBaseScene(null);
    if (sceneId)
      loadScene(sceneId)
        .then((value) => {
          if (!canceled) setBaseScene(value);
        })
        .catch((cause) => {
          if (!canceled) setError((cause as Error).message);
        });
    return () => {
      canceled = true;
    };
  }, [sceneId]);
  const scene = useMemo(() => {
    if (!baseScene || !bundle || baseScene.manifest.sceneId !== sceneId) return null;
    const overlay = bundle.overlays.find((o) => o.scene_id === baseScene.manifest.sceneId);
    return overlay ? applyDemoOverlay(baseScene, overlay) : baseScene;
  }, [baseScene, bundle, sceneId]);
  const snapshot = useMemo(() => (scene && state ? demoRoute(scene, state) : null), [scene, state]);
  const previous = useMemo(
    () =>
      scene &&
      example &&
      chapterIndex > 0 &&
      example.steps[chapterIndex - 1].state.scene_id === scene.manifest.sceneId
        ? demoRoute(scene, example.steps[chapterIndex - 1].state)
        : null,
    [scene, example, chapterIndex],
  );
  const pending = !!step && needsShowcaseConfirmation(step.id) && !applied;
  const closed =
    state?.routing.events
      .filter((e) => e.status === 'active')
      .flatMap((e) => (e.target.facilityId ? [e.target.facilityId] : [])) || [];
  const selectedCase = showcaseCases.find((c) => c.id === caseId)!;
  const distance = snapshot?.result.status === 'ok' ? Math.round(snapshot.result.distanceM) : null;
  const previousDistance =
    previous?.result.status === 'ok' ? Math.round(previous.result.distanceM) : null;
  const facilityNames =
    snapshot?.facilities.map(
      (id) => scene?.graph.facilities.find((f) => f.id === id)?.label || id,
    ) || [];
  const result = step?.response?.result;
  const candidateNode = scene?.graph.nodes.find((n) =>
    result?.agent === 'localization' ? n.id === result.payload.map_db_node_id : false,
  );
  const highlight =
    step?.id === 'localization' && candidateNode
      ? {
          lon: candidateNode.lon,
          lat: candidateNode.lat,
          level_id: candidateNode.levelId,
          label: applied ? '已確認位置' : '待確認位置',
        }
      : undefined;
  useEffect(() => {
    const segment = snapshot?.segments.find((s) => s.type === 'floor' || s.type === 'transition');
    setLevel(
      candidateNode?.levelId ||
        segment?.levelId ||
        segment?.fromLevel ||
        scene?.manifest.levels[0]?.id ||
        '',
    );
  }, [scene, snapshot, candidateNode]);
  let photo: { src: string; title: string; source: string } | null = null;
  if (bundle && step) {
    if (step.id === 'fault' && caseId.startsWith('popcorn-2'))
      photo = {
        src: asset('showcase/media/lift-demo.png'),
        title: 'Lift A 暫停服務',
        source: 'AI 合成照片・演示設施',
      };
    else if (step.id === 'localization' && caseId.startsWith('popcorn-2'))
      photo = {
        src: asset('showcase/media/kfc-localization.png'),
        title: 'KFC 店面與引路徑',
        source: 'AI 改編照片・地標附近粗略定位',
      };
    else {
      const record = step.media_ids
        .map((id) => bundle.media.find((m) => m.id === id))
        .find((m) => m?.kind === (step.id === 'fault' ? 'scripted_sign' : 'historical_photo'));
      if (record)
        photo = {
          src: asset(`data/demo/${record.path}`),
          title: record.title.replace(/\.jpg$/i, ''),
          source:
            record.kind === 'scripted_sign'
              ? '預設故障告示・演示情境'
              : `歷史參考照片・${record.author}`,
        };
    }
  }
  const jump = (index: number) => {
    stopAudio();
    setChapterIndex(index);
    setApplied(null);
    setDry(false);
    setError('');
    requestAnimationFrame(() => {
      document.getElementById('chapter-title')?.focus({ preventScroll: true });
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
  };
  const confirm = () => {
    if (!scene || !example) return;
    try {
      setApplied(confirmShowcaseStep(scene, example, chapterIndex));
      setError('');
    } catch (cause) {
      setError((cause as Error).message);
    }
  };
  const advance = () =>
    pending ? confirm() : jump(chapterIndex === showcaseChapters.length - 1 ? 0 : chapterIndex + 1);
  const playAudio = () => {
    setAudioStatus('正在播放預錄廣東話指引…');
    void audio.current
      ?.play()
      .catch(() => setAudioStatus('音訊未能播放，可使用下方播放器重試；文字指引仍可閱讀。'));
  };

  if (!bundle || !step || !state)
    return (
      <main className="boot-screen">
        <Compass size={48} />
        <h1>AccessRoute 互動展示</h1>
        <p role="status">{error || '正在準備旅程與本地地圖…'}</p>
        {error && <button onClick={() => location.reload()}>重新載入</button>}
      </main>
    );

  return (
    <div className={`showcase${largeText ? ' large-text' : ''}`}>
      <a className="skip-link" href="#showcase-main">
        略過導覽，前往展示內容
      </a>
      <header className="showcase-header">
        <a className="showcase-brand" href={asset('showcase/')}>
          <span className="brand-mark">
            <Navigation size={22} />
          </span>
          <span>
            AccessRoute <small>無障礙導航 · 互動展示</small>
          </span>
        </a>
        <div className="header-actions">
          <span className="mode-badge">
            <span />
            前端預設演示
          </span>
          <button
            className="text-button"
            aria-pressed={largeText}
            onClick={() => setLargeText(!largeText)}
          >
            大字模式
          </button>
          <a className="text-button" href={asset('map-demo/index.html')}>
            完整應用 <ArrowRight size={15} />
          </a>
        </div>
      </header>
      <div className="showcase-layout">
        <aside className="story-sidebar" aria-label="展示案例與階段">
          <p className="eyebrow">從需要，到安心抵達</p>
          <h1>
            每一段路，
            <br />
            都照顧不同需要。
          </h1>
          <label className="scenario-label" htmlFor="showcase-case">
            選擇展示案例
          </label>
          <select
            id="showcase-case"
            aria-label="選擇展示案例"
            value={caseId}
            onChange={(e) => setCaseId(e.target.value)}
          >
            {showcaseCases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label} · {c.journey}
              </option>
            ))}
          </select>
          <div className="scenario-summary">
            {caseId.endsWith('wang') ? (
              <Accessibility size={22} />
            ) : caseId.endsWith('lam') ? (
              <Baby size={22} />
            ) : (
              <ShieldCheck size={22} />
            )}
            <span>
              <strong>{selectedCase.label}</strong>
              <small>{selectedCase.description}</small>
            </span>
          </div>
          <nav className="chapter-nav" aria-label="旅程展示階段">
            {showcaseChapters.map((item, i) => (
              <button
                key={item.id}
                aria-current={i === chapterIndex ? 'step' : undefined}
                onClick={() => jump(i)}
              >
                <span className="chapter-number">
                  {i < chapterIndex ? <Check size={14} /> : `0${i + 1}`}
                </span>
                <span>{item.title}</span>
                {i === chapterIndex && <ArrowRight size={15} />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <p>
              <Sparkles size={15} /> AI 觀察結果與天氣均已預設；路線由本地引擎計算。
            </p>
            <button className="text-button" onClick={() => jump(0)}>
              <RotateCcw size={15} />
              重新開始
            </button>
          </div>
        </aside>
        <main id="showcase-main" className="presentation" tabIndex={-1}>
          <section className="chapter-heading" aria-labelledby="chapter-title">
            <div>
              <p className="eyebrow">
                {selectedCase.journey}{' '}
                <span>
                  ／ 0{chapterIndex + 1} · {chapter.short}
                </span>
              </p>
              <h2 id="chapter-title" tabIndex={-1}>
                {chapter.title}
              </h2>
              <p className="chapter-description">{showcaseDescriptions[step.id]}</p>
            </div>
            <span className="chapter-count">
              {chapterIndex + 1}
              <small>/ 8</small>
            </span>
          </section>
          <div className="presentation-grid">
            <section className="map-card" aria-label="互動地圖與路線">
              <div className="map-topline">
                <span>
                  <MapPin size={16} />
                  {scene?.manifest.nameZh || '正在載入地圖'}
                </span>
                <div className="view-switch" role="group" aria-label="地圖檢視">
                  <button aria-pressed={view === 'floor'} onClick={() => setView('floor')}>
                    <Layers size={14} />
                    樓層
                  </button>
                  <button aria-pressed={view === 'macro'} onClick={() => setView('macro')}>
                    3D 概覽
                  </button>
                </div>
              </div>
              <div className="presentation-map" aria-busy={!scene || !snapshot}>
                {scene && snapshot ? (
                  view === 'floor' ? (
                    <FloorMap
                      scene={scene}
                      segments={snapshot.segments}
                      routeSegments={snapshot.segments}
                      closedFacilities={closed}
                      levelId={level}
                      highlight={highlight}
                      interactive
                    />
                  ) : (
                    <Suspense fallback={<p className="map-loading">正在載入 3D 地圖…</p>}>
                      <MacroMap
                        scene={scene}
                        segments={snapshot.segments}
                        closedFacilities={closed}
                        highlight={highlight}
                      />
                    </Suspense>
                  )
                ) : (
                  <p className="map-loading">正在載入官方地圖與路線…</p>
                )}
              </div>
              {scene && view === 'floor' && (
                <div className="level-switch" role="group" aria-label="選擇樓層">
                  {scene.manifest.levels.map((l) => (
                    <button key={l.id} aria-pressed={level === l.id} onClick={() => setLevel(l.id)}>
                      {l.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="route-stats">
                <div>
                  <span>{chapterIndex === 0 ? '距離基準・未套用需要' : '目前剩餘步行距離'}</span>
                  <strong data-testid="showcase-distance">
                    {!snapshot ? '載入中…' : distance === null ? '無可行路線' : `${distance}`}
                    <small>{distance === null ? '' : '米'}</small>
                  </strong>
                </div>
                <div>
                  <span>露天路段</span>
                  <strong>
                    {Math.round(snapshot?.exposed_m || 0)}
                    <small>米</small>
                  </strong>
                </div>
                <div>
                  <span>目前路線狀態</span>
                  <strong className="route-state">
                    {chapterIndex === 7
                      ? '已到達'
                      : pending
                        ? '等待確認'
                        : applied
                          ? '已更新'
                          : state.policy_mode === 'distance_only'
                            ? '距離基準'
                            : '已套用需要'}
                  </strong>
                </div>
              </div>
              <div className="route-footnote">
                {facilityNames.length
                  ? `途經設施：${facilityNames.join('、')}`
                  : chapterIndex === 7
                    ? '目的節點已到達。'
                    : '此段沒有需要乘搭的跨層設施。'}
                <span>官方幾何＋明示演示連線；通行屬性尚未實地核實。</span>
              </div>
            </section>
            <aside className="insight-card" aria-label="輸入與預設結果">
              <p className="eyebrow">
                <Sparkles size={14} /> 展示輸入
              </p>
              <blockquote>
                「
                {step.id === 'start'
                  ? `我需要${selectedCase.label}路線，由${selectedCase.journey.replace(' → ', '前往')}。`
                  : step.utterance}
                」
              </blockquote>
              {step.id === 'rain' && (
                <div className="weather-switch" role="group" aria-label="演示天氣">
                  <button aria-pressed={dry} onClick={() => setDry(true)}>
                    晴天
                  </button>
                  <button aria-pressed={!dry} onClick={() => setDry(false)}>
                    <CloudRain size={15} />
                    雨天
                  </button>
                </div>
              )}
              {photo && (
                <figure className="demo-photo">
                  <img src={photo.src} alt={photo.title} />
                  <figcaption>{photo.source}</figcaption>
                </figure>
              )}
              {step.id === 'preferences' || step.id === 'rain' ? (
                <div className="result-box">
                  <h3>預設需求解析</h3>
                  <ul>
                    <li>
                      <CheckCircle2 size={16} />
                      {selectedCase.label}
                    </li>
                    <li>
                      <CheckCircle2 size={16} />
                      避開樓梯與陡坡
                    </li>
                    <li>
                      <CheckCircle2 size={16} />
                      {state.preferences?.prefer_covered_shelter
                        ? '下雨時優先有蓋路線'
                        : '依出行需要選擇可行路線'}
                    </li>
                  </ul>
                </div>
              ) : step.id === 'fault' ? (
                <div className={`result-box ${pending ? 'pending-result' : ''}`}>
                  <h3>{pending ? '預設觀察・待確認' : '故障已套用・路線已重算'}</h3>
                  <p>
                    {result?.agent === 'obstacle'
                      ? result.payload.location_sign
                      : '演示設施暫停服務'}
                  </p>
                  <p>
                    {pending
                      ? '確認這是目前路線上的設施，再套用演示停用事件。'
                      : `已避開停用設施${previousDistance !== null && distance !== null ? `，剩餘距離由 ${previousDistance} 米變為 ${distance} 米` : ''}。`}
                  </p>
                  {!pending && (
                    <button className="inline-reset" onClick={() => setApplied(null)}>
                      恢復設施，再比較原路線
                    </button>
                  )}
                </div>
              ) : step.id === 'localization' ? (
                <div className={`result-box ${pending ? 'pending-result' : ''}`}>
                  <h3>{pending ? '預設位置候選・待確認' : '已確認地標附近位置'}</h3>
                  <p>
                    {result?.agent === 'localization'
                      ? result.payload.anchor_names.join(' · ')
                      : '地標附近公共通道'}
                  </p>
                  <p>
                    {pending
                      ? '對照照片和地圖後，確認這個粗略候選位置。'
                      : '起點已移至確認的公共節點，地圖顯示重新計算的剩餘路線。'}
                  </p>
                </div>
              ) : (
                <div className="result-box">
                  <h3>
                    {step.id === 'arrival'
                      ? '旅程完成'
                      : step.id === 'transfer'
                        ? '兩端步行接駁'
                        : step.id === 'guidance'
                          ? '預設廣東話指引'
                          : '先看距離基準，再加入需要'}
                  </h3>
                  <p>
                    {step.id === 'guidance'
                      ? state.guidance
                      : step.id === 'transfer'
                        ? '鐵路段只作接駁敘事；畫面距離只計目前場景步行。'
                        : step.id === 'arrival'
                          ? '剩餘距離為零，可重播或切換另一個出行案例。'
                          : '下一步套用個人需要，觀察路線如何避開樓梯。'}
                  </p>
                </div>
              )}
              <div className="audio-block">
                <button className="audio-button" onClick={playAudio}>
                  <Volume2 size={17} />
                  播放本段廣東話
                </button>
                <span className="audio-note">預錄音訊，不需要語音包</span>
                <audio
                  key={`${caseId}:${step.id}`}
                  ref={audio}
                  controls
                  preload="none"
                  src={asset(`showcase/audio/${caseId}-${step.id}.m4a`)}
                  onEnded={() => setAudioStatus('本段廣東話已播放完成。')}
                  onError={() => setAudioStatus('音訊載入失敗；請重試，或繼續閱讀文字。')}
                />
                <p className="audio-status" role="status">
                  {audioStatus}
                </p>
              </div>
              <details className="evidence-details">
                <summary>查看預設結果與資料來源</summary>
                <p>此頁重播已準備的示例，不會將照片或需求傳送到模型服務。</p>
                <pre>
                  {JSON.stringify(
                    result?.payload || { stage: step.id, source: '展示案例庫' },
                    null,
                    2,
                  )}
                </pre>
                <a href={asset('showcase/credits.txt')}>照片署名與音訊說明</a>
              </details>
            </aside>
          </div>
          {error && (
            <p className="showcase-error" role="alert">
              {error}
              <button className="text-button" onClick={() => location.reload()}>
                重新載入展示
              </button>
            </p>
          )}
          <section className="presenter-controls" aria-label="展示操作">
            <div className="chapter-back">
              <button
                className="secondary-button"
                disabled={chapterIndex === 0}
                onClick={() => jump(chapterIndex - 1)}
              >
                <ArrowLeft size={16} />
                上一步
              </button>
              <span className="progress-label">
                {pending ? '等待你確認後才更新地圖' : '可逐步展示，也可點選左側階段'}
              </span>
            </div>
            <button className="primary-button" onClick={advance} disabled={!scene || !snapshot}>
              {pending
                ? step.id === 'fault'
                  ? '確認停用並重新規劃'
                  : '確認位置並更新路線'
                : chapter.action}
              {pending ? <Check size={18} /> : <ArrowRight size={18} />}
            </button>
          </section>
          <div className="quick-jumps">
            <span>快速展示</span>
            <button onClick={() => jump(3)}>故障改道</button>
            <button onClick={() => jump(4)}>照片定位</button>
            <button onClick={() => jump(5)}>粵語指引</button>
            <button onClick={() => jump(7)}>到達畫面</button>
          </div>
          <footer className="showcase-footer">
            <span>
              <ShieldCheck size={14} /> 前端案例回放・不需登入或後端
            </span>
            <a href={asset('?demo=1')}>
              瀏覽完整案例庫 <ArrowRight size={13} />
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
