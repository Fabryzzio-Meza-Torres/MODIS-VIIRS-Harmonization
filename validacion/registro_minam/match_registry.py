"""Retrospective association with an official registry, not an omission-rate test.
Fixed primary window: 5km and +/-3 calendar days. Sensitivity: 10km/3d,
25km/7d. Temporal controls: +/-28d. No model coefficients are selected here.
"""
from pathlib import Path
import argparse,hashlib,json
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from scipy.stats import pearsonr,spearmanr
from pyproj import Transformer
import shapely
from shapely.geometry import shape

CRS='+proj=laea +lat_0=-9 +lon_0=-75 +datum=WGS84 +units=m +no_defs'
MAX_RADIUS_M=25000.
MAX_TIME_DAYS=7.5
WINDOWS=[(5000.,3),(10000.,3),(25000.,7)]
SHIFTS=[0,-28,28]

def utc_days(values):
    index=pd.DatetimeIndex(pd.to_datetime(values,utc=True))
    if index.hasnans:raise ValueError('Missing timestamps cannot be matched.')
    return index.as_unit('ns').asi8/86400e9

def match_points(tree,point_data,events):
    """events columns x/y and local-date noon in UTC fractional days.
    point_data columns x/y/UTC fractional days. Filters circular spatial support
    after a sup-norm tree candidate query; time is calendar-day support.
    """
    output=np.zeros((len(events),len(WINDOWS)),dtype=bool)
    for start in range(0,len(events),500):
        batch=events[start:start+500]
        candidates=tree.query_ball_point(batch/[MAX_RADIUS_M,MAX_RADIUS_M,MAX_TIME_DAYS],
                                         r=1.,p=np.inf,workers=1)
        for i,indices in enumerate(candidates):
            if not indices:continue
            delta=point_data[indices]-batch[i]
            distance2=delta[:,0]**2+delta[:,1]**2;time=delta[:,2]
            for k,(radius,window) in enumerate(WINDOWS):
                output[start+i,k]=np.any((distance2<=radius**2)&
                    (time>=-(window+.5))&(time<window+.5))
    return output

def run(artifacts,out):
    artifacts,out=Path(artifacts),Path(out);out.mkdir(exist_ok=True,parents=True)
    source=out/'registry_snapshot.csv.gz'
    raw=pd.read_csv(source,dtype=str,low_memory=False)
    d=raw.copy()
    d['date_text']=d.FEC_EMERGE.str.strip()
    d['date_text']=d.date_text.str.replace(r'^(\d{2})-(\d{2})-(\d{4})$',r'\1/\2/\3',regex=True)
    d['event_date']=pd.to_datetime(d.date_text,format='%d/%m/%Y',errors='coerce')
    components={name:pd.to_numeric(d[field].str.strip(),errors='coerce') for name,field in
                [('year','aÑO1'),('month','MES1'),('day','DIA1')]}
    structured=pd.to_datetime(pd.DataFrame(components),errors='coerce')
    d['date_conflict']=d.event_date.notna()&structured.notna()&d.event_date.ne(structured)
    d['date_from_components']=d.event_date.isna()&structured.notna()
    d['event_date']=d.event_date.fillna(structured)
    date_quality={'conflicting_date_fields_excluded':int(d.date_conflict.sum()),
        'dates_repaired_from_components':int(d.date_from_components.sum()),
        'dates_unresolved':int(d.event_date.isna().sum())}
    d['longitude']=pd.to_numeric(d.longitude,errors='coerce')
    d['latitude']=pd.to_numeric(d.latitude,errors='coerce')
    coordinates=d.longitude.between(-180,180)&d.latitude.between(-90,90)
    country=shape(json.loads((artifacts/'23_demo_historica/data/peru.geojson').read_text())['geometry'])
    shapely.prepare(country)
    d['within_country']=False
    d.loc[coordinates,'within_country']=shapely.intersects_xy(country,d.loc[coordinates,'longitude'],d.loc[coordinates,'latitude'])
    eligible=d.event_date.between('2013-01-07','2025-12-31')&~d.date_conflict&d.within_country
    d=d.loc[eligible].copy()
    d['origin']=d.ORIGEN.fillna('unknown').str.strip().str.upper()
    code=d.COD_EMERGE.fillna('').str.strip()
    valid_code=code.str.fullmatch(r'\d{5,}').fillna(False)&~code.str.fullmatch(r'0+').fillna(False)
    # One incident reference may have many mapped locations. Keep their geometry,
    # but aggregate matches by reference so one code is not counted as many fires.
    fallback=d.event_date.dt.strftime('%Y-%m-%d')+'|'+d.longitude.astype(str)+'|'+d.latitude.astype(str)
    d['incident_ref']=np.where(valid_code,d.origin+'|code|'+code,d.origin+'|location_date|'+fallback)
    before=len(d)
    d=d.drop_duplicates(['incident_ref','event_date','longitude','latitude']).reset_index(drop=True)
    span=d.groupby('incident_ref').event_date.agg(['min','max'])
    ambiguous=set(span.index[(span['max']-span['min']).dt.days>30])
    d=d.loc[~d.incident_ref.isin(ambiguous)].reset_index(drop=True)
    project=Transformer.from_crs('EPSG:4326',CRS,always_xy=True)
    x,y=project.transform(d.longitude.to_numpy(),d.latitude.to_numpy())
    # Source dates have no timestamp/zone: assume Peru local calendar date and
    # match full local calendar-day windows, not an invented precise ignition hour.
    centers=utc_days(d.event_date)+17/24
    events=np.column_stack([x,y,centers])
    choices=pd.read_csv(artifacts/'23_demo_historica/series/platform_selection.csv')
    choices['week']=pd.to_datetime(choices.week_start_utc,utc=True)
    selected={(r.week,r.instrument):r.selected_platform for r in choices.itertuples()}
    inventory=pd.read_csv(artifacts/'02_preparacion/inventario.csv')
    observations=[]
    columns=['timestamp_utc','platform','hotspot_type_code','longitude_deg','latitude_deg']
    for row in inventory.query("processing=='SP'").itertuples():
        path=artifacts/'02_preparacion'/row.output_file.replace('\\','/')
        for chunk in pd.read_csv(path,usecols=columns,chunksize=150000):
            t=pd.to_datetime(chunk.timestamp_utc,utc=True)
            use=t.ge('2012-12-01')&t.lt('2026-02-15')&chunk.hotspot_type_code.eq(0)
            a=chunk.loc[use].copy();t=t.loc[use]
            if a.empty:continue
            a['instrument']=np.where(a.platform.isin(['Terra','Aqua']),'MODIS','VIIRS')
            day=t.dt.floor('D');week=day-pd.to_timedelta(day.dt.dayofweek,unit='D')
            primary=np.array([selected.get((w,i))==p for w,i,p in zip(week,a.instrument,a.platform)])
            inside=shapely.intersects_xy(country,a.longitude_deg,a.latitude_deg)
            a=a.loc[primary&inside].copy();t=t.loc[a.index]
            if a.empty:continue
            xx,yy=project.transform(a.longitude_deg.to_numpy(),a.latitude_deg.to_numpy())
            a['x']=xx;a['y']=yy;a['utc_days']=utc_days(t)
            observations.append(a[['instrument','x','y','utc_days']])
    points=pd.concat(observations,ignore_index=True)
    records=[]
    for instrument in ['MODIS','VIIRS']:
        cloud=points.loc[points.instrument.eq(instrument),['x','y','utc_days']].to_numpy()
        tree=cKDTree(cloud/[MAX_RADIUS_M,MAX_RADIUS_M,MAX_TIME_DAYS])
        for shift in SHIFTS:
            shifted=events.copy();shifted[:,2]+=shift
            result=match_points(tree,cloud,shifted)
            for k,(radius,window) in enumerate(WINDOWS):
                rows=pd.DataFrame({'incident_ref':d.incident_ref,'origin':d.origin,'match':result[:,k]})
                incidents=rows.groupby(['origin','incident_ref'],as_index=False).match.any()
                for origin,g in incidents.groupby('origin'):
                    records.append({'instrument':instrument,'origin':origin,'radius_km':radius/1000,
                        'calendar_day_half_window':window,'date_shift_days':shift,'incident_references':len(g),
                        'with_satellite_record':int(g.match.sum()),'association_fraction':float(g.match.mean())})
            print(instrument,'shift',shift,'done',flush=True)
    summary=pd.DataFrame(records);summary.to_csv(out/'spatiotemporal_associations.csv',index=False)
    # Record-count correlation is descriptive. A constant positive response factor
    # leaves correlation unchanged; it cannot validate a harmonization by itself.
    incident=d.groupby(['origin','incident_ref'],as_index=False).event_date.min()
    incident['week_start_utc']=incident.event_date-pd.to_timedelta(incident.event_date.dt.dayofweek,unit='D')
    indeci=incident.loc[incident.origin.eq('INDECI')].groupby('week_start_utc').size()
    national=pd.read_csv(artifacts/'23_demo_historica/series/national_series.csv',parse_dates=['week_start_utc'])
    national['week_start_utc']=national.week_start_utc.dt.tz_localize(None)
    correlation=[]
    for instrument,anchor in [('MODIS','Aqua'),('VIIRS','Suomi-NPP')]:
        n=national.loc[national.instrument.eq(instrument)&national.platform.eq(anchor)&
            national.week_start_utc.between('2013-01-07','2025-12-22')].copy()
        n['registry_references']=n.week_start_utc.map(indeci).fillna(0).astype(int)
        for period,start,end in [('development',2013,2021),('validation',2022,2023),('final',2024,2025)]:
            g=n.loc[n.week_start_utc.dt.year.between(start,end)]
            for value in ['raw_count','harmonized_count']:
                a=g[value].to_numpy();b=g.registry_references.to_numpy()
                correlation.append({'instrument':instrument,'period':period,'variable':value,'weeks':len(g),
                    'pearson':float(pearsonr(a,b).statistic),'spearman':float(spearmanr(np.round(a,6),b).statistic)})
    pd.DataFrame(correlation).to_csv(out/'weekly_record_correlations.csv',index=False)
    d[['OBJECTID_1','incident_ref','origin','event_date','longitude','latitude','date_from_components']].to_csv(out/'audited_registry_units.csv.gz',index=False)
    report={'source':json.loads((out/'snapshot_manifest.json').read_text())['source'],
        'snapshot_sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'source_rows':len(raw),
        'common_period':'2013-01-07 to 2025-12-31','eligible_rows_before_exact_dedup':before,
        'audited_geographic_rows':len(d),'incident_references':d.incident_ref.nunique(),
        'source_date_conflicts':int((pd.to_datetime(raw.FEC_EMERGE.str.strip(),format='%d/%m/%Y',errors='coerce').notna()).sum()),
        'ambiguous_references_over_30_days_excluded':len(ambiguous),
        'primary_window':{'radius_km':5,'calendar_day_half_window':3},
        'date_zone_assumption':'Peru local calendar day (UTC-5); full day uncertainty preserved',
        'geolocation_is_verified_ignition_location':False,'unmatched_is_proven_omission':False,
        'ground_incident_independence_established':False,'coverage_corrected':False,
        'satellite_point_selection':'same one platform per instrument/country/week as the published empirical series',
        'source_groups_not_pooled':True,'satellite_points_indexed':points.groupby('instrument').size().to_dict(),
        'date_quality':date_quality,'spearman_rank_rounding_decimals':6,
        'temporal_controls':'same locations shifted -28 and +28 calendar days; not true fire-free controls',
        'model_changed_from_registry_results':False,'correlation_validates_global_scale':False,
        'registry_geometry_note':'mapped points can represent affected areas or reporting locations; code groups can have many locations'}
    # Preserve exact date-quality counts, rather than calling all parseable dates conflicts.
    original=pd.to_datetime(raw.FEC_EMERGE.str.strip(),format='%d/%m/%Y',errors='coerce')
    report['raw_dates_not_strictly_parseable']=int(original.isna().sum())
    report.pop('source_date_conflicts')
    (out/'registry_comparison.json').write_text(json.dumps(report,indent=2))
    print(summary.loc[summary.date_shift_days.eq(0)].to_string(index=False))
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--artifacts',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();run(a.artifacts,a.out)
