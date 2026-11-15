"""Generate 25x12 experimental first-detected-episode probabilities for review.

Actual issue time is never backdated. A stale or incomplete feature window
produces an unavailable estimate, never a fabricated zero or old fresh score.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,json
import joblib
import numpy as np
import pandas as pd
from pyproj import Transformer
from onset_label_pilot import CRS,causal_onsets
from regional_risk_features import RegionalFeatureStore
from train_regional_risk import sha


def support_reasons(reference_time,nrt_min,nrt_max,weather_value_day,features,selected_features,target,issued):
    reference=pd.Timestamp(reference_time)
    cutoff=reference-pd.Timedelta(days=3)
    required_start=cutoff-pd.Timedelta(days=90+5)
    reasons=[]
    if pd.Timestamp(nrt_min)>required_start:reasons.append('insufficient_NRT_history_for_90_day_window_and_episode_buffer')
    if pd.Timestamp(nrt_max)<cutoff:reasons.append('NRT_acquisition_extent_does_not_reach_feature_cutoff')
    expected_day=(reference.tz_convert('UTC').normalize()-pd.Timedelta(days=8)).strftime('%Y-%m-%d')
    if weather_value_day!=expected_day:reasons.append('weather_point_does_not_reach_assumed_availability_cutoff')
    for name in selected_features:
        if name=='region_id':continue
        if name not in features or not np.isfinite(features[name]):
            reasons.append('missing_selected_feature:'+name)
    if pd.Timestamp(target)<=pd.Timestamp(issued):reasons.append('target_week_already_started_at_issue')
    return reasons


def generate(repo,model_dir,nrt_dir,weather_dir,training_dir,output):
    output.mkdir(parents=True,exist_ok=True)
    model_file=model_dir/'regional_risk_models.joblib'
    model_report=json.loads((model_dir/'training_evaluation_report.json').read_text(encoding='utf-8'))
    assert sha(model_file)==model_report['model_sha256'],'Frozen model changed'
    parity=json.loads((output/'feature_parity_report.json').read_text(encoding='utf-8'))
    assert parity['extractor_sha256']==sha(Path(__file__).with_name('regional_risk_features.py'))
    assert parity['dataset_sha256']==model_report['dataset_sha256']
    bundle=joblib.load(model_file)
    selected=bundle['selected']['all_regions']
    model=bundle['models']['all_regions'][selected]
    calibrator=bundle['calibrators']['all_regions'][selected]
    baseline_model=bundle['models']['all_regions']['climatology']
    baseline_calibrator=bundle['calibrators']['all_regions']['climatology']
    nrt_file=nrt_dir/'recent_noaa20_nrt.csv.gz'
    weather_file=weather_dir/'regional_point_weather.csv.gz'
    nrt=pd.read_csv(nrt_file,dtype={'region_id':str})
    nrt['timestamp_utc']=pd.to_datetime(nrt.timestamp_utc,utc=True)
    nrt=nrt.sort_values(['timestamp_utc','source_row'],kind='stable').reset_index(drop=True)
    assert not nrt.duplicated(['timestamp_utc','latitude_deg','longitude_deg']).any()
    assert nrt.platform.eq('NOAA-20').all() and nrt.processing.eq('NRT').all()
    if nrt.empty:raise ValueError('No eligible NRT input')
    ingested=pd.to_datetime(nrt.ingested_at,utc=True)
    issued=pd.Timestamp(datetime.now(timezone.utc))
    assert ingested.le(issued).all() and nrt.timestamp_utc.le(issued).all()
    local=issued.tz_convert('America/Lima')
    reference=local.normalize()-pd.Timedelta(days=(local.dayofweek+1)%7)
    assert reference.dayofweek==6 and reference<=local
    cutoff=reference.tz_convert('UTC')-pd.Timedelta(days=3)
    nrt_min,nrt_max=nrt.timestamp_utc.min(),nrt.timestamp_utc.max()
    project=Transformer.from_crs('EPSG:4326',CRS,always_xy=True)
    x,y=project.transform(nrt.longitude_deg.to_numpy(),nrt.latitude_deg.to_numpy())
    xy=np.column_stack([x,y])
    times=pd.DatetimeIndex(nrt.timestamp_utc).as_unit('ns').asi8
    indices=causal_onsets(xy,times,1250.,5.)
    nrt['is_candidate_onset']=False
    nrt.loc[indices,'is_candidate_onset']=True
    # An actual-data prefix test complements the synthetic causality unit tests.
    prefix_size=np.searchsorted(times,cutoff.as_unit('ns').value,side='left')
    prefix=causal_onsets(xy[:prefix_size],times[:prefix_size],1250.,5.)
    assert np.array_equal(prefix,indices[indices<prefix_size]),'Later NRT data rewrites earlier episode labels'
    store=RegionalFeatureStore.from_files(repo,nrt,weather_file)
    frame_rows=[];reasons_by_key={}
    for rid,region in store.regions.items():
        for lead in range(1,13):
            target=reference+pd.Timedelta(days=1+7*(lead-1))
            values=store.vector(rid,reference,target,lead)
            row={'region_id':rid,'region_name':region.name,
                'feature_reference_at':reference.isoformat(),'issued_at':issued.isoformat(),
                'target_week_start':target.strftime('%Y-%m-%d'),
                'target_week_end_exclusive':(target+pd.Timedelta(days=7)).strftime('%Y-%m-%d'),
                'lead_weeks':lead,**values}
            frame_rows.append(row)
            reasons_by_key[(rid,lead)]=support_reasons(reference,nrt_min,nrt_max,
                values['weather_value_day'],row,model.features,target,issued)
    frame=pd.DataFrame(frame_rows)
    assert len(frame)==300 and not frame.duplicated(['region_id','lead_weeks']).any()
    raw=model.predict_proba(frame)
    probability=calibrator.predict(raw,frame.lead_weeks)
    baseline=baseline_calibrator.predict(baseline_model.predict_proba(frame),frame.lead_weeks)
    assert np.isfinite(probability).all() and ((probability>=0)&(probability<=1)).all()
    frame.to_csv(output/'forecast_features.csv.gz',index=False,compression={'method':'gzip','mtime':0})
    # Feature-range flags use training data only; they do not alter probabilities.
    train=pd.read_csv(training_dir/'regional_risk_training_rows.csv.gz',dtype={'region_id':str})
    train=train.loc[train.split.eq('train')]
    range_flags={}
    for rid,g in train.groupby('region_id'):
        numeric=[c for c in model.features if c!='region_id']
        range_flags[rid]=(g[numeric].min(),g[numeric].max())
    forecasts=[]
    for i,row in enumerate(frame.itertuples()):
        key=(row.region_id,row.lead_weeks)
        reasons=reasons_by_key[key]
        low,high=range_flags[row.region_id]
        values=frame.iloc[i]
        outside=[c for c in low.index if pd.notna(values[c]) and
                 (values[c]<low[c]-1e-12 or values[c]>high[c]+1e-12)]
        forecasts.append({'region_id':row.region_id,'region_name':row.region_name,
            'issued_at':issued.isoformat(),'target_week_start':row.target_week_start,
            'target_week_end_exclusive':row.target_week_end_exclusive,'lead_weeks':int(row.lead_weeks),
            'probability':None if reasons else float(probability[i]),
            'probability_percent':None if reasons else float(100*probability[i]),
            'raw_model_probability_for_review':None if reasons else float(raw[i]),
            'climatology_probability_for_review':None if reasons else float(baseline[i]),
            'estimation_status':'unavailable' if reasons else 'estimated',
            'quality_status':'insufficient_support' if reasons else 'experimental',
            'unavailable_reasons':reasons,'features_outside_region_training_range':outside})
    trace={'model_sha256':sha(model_file),'nrt_sha256':sha(nrt_file),
        'weather_sha256':sha(weather_file),'extractor_sha256':parity['extractor_sha256'],
        'training_dataset_sha256':model_report['dataset_sha256']}
    snapshot_id=sha_text(json.dumps({'trace':trace,'issued_at':issued.isoformat()},sort_keys=True))
    metadata={'status':'local_pilot_pending_human_release_review','method_version':bundle['method_version'],
        'snapshot_id':snapshot_id,'country':'PER','regions':25,'forecast_rows':300,
        'lead_weeks':list(range(1,13)),'selected_model':selected,
        'issued_at':issued.isoformat(),'generated_at':datetime.now(timezone.utc).isoformat(),
        'feature_reference_at':reference.isoformat(),
        'issue_time_backdated_to_feature_reference':False,
        'target_definition':'at least one new NOAA-20 vegetation-fire detection episode in region during target week',
        'target_unit':'one Monday-Sunday week in America/Lima; end exclusive',
        'cumulative_twelve_week_risk':False,'physical_ignition_probability_verified':False,
        'calibration_kind':'monotonic Platt per lead fitted on 2023; no test-driven policy change',
        'calibration_improvement_demonstrated':False,
        'per_forecast_uncertainty_intervals_available':False,
        'NRT_SP_transfer_validated':False,'NRT_type0_assumed':False,
        'NRT_type_unavailable_rows':int(nrt.type_unavailable.sum()),
        'NRT_last_acquisition_utc':nrt_max.isoformat(),
        'NRT_last_acquisition_age_hours_at_issue':(issued-nrt_max).total_seconds()/3600,
        'NRT_ingested_at':ingested.max().isoformat(),
        'reference_cutoff_exclusive':cutoff.isoformat(),
        'weather_value_days_used':sorted(frame.weather_value_day.unique().tolist()),
        'weather_last_source_day':pd.read_csv(weather_file,usecols=['date']).date.max(),
        'weather_spatial_support':'one inside-polygon point per department, not areal mean',
        'future_realized_weather_used':False,'future_weather_forecast_used':False,
        'automatic_refresh_configured':False,'public_api_modified':False,
        'historical_extractor_parity_rows':parity['rows_checked'],
        'NRT_future_suffix_prefix_invariance_verified':True,
        'estimated_rows':sum(r['estimation_status']=='estimated' for r in forecasts),
        'unavailable_rows':sum(r['estimation_status']=='unavailable' for r in forecasts),
        'validation_notes':['2024 ties climatology; improvement is not consistent across years.',
            'Moquegua and Tacna have some of the largest retrospective errors.',
            'Region and season dominate model signal; perturbation tests are not NRT outcome validation.',
            'NRT processing has no confirmed vegetation type in this input download.'],
        'sources':trace}
    document={'metadata':metadata,'data':forecasts}
    path=output/'regional_forecasts.json'
    # Strict JSON: no NaN, infinity or non-serializable date values.
    path.write_text(json.dumps(document,ensure_ascii=False,indent=2,allow_nan=False),encoding='utf-8')
    flat=pd.DataFrame(forecasts)
    flat.to_csv(output/'regional_forecasts.csv',index=False)
    summary=flat.loc[flat.lead_weeks.eq(1),['region_id','region_name','target_week_start',
        'probability_percent','climatology_probability_for_review','quality_status']]
    summary.to_csv(output/'first_week_review.csv',index=False)
    assert sha(model_file)==model_report['model_sha256']
    verification={'status':'forecast_grid_generated_for_review','rows':300,'regions':25,'leads':12,
        'unique_region_lead_keys':300,'json_sha256':sha(path),'model_hash_unchanged':True,
        'model_retrained':False,'feature_parity_rows':parity['rows_checked'],
        'future_suffix_does_not_change_NRT_past':True,'issue_time_is_actual_generation_time':True,
        'estimated_rows':metadata['estimated_rows'],'unavailable_rows':metadata['unavailable_rows'],
        'physical_ignition_probability_verified':False,'public_api_modified':False}
    (output/'pilot_verification.json').write_text(json.dumps(verification,indent=2),encoding='utf-8')
    print(json.dumps(verification,indent=2),flush=True)
    print(summary.to_string(index=False),flush=True)


def sha_text(value):
    import hashlib
    return hashlib.sha256(value.encode('utf-8')).hexdigest()


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--model-dir',type=Path,required=True)
    p.add_argument('--nrt-dir',type=Path,required=True)
    p.add_argument('--weather-dir',type=Path,required=True)
    p.add_argument('--training-dir',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();generate(a.repo,a.model_dir,a.nrt_dir,a.weather_dir,a.training_dir,a.output)
