"""Derive a bounded demo graph from official public indoor geometry.
No accessibility is inferred from geometry. All edges remain wheelchair=unknown.
Vertical pairing and station links are explicit, traceable demo augmentations.
"""
import json,math,pathlib,heapq,collections
from shapely.geometry import shape,Point,LineString,mapping
from shapely.ops import unary_union,transform
from fetch_data import ROOT,RAW
CONFIGS=json.loads((ROOT/'data/scene-build-configs.json').read_text())
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,separators=(',',':')))
def fc(fs):return {'type':'FeatureCollection','features':fs}
def build(c):
 vid=c['venue'];out=ROOT/'data/scenes'/c['id'];raw={k:json.loads((RAW/vid/(v+'.json')).read_text()) for k,v in {'levels':'level_polygon','units':'unit_polygon','openings':'opening_line','amenities':'amenity_point'}.items()}
 venue=next(f for f in json.loads((RAW/'venues.json').read_text())['features'] if f['properties']['venue_id']==vid)
 bb=venue['properties']['bbox'];cx=(bb[0]+bb[2])/2;cy=(bb[1]+bb[3])/2;sx=111320*math.cos(math.radians(cy));sy=111320
 def xy(g):return transform(lambda x,y,z=None:((x-cx)*sx,(y-cy)*sy),g)
 def ll(p):return [round(p[0]/sx+cx,9),round(p[1]/sy+cy,9)]
 nodes=[];edges=[];facilities=[];points={};geoms={};levelNodes={};levelDefs=[]
 def node(nid,p,kind='junction',level=None,**extra):
  co=ll(p);n={'id':nid,'sceneId':c['id'],'lon':co[0],'lat':co[1],'kind':kind,**extra}
  if level:n.update(venueId=vid,levelId=level,z=next(l['z'] for l in levelDefs if l['id']==level))
  nodes.append(n);points[nid]=p;return nid
 def edge(a,b,kind='corridor',provenance='derived',**extra):
  edges.append({'id':f'e-{len(edges)}','from':a,'to':b,'distanceM':round(math.dist(points[a],points[b]),3),'kind':kind,'bidirectional':True,'indoor':kind not in ['outdoor','bridge'],'wheelchair':'unknown','provenance':provenance,'sourceRef':f'{vid}/unit_polygon.json',**extra})
 for level in c['levels']:
  lf=next(f for f in raw['levels']['features'] if f['properties']['level_id']==level);lp=lf['properties'];levelDefs.append({'id':level,'label':lp['level_short_name_en'],'z':lp['level_z_value']})
  polys=[xy(shape(f['geometry'])).buffer(0) for f in raw['units']['features'] if f['properties']['level_id']==level and f['properties']['unit_category'] in ['walkway','lobby','elevator','entry'] and f['properties'].get('unit_restriction') not in ['restricted','employeesonly']]
  # 0.25 m tolerance repairs precision gaps, not doors or walls.
  geom=unary_union(polys).buffer(.25);geoms[level]=geom
  x0,y0,x1,y1=geom.bounds;grid={};step=1.6
  for i in range(math.floor(x0/step),math.ceil(x1/step)+1):
   for j in range(math.floor(y0/step),math.ceil(y1/step)+1):
    p=(i*step,j*step)
    if geom.covers(Point(p)):grid[i,j]=node(f'{level[:8]}-{i}-{j}',p,level=level)
  for (i,j),a in grid.items():
   for di,dj in [(1,0),(0,1),(1,1),(1,-1)]:
    b=grid.get((i+di,j+dj))
    if b and geom.covers(LineString([points[a],points[b]])):edge(a,b)
  levelNodes[level]=list(grid.values())
 def attach_feature(f,kind,level,facility=None):
  p=xy(shape(f['geometry'])).centroid.coords[0];near=sorted(levelNodes[level],key=lambda n:math.dist(p,points[n]))[:20]
  valid=[n for n in near if math.dist(p,points[n])<6 and geoms[level].covers(LineString([p,points[n]]))]
  if not valid:return None
  nid=node(f['properties'].get('amenity_id',f'point-{len(nodes)}'),p,kind,level,sourceRef=f'{vid}/amenity_point.json',**({'facilityId':facility} if facility else {}))
  for n in valid[:4]:edge(nid,n)
  return nid
 # Connected components on each floor, before vertical links.
 adj=collections.defaultdict(list)
 for e in edges:adj[e['from']].append(e['to']);adj[e['to']].append(e['from'])
 comp={};compSize={}
 for n in nodes:
  if n['id'] in comp:continue
  label=n['id'];todo=[label];comp[label]=label;size=0
  while todo:
   a=todo.pop();size+=1
   for b in adj[a]:
    if b not in comp:comp[b]=label;todo.append(b)
  compSize[label]=size
 # Pair all mapped vertical modes; a scene does not require a lift or two lifts.
 modes={'elevator':'lift','stairs':'stairs','escalator':'escalator','ramp':'ramp'}
 pairs=[]
 for category,kind in modes.items():
  features=[[f for f in raw['amenities']['features'] if f['properties']['level_id']==l and f['properties']['amenity_category']==category and not any(t in str(f['properties'].get('amenity_name_en','')).lower() for t in ['service','fireman','platform'])] for l in c['levels']]
  for a in features[0]:
   if not features[1]:continue
   p=xy(shape(a['geometry'])).centroid.coords[0]
   b=min(features[1],key=lambda f:math.dist(p,xy(shape(f['geometry'])).centroid.coords[0]))
   q=xy(shape(b['geometry'])).centroid.coords[0]
   if math.dist(p,q)>(1 if kind=='lift' else 6):continue
   near=[]
   for pt,lev in [(p,c['levels'][0]),(q,c['levels'][1])]:
    ns=sorted(levelNodes[lev],key=lambda n:math.dist(pt,points[n]));ns=[n for n in ns[:20] if math.dist(pt,points[n])<6 and geoms[lev].covers(LineString([pt,points[n]]))];near.append(ns[0] if ns else None)
   if all(near):pairs.append((a,b,comp[near[0]],comp[near[1]],kind))
 groups=collections.defaultdict(list)
 for p in pairs:groups[p[2:4]].append(p)
 if not groups:raise ValueError(f'No connected cross-level facilities {c["id"]}')
 key=max(groups,key=lambda k:(sum(p[4] in ['lift','ramp'] for p in groups[k]),compSize[k[0]]+compSize[k[1]]))
 chosen=[]
 for kind in modes.values():chosen.extend([p for p in groups[key] if p[4]==kind][:2])
 keep={n for n,label in comp.items() if label in key};nodes[:]=[n for n in nodes if n['id'] in keep];edges[:]=[e for e in edges if e['from'] in keep and e['to'] in keep]
 # Renumber before attaching new edges, avoiding ID collisions after pruning.
 for i,e in enumerate(edges):e['id']=f'e-{i}'
 for lev in c['levels']:levelNodes[lev]=[n for n in levelNodes[lev] if n in keep]
 modeCounts=collections.defaultdict(int)
 for a,b,_,__,kind in chosen:
  i=modeCounts[kind];modeCounts[kind]+=1
  fid=c['id']+'-'+kind+'-'+chr(97+i);facilities.append({'id':fid,'label':kind.title()+' '+chr(65+i),'kind':kind,'sourceRefs':[a['properties']['amenity_id'],b['properties']['amenity_id']]})
  an=attach_feature(a,kind,c['levels'][0],fid);bn=attach_feature(b,kind,c['levels'][1],fid)
  if not an or not bn:raise ValueError('Facility attach failure')
  dz=abs(levelDefs[0]['z']-levelDefs[1]['z'])
  # A paired point alone does not establish ramp slope or escalator direction.
  edge(an,bn,kind,'manual/demo augmentation',facilityId=fid,distanceM=max(dz,math.dist(points[an],points[bn])),wheelchair='no' if kind in ['stairs','escalator'] else 'unknown',sourceRef='source-metadata.json#vertical-pairing')
 # Endpoint is a public corridor point, not a fabricated shop.
 upper=levelNodes[c['levels'][1]];liftpts=[points[n['id']] for n in nodes if n['kind'] in modes.values() and n.get('levelId')==c['levels'][1]]
 target=max(upper,key=lambda n:min(math.dist(points[n],p) for p in liftpts));next(n for n in nodes if n['id']==target).update(kind='poi',label='1/F 公共走廊演示點')
 ground=c['levels'][0];entries=[f for f in raw['amenities']['features'] if f['properties']['level_id']==ground and f['properties']['amenity_category']=='entry']
 entry=None
 for f in entries:
  entry=attach_feature(f,'entrance',ground)
  if entry:break
 if not entry:
  entry=max(levelNodes[ground],key=lambda n:min(math.dist(points[n],p) for p in liftpts));next(n for n in nodes if n['id']==entry).update(kind='entrance',label='G/F 走廊端點（入口連接待核實）')
 next(n for n in nodes if n['id']==entry).setdefault('label','G/F 建築入口')
 station=next(f for f in json.loads((RAW/'mtr-venues.json').read_text())['features'] if f['properties']['venue_name_en']==c['station']);sv=station['properties']['venue_id']
 stationAmenities=json.loads((RAW/sv/'mtr_amenity_point.json').read_text())['features']
 # Select a station entrance amenity if available; otherwise a venue-boundary point.
 entries=[f for f in stationAmenities if f['properties'].get('amenity_category')=='entry']
 if entries:sf=min(entries,key=lambda f:Point(points[entry]).distance(xy(shape(f['geometry']))));sp=xy(shape(sf['geometry'])).centroid.coords[0];sref=sf['properties']['amenity_id']
 else:sp=xy(shape(station['geometry'])).boundary.interpolate(xy(shape(station['geometry'])).boundary.project(Point(points[entry]))).coords[0];sref=sv
 # A separate exterior handoff keeps indoor and outdoor segments distinct.
 doorway=node(c['id']+'-doorway',points[entry],'entrance',label='室內 / 室外交接點')
 edge(entry,doorway,'outdoor','manual/demo augmentation',sourceRef='source-metadata.json#building-exit')
 stop=node(c['id']+'-station',sp,'stop',label=c['stationZh']+' 接駁點',sourceRef=sref)
 edge(doorway,stop,'outdoor','manual/demo augmentation',sourceRef='source-metadata.json#station-link')
 # Official route geometry can replace the outdoor link in a later enrichment pass.
 baseline=RAW/(c['id']+'-outdoor-route.json')
 if baseline.exists():
  d=json.loads(baseline.read_text());paths=d.get('routes',{}).get('features',[])
  if paths:
   coords=paths[0]['geometry']['paths'][0];geom=[ll(points[doorway])]+[[p[0],p[1]] for p in coords]+[ll(sp)];edges[-1]['geometry']=geom;edges[-1]['distanceM']=round(sum(math.dist(((b[0]-a[0])*sx,(b[1]-a[1])*sy),(0,0)) for a,b in zip(geom,geom[1:])),2);edges[-1]['sourceRef']=str(baseline.relative_to(ROOT));edges[-1]['tags']={'officialBaseline':True,'endpointLinksUnverified':True}
 # Stable demo labels: the default route uses Lift A.
 adj=collections.defaultdict(list)
 for e in edges:
  if e['kind'] in ['stairs','escalator']:continue
  cost=e['distanceM']+20+(12 if e['kind']=='lift' else 0)
  adj[e['from']].append((e['to'],cost,e));adj[e['to']].append((e['from'],cost,e))
 queue=[(0,target)];best={target:0};prev={}
 while queue:
  cost,n=heapq.heappop(queue)
  if cost!=best[n]:continue
  if n==stop:break
  for nxt,w,e in adj[n]:
   if cost+w<best.get(nxt,float('inf')):best[nxt]=cost+w;prev[nxt]=(n,e);heapq.heappush(queue,(cost+w,nxt))
 n=stop;used=None
 while n!=target and n in prev:
  n,e=prev[n]
  if e['kind']=='lift':used=e['facilityId']
 if used and used.endswith('-b'):
  def swap(fid):return c['id']+'-lift-'+('a' if fid.endswith('-b') else 'b')
  for f in facilities:
   if f['kind']=='lift':f['id']=swap(f['id']);f['label']='Lift '+f['id'][-1].upper()
  for n in nodes:
   if n.get('kind')=='lift' and n.get('facilityId'):n['facilityId']=swap(n['facilityId'])
  for e in edges:
   if e['kind']=='lift' and e.get('facilityId'):e['facilityId']=swap(e['facilityId'])
  facilities.sort(key=lambda f:f['id'])
 graph={'schemaVersion':'1.0','sceneId':c['id'],'nodes':nodes,'edges':edges,'facilities':facilities};write(out/'graph.json',graph)
 for key,v in raw.items():write(out/(key+'.geojson'),fc([f for f in v['features'] if f['properties']['level_id'] in c['levels']]))
 near=[f for f in json.loads((RAW/'venues.json').read_text())['features']+json.loads((RAW/'mtr-venues.json').read_text())['features'] if xy(shape(f['geometry'])).distance(Point(0,0))<600];write(out/'surroundings.geojson',fc(near))
 manifest={'schemaVersion':'1.0','sceneId':c['id'],'venueId':vid,'name':venue['properties']['venue_name_en'],'nameZh':c['nameZh'],'district':venue['properties']['address_locality'],'station':c['station'],'stationZh':c['stationZh'],'entryPoints':[target,entry,stop],'defaultStart':target,'defaultEnd':stop,'center':[cx,cy],'levels':levelDefs,'capabilities':{'indoor':True,'z':True,'wheelchairMetadata':False,'shelterMetadata':False},'files':{'graph':'graph.json','levels':'levels.geojson','units':'units.geojson','openings':'openings.geojson','amenities':'amenities.geojson','surroundings':'surroundings.geojson','metadata':'source-metadata.json'},'dataQuality':'官方樓層幾何；通行屬性未核實；電梯跨層與站口銜接為演示補充'};write(out/'manifest.json',manifest)
 metadata={'source':'Lands Department, HKSARG','retrievedDate':'2026-09-27','rawVenueId':vid,'rawStationId':sv,'coordinateSystem':'EPSG:4326; distances use local metric projection','geometry':'Official level/unit/opening/amenity features, unmodified geometry','graphDerivation':'1.6m grid inside public walkway/lobby/elevator/entry polygons, 0.25m precision tolerance, segment containment checked; connected floor components joined by lifts, ramps, stairs or escalators','vertical-pairing':'manual/demo augmentation: cross-level amenities paired by type and proximity (lifts <=1m, other modes <=6m); topology, public access and availability NOT verified','building-exit':'manual/demo augmentation: zero-distance handoff from indoor endpoint to exterior','station-link':'manual/demo augmentation: station amenity/boundary handoff; official outdoor baseline when present; endpoint access NOT verified','accessibility':'All graph edges wheelchair=unknown. Demo mode penalizes uncertainty. Strict mode blocks it. No route is certified accessible.','facilities':facilities,'manualAugmentations':[e['id'] for e in edges if e['provenance']=='manual/demo augmentation'],'limitations':['No indoor positioning','No verified opening hours or lift status','No observed door widths or slopes','Transit leg is abstract','Selected endpoints are public corridor demo points']};write(out/'source-metadata.json',metadata)
 print(c['id'],len(nodes),'nodes',len(edges),'edges',dict(modeCounts),'vertical modes','entry',entry,'target',target)
if __name__=='__main__':
 from build_scene_catalog import main
 main()
