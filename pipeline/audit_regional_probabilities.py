"""Read-only audit of high regional probabilities; never refits or rescales."""
from pathlib import Path
from datetime import datetime,timezone
from urllib.request import urlopen
import argparse,hashlib,json
import joblib
import numpy as np
import pandas as pd

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,data):Path(path).write_text(json.dumps(data,indent=2,ensure_ascii=False,allow_nan=False),encoding='utf-8')

def audit(repo,artifacts,out):
    out.mkdir(parents=True,exist_ok=True)
    report=json.loads((repo/'reports/prediction/model/training_evaluation_report.json').read_text(encoding='utf-8'))
    model_path=artifacts/'39_modelo_riesgo_regional/regional_risk_models.joblib'
    assert sha(model_path)==report['model_sha256']
    with urlopen('https://modis-viirs-harmonization-production.up.railway.app/v1/fire-risk/outlook?limit=300',timeout=30) as r:live=json.load(r)
    write(out/'live_outlook_at_audit.json',live)
    current=pd.DataFrame(live['data']);current['region_id']=current.region_id.astype(str).str.zfill(2)
    assert len(current)==300 and not current.duplicated(['region_id','lead_weeks']).any()
    assert np.max(np.abs(current.probability_percent-100*current.probability))<1e-9
    feature_path=artifacts/'40_piloto_pronosticos/forecast_features.csv.gz'
    features=pd.read_csv(feature_path,dtype={'region_id':str})
    current=current.sort_values(['region_id','lead_weeks']).reset_index(drop=True)
    features=features.sort_values(['region_id','lead_weeks']).reset_index(drop=True)
    assert current[['region_id','lead_weeks']].equals(features[['region_id','lead_weeks']])
    bundle=joblib.load(model_path);selected=bundle['selected']['all_regions']
    estimator=bundle['models']['all_regions'][selected]
    calibrator=bundle['calibrators']['all_regions'][selected]
    raw=estimator.predict_proba(features);frozen=calibrator.predict(raw,features.lead_weeks)
    parity=float(np.max(np.abs(frozen-current.probability)))
    assert parity<1e-12,parity
    diagnostics=artifacts/'39_modelo_riesgo_regional/evaluation_predictions.csv.gz'
    all_predictions=pd.read_csv(diagnostics,dtype={'region_id':str,'period':str})
    historical=all_predictions.loc[all_predictions.scope.eq('all_regions')&all_predictions.lead_weeks.eq(1)].copy()
    assert not historical.duplicated(['region_id','target_week_start']).any()
    historical['probability_bin']=pd.cut(historical.selected_probability,
        [0,.5,.8,.9,.95,.99,1.0000001],include_lowest=True,right=False,
        labels=['0–50 %','50–80 %','80–90 %','90–95 %','95–99 %','99–100 %'])
    bins=historical.groupby(['period','probability_bin'],observed=True).agg(
        rows=('y_new_detected_episode','size'),mean_probability=('selected_probability','mean'),
        observed_frequency=('y_new_detected_episode','mean')).reset_index()
    bins['probability_bin']=bins.probability_bin.astype(str)
    bins['overprediction_percentage_points']=100*(bins.mean_probability-bins.observed_frequency)
    bins.to_csv(out/'historical_calibration_lead1.csv',index=False)
    high=historical.loc[historical.selected_probability.ge(.9)].groupby('period').agg(
        rows=('y_new_detected_episode','size'),mean_probability=('selected_probability','mean'),
        observed_frequency=('y_new_detected_episode','mean')).reset_index()
    high.to_csv(out/'historical_high_probability_lead1.csv',index=False)
    all_high=all_predictions.loc[all_predictions.scope.eq('all_regions')&all_predictions.selected_probability.ge(.9)]
    all_high.groupby(['period','lead_weeks']).agg(rows=('y_new_detected_episode','size'),
        mean_probability=('selected_probability','mean'),observed_frequency=('y_new_detected_episode','mean')).reset_index().to_csv(out/'historical_high_probability_by_lead.csv',index=False)
    labels=pd.read_csv(artifacts/'36_noaa20_etiquetas/regional_week_proxy_pilot.csv',dtype={'region_id':str},parse_dates=['target_week_start'])
    assert not labels.duplicated(['region_id','target_week_start']).any()
    november=labels.loc[labels.target_week_start.dt.month.eq(11)].groupby('region_id').agg(
        historical_november_weeks=('has_new_detected_episode','size'),
        historical_november_positive=('has_new_detected_episode','sum'),
        historical_november_frequency=('has_new_detected_episode','mean')).reset_index()
    first=current.loc[current.lead_weeks.eq(1)].copy()
    first=first.merge(november,on='region_id',validate='one_to_one')
    first[['region_id','region_name','probability_percent','historical_november_weeks',
        'historical_november_positive','historical_november_frequency']].to_csv(out/'first_week_vs_november_history.csv',index=False)
    # Compare the exact labels to the broader activity target mentioned by the user.
    observations=pd.read_csv(artifacts/'36_noaa20_etiquetas/eligible_reference_detections.csv.gz',
        dtype={'region_id':str},usecols=['region_id','timestamp_utc'])
    times=pd.to_datetime(observations.timestamp_utc,utc=True).dt.tz_convert('America/Lima').dt.tz_localize(None)
    observations['target_week_start']=times.dt.normalize()-pd.to_timedelta(times.dt.dayofweek,unit='D')
    counts=observations.groupby(['region_id','target_week_start']).size().rename('detection_count')
    activity=labels.merge(counts,on=['region_id','target_week_start'],how='left',validate='one_to_one')
    activity['any_detection_recorded']=activity.detection_count.fillna(0).gt(0)
    target_differences=int(activity.any_detection_recorded.ne(activity.has_new_detected_episode.astype(bool)).sum())
    assert not ((activity.has_new_detected_episode==1)&~activity.any_detection_recorded).any()
    training=pd.read_csv(artifacts/'37_dataset_riesgo_regional/regional_risk_training_rows.csv.gz',dtype={'region_id':str})
    actual_train=training.loc[training.split.eq('train')]
    ranges=[]
    for rid,g in features.groupby('region_id'):
        train=actual_train.loc[actual_train.region_id.eq(rid)]
        for name in estimator.features:
            if name in ['region_id','lead_weeks']:continue
            low,high_value=train[name].min(),train[name].max()
            value=float(g[name].iloc[0])
            # Target-season features vary by lead: evaluate all 12 values, not just first.
            outside=int((g[name].lt(low)|g[name].gt(high_value)).sum())
            if outside:ranges.append({'region_id':rid,'feature':name,'outside_rows':outside,
                'training_min':float(low),'training_max':float(high_value),'first_lead_value':value})
    pd.DataFrame(ranges).to_csv(out/'current_outside_training_range.csv',index=False)
    current_review=json.loads((repo/'data/regional_outlook.json').read_text(encoding='utf-8'))
    baseline=pd.DataFrame(current_review['data'])[['region_id','lead_weeks','climatology_probability_for_review']]
    assert live['metadata']['snapshot_id']==current_review['metadata']['snapshot_id']
    comparison=current.merge(baseline,on=['region_id','lead_weeks'],validate='one_to_one')
    summary={'audit_at':datetime.now(timezone.utc).isoformat(),'model_changed':False,'public_api_changed':False,
        'selected_model':selected,'snapshot_id':live['metadata']['snapshot_id'],
        'live_rows':len(current),'live_above_90_percent':int(current.probability.gt(.9).sum()),
        'live_mean_percent':float(current.probability_percent.mean()),
        'first_week_regions_above_90_percent':int(first.probability.gt(.9).sum()),
        'first_week_total_regions':len(first),'first_week_mean_percent':float(first.probability_percent.mean()),
        'frozen_model_vs_live_max_absolute_probability_error':parity,
        'probability_percent_is_probability_times_100':True,
        'historical_unique_region_weeks':len(labels),'historical_positive_frequency':float(labels.has_new_detected_episode.mean()),
        'historical_any_detection_frequency':float(activity.any_detection_recorded.mean()),
        'target_new_episode_vs_any_detection_different_region_weeks':target_differences,
        'historical_evaluation_uses_single_lead_no_duplicate_target_labels':True,
        'historical_high_probability_lead1':high.to_dict('records'),
        'current_calibrated_climatology_above_90_count':int(comparison.climatology_probability_for_review.gt(.9).sum()),
        'current_mean_absolute_model_vs_calibrated_climatology_percentage_points':float(100*np.abs(comparison.probability-comparison.climatology_probability_for_review).mean()),
        'NRT_SP_transfer_validated':live['metadata']['NRT_SP_transfer_validated'],
        'calibration_improvement_demonstrated':live['metadata']['calibration_improvement_demonstrated'],
        'physical_ignition_probability_verified':False,
        'intervals_are_not_independent_binomial_claims':True,
        'interpretation':'Probability of >=1 newly detected eligible episode anywhere in a whole department during one week; not percentage of detections that are fires, not province probability.',
        'future_outcomes_for_this_snapshot_available':False,
        'conclusion':'High regional base rates explain saturation; exact future percentages and SP/NRT transfer remain unverified. No arbitrary rescaling.'}
    write(out/'audit_summary.json',summary)
    print(json.dumps(summary,indent=2,ensure_ascii=False),flush=True)
    print(first[['region_name','probability_percent','historical_november_positive','historical_november_weeks']].to_string(index=False))
    print(bins.round(4).to_string(index=False))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--artifacts',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();audit(args.repo,args.artifacts,args.output)
