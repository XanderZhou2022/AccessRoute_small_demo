"""Save official baseline; travel mode selected by advertised name, not guessed ID."""
import json, urllib.parse
from fetch_data import RAW,fetch
modes=json.loads((RAW/'travel-modes.json').read_text())['supportedTravelModes']
mode=next(m for m in modes if m['name']=='Barrier Free Path')
stops={'features':[{'attributes':{'Name':'Concourse'},'geometry':{'spatialReference':{'wkid':4326},'x':114.19133,'y':22.32587,'z':-3.61}},{'attributes':{'Name':'Platform'},'geometry':{'spatialReference':{'wkid':4326},'x':114.19156,'y':22.32593,'z':-9.97}}]}
q={'stops':json.dumps(stops),'travelMode':mode['id'],'directionsLanguage':'en','outSR':4326,'f':'json','returnZ':'true','returnDirections':'true','directionsLengthUnits':'esriNAUMeters','directionsStyleName':'NA Campus'}
p=fetch('route-baseline.json','https://mapapi.hkmapservice.gov.hk/PedRoute/NAServer/route/solve?'+urllib.parse.urlencode(q))
x=json.loads(p.read_text()); print('Response keys:',list(x)); print(str(x)[:2500])
