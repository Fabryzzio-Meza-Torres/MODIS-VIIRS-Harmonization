"""Detection-limit diagnostics on development data only. No count inversion."""
from pathlib import Path
import argparse,hashlib,json
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape
from frp_operator import parameters,response_weight,COEFFICIENTS,SOURCE

def audit(artifacts,out):
    artifacts,out=Path(artifacts),Path(out);out.mkdir(exist_ok=True,parents=True)
    country=shape(json.loads((artifacts/'23_demo_historica/data/peru.geojson').read_text())['geometry'])
    shapely.prepare(country)
    inventory=pd.read_csv(artifacts/'02_preparacion/inventario.csv')
    records=[]
    columns=['timestamp_utc','platform','latitude_deg','longitude_deg','hotspot_type_code','frp_mw','scan','track','daynight']
    for row in inventory.query("processing=='SP'").itertuples():
        source=artifacts/'02_preparacion'/row.output_file.replace('\\','/')
        for chunk in pd.read_csv(source,usecols=columns,chunksize=150000):
            t=pd.to_datetime(chunk.timestamp_utc,utc=True)
            use=t.ge('2013-01-07')&t.lt('2022-01-01')&chunk.hotspot_type_code.eq(0)
            d=chunk.loc[use].copy()
            if d.empty:continue
            inside=shapely.intersects_xy(country,d.longitude_deg,d.latitude_deg);d=d.loc[inside].copy()
            if d.empty:continue
            d['instrument']=np.where(d.platform.isin(['Aqua','Terra']),'MODIS','VIIRS')
            d['area_km2']=d.scan*d.track
            midpoint,rate,cutoff=parameters(d.area_km2,d.instrument,d.daynight)
            d['table_midpoint_mw']=midpoint
            d['response_factor_on_reported_frp']=response_weight(d.frp_mw,d.area_km2,d.instrument,d.daynight)
            d['below_midpoint']=d.frp_mw<midpoint;d['zero_frp']=d.frp_mw.eq(0)
            records.append(d[['platform','daynight','frp_mw','area_km2','table_midpoint_mw',
                              'response_factor_on_reported_frp','below_midpoint','zero_frp']])
    points=pd.concat(records,ignore_index=True)
    summary=points.groupby(['platform','daynight']).agg(reported_detections=('frp_mw','size'),
        frp_median_mw=('frp_mw','median'),area_median_km2=('area_km2','median'),
        table_midpoint_median_mw=('table_midpoint_mw','median'),
        reported_share_below_table_midpoint=('below_midpoint','mean'),reported_zero_frp_share=('zero_frp','mean'),
        median_response_factor_on_reported_frp=('response_factor_on_reported_frp','median')).reset_index()
    summary.to_csv(out/'development_detection_limit_diagnostics.csv',index=False)
    specs={}
    for sensor,area in [('MODIS',1.),('VIIRS',.375**2)]:
        for dn in ['D','N']:
            midpoint,rate,cutoff=parameters(area,sensor,dn)
            specs[sensor+'_'+dn]={'assumed_pixel_area_km2':area,'table_midpoint_mw':float(midpoint),
                'rate_inverse_mw':float(rate),'cutoff':float(cutoff)}
    report={'status':'research_diagnostic_not_production','source':SOURCE,
        'coefficient_source':'published XLSX Tables 1 and 2; independently parsed',
        'coefficient_tuples':{s+'_'+dn:list(v) for (s,dn),v in COEFFICIENTS.items()},
        'table_file_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.glob('table*.xlsx')},
        'development_period':'2013-01-07 to 2021-12-31','reported_points_audited':len(points),
        'final_test_2024_2025_used':False,'national_series_changed':False,
        'paper_text_consistency':{'table_evaluations':specs,
            'abstract_MODIS_clear_night_nadir_mw':3.7,
            'MODIS_table_night_at_1km2_mw':5.44,
            'disagreement_unresolved':True,
            'no_silent_replacement_of_published_table_coefficients':True},
        'eq6_A0_assumption_km2':0.,'pixel_area_proxy':'FIRMS rounded scan*track in km2',
        'diagnostic_is_omission_probability':False,'inverse_probability_count_correction_performed':False,
        'warnings':['FRP is already selection-censored; response values on reported points cannot recover omitted fires',
            'Numerical behavior of equations is tested; physical calibration for Peru remains unvalidated',
            'No historical exposure mask or independent ignition truth is inferred from this diagnostic']}
    (out/'operator_audit.json').write_text(json.dumps(report,indent=2))
    print(summary.to_string(index=False));print('Research-only. No production series changed.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--artifacts',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();audit(a.artifacts,a.out)
