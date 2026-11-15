"""Atomically add regional series and SQLite spatial/temporal indexes to a snapshot."""
from pathlib import Path
from contextlib import closing
import argparse,csv,gzip,json,os,sqlite3

def enrich(database,assets):
    database,assets=Path(database).resolve(),Path(assets)
    staging=database.with_name(database.stem+'.regions-building.sqlite')
    if staging.exists():raise RuntimeError('Inspect the existing regional staging file before retrying.')
    with closing(sqlite3.connect(database.as_uri()+'?mode=ro',uri=True)) as source,closing(sqlite3.connect(staging)) as db:
        source.backup(db)
        db.execute('PRAGMA foreign_keys=ON')
        info=json.loads((assets/'regional_metadata.json').read_text())
        base=json.loads(db.execute("SELECT payload FROM metadata WHERE name='series'").fetchone()[0])
        if info.get('source_snapshot_id') and info['source_snapshot_id']!=base.get('source_snapshot_id'):
            raise ValueError('Regional assets and base snapshot refer to different source/model versions.')
        with db:
            for table in ['region_spatial_index','cell_spatial_index','region_cells','regional_series','regions']:
                db.execute('DROP TABLE IF EXISTS '+table)
            db.executescript('''CREATE TABLE regions(id INTEGER PRIMARY KEY,region_id TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,geometry TEXT NOT NULL,min_lon REAL,max_lon REAL,min_lat REAL,max_lat REAL);
                CREATE VIRTUAL TABLE region_spatial_index USING rtree(id,min_lon,max_lon,min_lat,max_lat);
                CREATE VIRTUAL TABLE cell_spatial_index USING rtree(id,min_lon,max_lon,min_lat,max_lat);
                CREATE TABLE region_cells(region_id TEXT,cell_id TEXT,overlap_area_km2 REAL CHECK(overlap_area_km2>0),
                    PRIMARY KEY(region_id,cell_id),
                    FOREIGN KEY(region_id) REFERENCES regions(region_id),
                    FOREIGN KEY(cell_id) REFERENCES cells(cell_id));
                CREATE INDEX region_cells_by_cell ON region_cells(cell_id,region_id);
                CREATE TABLE regional_series(region_id TEXT,week_start_utc TEXT,instrument TEXT,
                    platform TEXT,raw_count INTEGER,harmonized_count REAL,lower_bound REAL,upper_bound REAL,
                    coverage_status TEXT,estimation_status TEXT,
                    PRIMARY KEY(region_id,week_start_utc,instrument),
                    FOREIGN KEY(region_id) REFERENCES regions(region_id),
                    CHECK(raw_count>0 AND lower_bound>=0 AND lower_bound<=harmonized_count AND harmonized_count<=upper_bound));
                CREATE INDEX regional_instrument_time ON regional_series(region_id,instrument,week_start_utc);''')
            if 'spatial_id' not in [r[1] for r in db.execute('PRAGMA table_info(cells)')]:
                db.execute('ALTER TABLE cells ADD COLUMN spatial_id INTEGER')
            db.execute('UPDATE cells SET spatial_id=rowid')
            db.execute('CREATE UNIQUE INDEX IF NOT EXISTS cell_spatial_id ON cells(spatial_id)')
            db.execute('''INSERT INTO cell_spatial_index SELECT spatial_id,center_lon,center_lon,
                          center_lat,center_lat FROM cells''')
            from shapely.geometry import shape
            catalog=json.loads((assets/'regions.geojson').read_text(encoding='utf-8'))
            for index,feature in enumerate(catalog['features'],1):
                g=shape(feature['geometry']);west,south,east,north=g.bounds
                p=feature['properties']
                db.execute('INSERT INTO regions VALUES (?,?,?,?,?,?,?,?)',
                    (index,p['region_id'],p['name'],json.dumps(feature['geometry']),west,east,south,north))
                db.execute('INSERT INTO region_spatial_index VALUES (?,?,?,?,?)',(index,west,east,south,north))
            with (assets/'region_cells.csv').open(encoding='utf-8',newline='') as stream:
                db.executemany('INSERT INTO region_cells VALUES (?,?,?)',
                    ((r['region_id'],r['cell_id'],float(r['overlap_area_km2'])) for r in csv.DictReader(stream)))
            with gzip.open(assets/'regional_series.csv.gz','rt',encoding='utf-8',newline='') as stream:
                db.executemany('INSERT INTO regional_series VALUES (?,?,?,?,?,?,?,?,?,?)',
                    ((r['region_id'],r['week_start_utc'][:10],r['instrument'],r['platform'],
                      int(r['raw_count']),float(r['harmonized_count']),float(r['lower_bound']),
                      float(r['upper_bound']),r['coverage_status'],r['estimation_status']) for r in csv.DictReader(stream)))
            # Regional aggregation must conserve country counts and estimates at every week.
            mismatch=db.execute('''SELECT count(*) FROM (
                SELECT n.week_start_utc,n.instrument,n.raw_count AS expected,n.harmonized_count AS estimate,
                       sum(r.raw_count) AS actual,sum(r.harmonized_count) AS actual_estimate
                FROM national_series n LEFT JOIN regional_series r
                ON r.week_start_utc=n.week_start_utc AND r.instrument=n.instrument
                WHERE n.raw_count IS NOT NULL GROUP BY n.week_start_utc,n.instrument
                HAVING actual IS NULL OR actual!=expected OR abs(actual_estimate-estimate)>1e-7
            )''').fetchone()[0]
            if mismatch:raise ValueError('Regional totals differ from the country series.')
            extra=db.execute('''SELECT count(*) FROM regional_series r LEFT JOIN national_series n
                ON n.week_start_utc=r.week_start_utc AND n.instrument=r.instrument
                WHERE n.raw_count IS NULL''').fetchone()[0]
            if extra:raise ValueError('Regional series contains dates/instruments absent from the country snapshot.')
            info.update(spatial_index='SQLite R*Tree candidates plus exact polygon containment',
                temporal_index='regional_series(region_id,instrument,week_start_utc)',
                schema_version='regional-query-v1',region_interval_kind='calibration-factor uncertainty only')
            db.execute('INSERT OR REPLACE INTO metadata VALUES (?,?)',('regions',json.dumps(info)))
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('SQLite integrity check failed')
        print('Regions',db.execute('SELECT count(*) FROM regions').fetchone()[0],
              'regional weeks',db.execute('SELECT count(*) FROM regional_series').fetchone()[0])
    os.replace(staging,database)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--database',required=True,type=Path);p.add_argument('--assets',required=True,type=Path)
    a=p.parse_args();enrich(a.database,a.assets)
