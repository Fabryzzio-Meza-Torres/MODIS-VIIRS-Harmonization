"""Rebuild inputs from the four original FIRMS ZIPs and the official MINAM service.
No credentials required. Never extracts arbitrary ZIP members onto the filesystem.
"""
from pathlib import Path
import argparse,hashlib,json,zipfile
from urllib.parse import urlencode
from urllib.request import urlopen
import numpy as np
import pandas as pd

SATELLITES={'Terra':'Terra','Aqua':'Aqua','SNPP':'Suomi-NPP','N20':'NOAA-20','N21':'NOAA-21'}
def normalize(zip_folder,artifacts):
    zip_folder,artifacts=Path(zip_folder),Path(artifacts)
    folder=artifacts/'02_preparacion/datos_normalizados';folder.mkdir(parents=True,exist_ok=True)
    records=[]
    for pattern in ['DL_FIRE_M-C61_*.zip','DL_FIRE_J1V-C2_*.zip','DL_FIRE_J2V-C2_*.zip','DL_FIRE_SV-C2_*.zip']:
        choices=list(zip_folder.glob(pattern))
        if len(choices)!=1:raise ValueError(f'Expected exactly one file matching {pattern}, found {len(choices)}')
        path=choices[0]
        with zipfile.ZipFile(path) as archive:
            members=[m for m in archive.namelist() if Path(m).name.startswith('fire_archive_') and m.endswith('.csv')]
            if len(members)!=1:raise ValueError('Expected one SP CSV per ZIP')
            member=members[0]
            with archive.open(member) as stream:d=pd.read_csv(stream)
        assert not d.duplicated().any(),'Duplicate original rows require review.'
        assert d.latitude.between(-90,90).all() and d.longitude.between(-180,180).all()
        assert np.isfinite(d.frp).all() and d.frp.ge(0).all()
        hhmm=d.acq_time.astype('int64').astype(str).str.zfill(4)
        d['timestamp_utc']=pd.to_datetime(d.acq_date+' '+hhmm,format='%Y-%m-%d %H%M',utc=True,errors='raise')
        d['platform']=d.satellite.map(SATELLITES)
        assert d.platform.notna().all(),'Unknown satellite label requires review.'
        d['latitude_deg']=d.latitude;d['longitude_deg']=d.longitude;d['frp_mw']=d.frp
        d['hotspot_type_code']=pd.to_numeric(d['type'],errors='raise')
        d['source_member']=Path(member).name;d['source_row']=np.arange(1,len(d)+1)
        d['processing']='SP'
        out=folder/(Path(member).stem+'_normalized.csv.gz')
        d.to_csv(out,index=False,compression={'method':'gzip','compresslevel':1,'mtime':0})
        records.append({'source_zip':path.name,'source_member':Path(member).name,'processing':'SP',
            'rows':len(d),'output_file':out.relative_to(artifacts/'02_preparacion').as_posix(),
            'source_zip_sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
        print(path.name,len(d),flush=True)
    pd.DataFrame(records).to_csv(artifacts/'02_preparacion/inventario.csv',index=False)

def boundary(artifacts):
    url='https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer/15/query'
    common={'outFields':'*','returnGeometry':'true','outSR':4326,'f':'geojson'}
    def request(params):
        with urlopen(url+'?'+urlencode(params),timeout=120) as response:result=json.load(response)
        assert result.get('type')=='FeatureCollection' and not result.get('exceededTransferLimit',False)
        return result
    country=request({**common,'where':'1=1','maxAllowableOffset':.005,'geometryPrecision':4,'resultRecordCount':1000})
    assert len(country['features'])==25
    refined=request({**common,'where':'OBJECTID_1 IN (21,24)','maxAllowableOffset':.001,'geometryPrecision':6})
    lookup={int(f['id']):f for f in refined['features']};assert set(lookup)=={21,24}
    country['features']=[lookup.get(int(f['id']),f) for f in country['features']]
    folder=Path(artifacts)/'22_limite_peru';folder.mkdir(parents=True,exist_ok=True)
    (folder/'departamentos_minam_malla.geojson').write_text(json.dumps(country),encoding='utf-8')
    (folder/'boundary_source.json').write_text(json.dumps({'service':url,'fetched_at_utc':pd.Timestamp.now(tz='UTC').isoformat(),
        'generalization_degrees':.005,'refined_ids':[21,24],'refined_degrees':.001},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--zip-folder',type=Path,required=True);p.add_argument('--artifacts',type=Path,required=True)
    p.add_argument('--skip-boundary',action='store_true',help='Only when the verified boundary already exists in artifacts.')
    a=p.parse_args();normalize(a.zip_folder,a.artifacts)
    if not a.skip_boundary:boundary(a.artifacts)
