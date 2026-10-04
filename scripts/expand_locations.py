"""Download a bounded, theme-led shortlist. Raw official responses are retained.
Run acquisition explicitly; never treat catalogue presence as route readiness.
"""
import json
from fetch_data import ROOT, RAW, fetch, wfs

NAMES = [
 'Shek Kip Mei Estate Ancillary Facilities Block',
 'Cheung Sha Wan Government Offices', 'Sha Tin Government Offices',
 'North Point Government Offices', 'Pei Ho Street Municipal Services Building',
 'Java Road Municipal Services Building', 'Kowloon City Municipal Services Building',
 'Sai Ying Pun Community Complex', 'Pak Tin Community Complex',
 'Tai Po Hui Market and Cooked Food Centre',
 'Kwai Hing Government Offices', 'Fa Yuen Street Municipal Services Building',
]

def center(p):
 b=p['bbox']; return ((b[0]+b[2])/2,(b[1]+b[3])/2)

def acquire():
 venues=json.loads((RAW/'expansion-20261004/venues.json').read_text())['features']
 stations=json.loads((RAW/'mtr-venues.json').read_text())['features']
 rows=[]
 for name in NAMES:
  f=next(v for v in venues if v['properties']['venue_name_en']==name)
  p=f['properties'];vid=p['venue_id']; x,y=center(p)
  s=min(stations,key=lambda v:((center(v['properties'])[0]-x)*103000)**2+((center(v['properties'])[1]-y)*111000)**2)['properties']
  row={'venueId':vid,'name':name,'nameZh':p['venue_name_zh'],'district':p['address_locality'],'station':s['venue_name_en'],'stationId':s['venue_id'],'counts':{}}
  for ft in ['level_polygon','unit_polygon','opening_line','amenity_point','occupant_point']:
   d=json.loads(fetch(vid+'/'+ft+'.json',wfs(ft,vid)).read_text())
   if d.get('type')!='FeatureCollection':raise ValueError((name,ft,d))
   count=len(d['features']);total=d.get('totalFeatures',count)
   row['counts'][ft]={'returned':count,'total':total,'complete':count==total}
   print(name,ft,count,'/',total,flush=True)
  for ft in ['mtr_level_polygon','mtr_opening_line','mtr_amenity_point']:
   d=json.loads(fetch(s['venue_id']+'/'+ft+'.json',wfs(ft,s['venue_id'])).read_text())
   if d.get('type')!='FeatureCollection':raise ValueError((s['venue_name_en'],ft,d))
  rows.append(row)
  (ROOT/'data/expansion-candidates.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2))
 # Requested priority area: preserve station data even if mall is absent.
 s=next(v['properties'] for v in stations if v['properties']['venue_name_en']=='Kowloon Tong Station')
 for ft in ['mtr_level_polygon','mtr_opening_line','mtr_amenity_point']:
  fetch(s['venue_id']+'/'+ft+'.json',wfs(ft,s['venue_id']))

if __name__=='__main__':acquire()
