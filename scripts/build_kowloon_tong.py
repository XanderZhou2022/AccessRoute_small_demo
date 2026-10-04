"""Kowloon Tong: official Festival Walk indoor centreline → lift → footbridges."""
import json,collections
from fetch_data import ROOT,RAW
from pedestrian_graph import topology,shortest,canonical
from build_scene_graph import write,fc

def build():
 sid='kowloon-tong-festival-walk';out=ROOT/'data/scenes'/sid
 source=json.loads((ROOT/'data/pedestrian'/sid/'network.geojson').read_text());net=topology(source['features'])
 # Stable official bridge edge endpoint at the station side; no invented entrance coordinate.
 station=next(e for e in net['edges'] if e['feature']['properties']['PedestrianRouteID']==200007733)['b']
 options=[]
 for e in net['edges']:
  if e['feature']['properties'].get('AliasNameEN')=='Festival Walk G':
   r=shortest(net,[(e['a'],0)],[(station,0)])
   if r and any(net['edges'][i]['feature']['properties']['FeatureType']==10 for i,_ in r['path']):options.append(r)
 chosen=min(options,key=lambda r:abs(r['cost']-280))
 # All reachable routes within this bounded acquired area stay available for rerouting.
 reachable={station};todo=[station]
 while todo:
  for n,*_ in net['adj'][todo.pop()]:
   if n not in reachable:reachable.add(n);todo.append(n)
 include={i for i,e in enumerate(net['edges']) if e['a'] in reachable and e['b'] in reachable}
 graph,levels,floors,at=canonical(net,sid,'official-building-1108222840',include)
 start=next(n for n in graph['nodes'] if n['id'] in at[chosen['start']] and n.get('levelId'))
 stop=next(n for n in graph['nodes'] if n['id'] in at[station] and not n.get('levelId'))
 start.update(kind='poi',label='又一城地下官方通道節點');stop.update(kind='stop',label='九龍塘站天橋接駁點（官方路網）')
 write(out/'graph.json',graph);write(out/'levels.geojson',fc(floors));write(out/'units.geojson',fc([]));write(out/'openings.geojson',fc([]));write(out/'amenities.geojson',fc([]));write(out/'pedestrian-network.geojson',source)
 surroundings=[]
 for file in ['venues.json','mtr-venues.json']:
  for f in json.loads((RAW/file).read_text())['features']:
   b=f['properties']['bbox']
   if 114.168<(b[0]+b[2])/2<114.181 and 22.332<(b[1]+b[3])/2<22.343:surroundings.append(f)
 write(out/'surroundings.geojson',fc(surroundings))
 manifest={'schemaVersion':'1.0','sceneId':sid,'venueId':'official-building-1108222840','name':'Festival Walk / Kowloon Tong footbridges','nameZh':'又一城・九龍塘站天橋','district':'KOWLOON TONG','station':'Kowloon Tong Station','stationZh':'九龍塘站','entryPoints':[start['id'],stop['id']],'defaultStart':start['id'],'defaultEnd':stop['id'],'center':[114.1748,22.3372],'levels':levels,'capabilities':{'indoor':True,'z':True,'wheelchairMetadata':False,'shelterMetadata':True},'files':{'graph':'graph.json','levels':'levels.geojson','units':'units.geojson','openings':'openings.geojson','amenities':'amenities.geojson','surroundings':'surroundings.geojson','metadata':'source-metadata.json'},'dataQuality':'官方室內外三維路網與天橋；樓層顯示通道中心線，沒有店舖單元平面；通行及開放時間待核實'}
 write(out/'manifest.json',manifest)
 write(out/'source-metadata.json',{'source':'Lands Department CSDI 3D Pedestrian Network','retrievedDate':'2026-10-04','representation':'network-centreline','rawSource':'data/raw/pedestrian/'+sid,'rawFeatures':len(source['features']),'exact-xyz-joins':'Shared original XYZ vertices; lon/lat rounded 8 decimals, elevation 1mm. No XY-only snapping or overpass joins. Zero-length semantic layer handoffs are derived.','selection':'Enabled, unpaid, step-free subnetwork; barriers and slopes > 1:12 excluded; raw dataset retains all other paths.','stationHandoff':'Official endpoint of PedestrianRouteID 200007733; station bridge interface, not a claim of accessible entry to paid platform.','defaultRoutePurpose':'Festival Walk G public passage, official lift and station footbridge chain','floorMaps':'Official network centreline geometries, NOT floor boundaries, corridors widths or shop polygons','accessibility':'All retained edges unknown, even when official WheelchairBarrier=false; access hours not yet enforced','limitations':['No full mall unit/opening/occupant polygons in public indoor catalogue','No verified shop landmarks','AccessTimeID preserved but access schedules not enforced','No live lift status'],'sourceFeatureIds':sorted({net['edges'][i]['feature']['properties']['PedestrianRouteID'] for i in include})})
 print(sid,len(graph['nodes']),len(graph['edges']),len(graph['facilities']),'default metric',chosen['cost'])
if __name__=='__main__':build()
