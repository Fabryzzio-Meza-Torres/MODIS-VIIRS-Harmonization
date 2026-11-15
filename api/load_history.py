"""Build a read-only query snapshot atomically; no training at request time."""
from pathlib import Path
from contextlib import closing
import argparse,csv,gzip,json,sqlite3,os,hashlib

def read_csv(path):
    opener=gzip.open if str(path).endswith('.gz') else open
    with opener(path,'rt',encoding='utf-8',newline='') as f:yield from csv.DictReader(f)

def number(value,integer=False):
    if value is None or value=='':return None
    return int(float(value)) if integer else float(value)

def load(source,out,regional_assets=None):
    root=Path(source);out=Path(out);staging=out.with_suffix('.building.sqlite')
    if staging.exists():raise RuntimeError('Previous staging exists; inspect it before retrying.')
    with closing(sqlite3.connect(staging)) as db,db:
        db.executescript('''CREATE TABLE metadata(name TEXT PRIMARY KEY,payload TEXT NOT NULL);
        CREATE TABLE cells(cell_id TEXT PRIMARY KEY,center_lon REAL,center_lat REAL,country_area_km2 REAL);
        CREATE TABLE cell_series(cell_id TEXT,week_start_utc TEXT,instrument TEXT,platform TEXT,raw_count INTEGER,harmonized_count REAL,lower_bound REAL,upper_bound REAL,PRIMARY KEY(cell_id,week_start_utc,instrument));
        CREATE TABLE national_series(week_start_utc TEXT,instrument TEXT,platform TEXT,raw_count INTEGER,harmonized_count REAL,lower_bound REAL,upper_bound REAL,coverage_status TEXT,estimation_status TEXT,PRIMARY KEY(week_start_utc,instrument));
        CREATE TABLE forecasts(cell_id TEXT PRIMARY KEY,center_lon REAL,center_lat REAL,country_area_km2 REAL,record_probability REAL,rank INTEGER,target_week_start TEXT,target_week_end TEXT,quality_flag TEXT);
        CREATE INDEX forecast_rank ON forecasts(rank);
        CREATE INDEX cell_geographic ON cells(center_lon,center_lat);''')
        for name,file in [('series',root/'series/series_metadata.json'),('forecast',root/'forecast/forecast_metadata.json')]:
            payload=json.loads(file.read_text(encoding='utf-8'))
            payload['artifact_sha256']=hashlib.sha256(file.read_bytes()).hexdigest()
            db.execute('INSERT INTO metadata VALUES (?,?)',(name,json.dumps(payload)))
        validation={'coverage_corrected':False,'ground_incident_validation_complete':False,
            'calibration_target':'conditional allocation of paired positive counts, not true wildfire counts',
            'calibration_outer':list(read_csv(root/'model/outer_validation.csv')),
            'calibration_final':list(read_csv(root/'model/final_test_2024_2025.csv')),
            'forecast':list(read_csv(root/'forecast/metrics.csv')),
            'forecast_not_uniformly_better_than_climatology':True}
        if (root/'model/uncertainty_correction.json').is_file():
            validation['uncertainty_correction']=json.loads((root/'model/uncertainty_correction.json').read_text())
        external=root.parent/'27_contraste_MINAM'
        if (external/'registry_comparison.json').is_file():
            validation['registry_association']={
                'metadata':json.loads((external/'registry_comparison.json').read_text()),
                'spatiotemporal_associations':list(read_csv(external/'spatiotemporal_associations.csv')),
                'weekly_record_correlations':list(read_csv(external/'weekly_record_correlations.csv'))}
        db.execute('INSERT INTO metadata VALUES (?,?)',('validation',json.dumps(validation)))
        db.executemany('INSERT INTO cells VALUES (?,?,?,?)',((r['cell_id'],number(r['center_lon']),number(r['center_lat']),number(r['country_area_km2'])) for r in read_csv(root/'data/cells.csv')))
        db.executemany('INSERT INTO cell_series VALUES (?,?,?,?,?,?,?,?)',((r['cell_id'],r['week_start_utc'][:10],r['instrument'],r['platform'],number(r['raw_count'],True),number(r['harmonized_count']),number(r['lower_bound']),number(r['upper_bound'])) for r in read_csv(root/'series/cell_series.csv.gz')))
        db.executemany('INSERT INTO national_series VALUES (?,?,?,?,?,?,?,?,?)',((r['week_start_utc'][:10],r['instrument'],r['platform'] or None,number(r['raw_count'],True),number(r['harmonized_count']),number(r['lower_bound']),number(r['upper_bound']),r['coverage_status'],r['estimation_status']) for r in read_csv(root/'series/national_series.csv')))
        db.executemany('INSERT INTO forecasts VALUES (?,?,?,?,?,?,?,?,?)',((r['cell_id'],number(r['center_lon']),number(r['center_lat']),number(r['country_area_km2']),number(r['record_probability']),int(r['rank']),r['target_week_start'],r['target_week_end'],r['quality_flag']) for r in read_csv(root/'forecast/forecast_cells.csv.gz')))
        assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        for table in ['cells','cell_series','national_series','forecasts']:
            print(table,db.execute('SELECT count(*) FROM '+table).fetchone()[0])
    os.replace(staging,out)
    if regional_assets is not None:
        from add_regions import enrich
        enrich(out,regional_assets)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    p.add_argument('--regional-assets',type=Path)
    a=p.parse_args();load(a.source,a.out,a.regional_assets)
