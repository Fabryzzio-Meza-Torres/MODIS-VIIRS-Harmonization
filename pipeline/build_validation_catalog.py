"""Publish traceable historical associations, including unmatched INDECI references.

Reproduces the frozen 5 km / +/-3 local calendar-day analysis. Never selects
model coefficients, calls a match a verified ignition, or infers sensor omissions.
"""
from pathlib import Path
from datetime import datetime,timezone
from urllib.parse import urlencode
from urllib.request import urlopen
import argparse,gzip,hashlib,json,shutil
import numpy as np
import pandas as pd
from scipy.spatial import cKDTree
from pyproj import Transformer,Geod
import shapely
from shapely.geometry import shape

BASE='https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer/1'
CRS='+proj=laea +lat_0=-9 +lon_0=-75 +datum=WGS84 +units=m +no_defs'
DAY=86400e9

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def load(path):return json.loads(Path(path).read_text(encoding='utf-8'))
def write(path,data):
    Path(path).write_text(json.dumps(data,ensure_ascii=False,separators=(',',':'),allow_nan=False)+'\n',encoding='utf-8',newline='\n')

def write_year(out,year,records):
    file=f'cases-{year}.json'
    write(out/file,{'year':int(year),'data':records})
    compressed=file+'.gz';(out/compressed).write_bytes(gzip.compress((out/file).read_bytes(),mtime=0))
    return {'year':int(year),'file':file,'references':len(records),'sha256':sha(out/file),
        'bytes':(out/file).stat().st_size,'compressed_file':compressed,
        'compressed_bytes':(out/compressed).stat().st_size}

def build(repo,artifacts,out):
    out.mkdir(parents=True,exist_ok=True)
    folder=artifacts/'27_contraste_MINAM'
    provenance=load(folder/'snapshot_manifest.json')
    assert sha(folder/'registry_snapshot.csv.gz')==provenance['csv_sha256']
    raw=pd.read_csv(folder/'registry_snapshot.csv.gz',dtype=str).fillna('')
    raw['OBJECTID_1']=raw.OBJECTID_1.astype(int)
    original=raw.set_index('OBJECTID_1')
    units=pd.read_csv(folder/'audited_registry_units.csv.gz',parse_dates=['event_date'])
    units=units.loc[units.origin.eq('INDECI')].sort_values(['incident_ref','event_date','OBJECTID_1']).reset_index(drop=True)
    assert units.incident_ref.nunique()==15140 and units.OBJECTID_1.is_unique
    project=Transformer.from_crs('EPSG:4326',CRS,always_xy=True)
    x,y=project.transform(units.longitude.to_numpy(),units.latitude.to_numpy())
    centers=pd.DatetimeIndex(units.event_date).as_unit('ns').asi8/DAY+17/24
    events=np.column_stack([x,y,centers]); geod=Geod(ellps='WGS84')
    selection=pd.read_csv(artifacts/'23_demo_historica/series/platform_selection.csv')
    selection['week']=pd.to_datetime(selection.week_start_utc,utc=True)
    selected={(r.week,r.instrument):r.selected_platform for r in selection.itertuples()}
    country=shape(load(artifacts/'23_demo_historica/data/peru.geojson')['geometry'])
    shapely.prepare(country)
    frames=[];source_hashes={}
    inventory=pd.read_csv(artifacts/'02_preparacion/inventario.csv')
    cols=['timestamp_utc','platform','hotspot_type_code','longitude_deg','latitude_deg','source_row','source_member']
    for entry in inventory.query("processing=='SP'").itertuples():
        path=artifacts/'02_preparacion'/entry.output_file.replace('\\','/')
        source_hashes[path.name]=sha(path)
        for chunk in pd.read_csv(path,usecols=cols,chunksize=150000):
            times=pd.to_datetime(chunk.timestamp_utc,utc=True)
            good=times.ge('2012-12-01')&times.lt('2026-02-15')&chunk.hotspot_type_code.eq(0)
            a=chunk.loc[good].copy();times=times.loc[good]
            if a.empty:continue
            a['instrument']=np.where(a.platform.isin(['Terra','Aqua']),'MODIS','VIIRS')
            day=times.dt.floor('D');week=day-pd.to_timedelta(day.dt.dayofweek,unit='D')
            primary=np.array([selected.get((w,i))==p for w,i,p in zip(week,a.instrument,a.platform)])
            inside=shapely.intersects_xy(country,a.longitude_deg,a.latitude_deg)
            a=a.loc[primary&inside].copy();times=times.loc[a.index]
            a['timestamp_utc']=times
            a['normalized_source']=path.name
            frames.append(a)
    points=pd.concat(frames,ignore_index=True)
    print('Selected satellite records:',len(points),flush=True)
    witnesses={'MODIS':{},'VIIRS':{}}
    associations=pd.read_csv(folder/'spatiotemporal_associations.csv')
    for instrument in witnesses:
        cloud=points.loc[points.instrument.eq(instrument)].reset_index(drop=True)
        px,py=project.transform(cloud.longitude_deg.to_numpy(),cloud.latitude_deg.to_numpy())
        pt=pd.DatetimeIndex(cloud.timestamp_utc).as_unit('ns').asi8/DAY
        coordinates=np.column_stack([px,py,pt]);scale=np.array([5000.,5000.,3.5])
        tree=cKDTree(coordinates/scale)
        for start in range(0,len(units),500):
            candidates=tree.query_ball_point(events[start:start+500]/scale,r=1,p=np.inf,workers=1)
            for local,indices in enumerate(candidates):
                if not indices:continue
                ri=start+local;delta=coordinates[indices]-events[ri]
                distance2=delta[:,0]**2+delta[:,1]**2
                valid=(distance2<=5000**2)&(delta[:,2]>=-3.5)&(delta[:,2]<3.5)
                if not valid.any():continue
                valid_indices=np.flatnonzero(valid)
                nearest=valid_indices[np.argmin(distance2[valid_indices])]
                pi=indices[nearest];u=units.iloc[ri];p=cloud.iloc[pi]
                rank=(float(distance2[nearest]),int(u.OBJECTID_1),p.timestamp_utc.isoformat(),int(p.source_row))
                prior=witnesses[instrument].get(u.incident_ref)
                if prior and prior[0]<=rank:continue
                _,_,meters=geod.inv(float(u.longitude),float(u.latitude),float(p.longitude_deg),float(p.latitude_deg))
                local_date=p.timestamp_utc.tz_convert('America/Lima').date()
                witnesses[instrument][u.incident_ref]=(rank,{
                    'instrument':instrument,'platform':p.platform,'timestamp_utc':p.timestamp_utc.isoformat(),
                    'satellite_longitude':float(p.longitude_deg),'satellite_latitude':float(p.latitude_deg),
                    'registry_object_id':int(u.OBJECTID_1),'registry_date':u.event_date.strftime('%Y-%m-%d'),
                    'registry_longitude':float(u.longitude),'registry_latitude':float(u.latitude),
                    'distance_projected_km':float(np.sqrt(distance2[nearest])/1000),
                    'distance_geodesic_km':float(meters/1000),
                    'calendar_day_difference':(local_date-u.event_date.date()).days,
                    'source_member':p.source_member,'source_row':int(p.source_row),
                    'normalized_source':p.normalized_source,'processing':'SP','type':0})
        expected=int(associations.query('origin=="INDECI" and instrument==@instrument and radius_km==5 and date_shift_days==0').with_satellite_record.iloc[0])
        assert len(witnesses[instrument])==expected,(instrument,len(witnesses[instrument]),expected)
        print(instrument,'exactly reproduces',expected,'matched references',flush=True)
    cases=[]
    for ref,g in units.groupby('incident_ref',sort=True):
        first=g.iloc[0];ids=[int(v) for v in g.OBJECTID_1]
        attrs=original.loc[ids]
        matches=[witnesses[i][ref][1] for i in witnesses if ref in witnesses[i]]
        cases.append({'id':ref,'year':int(first.event_date.year),
            'date_start':first.event_date.strftime('%Y-%m-%d'),'date_end':g.event_date.max().strftime('%Y-%m-%d'),
            'departments':sorted(set(v.strip() for v in attrs.NOMBDEP if v.strip())),
            'registry_object_ids':ids,'registry_locations':len(g),
            'reference_codes':sorted(set(v.strip() for v in attrs.COD_EMERGE if v.strip())),
            'source_labels':sorted(set(v.strip() for v in attrs.FTE_INF if v.strip())),
            'registry_longitude':float(first.longitude),'registry_latitude':float(first.latitude),
            'match_status':'both' if len(matches)==2 else 'modis' if matches and matches[0]['instrument']=='MODIS' else 'viirs' if matches else 'none',
            'matches':matches})
    catalog=pd.DataFrame(cases)
    years=[]
    for year,g in catalog.groupby('year'):
        file=f'cases-{year}.json';records=g.sort_values(['date_start','id'],ascending=[False,True]).to_dict('records')
        years.append(write_year(out,year,records))
    # Verify a deterministic sample against the current official service; keep the
    # complete versioned snapshot as the source of the historical calculations.
    sample_ids=units.groupby(units.event_date.dt.year).OBJECTID_1.first().astype(int).tolist()
    query=urlencode({'objectIds':','.join(map(str,sample_ids)),'outFields':'OBJECTID_1,FEC_EMERGE,ORIGEN,NOMBDEP',
                     'returnGeometry':'true','outSR':4326,'f':'json'})
    with urlopen(BASE+'/query?'+query,timeout=40) as response:live=json.load(response)
    assert len(live['features'])==len(sample_ids)
    for feature in live['features']:
        attr=feature['attributes'];src=original.loc[int(attr['OBJECTID_1'])]
        assert attr['ORIGEN']==src.ORIGEN and attr['FEC_EMERGE']==src.FEC_EMERGE and attr['NOMBDEP']==src.NOMBDEP
        assert abs(feature['geometry']['x']-float(src.longitude))<1e-8
        assert abs(feature['geometry']['y']-float(src.latitude))<1e-8
    assets=out/'documents';assets.mkdir(exist_ok=True)
    curimana=load(artifacts/'06_caso_curimana/resultado_curimana.json')
    for item in curimana['document_hashes']:
        src=artifacts/'06_caso_curimana/fuentes'/item['file']
        assert sha(src)==item['sha256'];shutil.copyfile(src,assets/item['file'])
    curimana['report_source']='https://portal.indeci.gob.pe/wp-content/uploads/2019/09/REPORTE-COMPLEMENTARIO-N%C2%BA-2027-06SEP2019-INCENDIO-FORESTAL-EN-EL-DISTRITO-DE-CURIMANA-UCAYALI-02.pdf'
    curimana['ANA_source']='https://www.ana.gob.pe/sites/default/files/normatividad/files/001-RESOLUCI%C3%93N%20DIRECTORAL%20N%C2%B0%20103-2019-ANA-AAA.U.pdf'
    scores=pd.read_csv(repo/'reports/prediction/model/evaluation_metrics.csv')
    model=scores.loc[scores.scope.eq('all_regions')&scores.calibrated&scores.model.isin(['climatology','lgbm_without_harmonization'])]
    summary={'schema_version':'1.0','generated_at':datetime.now(timezone.utc).isoformat(),
        'source_url':BASE,'source_snapshot':provenance,'period_start':'2013-01-07','period_end':'2025-12-31',
        'primary_window':{'radius_km':5,'calendar_day_half_window':3,'distance_method':CRS},
        'catalog_origin':'INDECI','catalog_references':len(cases),'catalog_locations':len(units),
        'catalog_status_counts':catalog.match_status.value_counts().to_dict(),
        'years':years,'departments':sorted({d for c in cases for d in c['departments']}),
        'associations':associations.to_dict('records'),
        'correlations':pd.read_csv(folder/'weekly_record_correlations.csv').to_dict('records'),
        'registry_audit':load(folder/'registry_comparison.json'),'satellite_sources_sha256':source_hashes,
        'live_source_verification':{'checked_at':datetime.now(timezone.utc).isoformat(),'sample_rows':len(sample_ids),
            'object_ids':sample_ids,'fields_and_geometry_match':True,'all_rows_checked_live':False},
        'case_study':curimana,
        'model_evaluation':model[['period','model','brier','rows','positive_fraction']].to_dict('records'),
        'onset_pilot_diagnostic':load(repo/'reports/prediction/onset_evidence_report.json'),
        'interpretation':{'association_is_verified_attribution':False,'unmatched_is_proven_omission':False,
            'ground_incident_independence_established':False,'physical_ignition_forecast_validated':False,
            'registry_is_count_of_independent_physical_fires':False}}
    write(out/'summary.json',summary)
    print(json.dumps({'references':len(cases),'status_counts':summary['catalog_status_counts'],
        'year_files':len(years),'live_samples':len(sample_ids),'summary_sha256':sha(out/'summary.json')},indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--artifacts',type=Path,required=True)
    args=p.parse_args();build(args.repo,args.artifacts,args.repo/'web/validation-data')
