import json,urllib.parse
from fetch_data import ROOT,RAW,fetch
modes=json.loads((RAW/'travel-modes.json').read_text())['supportedTravelModes'];mode=next(m for m in modes if m['name']=='Barrier Free Path')
for sid in ['hysan-place','popcorn-2']:
 graph=json.loads((ROOT/'data/scenes'/sid/'graph.json').read_text());nodes={n['id']:n for n in graph['nodes']};e=graph['edges'][-1];stops={'features':[{'geometry':{'x':nodes[n]['lon'],'y':nodes[n]['lat'],'spatialReference':{'wkid':4326}}} for n in [e['from'],e['to']]]}
 q={'stops':json.dumps(stops),'travelMode':mode['id'],'returnZ':'true','returnDirections':'true','directionsLanguage':'en','outSR':4326,'f':'json'}
 p=fetch(sid+'-outdoor-route.json','https://mapapi.hkmapservice.gov.hk/PedRoute/NAServer/route/solve?'+urllib.parse.urlencode(q));d=json.loads(p.read_text());print(sid,list(d),d.get('error',''))
