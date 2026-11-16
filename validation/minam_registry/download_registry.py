"""Snapshot of the official MINAM historical registry, with exact object-ID conservation."""
from pathlib import Path
import argparse,hashlib,json,time
from urllib.request import urlopen
from urllib.parse import urlencode
import pandas as pd

BASE='https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer/1'
FIELDS=['OBJECTID_1','ID_RHI','COD_EMERGE','FEC_EMERGE','FEC_TERMIN','FTE_INF','ORIGEN',
        'DES_FUENTE','IMG_','NOMBDEP','INCENDIO','OBSERVACIO','aÑO1','MES1','DIA1']

def get(params):
    for attempt in range(3):
        try:
            with urlopen(BASE+'/query?'+urlencode(params),timeout=60) as r:d=json.load(r)
            if 'error' in d:raise RuntimeError('ArcGIS error '+str(d['error'].get('code')))
            return d
        except Exception:
            if attempt==2:raise
            time.sleep(2**attempt)

def run(out):
    out=Path(out);pages=out/'source_pages';pages.mkdir(exist_ok=True,parents=True)
    idsfile=out/'object_ids.json'
    if not idsfile.is_file():
        idsfile.write_text(json.dumps(get({'where':'1=1','returnIdsOnly':'true','f':'json'})))
    manifest=json.loads(idsfile.read_text());ids=sorted(manifest['objectIds'])
    assert len(ids)==len(set(ids)) and manifest['objectIdFieldName']=='OBJECTID_1'
    records=[]
    for offset in range(0,len(ids),500):
        batch=ids[offset:offset+500];file=pages/f'{offset:06}.json'
        if not file.is_file():
            d=get({'where':f'OBJECTID_1>={batch[0]} AND OBJECTID_1<={batch[-1]}','outFields':','.join(FIELDS),
                'returnGeometry':'true','outSR':4326,'resultRecordCount':1000,'f':'json'})
            file.write_text(json.dumps(d))
        else:d=json.loads(file.read_text())
        assert not d.get('exceededTransferLimit',False)
        entries=d['features']
        assert {e['attributes']['OBJECTID_1'] for e in entries}==set(batch)
        for feature in entries:
            row=feature['attributes'];geo=feature.get('geometry') or {}
            records.append({**row,'longitude':geo.get('x'),'latitude':geo.get('y')})
        print('MINAM',offset+len(batch),'/',len(ids),flush=True)
    frame=pd.DataFrame(records)
    assert frame.OBJECTID_1.is_unique and len(frame)==len(ids)
    path=out/'registry_snapshot.csv.gz';frame.to_csv(path,index=False,compression={'method':'gzip','compresslevel':1,'mtime':0})
    report={'source':BASE,'layer':'Registro histórico de incendios 2000-2025',
        'downloaded_at_utc':pd.Timestamp.now(tz='UTC').isoformat(),'rows':len(frame),
        'object_id_manifest_sha256':hashlib.sha256(idsfile.read_bytes()).hexdigest(),
        'csv_sha256':hashlib.sha256(path.read_bytes()).hexdigest(),'object_ids_complete':True,
        'date_is_registration_or_emergency_not_verified_ignition':True,
        'independence_from_satellite_products_not_established':True,
        'relation_to_user_portal':'official MINAM layer with matching registry title; portal resource inaccessible (403), exact resource identity not yet proven'}
    (out/'snapshot_manifest.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();run(a.out)
