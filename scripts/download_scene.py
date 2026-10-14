import json
from fetch_data import RAW,fetch,wfs
for f in json.loads((RAW/'mtr-venues.json').read_text())['features']:
 p=f['properties']
 if p['venue_name_en'] in ['Causeway Bay Station','Tseung Kwan O Station']:
  for ft in ['mtr_level_polygon','mtr_opening_line','mtr_amenity_point']:
   d=json.loads(fetch(p['venue_id']+'/'+ft+'.json',wfs(ft,p['venue_id'])).read_text())
   print(p['venue_name_en'],ft,len(d.get('features',[])),flush=True)
