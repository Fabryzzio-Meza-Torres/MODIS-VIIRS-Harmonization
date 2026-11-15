"""Build retrospective region/issue/target-week rows, leads 1..12.

The target is a first-detected episode proxy, not verified physical ignition.
SP values stand in for potential NRT features with a stated latency assumption;
historical release timestamps/reanalysis vintages are NOT reconstructed.
"""
from pathlib import Path
from contextlib import closing
import argparse
import hashlib
import json
import sqlite3
import numpy as np
import pandas as pd

DAY_NS=86400*10**9


def ns(value):
    return pd.Timestamp(value).as_unit('ns').value


def sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024**2),b''):digest.update(block)
    return digest.hexdigest()


def build(repo, reference, weather, output):
    output.mkdir(parents=True,exist_ok=True)
    labels=pd.read_csv(reference/'regional_week_proxy_pilot.csv',dtype={'region_id':str})
    labels['target_week_start']=pd.to_datetime(labels.target_week_start)
    target={(r.region_id,r.target_week_start.strftime('%Y-%m-%d')):int(r.has_new_detected_episode)
            for r in labels.itertuples()}
    det=pd.read_csv(reference/'eligible_reference_detections.csv.gz',dtype={'region_id':str})
    det['timestamp_utc']=pd.to_datetime(det.timestamp_utc,utc=True)
    weather_path=weather/'regional_point_weather.csv.gz'
    daily=pd.read_csv(weather_path,dtype={'region_id':str},parse_dates=['date'])
    with closing(sqlite3.connect((repo/'api/history.sqlite').resolve().as_uri()+'?mode=ro',uri=True)) as db:
        regions=pd.read_sql_query('SELECT region_id,name,min_lon,min_lat,max_lon,max_lat FROM regions ORDER BY region_id',db)
    history=pd.read_csv(repo/'data/regional_series.csv.gz',dtype={'region_id':str})
    history['week_start_utc']=pd.to_datetime(history.week_start_utc)
    harmonized={}
    for key,g in history.groupby(['region_id','week_start_utc']):
        values=g.harmonized_count.dropna().to_numpy()
        harmonized[(key[0],key[1].strftime('%Y-%m-%d'))]=(float(values.mean()) if len(values) else np.nan,len(values))
    # Freeze the protocol before any classifier is fitted.
    protocol={
        'target':'at least one newly detected NOAA-20 vegetation-fire episode in region and target week',
        'physical_ignition_labels_verified':False,
        'label_rule':'1.25 km, 5 days; same-time components; frozen prior nonvegetation cells',
        'reference':'NOAA-20 SP type0 nominal/high; selected to support current NOAA-20 NRT',
        'issue_schedule':'Sunday 00:00 America/Lima',
        'lead_1':'next Monday (one day after Sunday release)',
        'lead_12':'eleven weeks after lead 1; output describes one target week, not cumulative 12-week risk',
        'reference_feature_delay_days_assumed':3,
        'weather_release_delay_days_assumed_after_day_end':7,
        'historical_available_at_verified':False,
        'weather_reanalysis_vintage_available_at_verified':False,
        'harmonization':'frozen empirical v1.1; annual lag only, never FRP adjusted with a count factor',
        'split_policy':'by issue period with target week ending before period boundary',
        'splits':{'train':['2018-08-05','2022-01-01'],
                  'selection':['2022-01-01','2023-01-01'],
                  'calibration':['2023-01-01','2024-01-01'],
                  'retrospective_test':['2024-01-01','2026-01-01'],
                  'confirmation_2026':['2026-01-01','2026-07-27']},
        'prior_2024_2025_inspection_disclosed':True,
        'confirmation_2026_performance_not_for_selection':True,
        'new_model_trained':False}
    (output/'evaluation_protocol.json').write_text(json.dumps(protocol,ensure_ascii=False,indent=2),encoding='utf-8')
    origins=pd.date_range('2018-08-05','2026-07-19',freq='7D',tz='America/Lima')
    result=[]
    discarded_for_maturity=0
    split_ranges={name:(pd.Timestamp(a,tz='America/Lima'),pd.Timestamp(b,tz='America/Lima'))
                  for name,(a,b) in protocol['splits'].items()}
    for region in regions.itertuples():
        a=det.loc[det.region_id.eq(region.region_id)].sort_values('timestamp_utc')
        times=pd.DatetimeIndex(a.timestamp_utc).as_unit('ns').asi8
        cum_frp=np.r_[0.,a.frp_mw.to_numpy().cumsum()]
        onset_values=a.is_candidate_onset.astype(bool).to_numpy(dtype=np.int64)
        cum_onsets=np.r_[0,onset_values.cumsum()]
        w=daily.loc[daily.region_id.eq(region.region_id)].sort_values('date').reset_index(drop=True)
        weather_times=pd.DatetimeIndex(w.date).as_unit('ns').asi8
        # A daily value ends at D+1. The assumed extra delay is seven days.
        weather_available=weather_times+8*DAY_NS
        weather_features={}
        for window in [7,28,90]:
            for field in ['T2M','RH2M','WS2M']:
                weather_features[f'{field.lower()}_mean_{window}d']=w[field].rolling(window,min_periods=window).mean().to_numpy()
            weather_features[f'rain_sum_{window}d']=w.PRECTOTCORR.rolling(window,min_periods=window).sum().to_numpy()
        for issued in origins:
            issued_ns=ns(issued)
            cutoff=issued_ns-3*DAY_NS
            right=np.searchsorted(times,cutoff,side='left')
            previous={}
            for window in [7,28,90]:
                left=np.searchsorted(times,cutoff-window*DAY_NS,side='left')
                previous[f'log_ref_records_{window}d']=float(np.log1p(right-left))
                previous[f'log_ref_frp_sum_{window}d']=float(np.log1p(cum_frp[right]-cum_frp[left]))
                previous[f'log_detected_onsets_{window}d']=float(np.log1p(cum_onsets[right]-cum_onsets[left]))
            previous['days_since_ref_record']=float(min((cutoff-times[right-1])/DAY_NS,365.)) if right else 365.
            previous['ref_no_records_90d']=int(previous['log_ref_records_90d']==0)
            wi=np.searchsorted(weather_available,issued_ns,side='right')-1
            assert wi>=0 and weather_available[wi]<=issued_ns
            latest_observation=times[right-1] if right else None
            assert latest_observation is None or latest_observation<cutoff<issued_ns
            for lead in range(1,13):
                target_week=issued+pd.Timedelta(days=1+7*(lead-1))
                target_end=target_week+pd.Timedelta(days=7)
                target_text=target_week.strftime('%Y-%m-%d')
                key=(region.region_id,target_text)
                if key not in target:
                    continue
                split=None
                for name,(begin,end) in split_ranges.items():
                    if begin<=issued<end:
                        if target_end<=end:
                            split=name
                        else:
                            discarded_for_maturity+=1
                        break
                if split is None:
                    continue
                annual_week=target_week-pd.Timedelta(weeks=52)
                assert annual_week+pd.Timedelta(days=7)<issued
                annual,n_instruments=harmonized.get((region.region_id,annual_week.strftime('%Y-%m-%d')),(np.nan,0))
                phase=2*np.pi*(target_week.dayofyear-1)/365.2425
                item={'region_id':region.region_id,'region_name':region.name,
                    'issued_at':issued.isoformat(),'target_week_start':target_text,
                    'target_week_end_exclusive':target_end.strftime('%Y-%m-%d'),
                    'lead_weeks':lead,'split':split,'y_new_detected_episode':target[key],
                    'target_season_sin':float(np.sin(phase)),'target_season_cos':float(np.cos(phase)),
                    'center_lon':(region.min_lon+region.max_lon)/2,
                    'center_lat':(region.min_lat+region.max_lat)/2,
                    'log_harmonized_annual_context':float(np.log1p(annual)) if np.isfinite(annual) else np.nan,
                    'harmonized_annual_context_missing':int(not np.isfinite(annual)),
                    'harmonized_context_instruments':n_instruments,
                    'weather_value_day':w.date.iloc[wi].strftime('%Y-%m-%d'),
                    'reference_cutoff_exclusive':pd.Timestamp(cutoff,tz='UTC').isoformat(),
                    **previous,**{k:float(v[wi]) for k,v in weather_features.items()}}
                result.append(item)
        print('Dataset region',region.region_id,region.name,'ready',flush=True)
    data=pd.DataFrame(result)
    assert not data.duplicated(['region_id','issued_at','lead_weeks']).any()
    assert data.lead_weeks.between(1,12).all() and data.y_new_detected_episode.isin([0,1]).all()
    assert data.region_id.nunique()==25
    path=output/'regional_risk_training_rows.csv.gz'
    data.to_csv(path,index=False,compression={'method':'gzip','compresslevel':1,'mtime':0})
    feature_names=[c for c in data.columns if c not in {
        'region_name','issued_at','target_week_start','target_week_end_exclusive','split',
        'y_new_detected_episode','weather_value_day','reference_cutoff_exclusive'}]
    metadata={'status':'retrospective_experimental_dataset_ready_for_review',
        'rows':len(data),'regions':25,'leads':list(range(1,13)),
        'features':feature_names,'rows_by_split':data.groupby('split').size().to_dict(),
        'rows_by_split_lead':data.groupby(['split','lead_weeks']).size().rename('rows').reset_index().to_dict(orient='records'),
        'boundary_rows_purged_for_target_maturity':discarded_for_maturity,
        'training_target_prevalence':float(data.loc[data.split.eq('train'),'y_new_detected_episode'].mean()),
        'label_semantics':protocol['target'],'physical_ignition_labels_verified':False,
        'reference_labels_sha256':sha(reference/'regional_week_proxy_pilot.csv'),
        'reference_detections_sha256':sha(reference/'eligible_reference_detections.csv.gz'),
        'weather_sha256':sha(weather_path),'training_rows_sha256':sha(path),
        'our_snapshot_id':json.loads((repo/'data/series_metadata.json').read_text(encoding='utf-8'))['source_snapshot_id'],
        'no_future_target_weather_used':True,'historical_available_at_verified':False,
        'weather_spatial_support':'representative point per department, not areal mean',
        'model_trained':False,'public_api_modified':False}
    (output/'dataset_manifest.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in metadata.items() if k!='rows_by_split_lead'},ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--reference',type=Path,required=True)
    p.add_argument('--weather',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();build(a.repo,a.reference,a.weather,a.output)
