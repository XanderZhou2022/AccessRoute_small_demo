"""Reproducible official-data acquisition; bounded requests, raw bytes + audit log."""
import json, pathlib, subprocess, datetime, time, hashlib, urllib.parse
ROOT=pathlib.Path(__file__).resolve().parents[1]
RAW=ROOT/'data/raw'
def fetch(name,url):
 p=RAW/name;p.parent.mkdir(parents=True,exist_ok=True)
 if p.exists() and p.stat().st_size:return p
 r=subprocess.run(['curl','-sS','-L','--max-time','45','--retry','1','-H','Origin: http://localhost:5173','-D',str(p)+'.headers','-o',str(p),'-w','%{http_code}',url],capture_output=True,text=True)
 record={'file':str(p.relative_to(ROOT)),'url':url,'retrievedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'httpStatus':r.stdout,'error':r.stderr,'sha256':hashlib.sha256(p.read_bytes()).hexdigest() if p.exists() else None}
 with (RAW/'requests.jsonl').open('a') as out:out.write(json.dumps(record)+'\n')
 if r.returncode or r.stdout!='200':raise RuntimeError(record)
 time.sleep(.25)
 return p

def wfs(feature,venue=None):
 q={'service':'WFS','version':'1.1.0','request':'GetFeature','outputFormat':'application/json','srsName':'EPSG:4326'}
 if venue:q['cql_filter']=f"venue_id='{venue}'"
 return 'https://mapapi.hkmapservice.gov.hk/ogc/wfs/indoor/'+feature+'?'+urllib.parse.urlencode(q)
if __name__=='__main__':
 venues=json.loads((RAW/'venues.json').read_text())['features']
 names=['Hysan Place','Maritime square','PopCorn 1','PopCorn 2','Telford Plaza','1881 Heritage']
 for f in venues:
  p=f['properties']
  if p['venue_name_en'] in names:
   for ft in ['level_polygon','unit_polygon','opening_line','amenity_point']:
    path=fetch(p['venue_id']+'/'+ft+'.json',wfs(ft,p['venue_id']))
    d=json.loads(path.read_text()); print(p['venue_name_en'],ft,len(d.get('features',[])),flush=True)
