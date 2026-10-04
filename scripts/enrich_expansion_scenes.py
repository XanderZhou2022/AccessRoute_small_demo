"""Replace straight demo station links with a route on frozen official 3D network.
Short endpoint snaps remain explicit unverified demo connectors.
"""
import json
from fetch_data import ROOT,RAW
from build_scene_graph import write
from pedestrian_graph import topology,shortest,nearby,canonical,meters

def enrich(c):
 out=ROOT/'data/scenes'/c['id'];graph=json.loads((out/'graph.json').read_text());manifest=json.loads((out/'manifest.json').read_text());metadata=json.loads((out/'source-metadata.json').read_text())
 src=ROOT/'data/pedestrian'/c['venue']/'network.geojson'
 if not src.exists():return {'sceneId':c['id'],'status':'missing-network'}
 data=json.loads(src.read_text());net=topology(data['features'],outdoor_only=True)
 doorway=next(n for n in graph['nodes'] if n['id']==c['id']+'-doorway');stop=next(n for n in graph['nodes'] if n['id']==manifest['defaultEnd'])
 entry=next(n for n in graph['nodes'] if n['id']==manifest['entryPoints'][1]);a=[doorway['lon'],doorway['lat'],entry.get('z',0)]
 b=[stop['lon'],stop['lat']]
 amenities=json.loads((RAW/metadata['rawStationId']/'mtr_amenity_point.json').read_text())['features']
 match=next((f for f in amenities if f['properties']['amenity_id']==stop.get('sourceRef')),None)
 if match and len(match['geometry']['coordinates'])>2:b=match['geometry']['coordinates']
 options=[]
 for outdoor_only in [True,False]:
  if not outdoor_only:net=topology(data['features'])
  for f in amenities:
   if f['properties'].get('amenity_category')!='entry':continue
   candidate=f['geometry']['coordinates']
   r=shortest(net,nearby(net,a,limit=30,max_distance=30),nearby(net,candidate,limit=12,max_distance=20))
   if r:options.append((r['cost'],r,candidate,f))
  if options:break
 if not options:return {'sceneId':c['id'],'status':'no-official-outdoor-path','maxBuildingSnapM':30,'maxStationSnapM':20}
 _,route,b,station_feature=min(options,key=lambda x:x[0])
 stop.update(lon=b[0],lat=b[1],sourceRef=station_feature['properties']['amenity_id'],label=c['stationZh']+' '+str(station_feature['properties'].get('amenity_name_en') or '入口')+' 接駁點')
 selected={i for i,_ in route['path']}
 addition,levels,floors,at=canonical(net,c['id'],c['venue'],selected)
 # Exact-coordinate choice; prefer semantic hub for attachment when available.
 def endpoint(k):
  ns=[n for n in addition['nodes'] if n['id'] in at[k]]
  return next((n for n in ns if not n.get('levelId')),ns[0])
 first=endpoint(route['start']);last=endpoint(route['end'])
 original_link=next(e for e in graph['edges'] if e['from']==doorway['id'] and e['to']==stop['id'])
 graph['edges'].remove(original_link)
 graph['nodes'].extend(addition['nodes']);graph['edges'].extend(addition['edges']);graph['facilities'].extend(addition['facilities'])
 snaps=[]
 for index,(x,y,p,q) in enumerate([(doorway,first,a,net['coords'][route['start']]),(last,stop,net['coords'][route['end']],b)]):
  length=meters(p,q);snaps.append(round(length,3))
  graph['edges'].append({'id':f'official-endpoint-snap-{index}','from':x['id'],'to':y['id'],'distanceM':length,'kind':'outdoor','bidirectional':True,'indoor':False,'wheelchair':'unknown','provenance':'manual/demo augmentation','sourceRef':'source-metadata.json#outdoor-attachment','tags':{'endpointLinksUnverified':True,'snapDistanceM':length}})
 manifest['levels'].extend(levels);manifest['capabilities']['shelterMetadata']=True
 manifest['dataQuality']='官方樓層幾何＋官方室外路網；室內圖推導、跨層電梯配對及兩端吸附待核實'
 metadata.update(networkIncludesIndoor=not outdoor_only,retrievedDate='2026-10-04',outdoorSource=str(src.relative_to(ROOT)),**{'station-link':'Official CSDI pedestrian route geometries; endpoint attachments separately marked manual/demo augmentation','outdoor-attachment':{'method':'3D nearest candidate endpoints (building max 30 m / station max 20 m), minimum route cost with snap penalty; no straight link replaces failed routing','snapDistancesM':snaps,'verified':False},'outdoorRouteIds':[net['edges'][i]['feature']['properties']['PedestrianRouteID'] for i,_ in route['path']],'outdoorLimitations':['Official WheelchairBarrier and Gradient exclude known barriers/steep slopes; retained accessibility stays unknown','AccessTimeID retained, opening schedules not yet enforced','Single official exterior path retained; full local network preserved for future alternative routing']})
 metadata['manualAugmentations']=[e['id'] for e in graph['edges'] if e['provenance']=='manual/demo augmentation']
 # Correct generic builder labels for candidates whose selected floor is not 1/F.
 selected_upper=manifest['levels'][1]['label'];selected_ground=manifest['levels'][0]['label']
 for n in graph['nodes']:
  if n.get('label'):n['label']=n['label'].replace('1/F',selected_upper).replace('G/F',selected_ground)
 metadata['vertical-pairing']=f'manual/demo augmentation: official lift points at {selected_ground} and {selected_upper} paired within 1m; shaft continuity and public access unverified'
 current=json.loads((out/'levels.geojson').read_text());current['features'].extend(floors)
 write(out/'levels.geojson',current);write(out/'graph.json',graph);write(out/'manifest.json',manifest);write(out/'source-metadata.json',metadata);write(out/'pedestrian-network.geojson',data)
 return {'sceneId':c['id'],'status':'enriched','officialRouteEdges':len(route['path']),'snapDistancesM':snaps,'routeCost':round(route['cost'],3)}
def main():
 results=[]
 for row in json.loads((ROOT/'data/expansion-builds.json').read_text()):
  if row['status']!='built':continue
  r=enrich(row['config']);results.append(r);print(r,flush=True)
 write(ROOT/'data/expansion-outdoor-audit.json',results)
if __name__=='__main__':main()
