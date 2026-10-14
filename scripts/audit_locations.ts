import { readFileSync, writeFileSync } from 'node:fs';
import { validateScene, type Scene, type Profile } from '../shared/domain/schema';
import { route } from '../shared/routing/route';
import { segmentRoute } from '../shared/journey/segment';
const root = new URL('../data/scenes/', import.meta.url);
const read = (path: string) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const ids: string[] = read('index.json').scenes;
const scenes = ids.map((id) => {
  const manifest = read(`${id}/manifest.json`);
  const s = validateScene({ manifest, ...Object.fromEntries(Object.entries(manifest.files).map(([key,file]) => [key,read(`${id}/${file}`)])) } as Scene);
  const checks = [];
  for (const profile of ['wheelchair','elderly','stroller'] as Profile[]) for (const reverse of [false,true]) {
    const r = route(s.graph, reverse ? manifest.defaultEnd : manifest.defaultStart, reverse ? manifest.defaultStart : manifest.defaultEnd, {profile,rain:false,strictAccessibility:false,events:[],now:'2026-10-04T00:00:00Z'});
    checks.push({profile,reverse,status:r.status,distanceM:r.status==='ok'?Math.round(r.distanceM*10)/10:null,segments:segmentRoute(s.graph,r).map(s=>s.type)});
  }
  return {sceneId:id,name:manifest.nameZh,station:manifest.stationZh,nodes:s.graph.nodes.length,edges:s.graph.edges.length,checks};
});
const journeys = ids.flatMap(from=>ids.filter(to=>to!==from).map(to=>({from,to,firstLeg:scenes.find(s=>s.sceneId===from)!.checks[0].status,lastLeg:scenes.find(s=>s.sceneId===to)!.checks[1].status,transit:'abstract'})));
const result={snapshotDate:'2026-10-04',sceneCount:ids.length,localRouteChecks:scenes.flatMap(s=>s.checks).length,orderedJourneyCount:journeys.length,allLocalRoutesPass:scenes.every(s=>s.checks.every(c=>c.status==='ok')),scenes,journeys};
writeFileSync(new URL('../docs/qa/location-expansion.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({scenes:ids.length,localRouteChecks:result.localRouteChecks,orderedJourneyCount:journeys.length,pass:result.allLocalRoutesPass}));
if(!result.allLocalRoutesPass || journeys.length!==132)process.exitCode=1;
