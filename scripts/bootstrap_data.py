"""Acquire top-level official catalogs and MTR CSVs before candidate scanning."""
from fetch_data import fetch, wfs
fetch('venues.json',wfs('venue_polygon'))
fetch('mtr-venues.json',wfs('mtr_venue_polygon'))
fetch('travel-modes.json','https://mapapi.hkmapservice.gov.hk/PedRoute/NAServer/route/retrieveTravelModes?f=json')
for name in ['barrier_free_facilities','barrier_free_facility_category','mtr_lines_and_stations']:
    fetch(name+'.csv','https://opendata.mtr.com.hk/data/'+name+'.csv')
