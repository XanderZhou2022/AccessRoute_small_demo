"""Rebuild and register the curated 12 scenes from frozen, auditable data."""
from fetch_data import ROOT
from build_scene_graph import CONFIGS,build,write
from build_kowloon_tong import build as build_kowloon_tong
from enrich_expansion_scenes import enrich

def main():
 audit=[]
 for c in CONFIGS:
  build(c)
  if c['id'] not in ['hysan-place','popcorn-2']:
   result=enrich(c);audit.append(result)
   if result['status']!='enriched':raise ValueError(result)
 build_kowloon_tong()
 ids=[c['id'] for c in CONFIGS];ids.insert(2,'kowloon-tong-festival-walk')
 assert len(ids)==12 and len(set(ids))==12
 write(ROOT/'data/scenes/index.json',{'schemaVersion':'1.0','scenes':ids})
 write(ROOT/'data/expansion-outdoor-audit.json',audit)
 from build_surroundings import build as build_surroundings
 build_surroundings()
 print('Registered',len(ids),'scenes')
if __name__=='__main__':main()
