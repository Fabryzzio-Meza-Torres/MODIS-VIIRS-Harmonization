"""Serve a precise observed-fire-activity event with an empirical historical context."""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json
import joblib
import numpy as np
import pandas as pd
from train_regional_activity import LABEL,METHOD,sha,write
from generate_regional_outlook import support_reasons

EVENT='at_least_one_eligible_fire_detection_recorded'

def historical_reference(labels,rid,target,issued):
    target=pd.Timestamp(target);issued=pd.Timestamp(issued)
    dates=pd.to_datetime(labels.target_week_start)
    phase=(dates.dt.dayofyear-1)/365.2425
    target_phase=(target.dayofyear-1)/365.2425
    delta=np.abs(phase-target_phase);distance=np.minimum(delta,1-delta)*365.2425
    # Closed historical weeks only, and prior years to the target year. Years
    # already observed before publication may inform next January's forecast.
    completed=(dates+pd.Timedelta(days=7)).dt.tz_localize('America/Lima').lt(issued)
    mask=labels.region_id.eq(rid)&dates.dt.year.lt(target.year)&completed&distance.le(14)
    chosen=labels.loc[mask];chosen_dates=dates.loc[mask]
    total=len(chosen);positive=int(chosen[LABEL].sum())
    return {'frequency_percent':100*positive/total if total>=20 else None,
        'positive_weeks':positive,'total_weeks':total,'years':sorted(set(map(int,chosen_dates.dt.year))),
        'seasonal_half_window_days':14,'source':'NOAA-20 SP eligible detections; empirical recorded frequency',
        'is_independent_binomial_sample':False,'coverage_corrected':False}

def generate(repo,artifacts,model_dir,output):
    output.mkdir(parents=True,exist_ok=True)
    report=json.loads((model_dir/'training_report.json').read_text(encoding='utf-8'))
    model_file=model_dir/'regional_activity_models.joblib';assert sha(model_file)==report['model_sha256']
    bundle=joblib.load(model_file);name=bundle['selected']['all_regions']
    estimator=bundle['models']['all_regions'][name];calibrator=bundle['calibrators']['all_regions'][name]
    feature_file=artifacts/'40_piloto_pronosticos/forecast_features.csv.gz'
    frame=pd.read_csv(feature_file,dtype={'region_id':str})
    prior=json.loads((repo/'data/regional_outlook.json').read_text(encoding='utf-8'))['metadata']
    issued=pd.Timestamp(datetime.now(timezone.utc))
    local=issued.tz_convert('America/Lima');reference=local.normalize()-pd.Timedelta(days=(local.dayofweek+1)%7)
    assert frame.feature_reference_at.map(pd.Timestamp).eq(reference).all(),'Feature cache is not from this weekly reference; recompute inputs'
    parity=json.loads((artifacts/'40_piloto_pronosticos/feature_parity_report.json').read_text(encoding='utf-8'))
    assert parity['rows_checked']==115350 and parity['extractor_sha256']==sha(Path(__file__).with_name('regional_risk_features.py'))
    nrt_file=artifacts/'38_nrt_reciente/recent_noaa20_nrt.csv.gz'
    weather_file=artifacts/'35_meteorologia/regional_point_weather.csv.gz'
    assert sha(nrt_file)==prior['sources']['nrt_sha256'] and sha(weather_file)==prior['sources']['weather_sha256']
    assert pd.Timestamp(prior['NRT_ingested_at'])<=issued
    nrt=pd.read_csv(nrt_file,usecols=['timestamp_utc'])
    nrt_times=pd.to_datetime(nrt.timestamp_utc,utc=True)
    raw=estimator.predict_proba(frame);probability=calibrator.predict(raw,frame.lead_weeks)
    labels=pd.read_csv(model_dir/'regional_activity_labels.csv',dtype={'region_id':str})
    assert sha(model_dir/'regional_activity_labels.csv')==report['labels_sha256']
    training=pd.read_csv(model_dir/'activity_training_rows.csv.gz',dtype={'region_id':str})
    numeric=[name for name in estimator.features if name!='region_id']
    ranges={rid:(g[numeric].min(),g[numeric].max())
        for rid,g in training.loc[training.split.eq('train')].groupby('region_id')}
    data=[]
    for i,r in enumerate(frame.to_dict('records')):
        target=pd.Timestamp(r['target_week_start'],tz='America/Lima')
        assert target==reference+pd.Timedelta(days=1+7*(r['lead_weeks']-1))
        reasons=support_reasons(reference,nrt_times.min(),nrt_times.max(),r['weather_value_day'],r,estimator.features,target,issued)
        context=historical_reference(labels,r['region_id'],target,issued)
        lower,upper=ranges[r['region_id']]
        outside=[key for key in lower.index if pd.notna(r[key]) and (r[key]<lower[key]-1e-12 or r[key]>upper[key]+1e-12)]
        p=None if reasons else float(probability[i]);pc=None if p is None else p*100
        data.append({'region_id':r['region_id'],'region_name':r['region_name'],'issued_at':issued.isoformat(),
            'target_week_start':target.strftime('%Y-%m-%d'),'target_week_end_exclusive':(target+pd.Timedelta(days=7)).strftime('%Y-%m-%d'),
            'lead_weeks':int(r['lead_weeks']),'probability':p,'probability_percent':pc,
            'estimation_status':'unavailable' if reasons else 'estimated',
            'quality_status':'insufficient_support' if reasons else 'experimental','unavailable_reasons':reasons,
            'features_outside_region_training_range':outside,'historical_reference':context,
            'difference_from_historical_frequency_pp':None if pc is None or context['frequency_percent'] is None else pc-context['frequency_percent']})
    scores=pd.read_csv(model_dir/'evaluation_metrics.csv')
    evaluation=scores.loc[scores.scope.eq('all_regions')&scores.model.isin([name,'climatology'])&scores.variant.eq('calibrated'),
        ['period','model','brier','rows','positive_frequency']].to_dict('records')
    chosen=scores.loc[scores.scope.eq('all_regions')&scores.model.eq(name)&scores.period.isin(['2024','2025'])]
    pooled={kind:float(np.average(g.brier,weights=g.rows)) for kind,g in chosen.groupby('variant')}
    sources={'model_sha256':sha(model_file),'dataset_sha256':report['dataset_sha256'],
        'feature_file_sha256':sha(feature_file),'labels_sha256':sha(model_dir/'regional_activity_labels.csv'),
        'nrt_sha256':sha(nrt_file),'weather_sha256':sha(weather_file),'extractor_sha256':parity['extractor_sha256']}
    snapshot=hashlib.sha256(json.dumps({'sources':sources,'issued_at':issued.isoformat(),'method':METHOD},sort_keys=True).encode()).hexdigest()
    metadata={'status':'experimental_activity_snapshot','method_version':METHOD,'snapshot_id':snapshot,
        'country':'PER','regions':25,'forecast_rows':300,'lead_weeks':list(range(1,13)),
        'issued_at':issued.isoformat(),'feature_reference_at':reference.isoformat(),
        'target_event':EVENT,'target_definition':'At least one eligible NOAA-20 presumed-vegetation-fire detection recorded anywhere in the department during one target week.',
        'target_eligibility':bundle['protocol']['eligibility'],'target_observation_product':'NOAA-20 standard processing (SP)',
        'time_zone':'America/Lima','week_end_exclusive':True,'supported_spatial_units':['department'],
        'national_probability_available':False,'province_probability_available':False,'point_probability_available':False,
        'cumulative_twelve_week_risk':False,'physical_ignition_probability_verified':False,
        'probability_is_detection_classification_confidence':False,'probability_is_area_burned_fraction':False,
        'selected_model':name,'NRT_ingested_at':prior['NRT_ingested_at'],
        'NRT_last_acquisition_utc':prior['NRT_last_acquisition_utc'],'NRT_SP_transfer_validated':False,
        'NRT_type0_assumed':False,'NRT_type_unavailable_rows':prior['NRT_type_unavailable_rows'],
        'weather_value_days_used':sorted(frame.weather_value_day.unique().tolist()),
        'weather_last_source_day':prior['weather_last_source_day'],
        'weather_support':'One inside-polygon point per department; observed weather only; simulated historical availability',
        'future_weather_forecast_used':False,'coverage_corrected':False,'automatic_refresh_configured':False,
        'historical_reference_method':'Recorded frequency in previous-year fully closed weeks within ±14 seasonal calendar days; not an uncertainty interval.',
        'difference_is_significance_test':False,'individual_uncertainty_intervals_available':False,
        'evaluation_status':'retrospective_only_all_evaluation_years_previously_examined',
        'prospective_validation_complete':False,'evaluation':evaluation,
        'calibration':{'method':'Monotonic Platt per lead fitted on 2023','pooled_2024_2025_brier':pooled,
            'observed_pooled_brier_improved':pooled['calibrated']<pooled['raw'],'test_driven_switching':False},
        'sources':sources,'ui':{'title_es':'Probabilidad de actividad de fuego detectada',
            'label_es':'Probabilidad estimada para esta semana',
            'explanation_es':'Posibilidad de que el satélite registre al menos una detección compatible con fuego en cualquier parte de este departamento durante la semana seleccionada.',
            'limits_es':'No identifica una ubicación exacta ni estima superficie quemada, daños o una ignición física confirmada. Puede incluir quemas agrícolas y otras detecciones mal clasificadas.',
            'historical_label_es':'Frecuencia histórica comparable',
            'difference_label_es':'Diferencia frente al histórico (puntos porcentuales)',
            'scope_notice_es':'El cálculo corresponde a todo el departamento. No hay un pronóstico provincial o por punto.',
            'status_es':'Experimental · pendiente de validación prospectiva'},
        'scientific_sources':[{'title':'NASA FIRMS VIIRS active fire / thermal anomalies description',
            'url':'https://firms.modaps.eosdis.nasa.gov/content/descriptions/FIRMS_VIIRS_Firehotspots.html'},
            {'title':'NASA FIRMS limitations and missed detections',
             'url':'https://firms.modaps.eosdis.nasa.gov/alerts/notes.php'}]}
    path=output/'regional_activity_outlook.json';write(path,{'metadata':metadata,'data':data})
    assert len(data)==300 and len({(r['region_id'],r['lead_weeks']) for r in data})==300
    assert sha(model_file)==report['model_sha256']
    print(json.dumps({'rows':300,'method_version':METHOD,'estimated':sum(r['probability'] is not None for r in data),
        'above_90_percent':sum(r['probability'] is not None and r['probability']>.9 for r in data),
        'snapshot_id':snapshot,'calibration':metadata['calibration']},indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--artifacts',type=Path,required=True);p.add_argument('--model-dir',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();generate(args.repo,args.artifacts,args.model_dir,args.output)
