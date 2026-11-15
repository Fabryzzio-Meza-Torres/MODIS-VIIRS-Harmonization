"""Carga artefactos a SQLite con transacción y publicación atómica, sin entrenamiento."""
import argparse
import csv
import gzip
import hashlib
import json
import math
import os
from pathlib import Path
import sqlite3
import uuid

SCHEMA='''
CREATE TABLE datasets(name TEXT PRIMARY KEY,payload TEXT NOT NULL);
CREATE TABLE raw(cell_id TEXT NOT NULL,week_start_utc TEXT NOT NULL,platform TEXT NOT NULL,
 raw_count INTEGER NOT NULL CHECK(raw_count>0),coverage_status TEXT NOT NULL,
 PRIMARY KEY(cell_id,week_start_utc,platform));
CREATE TABLE cells(cell_id TEXT PRIMARY KEY);
CREATE TABLE national(week_start_utc TEXT PRIMARY KEY,raw_aqua REAL,raw_snpp REAL,
 aqua_equivalent_estimate REAL,coverage_status TEXT NOT NULL,method_version TEXT NOT NULL);
CREATE TABLE pilot(cell_id TEXT NOT NULL,fire_file TEXT NOT NULL,geo_product TEXT NOT NULL,
 roi_cell_area_km2 REAL NOT NULL,candidate_usable_area_km2 REAL NOT NULL,area_status TEXT NOT NULL,
 PRIMARY KEY(cell_id,fire_file));
CREATE TABLE harmonized(cell_id TEXT NOT NULL,week_start_utc TEXT NOT NULL,
 harmonized_count REAL,lower_bound REAL,upper_bound REAL,
 coverage_status TEXT NOT NULL,estimation_status TEXT NOT NULL,
 platforms_used TEXT NOT NULL,method_version TEXT NOT NULL,source_snapshot_id TEXT NOT NULL,
 PRIMARY KEY(cell_id,week_start_utc));
'''


def optional_float(value):
    if value in (None,''):
        return None
    result=float(value)
    if not math.isfinite(result) or result<0:
        raise ValueError('Valor no finito o negativo en serie.')
    return result


def file_hash(path):
    h=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1048576),b''):
            h.update(block)
    return h.hexdigest()


def build(artifacts, destination):
    artifacts, destination=Path(artifacts),Path(destination).resolve()
    destination.parent.mkdir(parents=True,exist_ok=True)
    temp=destination.with_name(destination.name+'.'+uuid.uuid4().hex+'.tmp')
    inputs={
        'raw':artifacts/'12_cobertura_continuidad/conteos_celda_semana_cuatro_plataformas.csv.gz',
        'baseline':artifacts/'08_armonizacion/serie_nacional_semanal_provisional_2013_2023.csv',
        'pilot':artifacts/'15_georreferenciacion/area_candidata_por_celda_y_granulo.csv',
    }
    snapshot={k:{'file':p.name,'sha256':file_hash(p)} for k,p in inputs.items()}
    db=sqlite3.connect(temp)
    try:
        db.executescript(SCHEMA)
        with gzip.open(inputs['raw'],'rt',encoding='utf-8',newline='') as stream:
            batch=[]
            for row in csv.DictReader(stream):
                batch.append((row['cell_id'],row['week_start_utc'][:10],row['platform'],
                              int(row['raw_count']),row['coverage_status']))
                if len(batch)==5000:
                    db.executemany('INSERT INTO raw VALUES (?,?,?,?,?)',batch); batch=[]
            db.executemany('INSERT INTO raw VALUES (?,?,?,?,?)',batch)
        db.execute('INSERT INTO cells SELECT DISTINCT cell_id FROM raw')
        with inputs['baseline'].open(encoding='utf-8',newline='') as stream:
            for row in csv.DictReader(stream):
                db.execute('INSERT INTO national VALUES (?,?,?,?,?,?)',(
                    row['week_start_utc'][:10],optional_float(row['Aqua']),optional_float(row['Suomi-NPP']),
                    optional_float(row['aqua_equivalent_estimate']),'unknown','baseline-seasonal-viirs-to-aqua-v1'))
        with inputs['pilot'].open(encoding='utf-8',newline='') as stream:
            for r in csv.DictReader(stream):
                db.execute('INSERT INTO pilot VALUES (?,?,?,?,?,?)',(
                    r['cell_id'],r['fire_file'],r['geo_product'],float(r['roi_cell_area_km2']),
                    float(r['candidate_usable_area_km2']),r['area_status']))
        meta=[
            {'name':'raw','status':'observed_sparse','grid_km':10,
             'crs':'+proj=laea +lat_0=-9 +lon_0=-75 +datum=WGS84 +units=m +no_defs',
             'unit':'reported hotspot detections per cell and UTC week by platform',
             'missing_policy':'absent rows are unknown, never confirmed zero',
             'processing':'SP','type':0,'period_start':'2013-01-07','period_end_exclusive':'2024-01-01'},
            {'name':'baseline_national','status':'provisional_baseline','spatial_scope':'Peru national totals only',
             'unit':'Aqua-equivalent weekly reported detections','method_version':'baseline-seasonal-viirs-to-aqua-v1',
             'coverage_corrected':False,'is_common_index':False,'missing_policy':'null stays null'},
            {'name':'coverage_pilot','status':'experimental','period':'2023-08-01 UTC',
             'unit':'km2 per granule, not continuous area-time',
             'validated_production_exposure':False,'may_sum_granules_as_unique_area':False},
            {'name':'harmonized','status':'not_published','method_version':None,
             'estimation_status_values':['estimated','imputed','unavailable'],
             'reason':'Coverage and harmonization method still being validated'},
        ]
        for m in meta:
            m.update(api_schema_version='1',timezone='UTC',end_is_exclusive=True,sources=snapshot)
            db.execute('INSERT INTO datasets VALUES (?,?)',(m['name'],json.dumps(m)))
        db.commit()
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        counts={t:db.execute('SELECT COUNT(*) FROM '+t).fetchone()[0]
                for t in ['raw','cells','national','pilot','harmonized']}
        assert counts['raw']>0 and counts['national']>0 and counts['harmonized']==0
        db.close()
        os.replace(temp,destination)
        return counts
    finally:
        db.close()
        if temp.exists():
            temp.unlink()


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--artifacts',required=True,type=Path)
    parser.add_argument('--database',type=Path,default=Path(__file__).with_name('firms.sqlite'))
    args=parser.parse_args()
    print(json.dumps(build(args.artifacts,args.database),indent=2))
