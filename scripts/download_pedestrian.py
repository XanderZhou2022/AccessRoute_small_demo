"""Acquire small official 3D pedestrian areas, with count/ID completeness checks."""
import json, urllib.parse
from fetch_data import ROOT,RAW,fetch
BASE='https://portal.csdi.gov.hk/server/rest/services/common/landsd_rcd_1637222018065_52265/FeatureServer/0/query?'
def area(sid,bounds):
 base={'where':'1=1','geometry':','.join(str(x) for x in bounds),'geometryType':'esriGeometryEnvelope','inSR':4326,'spatialRel':'esriSpatialRelIntersects'}
 folder='pedestrian/'+sid
 count=json.loads(fetch(folder+'/count.json',BASE+urllib.parse.urlencode({**base,'returnCountOnly':'true','f':'json'})).read_text())['count']
 features=[];offset=0
 while offset<count:
  q={**base,'outFields':'*','outSR':4326,'f':'geojson','returnZ':'true','orderByFields':'OBJECTID ASC','resultOffset':offset,'resultRecordCount':1000}
  d=json.loads(fetch(folder+f'/page-{offset}.geojson',BASE+urllib.parse.urlencode(q)).read_text())
  fs=d.get('features',[])
  if not fs:break
  features.extend(fs);offset+=len(fs)
 ids=[f['properties']['OBJECTID'] for f in features]
 if len(set(ids))!=len(ids):raise ValueError((sid,'duplicate IDs'))
 missing=[]
 if len(ids)!=count:
  inventory=json.loads(fetch(folder+'/ids.json',BASE+urllib.parse.urlencode({**base,'returnIdsOnly':'true','f':'json'})).read_text())['objectIds']
  missing=sorted(set(inventory)-set(ids))
  if missing:
   original=json.loads(fetch(folder+'/unrepresented.json',BASE+urllib.parse.urlencode({'objectIds':','.join(map(str,missing)),'outFields':'*','outSR':4326,'returnZ':'true','f':'json'})).read_text())
   for f in original.get('features',[]):
    paths=f.get('geometry',{}).get('paths',[])
    if paths:
     features.append({'type':'Feature','id':f['attributes']['OBJECTID'],'properties':f['attributes'],'geometry':{'type':'LineString' if len(paths)==1 else 'MultiLineString','coordinates':paths[0] if len(paths)==1 else paths}})
   ids=[f['properties']['OBJECTID'] for f in features]
   missing=sorted(set(inventory)-set(ids))
  if len(ids)+len(missing)!=count:raise ValueError((sid,'unexplained count mismatch'))
 # A derived merge, never presented as original response bytes.
 out=ROOT/'data/pedestrian'/sid;out.mkdir(parents=True,exist_ok=True)
 (out/'network.geojson').write_text(json.dumps({'type':'FeatureCollection','features':features},ensure_ascii=False,separators=(',',':')))
 (out/'source-metadata.json').write_text(json.dumps({'source':'Lands Department CSDI 3D Pedestrian Network','boundsWGS84':bounds,'sourceCount':count,'featureCount':len(ids),'complete':not missing,'nullGeometryIds':missing,'rawPages':folder,'merge':'Concatenation ordered by OBJECTID; source geometry and properties unchanged','snapshot':'2026-10-04'},indent=2))
 print(sid,len(ids),'valid,',len(missing),'null geometries',flush=True)
def main():
 import argparse
 p=argparse.ArgumentParser();p.add_argument('--priority-only',action='store_true');args=p.parse_args()
 area('kowloon-tong-festival-walk',[114.168,22.332,114.181,22.343])
 if args.priority_only:return
 venues={f['properties']['venue_id']:f['properties'] for f in json.loads((RAW/'venues.json').read_text())['features']}
 stations={f['properties']['venue_id']:f['properties'] for f in json.loads((RAW/'mtr-venues.json').read_text())['features']}
 rows=json.loads((ROOT/'data/expansion-candidates.json').read_text())
 for r in rows:
  a=venues[r['venueId']]['bbox'];b=stations[r['stationId']]['bbox']
  bounds=[min(a[0],b[0])-.001,min(a[1],b[1])-.001,max(a[2],b[2])+.001,max(a[3],b[3])+.001]
  area(r['venueId'],bounds)
if __name__=='__main__':main()
