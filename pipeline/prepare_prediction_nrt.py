"""One-shot verified NOAA-20 NRT ingestion from the team's original download.

No type=0 is invented for NRT. This does not configure a recurring FIRMS fetch.
"""
from pathlib import Path
from contextlib import closing
from datetime import datetime, timezone
import argparse
import hashlib
import json
import sqlite3
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape


def prepare(repo, originals, reference, output):
    output.mkdir(parents=True,exist_ok=True)
    source=originals/'fire_nrt_J1V-C2_848899_normalized.csv.gz'
    fields=['timestamp_utc','latitude_deg','longitude_deg','frp_mw','source_row',
            'confidence_viirs_category','hotspot_type_code','daynight']
    d=pd.read_csv(source,usecols=fields)
    initial=len(d)
    d['timestamp_utc']=pd.to_datetime(d.timestamp_utc,utc=True,errors='coerce')
    valid=d.timestamp_utc.notna() & d.latitude_deg.between(-90,90) & d.longitude_deg.between(-180,180)
    valid &= np.isfinite(d.frp_mw) & d.frp_mw.ge(0)
    valid &= d.confidence_viirs_category.isin(['nominal','high'])
    d=d.loc[valid].copy()
    before=len(d);d=d.drop_duplicates(['timestamp_utc','latitude_deg','longitude_deg'])
    duplicates=before-len(d)
    frozen=pd.read_csv(reference/'frozen_nonvegetation_cells.csv').source_cell
    cells=np.rint(d.latitude_deg/.005).astype('int64')*1000000+np.rint(d.longitude_deg/.005).astype('int64')
    excluded=cells.isin(frozen)
    known_static_excluded=int(excluded.sum());d=d.loc[~excluded].copy()
    with closing(sqlite3.connect((repo/'api/history.sqlite').resolve().as_uri()+'?mode=ro',uri=True)) as db:
        regions=pd.read_sql_query('SELECT region_id,name,geometry FROM regions ORDER BY region_id',db)
    tree=shapely.STRtree([shape(json.loads(s)) for s in regions.geometry])
    i,j=tree.query(shapely.points(d.longitude_deg.to_numpy(),d.latitude_deg.to_numpy()),predicate='covered_by')
    assignments=pd.DataFrame({'point':i,'region':j}).sort_values(['point','region']).drop_duplicates('point')
    outside=len(d)-len(assignments)
    d=d.iloc[assignments.point].copy()
    d['region_id']=regions.region_id.to_numpy()[assignments.region]
    d['region_name']=regions.name.to_numpy()[assignments.region]
    ingested=datetime.now(timezone.utc)
    assert d.timestamp_utc.le(ingested).all()
    d['platform']='NOAA-20';d['processing']='NRT'
    d['type_unavailable']=d.hotspot_type_code.isna()
    d['ingested_at']=ingested.isoformat()
    d=d.sort_values(['timestamp_utc','source_row'])
    d.to_csv(output/'recent_noaa20_nrt.csv.gz',index=False,compression={'method':'gzip','mtime':0})
    last=d.timestamp_utc.max()
    report={'status':'one_shot_ingestion_verified_not_continuous_refresh','platform':'NOAA-20',
        'source':source.name,'source_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),
        'source_rows':initial,'eligible_rows':len(d),'duplicate_rows_removed':duplicates,
        'known_static_excluded':known_static_excluded,'outside_MINAM_excluded':outside,
        'type_unavailable_rows':int(d.type_unavailable.sum()),'type0_assumed':False,
        'first_acquisition_utc':d.timestamp_utc.min().isoformat(),
        'last_acquisition_utc':last.isoformat(),'ingested_at':ingested.isoformat(),
        'last_acquisition_age_hours':(pd.Timestamp(ingested)-last).total_seconds()/3600,
        'source_latest_acquisition_proves_no_newer_data_exist':False,
        'historical_available_at_known':False,'NRT_SP_transfer_validated':False,
        'automatic_FIRMS_refresh_configured':False,'NRT_used_as_training_label':False,
        'model_trained':False}
    (output/'nrt_ingestion_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--originals',type=Path,required=True)
    p.add_argument('--reference',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();prepare(a.repo,a.originals,a.reference,a.output)
