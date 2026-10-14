"""Topology and conservative routing over official 3D pedestrian polylines.
Only identical XYZ endpoints/vertices connect; XY crossings never imply connectivity.
"""
import math,heapq,collections,json,hashlib

def key(p):return tuple(round(float(v),8 if i<2 else 3) for i,v in enumerate(p[:3]))
def meters(a,b):return math.sqrt(((a[0]-b[0])*103000)**2+((a[1]-b[1])*111320)**2+((a[2] if len(a)>2 else 0)-(b[2] if len(b)>2 else 0))**2)
def usable(p):
 return p.get('Enabled')==1 and p.get('Location')!=3 and p.get('FeatureType') not in [8,12,13,16,20,21] and p.get('WheelchairBarrier')!=1 and (p.get('FeatureType') in [10,18] or abs(p.get('Gradient') or 0)<=.0833)
def topology(features,outdoor_only=False):
 fs=[f for f in features if f.get('geometry') and usable(f['properties']) and (not outdoor_only or f['properties']['Location']==1)]
 lines=[]
 for f in fs:
  g=f['geometry'];parts=[g['coordinates']] if g['type']=='LineString' else g['coordinates']
  for part in parts:
   if len(part)>1:lines.append((f,part))
 ends={key(p) for _,line in lines for p in [line[0],line[-1]]};edges=[];adj=collections.defaultdict(list);coords={}
 for f,line in lines:
  begin=0
  for i in range(1,len(line)):
   if i!=len(line)-1 and key(line[i]) not in ends:continue
   path=line[begin:i+1];begin=i;a=key(path[0]);b=key(path[-1])
   if a==b:continue
   coords[a]=path[0];coords[b]=path[-1];distance=sum(meters(x,y) for x,y in zip(path,path[1:]));idx=len(edges)
   edges.append({'feature':f,'coords':path,'a':a,'b':b,'distance':distance})
   direction=f['properties'].get('Direction') or 0
   if direction!=-1:adj[a].append((b,distance,idx,False))
   if direction!=1:adj[b].append((a,distance,idx,True))
 return {'edges':edges,'adj':adj,'coords':coords}
def shortest(net,starts,ends):
 q=[];best={};prev={};targets=dict(ends)
 for node,cost in starts:
  if cost<best.get(node,float('inf')):best[node]=cost;heapq.heappush(q,(cost,node))
 finish=None;total=float('inf')
 while q:
  cost,n=heapq.heappop(q)
  if cost!=best[n]:continue
  if cost>total:break
  if n in targets and cost+targets[n]<total:finish=n;total=cost+targets[n]
  for nxt,w,e,reverse in net['adj'][n]:
   if cost+w<best.get(nxt,float('inf')):
    best[nxt]=cost+w;prev[nxt]=(n,e,reverse);heapq.heappush(q,(cost+w,nxt))
 if finish is None:return None
 path=[];n=finish
 while n in prev:
  a,e,reverse=prev[n];path.append((e,reverse));n=a
 return {'start':n,'end':finish,'path':list(reversed(path)),'cost':total}
def nearby(net,p,limit=12,max_distance=60):
 candidates=sorted((meters(p,x),n) for n,x in net['coords'].items())
 return [(n,d*4) for d,n in candidates[:limit] if d<=max_distance]

def canonical(net,sid,venue_id,include=None):
 """Convert a selected network into the existing Scene contract without XY snapping."""
 chosen=net['edges'] if include is None else [e for i,e in enumerate(net['edges']) if i in include]
 floor_at=collections.defaultdict(set);defs={};features_by_floor=collections.defaultdict(dict)
 for e in chosen:
  p=e['feature']['properties'];fid=p.get('FloorID')
  if fid and p.get('Location')==2:
   lid='ped-floor-'+str(fid)
   for k in [e['a'],e['b']]:floor_at[k].add(lid)
   defs.setdefault(lid,{'id':lid,'label':p.get('AliasNameTC') or p.get('AliasNameEN') or str(fid),'z':round(e['coords'][0][2],3)})
 nodes={};at=collections.defaultdict(list);edges=[];facilities={}
 def node(k,scope):
  nid='ped-'+hashlib.sha256((str(k)+'|'+str(scope)).encode()).hexdigest()[:20]
  if nid not in nodes:
   p=net['coords'][k];n={'id':nid,'sceneId':sid,'lon':p[0],'lat':p[1],'z':p[2],'kind':'junction','sourceRef':'pedestrian-network.geojson'}
   if scope:n.update(levelId=scope,venueId=venue_id)
   nodes[nid]=n;at[k].append(nid)
  return nid
 def altitude(k):
  found=sorted(floor_at[k])
  if found:return found[0]
  lid='ped-z-'+str(round(k[2]*1000)).replace('-','m');defs.setdefault(lid,{'id':lid,'label':f'路網標高 {k[2]:.2f} m','z':k[2]});return lid
 for e in chosen:
  p=e['feature']['properties'];t=p['FeatureType'];indoor=p['Location']==2;vertical=t in [10,18]
  scope='ped-floor-'+str(p['FloorID']) if indoor and p.get('FloorID') else None
  a=node(e['a'],altitude(e['a']) if vertical else scope);b=node(e['b'],altitude(e['b']) if vertical else scope)
  kind='lift' if vertical else 'bridge' if t==2 else 'corridor' if scope else 'outdoor'
  fid=sid+'-official-lift-'+str(p['PedestrianRouteID'])
  ref='pedestrian-network.geojson#'+str(p['PedestrianRouteID'])
  co=[v[:2] for v in e['coords']];direction=p.get('Direction') or 0
  if direction==-1:a,b=b,a;co.reverse()
  edge={'id':f'ped-e-{len(edges)}','from':a,'to':b,'distanceM':round(e['distance'],4),'kind':kind,'bidirectional':direction==0,'indoor':indoor,'wheelchair':'unknown','provenance':'official','sourceRef':ref,'geometry':co,'tags':{k:v for k,v in p.items() if v is not None and isinstance(v,(str,int,float,bool))}}
  if p.get('WeatherProof') in [1,2]:edge['sheltered']=p['WeatherProof']==1
  if p.get('Gradient') is not None and not vertical:edge['slope']=p['Gradient']
  if vertical:
   facilities[fid]={'id':fid,'label':(p.get('AliasNameTC') or '官方電梯路段')+' '+str(p['PedestrianRouteID']),'kind':'lift','sourceRefs':[ref]};edge['facilityId']=fid
   for nid in [a,b]:nodes[nid].update(kind='lift',facilityId=fid)
  edges.append(edge)
  if scope:features_by_floor[scope][p['PedestrianRouteID']]={**e['feature'],'properties':{**p,'level_id':scope,'unit_category':'walkway','unit_name_en':p.get('AliasNameEN'),'representation':'official network centreline; not a room polygon'}}
 # Different semantic layers meet ONLY where the official XYZ node is identical.
 for k,ids in list(at.items()):
  if len(ids)<2:continue
  hub=node(k,None)
  for nid in list(ids):
   if nid==hub:continue
   edges.append({'id':f'ped-e-{len(edges)}','from':nid,'to':hub,'distanceM':0,'kind':'outdoor','bidirectional':True,'indoor':False,'wheelchair':'unknown','provenance':'derived','sourceRef':'source-metadata.json#exact-xyz-joins'})
 # Elevation-only transitions have no room boundaries: use incident official lines for view bounds.
 for lid in defs:
  if lid in features_by_floor:continue
  for e in chosen:
   if any(nodes[nid].get('levelId')==lid for k in [e['a'],e['b']] for nid in at[k]):
    p=e['feature']['properties'];features_by_floor[lid][p['PedestrianRouteID']]={**e['feature'],'properties':{**p,'level_id':lid,'representation':'official network centreline'}}
 floors=[f for fs in features_by_floor.values() for f in fs.values()]
 return {'schemaVersion':'1.0','sceneId':sid,'nodes':list(nodes.values()),'edges':edges,'facilities':list(facilities.values())}, sorted(defs.values(),key=lambda x:x['z']),floors,at
