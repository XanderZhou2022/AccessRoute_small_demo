"""Rank downloaded candidates; geometric station proximity is not route accessibility."""
import json, math, csv
from fetch_data import ROOT, RAW
mtr=json.loads((RAW/'mtr-venues.json').read_text())['features']
def center(p):
 b=p['bbox'];return [(b[0]+b[2])/2,(b[1]+b[3])/2]
def dist(a,b):return math.hypot((a[0]-b[0])*103000,(a[1]-b[1])*111000)
rows=[]
for f in json.loads((RAW/'venues.json').read_text())['features']:
 p=f['properties'];d=RAW/p['venue_id']
 if not (d/'amenity_point.json').exists():continue
 data={k:json.loads((d/(k+'.json')).read_text())['features'] for k in ['level_polygon','unit_polygon','opening_line','amenity_point']}
 nearest=min(mtr,key=lambda s:dist(center(p),center(s['properties'])))['properties']
 lifts=sum(x['properties']['amenity_category']=='elevator' for x in data['amenity_point'])
 rows.append({'venueId':p['venue_id'],'name':p['venue_name_en'],'levels':len(data['level_polygon']),'units':len(data['unit_polygon']),'openings':len(data['opening_line']),'amenities':len(data['amenity_point']),'liftPoints':lifts,'nearestStation':nearest['venue_name_en'],'straightLineM':round(dist(center(p),center(nearest))),'networkAdvertised':p['venue_network'],'score':sum(bool(data[k]) for k in data)*10+min(lifts,20)})
rows.sort(key=lambda r:-r['score'])
(ROOT/'data/candidates.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
with (ROOT/'data/candidates.csv').open('w') as out:
 w=csv.DictWriter(out,fieldnames=rows[0].keys());w.writeheader();w.writerows(rows)
print(json.dumps(rows,ensure_ascii=False,indent=2))
