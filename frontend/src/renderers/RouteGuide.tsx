import type { Scene, RouteSegment } from '../../../shared/domain/schema';
import { endpoints, segmentColor, segmentLabel } from './routePresentation';
export function RouteGuide({
  scene,
  segments,
  activeId,
  onInspect,
  view,
}: {
  scene: Scene;
  segments: RouteSegment[];
  activeId?: string;
  onInspect: (segment: RouteSegment) => void;
  view: string;
}) {
  if (!segments.length) return null;
  const points = endpoints(scene, segments);
  return (
    <section className="route-guide" aria-label="路線顏色與樓層說明">
      <div className="route-guide-heading">
        <strong>路線順序與樓層</strong>
        <span>
          {view === 'macro'
            ? '概覽將各樓層路線投影在建築上；顏色表示所在樓層。'
            : '目前顯示單一樓層；點選下方路段可查看其他樓層。'}
        </span>
      </div>
      <ol className="route-step-list">
        {segments
          .filter((s) => s.type === 'transition' || s.distanceM > 0.5)
          .map((s, i) => (
            <li key={s.id}>
              <button
                className={s.id === activeId ? 'route-step active' : 'route-step'}
                onClick={() => onInspect(s)}
                aria-current={s.id === activeId ? 'step' : undefined}
                style={{ borderLeftColor: segmentColor(scene, s) }}
              >
                <span className="route-step-number" style={{ background: segmentColor(scene, s) }}>
                  {i + 1}
                </span>
                <span>
                  {segmentLabel(scene, s)}
                  <small>
                    {s.type === 'transition'
                      ? '在橙色換層標記處轉換樓層'
                      : `${Math.round(s.distanceM)} m`}
                  </small>
                </span>
              </button>
            </li>
          ))}
      </ol>
      <div className="route-key">
        {points.map((p) => (
          <span key={p.role}>
            <i style={{ background: p.color }} />
            {p.role}：{p.detail}
          </span>
        ))}
        <span>
          <i className="route-key-lift">↕</i>電梯／換層位置
        </span>
      </div>
    </section>
  );
}
