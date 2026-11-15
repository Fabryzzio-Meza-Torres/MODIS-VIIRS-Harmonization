"""Cache NASA POWER observed meteorology at one representative point per region.

Point samples are NOT regional areal means. Historical reanalysis vintages and
publication times are not reconstructed; downstream availability assumptions
must be explicit. No future weather is requested as a forecast covariate.
"""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
import argparse
import hashlib
import json
import sqlite3
import time
import urllib.request
import urllib.parse
import pandas as pd
from shapely.geometry import shape


def download(repo, output, start='20120101', end='20261112'):
    output.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect((repo/'api/history.sqlite').resolve().as_uri()+'?mode=ro',uri=True)) as db:
        regions=pd.read_sql_query('SELECT region_id,name,geometry FROM regions ORDER BY region_id',db)
    rows=[]
    def fetch(region):
        point=shape(json.loads(region.geometry)).representative_point()
        params={'parameters':'T2M,RH2M,PRECTOTCORR,WS2M','community':'AG',
            'longitude':round(point.x,5),'latitude':round(point.y,5),'start':start,
            'end':end,'format':'JSON','time-standard':'UTC'}
        query=urllib.parse.urlencode(params)
        path=output/f'POWER_{region.region_id}_{start}_{end}.json'
        url='https://power.larc.nasa.gov/api/temporal/daily/point?'+query
        if not path.exists():
            for attempt in range(3):
                try:
                    with urllib.request.urlopen(url,timeout=60) as response:
                        data=response.read(16*1024**2)
                    value=json.loads(data)
                    assert set(params['parameters'].split(','))<=set(value['properties']['parameter'])
                    partial=path.with_suffix('.part');partial.write_bytes(data);partial.replace(path)
                    break
                except Exception:
                    if attempt==2:raise
                    time.sleep(1+attempt)
        value=json.loads(path.read_bytes())
        daily=pd.DataFrame(value['properties']['parameter']).rename_axis('date').reset_index()
        daily['date']=pd.to_datetime(daily.date,format='%Y%m%d')
        fields=params['parameters'].split(',')
        daily[fields]=daily[fields].replace(value['header']['fill_value'],float('nan'))
        daily['region_id']=region.region_id
        info={'region_id':region.region_id,'name':region.name,'longitude':point.x,'latitude':point.y,
            'url':url,'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
            'rows':len(daily),'complete_rows':int(daily[fields].notna().all(axis=1).sum()),
            'last_complete_day':str(daily.loc[daily[fields].notna().all(axis=1),'date'].max()),
            'header':value['header'],'parameters':value.get('parameters',{})}
        print(region.region_id,region.name,info['complete_rows'],'complete weather days',flush=True)
        return daily,info
    with ThreadPoolExecutor(max_workers=2) as pool:
        for future in as_completed([pool.submit(fetch,r) for r in regions.itertuples()]):
            daily,info=future.result();rows.append(daily)
            # Append completion log so successful cached work survives a later failure.
            with (output/'download_progress.jsonl').open('a',encoding='utf-8') as stream:
                stream.write(json.dumps(info,ensure_ascii=False)+'\n')
    combined=pd.concat(rows,ignore_index=True).sort_values(['region_id','date'])
    combined.to_csv(output/'regional_point_weather.csv.gz',index=False,
        compression={'method':'gzip','mtime':0})
    complete_log=[json.loads(line) for line in (output/'download_progress.jsonl').read_text(encoding='utf-8').splitlines()]
    latest={item['region_id']:item for item in complete_log}
    manifest={'source':'NASA POWER daily point UTC','region_points':len(latest),
        'parameters':['T2M','RH2M','PRECTOTCORR','WS2M'],
        'spatial_support':'one inside-polygon representative point; not a regional areal mean',
        'forecast_weather':False,'historical_available_at_verified':False,
        'historical_reanalysis_vintages_reconstructed':False,
        'regions':[latest[k] for k in sorted(latest)]}
    (output/'weather_manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf-8')
    print('Cached weather dataset:',len(combined),'rows',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();download(a.repo,a.output)
