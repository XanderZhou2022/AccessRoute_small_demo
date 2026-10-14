"""Select compact two-floor candidates using geometry, recording build failures."""
import json
from fetch_data import ROOT,RAW
from build_scene_graph import build,write
SLUGS=['shek-kip-mei-services','cheung-sha-wan-government','sha-tin-government','north-point-government','pei-ho-market','java-road-market','kowloon-city-market','sai-ying-pun-complex','pak-tin-complex','tai-po-market','kwai-hing-government','fa-yuen-market']
def main():
 rows=json.loads((ROOT/'data/expansion-candidates.json').read_text()); stations=json.loads((RAW/'mtr-venues.json').read_text())['features'];result=[]
 for row,sid in zip(rows,SLUGS):
  levels=json.loads((RAW/row['venueId']/'level_polygon.json').read_text())['features']
  ground=[f for f in levels if f['properties']['level_short_name_en']=='G/F']
  upper=[f for f in levels if f['properties']['level_short_name_en'] in ['1/F','2/F','UG/F']]
  upper.sort(key=lambda f:(f['properties']['level_short_name_en']!='1/F',f['properties']['level_z_value']))
  s=next(f['properties'] for f in stations if f['properties']['venue_id']==row['stationId']);attempts=[]
  for a in ground:
   for b in upper:
    c={'id':sid,'venue':row['venueId'],'station':row['station'],'stationZh':s['venue_name_zh'],'nameZh':row['nameZh'],'levels':[a['properties']['level_id'],b['properties']['level_id']]}
    try:
     build(c);result.append({'config':c,'status':'built','attempts':attempts});break
    except (ValueError,KeyError,IndexError) as e:
     attempts.append({'levels':c['levels'],'error':str(e)});print(sid,'FAILED',str(e),flush=True)
   else:continue
   break
  else:result.append({'sceneId':sid,'status':'not-built','attempts':attempts})
  write(ROOT/'data/expansion-builds.json',result)
if __name__=='__main__':main()
