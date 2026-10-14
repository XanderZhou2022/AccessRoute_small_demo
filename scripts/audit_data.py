"""Create reproducibility inventory from frozen files, never alter response bytes."""
import json,hashlib,datetime,pathlib
from fetch_data import ROOT,RAW,wfs
known={'venues.json':wfs('venue_polygon'),'mtr-venues.json':wfs('mtr_venue_polygon'),'travel-modes.json':'https://mapapi.hkmapservice.gov.hk/PedRoute/NAServer/route/retrieveTravelModes?f=json'}
for n in ['barrier_free_facilities','barrier_free_facility_category','mtr_lines_and_stations']:known[n+'.csv']='https://opendata.mtr.com.hk/data/'+n+'.csv'
logs=[json.loads(s) for s in (RAW/'requests.jsonl').read_text().splitlines()]
byfile={s['file'].removeprefix('data/raw/'):s for s in logs}
rows=[]
for p in sorted(RAW.rglob('*')):
 if not p.is_file() or p.suffix not in ['.json','.csv','.geojson','.xml']:continue
 name=str(p.relative_to(RAW));log=byfile.get(name,{})
 if p.parent!=RAW and name not in byfile:known[name]=wfs(p.stem,p.parent.name)
 rows.append({'file':str(p.relative_to(ROOT)),'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'url':log.get('url',known.get(name)),'downloadedAt':log.get('retrievedAt',datetime.datetime.fromtimestamp(p.stat().st_mtime,datetime.timezone.utc).isoformat()),'timestampEvidence':'request-log' if log else 'local-file-mtime','httpStatus':log.get('httpStatus'),'headersFile':str(pathlib.Path(str(p)+'.headers').relative_to(ROOT)) if pathlib.Path(str(p)+'.headers').exists() else None})
(ROOT/'data/source-index.json').write_text(json.dumps(rows,indent=2))
print('Inventoried',len(rows),'official JSON/CSV files')
