"""Two empirical instrument series. Archive gaps remain unavailable, not zero fire."""
from pathlib import Path
import argparse,hashlib,json
import numpy as np
import pandas as pd
from calibration import PLATFORMS,log_response

def export(source,model_folder,out):
    source,model_folder,out=Path(source),Path(model_folder),Path(out)
    out.mkdir(parents=True,exist_ok=True)
    model=json.loads((model_folder/'model.json').read_text())
    preparation=json.loads((source/'preparation.json').read_text())
    factors=pd.read_csv(model_folder/'calibration_factors.csv')
    draws=np.load(model_folder/'bootstrap_parameters.npz')['theta']
    observations=pd.read_csv(source/'observations.csv.gz',parse_dates=['week_start_utc'])
    cells=pd.read_csv(source/'cells.csv')
    snapshot=hashlib.sha256((json.dumps(preparation,sort_keys=True)+json.dumps(model,sort_keys=True)).encode()).hexdigest()
    d=observations.merge(cells[['cell_id','center_lat','ix','iy']],on='cell_id',validate='many_to_one')
    d['month']=(d.week_start_utc+pd.Timedelta(days=3)).dt.month
    d['latitude_band']=np.where(d.center_lat>-6,'north',np.where(d.center_lat<-12,'south','central'))
    d=d.merge(factors,on=['platform','month','latitude_band'],validate='many_to_one')
    assert d.factor.notna().all()
    d['instrument']=np.where(d.platform.isin(['Terra','Aqua']),'MODIS','VIIRS')
    d['harmonized_count']=d.raw_count*d.factor
    d['lower_bound']=d.raw_count*d.factor_low
    d['upper_bound']=d.raw_count*d.factor_high
    d['estimation_status']='estimated'
    d['method_version']=model['version']
    d['source_snapshot_id']=snapshot
    d['coverage_corrected']=False
    def period_status(weeks):
        return np.select([weeks<pd.Timestamp('2002-07-08',tz='UTC'),
            weeks<pd.Timestamp('2012-02-06',tz='UTC'),weeks>=pd.Timestamp('2026-01-01',tz='UTC')],
            ['pre_Aqua_bridge_extrapolation','pre_VIIRS_reference_extrapolation','post_validation_extrapolation'],default='historical_overlap')
    d['calibration_period_status']=period_status(d.week_start_utc)
    present=d.groupby(['week_start_utc','platform']).size().unstack('platform').reindex(columns=PLATFORMS)
    calendar=pd.date_range('2000-11-06','2026-07-20',freq='7D',tz='UTC')
    choices=[]
    for week in calendar:
        available=set(present.columns[present.loc[week].notna()]) if week in present.index else set()
        for instrument,priority in [('MODIS',['Aqua','Terra']),('VIIRS',['Suomi-NPP','NOAA-20','NOAA-21'])]:
            eligible=[p for p in priority if p in available and not (p=='Terra' and week.year>=2024)]
            selected=eligible[0] if eligible else None
            choices.append({'week_start_utc':week,'instrument':instrument,'selected_platform':selected,
                            'is_fallback':selected is not None and selected!=priority[0],
                            'selection_reason':'anchor_has_country_records' if selected==priority[0] else
                            ('anchor_without_country_records' if selected else 'no_eligible_platform_records')})
    choices=pd.DataFrame(choices)
    primary=d.merge(choices,on=['week_start_utc','instrument'],validate='many_to_one')
    primary=primary.loc[primary.platform.eq(primary.selected_platform)].copy()
    assert not primary.duplicated(['cell_id','week_start_utc','instrument']).any()
    assert (primary.lower_bound<=primary.harmonized_count).all()
    assert (primary.upper_bound>=primary.harmonized_count).all()
    national=primary.groupby(['week_start_utc','instrument','platform'],as_index=False).agg(
        raw_count=('raw_count','sum'),harmonized_count=('harmonized_count','sum'),
        cells_with_records=('cell_id','nunique'))
    national['lower_bound']=np.nan;national['upper_bound']=np.nan
    factor_cache={}
    for (week,instrument,platform),g in primary.groupby(['week_start_utc','instrument','platform']):
        totals=np.zeros(len(draws))
        grouped=g.groupby(['month','latitude_band']).raw_count.sum()
        for (month,band),count in grouped.items():
            key=(platform,int(month),band)
            if key not in factor_cache:
                latitude={'north':-4.,'central':-9.,'south':-15.}[band]
                factor_cache[key]=np.array([np.exp(-log_response(
                    {**model,'theta':theta.tolist()},platform,[week],[latitude])[0]) for theta in draws])
            totals+=count*factor_cache[key]
        lo,hi=np.quantile(totals,[.025,.975])
        use=national.week_start_utc.eq(week)&national.instrument.eq(instrument)
        estimate=national.loc[use,'harmonized_count'].iloc[0]
        national.loc[use,'lower_bound']=min(float(lo),estimate)
        national.loc[use,'upper_bound']=max(float(hi),estimate)
    national=choices.merge(national,on=['week_start_utc','instrument'],how='left',validate='one_to_one')
    national['coverage_status']='unknown'
    national['estimation_status']=np.where(national.harmonized_count.notna(),'estimated','unavailable')
    national['method_version']=model['version'];national['source_snapshot_id']=snapshot
    national['coverage_corrected']=False
    national['calibration_period_status']=period_status(national.week_start_utc)
    selected_columns=['cell_id','week_start_utc','instrument','platform','raw_count','harmonized_count',
        'lower_bound','upper_bound','coverage_status','estimation_status','method_version','source_snapshot_id',
        'is_fallback','selection_reason','calibration_period_status','coverage_corrected']
    primary[selected_columns].to_csv(out/'cell_series.csv.gz',index=False,compression={'method':'gzip','compresslevel':1,'mtime':0})
    national.to_csv(out/'national_series.csv',index=False)
    choices.to_csv(out/'platform_selection.csv',index=False)
    d.to_csv(out/'all_platform_calibrations.csv.gz',index=False,compression={'method':'gzip','compresslevel':1,'mtime':0})
    fused=primary.groupby(['cell_id','week_start_utc'],as_index=False).agg(
        empirical_activity=('harmonized_count','mean'),instruments_with_records=('instrument','nunique'))
    fused.to_csv(out/'forecast_activity_features.csv.gz',index=False,compression={'method':'gzip','compresslevel':1,'mtime':0})
    meta={'status':'empirical_demo','method_version':model['version'],'source_snapshot_id':snapshot,
        'instrument_series':['MODIS','VIIRS'],'country':'PER','grid_km':10,'time_unit':'UTC week',
        'MODIS_start':'2000-11-06','VIIRS_start':'2012-02-06','last_week_start':'2026-07-20',
        'last_week_end':'2026-07-26','coverage_corrected':False,
        'missing_policy':'unavailable; never a confirmed zero fire count',
        'uncertainty_kind':model['uncertainty_kind'],'interval_is_full_fire_uncertainty':False,
        'interval_level':.95,'calibration_interval_status':'computed_verified_time_blocks',
        'bootstrap_training_blocks':model['bootstrap_training_blocks'],
        'reference':model['reference'],'cell_rows_with_records':len(primary),'national_calendar_rows':len(national),
        'count_unit':model['count_unit'],
        'period_status_note':'before Aqua/VIIRS overlap and in 2026, response stability is extrapolated; factor-only bands omit this structural uncertainty',
        'fusion_for_forecast':'mean of available empirical instrument estimates; not a sum or recovered physical activity',
        'platform_choice':'one anchor per country/week; bridge only if anchor has no country records',
        'NRT_included':False,'calibration_report_folder':model_folder.name,
        'complete_physical_harmonization':False}
    (out/'series_metadata.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    print(json.dumps(meta,indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for name in ['source','model-folder','out']:p.add_argument('--'+name,required=True,type=Path)
    a=p.parse_args();export(a.source,a.model_folder,a.out)
