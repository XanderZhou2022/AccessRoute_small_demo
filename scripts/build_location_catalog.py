"""Publish honest data coverage and reusable POIs; never invent visual landmarks."""
import json,collections
from fetch_data import ROOT,RAW
from build_scene_graph import write
TOPICS={
'hysan-place':['商場'],'popcorn-2':['商場','住宅區日常出行'],
'kowloon-tong-festival-walk':['商場','天橋','鐵路接駁'],
'shek-kip-mei-services':['長者服務','護養院所在建築','公共屋邨社區'],
'cheung-sha-wan-government':['政府合署','政務服務'],
'sha-tin-government':['政府合署','政務服務'],
'north-point-government':['政府合署','局署辦事處'],
'kwai-hing-government':['政府合署','政務服務'],
'pei-ho-market':['街市','熟食中心','社區日常出行'],
'java-road-market':['街市','市政服務'],
'kowloon-city-market':['街市','市政服務'],
'tai-po-market':['街市','熟食中心']}
SOURCES={
 'indoorAPI':'https://portal.csdi.gov.hk/csdi-webpage/apidoc/3d-indoor-map-api',
 'indoorIndex':'https://portal.csdi.gov.hk/geoportal/?datasetId=landsd_rcd_1671437329821_60808',
 'pedestrian':'https://portal.csdi.gov.hk/geoportal/?datasetId=landsd_rcd_1637222018065_52265',
 'shekKipMeiServices':'https://www.swd.gov.hk/tc/pubsvc/district/ssp/infobook/',
 'shekKipMeiNursing':'https://elderlyinfo.swd.gov.hk/tc/search-result-ccsv?items_per_page=30&page=11&sort_by=field_bi_name_en_value',
 'hospitalLocations':'https://data.gov.hk/en-data/dataset/hospital-hadata-health-care-facilities/resource/c77dbfcb-8438-40ab-b6db-ee3e21bbaa67'}
def main():
 ids=json.loads((ROOT/'data/scenes/index.json').read_text())['scenes'];rows=[]
 for sid in ids:
  out=ROOT/'data/scenes'/sid;m=json.loads((out/'manifest.json').read_text());g=json.loads((out/'graph.json').read_text());meta=json.loads((out/'source-metadata.json').read_text());vid=m['venueId'];layers={};pois=[]
  if sid!='kowloon-tong-festival-walk':
   node_ids={n['id']:n for n in g['nodes']}
   for layer in ['level_polygon','unit_polygon','opening_line','amenity_point','occupant_point']:
    p=RAW/vid/(layer+'.json');d=json.loads(p.read_text());fs=d['features'];layers[layer]={'path':str(p.relative_to(ROOT)),'count':len(fs),'reportedTotal':d.get('totalFeatures',len(fs)),'complete':len(fs)==d.get('totalFeatures',len(fs))}
    if layer not in ['amenity_point','occupant_point']:continue
    kind=layer.split('_')[0]
    for f in fs:
     p=f['properties'];pid=p.get(kind+'_id') or f.get('id');n=node_ids.get(pid)
     pois.append({'id':pid,'kind':kind,'nameEn':p.get(kind+'_name_en'),'nameZh':p.get(kind+'_name_zh'),'category':p.get(kind+'_category'),'venueId':vid,'levelId':p.get('level_id'),'geometry':f['geometry'],'graphNodeId':n['id'] if n else None,'facilityId':n.get('facilityId') if n else None,'mappingStatus':'exact-official-amenity-id' if n else 'unmatched','sourceRef':str((RAW/vid/(layer+'.json')).relative_to(ROOT)),'rawProperties':p})
  write(ROOT/'data/poi'/f'{sid}.json',{'sceneId':sid,'records':pois,'warning':'Official named/unnamed POIs are retrieval candidates, not validated visual landmarks. Null graphNodeId requires a map/door association; do not replace null with a guessed nearest node.'})
  network_path=ROOT/'data/pedestrian'/(sid if sid=='kowloon-tong-festival-walk' else vid)/'network.geojson'
  network=json.loads(network_path.read_text())['features'];counts=collections.Counter(f['properties']['FeatureType'] for f in network)
  row={'sceneId':sid,'name':m['nameZh'],'station':m['stationZh'],'district':m['district'],'themes':TOPICS[sid],'demoLevels':[l['label'] for l in m['levels']],'indoorRepresentation':'official-centreline-only' if sid=='kowloon-tong-festival-walk' else 'official-floor-unit-opening-amenity-polygons','fullIndoorLayers':layers,'pedestrianNetwork':{'path':str(network_path.relative_to(ROOT)),'features':len(network),'footbridgeFeatures':counts[2],'liftFeatures':counts[10]+counts[18],'preservesZ':True,'preservedFields':['FloorID','BuildingID_1','FeatureType','WeatherProof','WheelchairBarrier','WheelchairAccess','Gradient','Direction','AccessTimeID']},'poiFile':f'data/poi/{sid}.json','poiCount':len(pois),'exactGraphPoiMatches':sum(p['graphNodeId'] is not None for p in pois),'scenePath':f'data/scenes/{sid}','routeNodes':len(g['nodes']),'routeEdges':len(g['edges']),'accessibilityVerified':False,'outdoorAttachments':meta.get('outdoor-attachment'),'knownGaps':meta.get('limitations',[])}
  if sid=='shek-kip-mei-services':row['serviceEvidence']={'elderlyCentre':'1/F, SWD directory','nursingHome':'2/F–3/F, SWD elderly information directory','demoEndpoint':'1/F public corridor; not a verified service counter or ward','sources':[SOURCES['shekKipMeiServices'],SOURCES['shekKipMeiNursing']]}
  rows.append(row)
 catalog={'schemaVersion':'1.0','snapshotDate':'2026-10-04','sceneCount':len(rows),'orderedJourneyCount':len(rows)*(len(rows)-1),'transit':'abstract; 132 ordered UI combinations are not 132 independently surveyed full transit routes','sources':SOURCES,'locations':rows,'gaps':[{'category':'hospital','candidate':'Kwong Wah Hospital / Yau Ma Tei','status':'reserve-outdoor-only','officialLocationFile':'data/raw/expansion-20261004/hospitals.geojson','pedestrianNetwork':'data/pedestrian/kwong-wah-hospital/network.geojson','reason':'No hospital interior in downloaded complete indoor catalogue; surrounding pedestrian geometry alone is insufficient for an indoor hospital scene.'},{'category':'elderly-population-density','status':'not-demographically-verified','reason':'Shek Kip Mei selected using verified elderly services and housing context, not an unsupported claim about resident age percentages.'},{'category':'festival-walk-shop-polygons','status':'unavailable-in-indoor-catalogue','reason':'Official multi-level pedestrian network is available; room/shop boundaries and named shop POIs are not.'}]}
 write(ROOT/'data/location-catalog.json',catalog)
 print('Catalogue',len(rows),'scenes;',sum(r['poiCount'] for r in rows),'POIs;',sum(r['pedestrianNetwork']['features'] for r in rows),'network features across areas (may overlap)')
 for r in rows:print(r['name'],r['station'],r['routeNodes'],r['routeEdges'],r['poiCount'])
if __name__=='__main__':main()
