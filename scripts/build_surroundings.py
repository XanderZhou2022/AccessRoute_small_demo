"""Official building footprints around each route; frozen inputs support offline rebuilds."""
import argparse,json,math,urllib.parse
from shapely.geometry import shape,Point
from fetch_data import ROOT,RAW,fetch

SERVICE='https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1637211194312_35158/FeatureServer/0'
def query(params):return SERVICE+'/query?'+urllib.parse.urlencode(params)
def write(p,d):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False))
def build(download=False):
 report=[]
 for sid in json.loads((ROOT/'data/scenes/index.json').read_text())['scenes']:
  folder=ROOT/'data/scenes'/sid;m=json.loads((folder/'manifest.json').read_text());g=json.loads((folder/'graph.json').read_text())
  nodes=g['nodes'];lat=m['center'][1];dx=350/(111320*math.cos(math.radians(lat)));dy=350/111320
  bounds=[min(n['lon'] for n in nodes)-dx,min(n['lat'] for n in nodes)-dy,max(n['lon'] for n in nodes)+dx,max(n['lat'] for n in nodes)+dy]
  prefix='buildings/'+sid;raw=RAW/prefix
  if download:
   ids=json.loads(fetch(prefix+'/ids.json',query({'where':'1=1','geometry':','.join(map(str,bounds)),'geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects','returnIdsOnly':'true','f':'json'})).read_text())
   if 'objectIds' not in ids:raise ValueError(ids)
   ids=sorted(ids['objectIds']);features=[]
   for i in range(0,len(ids),100):
    page=json.loads(fetch(prefix+f'/batch100-{i//100}.geojson',query({'objectIds':','.join(map(str,ids[i:i+100])),'outFields':'*','returnGeometry':'true','outSR':4326,'f':'geojson'})).read_text())
    if 'features' not in page:raise ValueError(page)
    features+=page['features']
   assert set(ids)=={f['properties']['OBJECTID'] for f in features},sid
   write(raw/'network.geojson',{'type':'FeatureCollection','features':features})
   write(raw/'coverage.json',{'source':SERVICE,'bbox':bounds,'expectedCount':len(ids),'receivedCount':len(features),'selection':'Graph extent plus 350 m margin; spatial intersection'})
  features=json.loads((raw/'network.geojson').read_text())['features']
  start=next(n for n in nodes if n['id']==m['defaultStart']);point=Point(start['lon'],start['lat']);out=[]
  for f in features:
   if not f.get('geometry'):continue
   p=dict(f['properties']);base=p.get('BaseHeight');top=p.get('TopHeight')
   height=float(top)-float(base) if isinstance(top,(int,float)) and isinstance(base,(int,float)) and top>base else None
   p.update(sourceDataset='landsd_rcd_1637211194312_35158',heightVerified=height is not None,venue_display_height=height or 20,venue_display_height_min=0)
   if shape(f['geometry']).covers(point):p['venue_id']=m['venueId']
   out.append({**f,'properties':p})
  write(folder/'surroundings.geojson',{'type':'FeatureCollection','features':out})
  meta=json.loads((folder/'source-metadata.json').read_text());meta['surroundings']={'source':SERVICE,'rawSource':str(raw.relative_to(ROOT)),'count':len(out),'coverage':json.loads((raw/'coverage.json').read_text()),'display':'Official footprints; heights visually scaled/capped, missing height uses schematic default; not photorealistic 3D.'};write(folder/'source-metadata.json',meta)
  report.append({'sceneId':sid,'buildings':len(out)});print(sid,len(out),flush=True)
 write(ROOT/'docs/qa/surroundings.json',report)
if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--download',action='store_true');build(parser.parse_args().download)
