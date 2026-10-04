import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateScene, type Scene, type MobilityNode } from '../shared/domain/schema';
import type { AgentResult, Preferences } from '../shared/genai/contracts';
import type { WorkflowContext, WorkflowResponse } from '../shared/genai/workflows';
import { demoRoute, applyDemoResult, applyDemoOverlay } from '../shared/demo/navigation';
import type {
  DemoCase,
  DemoStep,
  DemoState,
  DemoMedia,
  KnowledgeRecord,
  DemoOverlay,
} from '../shared/demo/types';
import { distance } from '../backend/retrieval/map-index';
import { searchKnowledge } from '../shared/demo/knowledge';

const root = resolve('data/demo'),
  knowledgeRoot = resolve('data/knowledge');
await mkdir(`${root}/cases`, { recursive: true });
await mkdir(`${root}/media`, { recursive: true });
await mkdir(knowledgeRoot, { recursive: true });
const read = async (path: string) => JSON.parse(await readFile(path, 'utf8'));
const save = async (path: string, data: unknown) =>
  writeFile(path, JSON.stringify(data, null, 2) + '\n');
const ids: string[] = (await read('data/scenes/index.json')).scenes;
const scenes: Scene[] = [];
for (const id of ids) {
  const base = `data/scenes/${id}`,
    manifest = await read(`${base}/manifest.json`);
  const files = await Promise.all(
    Object.entries(manifest.files).map(async ([key, file]) => [key, await read(`${base}/${file}`)]),
  );
  scenes.push(validateScene({ manifest, ...Object.fromEntries(files) } as Scene));
}
const media: DemoMedia[] = (await read(`${root}/media.json`)).filter(
  (m: DemoMedia) => m.kind === 'historical_photo',
);
const knowledge = new Map<string, KnowledgeRecord[]>();
const generic = /^(商店|店舖|SHOP|STORE|MARKET|KITCHEN|冷氣機及冷氣房)$/i;
for (const scene of scenes) {
  const source = await read(`data/poi/${scene.manifest.sceneId}.json`);
  const records: KnowledgeRecord[] = source.records
    .filter(
      (r: any) =>
        r.kind === 'occupant' && (r.nameZh || r.nameEn) && !generic.test(r.nameZh || r.nameEn),
    )
    .map((r: any) => {
      const [lon, lat] = r.geometry.coordinates;
      const nearest = scene.graph.nodes
        .filter((n) => n.levelId === r.levelId && ['junction', 'entrance', 'poi'].includes(n.kind))
        .map((node) => ({ node, d: distance(node, { lon, lat }) }))
        .sort((a, b) => a.d - b.d)[0];
      const mapped = nearest && nearest.d <= 20;
      const names = [...new Set([r.nameZh, r.nameEn].filter(Boolean))] as string[];
      const apple = /Apple/i.test(names.join(' ')) && scene.manifest.sceneId === 'hysan-place';
      const kfc = /KFC|肯德基/i.test(names.join(' ')) && scene.manifest.sceneId === 'popcorn-2';
      return {
        id: `poi:${r.id}`,
        scene_id: scene.manifest.sceneId,
        names,
        category: r.category,
        level_id: r.levelId,
        lon,
        lat,
        node_id: mapped ? nearest.node.id : null,
        association: mapped ? 'approximate' : 'unmapped',
        association_distance_m: mapped ? Number(nearest.d.toFixed(2)) : null,
        source: r.sourceRef,
        ...(apple ? { verified_url: 'https://www.apple.com/hk/en/retail/causewaybay/' } : {}),
        ...(kfc
          ? { verified_url: 'https://www.popcorntko.com.hk/en/dining/bltd1123c2523189cab' }
          : {}),
        media_ids:
          apple || kfc
            ? media
                .filter(
                  (m) =>
                    m.scene_id === scene.manifest.sceneId &&
                    (apple ? /Apple/i.test(m.title) : /KFC/i.test(m.title)),
                )
                .map((m) => m.id)
            : [],
      };
    });
  for (const facility of scene.graph.facilities) {
    for (const node of scene.graph.nodes.filter((n) => n.facilityId === facility.id))
      records.push({
        id: `facility:${facility.id}:${node.id}`,
        scene_id: scene.manifest.sceneId,
        names: [facility.label],
        category: facility.kind,
        level_id: node.levelId,
        lon: node.lon,
        lat: node.lat,
        node_id: node.id,
        association: 'approximate',
        association_distance_m: 0,
        source: `data/scenes/${scene.manifest.sceneId}/graph.json`,
        media_ids: [],
      });
  }
  knowledge.set(scene.manifest.sceneId, records);
  await save(`${knowledgeRoot}/${scene.manifest.sceneId}.json`, {
    version: '1.0',
    scene_id: scene.manifest.sceneId,
    records,
    association_note:
      '店舖坐標來自官方 POI；同層 20 米內公共節點只是候選，需用戶確認。設施記錄沿用現有圖的官方或演示來源。',
  });
}
const time = '2026-10-04T09:00:00.000Z';
const overlays: DemoOverlay[] = scenes.map((scene) => {
  const overlay: DemoOverlay = {
    scene_id: scene.manifest.sceneId,
    edges: [],
    facilities: [],
    assumptions: [],
  };
  const state: DemoState = {
    policy_mode: 'accessible',
    scene_id: scene.manifest.sceneId,
    current_node_id: scene.manifest.defaultStart,
    destination_node_id: scene.manifest.defaultEnd,
    preferences: null,
    guidance: '',
    routing: {
      profile: 'wheelchair',
      rain: false,
      strictAccessibility: false,
      now: time,
      events: [],
    },
  };
  const base = demoRoute(scene, state).result;
  const used =
    base.status === 'ok'
      ? base.edgeIds.map((id) => scene.graph.edges.find((e) => e.id === id)!)
      : [];
  const lift = used.find((e) => e.kind === 'lift');
  if (lift) {
    const facilityId = `demo-${scene.manifest.sceneId}-stairs`;
    overlay.facilities.push({
      id: facilityId,
      label: '演示樓梯捷徑',
      kind: 'stairs',
      sourceRefs: ['scripted-demo-assumption'],
    });
    overlay.edges.push({
      ...lift,
      id: `${facilityId}-edge`,
      kind: 'stairs',
      facilityId,
      distanceM: lift.distanceM * 0.5,
      wheelchair: 'no',
      provenance: 'manual/demo augmentation',
      sourceRef: 'scripted-demo-assumption',
      tags: { demo_assumption: true },
    });
    overlay.assumptions.push(
      '同一組跨樓層節點有一條較短的樓梯捷徑；僅用於比較原始最短距離和無台階規劃。',
    );
  }
  // Independent cross-level facilities let every mobility profile reroute after a lift outage.
  for (const vertical of used.filter((e) => ['lift', 'stairs', 'escalator'].includes(e.kind))) {
    const a = scene.graph.nodes.find((n) => n.id === vertical.from)!;
    const b = scene.graph.nodes.find((n) => n.id === vertical.to)!;
    const dz = Math.abs(
      (scene.manifest.levels.find((l) => l.id === a.levelId)?.z ?? 0) -
        (scene.manifest.levels.find((l) => l.id === b.levelId)?.z ?? 0),
    );
    for (const kind of ['ramp', 'escalator'] as const) {
      const facilityId = `demo-${vertical.id}-${kind}`;
      overlay.facilities.push({
        id: facilityId,
        label: kind === 'ramp' ? '演示緩坡通道' : '演示扶手電梯',
        kind,
        sourceRefs: ['scripted-demo-assumption'],
      });
      overlay.edges.push({
        ...vertical,
        id: `${facilityId}-edge`,
        kind,
        facilityId,
        distanceM:
          kind === 'ramp'
            ? Math.max(dz / 0.05, vertical.distanceM * 8, 20)
            : Math.max(vertical.distanceM * 2, 6),
        slope: kind === 'ramp' ? 0.05 : undefined,
        widthM: kind === 'ramp' ? 1.5 : 0.8,
        wheelchair: kind === 'ramp' ? 'yes' : 'no',
        indoor: true,
        sheltered: true,
        provenance: 'manual/demo augmentation',
        sourceRef: 'scripted-demo-assumption',
        tags: { demo_assumption: true },
      });
    }
  }
  overlay.assumptions.push(
    '跨層替代設施包含 5% 緩坡及扶手電梯，按通行能力選擇；設施存在、坡度及門寬為演示場景設定。',
  );
  const exposed = used
    .filter(
      (e) => e.distanceM > 5 && !e.indoor && !e.sheltered && ['outdoor', 'bridge'].includes(e.kind),
    )
    .sort((a, b) => b.distanceM - a.distanceM)[0];
  if (exposed) {
    const a = scene.graph.nodes.find((n) => n.id === exposed.from)!,
      b = scene.graph.nodes.find((n) => n.id === exposed.to)!;
    const midpoint: [number, number] = [(a.lon + b.lon) / 2, (a.lat + b.lat) / 2 + 0.00012];
    const via = { lon: midpoint[0], lat: midpoint[1] };
    overlay.edges.push({
      ...exposed,
      id: `demo-${exposed.id}-covered`,
      sheltered: true,
      distanceM: Math.max(exposed.distanceM * 1.3, distance(a, via) + distance(via, b)),
      geometry: [[a.lon, a.lat], midpoint, [b.lon, b.lat]],
      provenance: 'manual/demo augmentation',
      sourceRef: 'scripted-demo-assumption',
      tags: { demo_assumption: true },
    });
    overlay.assumptions.push(
      '其中一段露天接駁存在較長的有蓋替代通道；有蓋與幾何繞行是演示假設，未經現場核實。',
    );
  }
  return overlay;
});
await save(`${root}/overlays.json`, overlays);
for (let i = 0; i < scenes.length; i++) scenes[i] = applyDemoOverlay(scenes[i], overlays[i]);
const people: {
  key: string;
  name: string;
  need: string;
  mobility: Preferences['mobility_type'];
  purpose: string;
}[] = [
  {
    key: 'wang',
    name: '王先生 Mr Wang',
    need: '使用手動輪椅，不能走樓梯',
    mobility: 'manual_wheelchair',
    purpose: '赴目的地附近的預約門診；示範到建築公共走廊，門診入口不在地圖內',
  },
  {
    key: 'chan',
    name: '陳女士 Ms Chan',
    need: '拉著 25 公斤行李，無法抬上樓梯',
    mobility: 'heavy_luggage',
    purpose: '帶行李前往約定的建築會合點',
  },
  {
    key: 'lee',
    name: '李伯伯 Mr Lee',
    need: '膝蓋不方便，避開樓梯和陡坡',
    mobility: 'elderly',
    purpose: '到目的地建築辦事並與家人會合',
  },
  {
    key: 'lam',
    name: '林女士 Ms Lam',
    need: '推嬰兒車，希望使用升降機',
    mobility: 'stroller',
    purpose: '帶孩子到目的地建築與家人會合',
  },
];
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!,
  );
function view(scene: Scene, step: DemoStep) {
  const activeNodes = new Set(step.route.result.status === 'ok' ? step.route.result.nodeIds : []);
  activeNodes.add(step.state.current_node_id);
  activeNodes.add(step.state.destination_node_id);
  const nodes = scene.graph.nodes.filter((n) => activeNodes.has(n.id)),
    cos = Math.cos((scene.manifest.center[1] * Math.PI) / 180);
  const xs = nodes.map((n) => n.lon * cos),
    ys = nodes.map((n) => n.lat);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const scale = Math.min(860 / (maxX - minX || 1), 420 / (maxY - minY || 1));
  const xy = (n: MobilityNode) => [
    (n.lon * cos - (minX + maxX) / 2) * scale + 500,
    ((minY + maxY) / 2 - n.lat) * scale + 300,
  ];
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const active = new Set(step.route.result.status === 'ok' ? step.route.result.edgeIds : []);
  const line = (a: MobilityNode, b: MobilityNode, selected: boolean) => {
    const [x1, y1] = xy(a),
      [x2, y2] = xy(b);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${selected ? '#157b79' : '#dce5e7'}" stroke-width="${selected ? 5 : 1}"/>`;
  };
  // Keep route previews compact; the full official floor geometry is displayed by the frontend.
  const graph = '';
  const route = scene.graph.edges
    .filter((e) => active.has(e.id))
    .map((e) =>
      e.geometry
        ? `<polyline points="${e.geometry.map(([lon, lat]) => xy({ lon, lat } as MobilityNode).join(',')).join(' ')}" fill="none" stroke="#157b79" stroke-width="5"/>`
        : line(nodeMap.get(e.from)!, nodeMap.get(e.to)!, true),
    )
    .join('');
  const mark = (id: string, label: string, color: string) => {
    const [cx, cy] = xy(nodeMap.get(id)!);
    return `<circle cx="${cx}" cy="${cy}" r="8" fill="${color}"/><text x="${cx + 12}" y="${cy - 12}" font-size="18">${label}</text>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="1000" height="600" fill="#f4f8f8"/><g font-family="sans-serif" fill="#163b45"><text x="35" y="45" font-size="26">${escape(scene.manifest.nameZh)} · ${escape(step.title)}</text>${graph}${route}${mark(step.state.current_node_id, '目前位置', '#df913a')}${mark(step.state.destination_node_id, '目標', '#157b79')}<text x="35" y="555" font-size="16">現有地圖節點與路線投影 · 跨樓層請參照頁面樓層圖 · 非現場視角照片</text></g></svg>`;
}
const cases: DemoCase[] = [];
for (let sceneIndex = 0; sceneIndex < scenes.length; sceneIndex++) {
  const origin = scenes[sceneIndex],
    destination = scenes[(sceneIndex + 1) % scenes.length];
  for (const person of people) {
    const id = `${origin.manifest.sceneId}-${person.key}`;
    let state: DemoState = {
      policy_mode: 'distance_only',
      scene_id: origin.manifest.sceneId,
      current_node_id: origin.manifest.defaultStart,
      destination_node_id: origin.manifest.defaultEnd,
      preferences: null,
      guidance: '',
      routing: {
        profile: 'elderly',
        rain: false,
        strictAccessibility: false,
        now: time,
        events: [],
      },
    };
    const initial = structuredClone(state),
      steps: DemoStep[] = [];
    let currentScene = origin;
    const context = (): WorkflowContext => ({
      context_id: `${id}-${steps.length}`,
      scene_id: state.scene_id,
      current_node_id: state.current_node_id,
      destination_node_id: state.destination_node_id,
      phase: 'planning',
      routing: state.routing,
      preferences: state.preferences,
      segment_id: demoRoute(currentScene, state).segments[0]?.id || null,
    });
    const add = async (
      key: string,
      title: string,
      utterance: string,
      explanation: string,
      result?: AgentResult,
      change?: () => void,
      knowledgeIds: string[] = [],
      photo = false,
    ) => {
      const before = demoRoute(currentScene, state),
        ctx = context();
      let response: WorkflowResponse | null = null;
      if (result) {
        result = { ...result, context_id: ctx.context_id, scene_id: ctx.scene_id };
        state = applyDemoResult(currentScene, state, result);
        response = {
          workflow: result.agent,
          status: 'ready',
          result,
          candidates: [],
          trace:
            result.agent === 'localization'
              ? [
                  { step: 'recorded-observation', summary: '例子庫提供照片／周圍描述中的名稱線索' },
                  { step: 'map-retrieval', summary: '從官方 POI、同層公共節點與當前路線取候選' },
                  {
                    step: 'user-confirmed-match',
                    summary: '本例由使用者確認候選位置，分數是預設演示分數',
                  },
                ]
              : [
                  {
                    step: `recorded-${result.agent}`,
                    summary: '例子庫預設結果；經相同結果契約與路由引擎處理',
                  },
                ],
          message: explanation,
          ...(result.agent === 'guidance'
            ? { speech: { mode: 'browser', language: 'zh-HK', selection: 'text_only' } }
            : {}),
        };
      }
      change?.();
      const after = demoRoute(currentScene, state);
      const changed =
        JSON.stringify(before.result.status === 'ok' ? before.result.edgeIds : []) !==
        JSON.stringify(after.result.status === 'ok' ? after.result.edgeIds : []);
      const step: DemoStep = {
        agent_records: [],
        id: key,
        title,
        utterance,
        explanation,
        context: structuredClone(ctx),
        response,
        state: structuredClone(state),
        route: after,
        media_ids: photo
          ? media
              .filter(
                (m) =>
                  m.kind === 'historical_photo' && m.scene_id === currentScene.manifest.sceneId,
              )
              .map((m) => m.id)
          : [],
        knowledge_ids: knowledgeIds,
        route_changed: changed,
      };
      if (result?.agent === 'preferences')
        step.agent_records.push({
          agent: '出行意圖 agent',
          source: 'example_library',
          input: { description: utterance },
          output: result.payload,
        });
      if (result?.agent === 'obstacle') {
        step.agent_records.push({
          agent: 'VLM 路障觀察 agent',
          source: 'example_library',
          input: { notice: utterance },
          output: {
            has_obstacle: true,
            type: result.payload.barrier_type,
            evidence: result.payload.location_sign,
            confidence: result.payload.confidence,
          },
        });
        step.agent_records.push({
          agent: '地圖設施匹配 agent',
          source: 'example_library',
          input: { scene_id: ctx.scene_id, notice: utterance },
          output: {
            target: result.payload.target,
            match_method: result.payload.match_method,
            confidence: result.payload.confidence,
          },
        });
      }
      if (result?.agent === 'localization') {
        const fuzzy = person.key === 'chan';
        const query = fuzzy
          ? result.payload.anchor_names[0].slice(0, 3)
          : result.payload.anchor_names[0];
        const hits = searchKnowledge(knowledge.get(ctx.scene_id)!, query, result.payload.level_id)
          .slice(0, 5)
          .map((hit) => hit.record);
        step.agent_records.push({
          agent: 'VLM／描述觀察 agent',
          source: 'example_library',
          input: { description: utterance },
          output: {
            names: fuzzy ? [] : result.payload.anchor_names,
            text: [query],
            objects: [],
            floor_label:
              currentScene.manifest.levels.find((l) => l.id === result.payload.level_id)?.label ||
              null,
            confidence: result.payload.confidence,
          },
        });
        step.agent_records.push({
          agent: '附近知識檢索',
          source: 'computed',
          input: { query, level_id: result.payload.level_id },
          output: hits.length ? hits : { facility_names: result.payload.anchor_names },
        });
        step.agent_records.push({
          agent: '地圖匹配 agent＋使用者確認',
          source: 'example_library',
          input: { query, candidates: hits.map((r) => r.id) },
          output: result.payload,
        });
      }
      if (result?.agent === 'guidance')
        step.agent_records.push({
          agent: '粵語表述 agent',
          source: 'example_library',
          input: { segment: before.segments[0] },
          output: { text: result.payload.text, speech: response!.speech },
        });
      step.agent_records.push({
        agent: '共用路由引擎',
        source: 'computed',
        input: {
          from: state.current_node_id,
          to: state.destination_node_id,
          routing: state.routing,
        },
        output: {
          status: after.result.status,
          distance_m: after.result.status === 'ok' ? after.result.distanceM : null,
          exposed_m: after.exposed_m,
          facilities: after.facilities,
          route_changed: changed,
        },
      });
      const path = `media/${id}-${key}.svg`;
      await writeFile(`${root}/${path}`, view(currentScene, step));
      media.push({
        id: `${id}-${key}-view`,
        scene_id: state.scene_id,
        title: `${title}路線位置圖`,
        path,
        kind: 'map_view',
        source_url: `data/scenes/${state.scene_id}/graph.json`,
        author: 'AccessRoute demo generator',
        license: 'Project-generated map view',
        license_url: '',
        captured_at: '',
        description: '由現有地圖坐標及路由結果生成',
        camera_node_id: null,
      });
      step.media_ids.push(`${id}-${key}-view`);
      steps.push(step);
    };
    const envelope = (agent: AgentResult['agent'], payload: unknown) =>
      ({
        version: '1.0',
        request_id: `${id}-${agent}-${steps.length}`,
        context_id: '',
        scene_id: '',
        agent,
        payload,
      }) as AgentResult;
    await add(
      'start',
      '人物與原路線',
      `${person.name}要從${origin.manifest.nameZh}前往${destination.manifest.nameZh}。`,
      `${person.purpose}。先展示未加入個人需求的原路線。`,
    );
    const preferences: Preferences = {
      mobility_type: person.mobility,
      avoid_stairs: true,
      avoid_steep_slopes: true,
      prefer_covered_shelter: false,
      tts_selection: 'text_only',
    };
    await add(
      'preferences',
      '解析出行需求',
      `我${person.need}，請幫我規劃。`,
      '意圖結果更新出行類型、避樓梯及陡坡條件，再用現有地圖重新求路。',
      envelope('preferences', preferences),
    );
    await add(
      'rain',
      '下雨與有蓋偏好',
      '現在下雨了，我想盡量在室內或有蓋地方行。',
      '天氣來自演示情境；意圖結果加入有蓋偏好。比較露天距離，若現有圖沒有更好的替代線，保留原路。',
      envelope('preferences', { ...preferences, prefer_covered_shelter: true }),
      () => {
        state.routing.rain = true;
      },
    );
    const beforeFault = demoRoute(origin, state);
    const used = beforeFault.facilities;
    const preferred = used.find(
      (facilityId) =>
        demoRoute(origin, {
          ...state,
          routing: {
            ...state.routing,
            events: [
              {
                id: 'probe',
                type: 'facility_closed',
                target: { facilityId },
                status: 'active',
                validFrom: time,
                source: 'demo',
              },
            ],
          },
        }).result.status === 'ok',
    );
    const failed = preferred || used[0];
    if (failed) {
      const label = origin.graph.facilities.find((f) => f.id === failed)!.label;
      await add(
        'fault',
        '報告設施故障與改道',
        `${label}顯示維修中，不能使用。`,
        preferred
          ? `將演示故障對應到 ${label} 的 facility ID，封閉後重新規劃替代線。`
          : '封閉設施後無可行路線，提示等待職員協助，不能虛構替代線。',
        envelope('obstacle', {
          event_id: `${id}-fault`,
          has_obstacle: true,
          barrier_type: 'broken_lift',
          location_sign: `${label} 維修中（演示情境）`,
          is_indoor: true,
          target: { facility_id: failed },
          confidence: 0.95,
          match_method: 'user_confirmed',
          valid_from: time,
          valid_until: '2026-10-04T11:00:00.000Z',
        }),
      );
      // A simulated notice is always labelled, never passed off as a photo of a real outage.
      const signPath = `media/${id}-fault-sign.svg`;
      await writeFile(
        `${root}/${signPath}`,
        `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="420"><rect width="800" height="420" fill="#fff3df"/><g font-family="sans-serif" text-anchor="middle" fill="#793f13"><text x="400" y="80" font-size="24">演示告示 · 非實際故障照片</text><text x="400" y="180" font-size="40">${escape(label)}</text><text x="400" y="260" font-size="46">維修中 / OUT OF SERVICE</text><text x="400" y="340" font-size="20">請選擇其他設施或聯絡職員</text></g></svg>`,
      );
      media.push({
        id: `${id}-fault-sign`,
        scene_id: origin.manifest.sceneId,
        title: `${label}演示維修告示`,
        path: signPath,
        kind: 'scripted_sign',
        source_url: 'scripted-example',
        author: 'AccessRoute',
        license: 'Project-generated illustration',
        license_url: '',
        captured_at: '',
        description: '虛構故障告示，供演示',
        camera_node_id: null,
      });
      steps.at(-1)!.media_ids.push(`${id}-fault-sign`);
      if (!preferred)
        await add(
          'recovery',
          '職員確認設施恢復',
          '職員確認升降機已恢復。',
          '這是明確的演示恢復事件；普通照片無障礙不能自動清除舊事件。',
          undefined,
          () => {
            state.routing.events = state.routing.events.map((e) => ({ ...e, status: 'resolved' }));
          },
        );
    } else {
      await add(
        'fault',
        '路段施工與改道',
        '前面有施工圍欄，我不能繼續走。',
        '將演示施工對應到當前路線的真實 edge ID，再重新求路。',
        envelope('obstacle', {
          event_id: `${id}-fault`,
          has_obstacle: true,
          barrier_type: 'construction',
          location_sign: '演示施工圍欄',
          is_indoor: false,
          target: {
            edge_ids: beforeFault.result.status === 'ok' ? [beforeFault.result.edgeIds[0]] : [],
          },
          confidence: 0.95,
          match_method: 'user_confirmed',
          valid_from: time,
          valid_until: '2026-10-04T11:00:00.000Z',
        }),
      );
      if (demoRoute(origin, state).result.status === 'no_route')
        await add(
          'recovery',
          '職員解除施工封閉',
          '職員已解除施工封閉。',
          '明確恢復演示事件後繼續。',
          undefined,
          () => {
            state.routing.events = state.routing.events.map((e) => ({ ...e, status: 'resolved' }));
          },
        );
    }
    const current = origin.graph.nodes.find((n) => n.id === state.current_node_id)!;
    const currentRoute = demoRoute(origin, state).result;
    const routeNodes =
      currentRoute.status === 'ok'
        ? currentRoute.nodeIds.map((id) => origin.graph.nodes.find((n) => n.id === id)!)
        : [current];
    const shops = knowledge
      .get(origin.manifest.sceneId)!
      .filter(
        (r) =>
          r.category !== 'lift' && r.node_id && routeNodes.some((n) => n.levelId === r.level_id),
      )
      .map((record) => ({
        record,
        d: Math.min(
          ...routeNodes
            .filter((n) => n.levelId === record.level_id)
            .map((n) => distance(n, record)),
        ),
      }))
      .filter((r) => r.d <= 60)
      .sort((a, b) => a.d - b.d);
    const landmark =
      shops.find((r) => r.record.media_ids.length)?.record ||
      shops.find((r) => /Apple|KFC|肯德基|NAMCO/.test(r.record.names.join(' ')))?.record ||
      shops[0]?.record;
    const location = landmark
      ? origin.graph.nodes.find((n) => n.id === landmark.node_id)!
      : routeNodes.find((n) => n.kind === 'lift') || routeNodes[Math.min(2, routeNodes.length - 1)];
    const names = landmark?.names || [
      location.facilityId
        ? origin.graph.facilities.find((f) => f.id === location.facilityId)!.label
        : '公共走廊',
    ];
    const level = origin.manifest.levels.find((l) => l.id === location.levelId)?.label;
    await add(
      'localization',
      '迷路後用照片／描述找位置',
      person.key === 'chan'
        ? `我好像走錯了，招牌有點模糊，只看見「${names[0].slice(0, 3)}」${level ? `和 ${level} 樓層標誌` : ''}。`
        : `我好像走錯了，旁邊看到「${names[0]}」${level ? `和 ${level} 樓層標誌` : ''}。`,
      landmark
        ? '名稱與官方 POI 比對，取同層公共節點作近似候選；本例使用者確認該位置後繼續導航。實景參考照片未提供精確拍攝節點。'
        : '用設施名稱和樓層縮小範圍；本例使用者確認圖上的候選，重新求剩餘路線。',
      envelope('localization', {
        is_indoor: !!location.levelId,
        status: 'matched',
        map_db_node_id: location.id,
        ...(location.levelId ? { level_id: location.levelId } : {}),
        anchor_names: names,
        direction_hint: '已確認的同層公共通道候選',
        confidence: person.key === 'chan' ? 0.55 : landmark ? 0.75 : 0.85,
        match_method: 'user_confirmed',
      }),
      undefined,
      landmark ? [landmark.id] : [],
      true,
    );
    const firstSegment = demoRoute(origin, state).segments[0];
    if (firstSegment)
      await add(
        'guidance',
        '生成下一段導航指引',
        '請告訴我下一步怎麼走。',
        '由重新規劃後的第一路段生成預設粵語句子，語音服務與文字生成分開。',
        envelope('guidance', {
          segment_id: firstSegment.id,
          text:
            firstSegment.type === 'transition'
              ? `請搭升降機去${origin.manifest.levels.find((l) => l.id === firstSegment.toLevel)?.label || '下一層'}。`
              : `請沿畫面路線行${Math.round(firstSegment.distanceM)}米去下一個位置。`,
        }),
      );
    await add(
      'transfer',
      '接駁到目的建築',
      `我已到${origin.manifest.stationZh}接駁點，接下來到${destination.manifest.stationZh}。`,
      '兩端步行路線已備好；中間公共交通是接駁敘事，沒有虛構班次或站間導航。',
      undefined,
      () => {
        currentScene = destination;
        state = {
          ...state,
          scene_id: destination.manifest.sceneId,
          current_node_id: destination.manifest.defaultEnd,
          destination_node_id: destination.manifest.defaultStart,
          guidance: '',
        };
      },
      [],
      true,
    );
    const destinationRoute = demoRoute(destination, state);
    await add(
      'arrival',
      '完成剩餘步行與到達',
      `我跟著路線到達${destination.manifest.nameZh}的公共走廊會合點。`,
      `${person.purpose}。剩餘步行完成；到達節點與目的節點相同。`,
      undefined,
      () => {
        state.current_node_id = state.destination_node_id;
        state.guidance = '已到達目的地會合點。';
      },
    );
    cases.push({
      id,
      title: `${person.name} · ${origin.manifest.nameZh} → ${destination.manifest.nameZh}`,
      person: person.name,
      purpose: person.purpose,
      origin_scene_id: origin.manifest.sceneId,
      destination_scene_id: destination.manifest.sceneId,
      tags: [person.mobility, 'rain', 'facility_fault', 'localization'],
      narrative: `${person.name}${person.need}；今天下雨，要從${origin.manifest.nameZh}出發。途中遇到設施故障，改道後利用店舖或設施名稱確認位置，最後前往${destination.manifest.nameZh}。`,
      initial_state: initial,
      destination_route: destinationRoute,
      steps,
    });
    await save(`${root}/cases/${id}.json`, cases.at(-1));
  }
}
await save(`${root}/media.json`, media);
await save(`${root}/index.json`, {
  version: '1.0',
  generated_at: time,
  cases: cases.map(({ steps, initial_state, destination_route, ...item }) => ({
    ...item,
    step_count: steps.length,
  })),
  media,
  counts: {
    cases: cases.length,
    steps: cases.reduce((n, c) => n + c.steps.length, 0),
    knowledge_records: [...knowledge.values()].reduce((n, r) => n + r.length, 0),
    historical_photos: media.filter((m) => m.kind === 'historical_photo').length,
  },
});
await save(`${root}/audit.json`, {
  cases: cases.length,
  per_scene: ids.map((scene_id) => ({
    scene_id,
    cases: cases.filter((c) => c.origin_scene_id === scene_id).length,
    knowledge: knowledge.get(scene_id)!.length,
  })),
  changed_preferences: cases.filter(
    (c) => c.steps.find((s) => s.id === 'preferences')!.route_changed,
  ).length,
  changed_rain: cases.filter((c) => c.steps.find((s) => s.id === 'rain')!.route_changed).length,
  changed_fault: cases.filter((c) => c.steps.find((s) => s.id === 'fault')!.route_changed).length,
});
console.log(
  `Built ${cases.length} examples, ${media.filter((m) => m.kind === 'historical_photo').length} real reference photos.`,
);
