"""Experimental observed-activity target, evaluated separately from onset proxy.

All 2024-2026 periods have previously been examined in this project. These are
retrospective diagnostics, never a new blind or prospective validation claim.
"""
from pathlib import Path
from datetime import datetime,timezone
import argparse,hashlib,json
import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import brier_score_loss,log_loss,average_precision_score
from regional_risk_models import RegionalRiskEstimator,LeadProbabilityCalibrator

LABEL='y_fire_activity_recorded'
METHOD='regional-recorded-fire-activity-v0.2'

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()
def write(path,value):Path(path).write_text(json.dumps(value,indent=2,ensure_ascii=False,allow_nan=False),encoding='utf-8',newline='\n')

def scores(frame,probability):
    y=frame[LABEL].to_numpy();p=np.clip(probability,1e-6,1-1e-6)
    error=np.square(y-p)
    lead=pd.DataFrame({'lead':frame.lead_weeks.to_numpy(),'error':error}).groupby('lead').error.mean()
    bins=np.minimum((p*10).astype(int),9)
    ece=sum(np.sum(bins==b)/len(y)*abs(np.mean(y[bins==b])-np.mean(p[bins==b])) for b in range(10) if np.any(bins==b))
    return {'rows':len(frame),'positive_frequency':float(y.mean()),'mean_probability':float(p.mean()),
        'brier':float(brier_score_loss(y,p)),'macro_lead_brier':float(lead.mean()),
        'log_loss':float(log_loss(y,p,labels=[0,1])),'ece_10_bins':float(ece),
        'average_precision':float(average_precision_score(y,p)) if y.sum() else None}

def candidates(features):
    simple=['region_id','lead_weeks','target_season_sin','target_season_cos',
        'log_ref_records_7d','log_ref_records_28d','days_since_ref_record']
    return [
        {'name':'constant','kind':'constant','features':['region_id']},
        {'name':'climatology','kind':'climatology','features':['region_id']},
        {'name':'logistic','kind':'logistic','features':simple},
        {'name':'lgbm_activity','kind':'lightgbm','features':features,
         'params':{'num_leaves':15,'max_depth':4,'min_child_samples':150,'reg_lambda':10.}}]

def choose(records):
    table=pd.DataFrame(records).set_index('model')
    simple='logistic' if table.loc['logistic','macro_lead_brier']<=.99*table.loc['climatology','macro_lead_brier'] else 'climatology'
    return 'lgbm_activity' if table.loc['lgbm_activity','macro_lead_brier']<=.99*table.loc[simple,'macro_lead_brier'] else simple

def train(artifacts,out):
    out.mkdir(parents=True,exist_ok=True)
    old_dir=artifacts/'37_dataset_riesgo_regional'
    old_file=old_dir/'regional_risk_training_rows.csv.gz'
    old_manifest=json.loads((old_dir/'dataset_manifest.json').read_text(encoding='utf-8'))
    assert sha(old_file)==old_manifest['training_rows_sha256']
    data=pd.read_csv(old_file,dtype={'region_id':str})
    prior_labels=pd.read_csv(artifacts/'36_noaa20_etiquetas/regional_week_proxy_pilot.csv',dtype={'region_id':str},parse_dates=['target_week_start'])
    source=artifacts/'36_noaa20_etiquetas/eligible_reference_detections.csv.gz'
    points=pd.read_csv(source,dtype={'region_id':str},usecols=['region_id','timestamp_utc'])
    local=pd.to_datetime(points.timestamp_utc,utc=True).dt.tz_convert('America/Lima').dt.tz_localize(None)
    points['target_week_start']=local.dt.normalize()-pd.to_timedelta(local.dt.dayofweek,unit='D')
    counts=points.groupby(['region_id','target_week_start']).size().rename('eligible_detection_count')
    labels=prior_labels[['region_id','target_week_start','has_new_detected_episode']].merge(counts,
        on=['region_id','target_week_start'],how='left',validate='one_to_one')
    labels['eligible_detection_count']=labels.eligible_detection_count.fillna(0).astype('int64')
    labels[LABEL]=labels.eligible_detection_count.gt(0).astype('int8')
    assert not ((labels.has_new_detected_episode==1)&labels[LABEL].eq(0)).any()
    labels['target_week_start']=labels.target_week_start.dt.strftime('%Y-%m-%d')
    data=data.rename(columns={'y_new_detected_episode':'previous_onset_proxy_label'})
    data=data.merge(labels[['region_id','target_week_start',LABEL]],on=['region_id','target_week_start'],validate='many_to_one')
    assert len(data)==115350
    features=[name for name in old_manifest['features'] if 'harmonized' not in name]
    protocol={'method_version':METHOD,'frozen_at':datetime.now(timezone.utc).isoformat(),
        'target_column':LABEL,'event':'at_least_one_eligible_satellite_detection_recorded_in_region_week',
        'eligibility':'NOAA-20 SP presumed vegetation fire (type 0), nominal/high confidence; pre-2018 nonvegetation mask frozen',
        'spatial_unit':'department','time_zone':'America/Lima','week':'Monday 00:00 inclusive to next Monday exclusive',
        'train':'2018-2021','selection':'2022','calibration':'2023','evaluation':'2024, 2025, January-July 2026',
        'evaluation_periods_previously_examined':True,'prospective_validation_complete':False,
        'features':features,'candidates':candidates(features),'rebalance':False,
        'selection_metric':'macro lead Brier on 2022 only; complexity requires 1% relative gain',
        'calibration_policy':'monotonic Platt per lead fitted 2023; raw and calibrated reported, no test-driven switching',
        'held_out_regions':['05','10','15','20','25'],'new_blind_spatial_test_claimed':False,
        'SP_NRT_transfer_validated':False,'historical_availability':'SP observations with simulated latency, not true historical NRT vintages',
        'previous_dataset_sha256':sha(old_file),'label_source_sha256':sha(source)}
    write(out/'protocol_frozen.json',protocol)
    labels.to_csv(out/'regional_activity_labels.csv',index=False)
    data.to_csv(out/'activity_training_rows.csv.gz',index=False,compression={'method':'gzip','mtime':0})
    models={};calibrators={};selected={};selection_records=[]
    reserved=set(protocol['held_out_regions'])
    for scope in ['all_regions','spatial_shadow']:
        permit=np.ones(len(data),dtype=bool) if scope=='all_regions' else ~data.region_id.isin(reserved)
        fitting=data.loc[permit&data.split.eq('train')]
        selection=data.loc[permit&data.split.eq('selection')]
        calibration=data.loc[permit&data.split.eq('calibration')]
        models[scope]={};calibrators[scope]={};records=[]
        for spec in protocol['candidates']:
            estimator=RegionalRiskEstimator(spec['kind'],spec['features'],spec.get('params')).fit(fitting,selection,label_column=LABEL)
            record={'scope':scope,'model':spec['name'],**scores(selection,estimator.predict_proba(selection))}
            records.append(record);selection_records.append(record)
            models[scope][spec['name']]=estimator
            calibrators[scope][spec['name']]=LeadProbabilityCalibrator().fit(
                estimator.predict_proba(calibration),calibration[LABEL],calibration.lead_weeks)
            print(scope,spec['name'],'selection Brier',round(record['macro_lead_brier'],6),flush=True)
        selected[scope]=choose(records)
    pd.DataFrame(selection_records).to_csv(out/'selection_metrics.csv',index=False)
    bundle={'models':models,'calibrators':calibrators,'selected':selected,'protocol':protocol,'method_version':METHOD}
    model_path=out/'regional_activity_models.joblib';joblib.dump(bundle,model_path,compress=3)
    freeze={'selected':selected,'model_sha256':sha(model_path),'protocol_sha256':sha(out/'protocol_frozen.json'),
        'evaluation_computed_in_this_run':False,'historical_results_already_known_from_prior_project':True}
    write(out/'model_freeze_before_evaluation.json',freeze)
    evaluations=[];predictions=[];by_region=[];by_lead=[]
    for scope in models:
        for period,mask in [('2024',data.split.eq('retrospective_test')&data.issued_at.str.startswith('2024')),
                            ('2025',data.split.eq('retrospective_test')&data.issued_at.str.startswith('2025')),
                            ('2026_Jan_Jul',data.split.eq('confirmation_2026'))]:
            if scope=='spatial_shadow':mask &= data.region_id.isin(reserved)
            frame=data.loc[mask].copy();probabilities={}
            for name,estimator in models[scope].items():
                raw=estimator.predict_proba(frame)
                calibrated=calibrators[scope][name].predict(raw,frame.lead_weeks)
                for kind,probability in [('raw',raw),('calibrated',calibrated)]:
                    evaluations.append({'scope':scope,'period':period,'model':name,'variant':kind,**scores(frame,probability)})
                probabilities[name]=calibrated
            probability=probabilities[selected[scope]]
            result=frame[['region_id','region_name','issued_at','target_week_start','lead_weeks',LABEL]].copy()
            result['scope']=scope;result['period']=period;result['probability']=probability
            result['climatology_probability']=probabilities['climatology'];predictions.append(result)
            for key,g in result.groupby('region_id'):
                by_region.append({'scope':scope,'period':period,'region_id':key,**scores(g,g.probability.to_numpy())})
            for key,g in result.groupby('lead_weeks'):
                by_lead.append({'scope':scope,'period':period,'lead_weeks':int(key),**scores(g,g.probability.to_numpy())})
    pd.DataFrame(evaluations).to_csv(out/'evaluation_metrics.csv',index=False)
    pd.DataFrame(by_region).to_csv(out/'evaluation_by_region.csv',index=False)
    pd.DataFrame(by_lead).to_csv(out/'evaluation_by_lead.csv',index=False)
    pred=pd.concat(predictions,ignore_index=True);pred.to_csv(out/'evaluation_predictions.csv.gz',index=False,compression={'method':'gzip','mtime':0})
    # Single-lead reliability table avoids repeating the same target at 12 horizons.
    reliability=pred.loc[pred.scope.eq('all_regions')&pred.lead_weeks.eq(1)].copy()
    reliability['bin']=pd.cut(reliability.probability,[0,.5,.8,.9,.95,.99,1.000001],right=False,include_lowest=True)
    reliability.groupby(['period','bin'],observed=True).agg(rows=(LABEL,'size'),mean_probability=('probability','mean'),
        observed_frequency=(LABEL,'mean')).reset_index().to_csv(out/'reliability_lead1.csv',index=False)
    report={'method_version':METHOD,'selected':selected,'model_sha256':sha(model_path),
        'dataset_sha256':sha(out/'activity_training_rows.csv.gz'),'labels_sha256':sha(out/'regional_activity_labels.csv'),
        'target_column':LABEL,'region_weeks':len(labels),'positive_frequency':float(labels[LABEL].mean()),
        'differences_from_previous_onset_target':int(labels[LABEL].ne(labels.has_new_detected_episode).sum()),
        'model_selection_uses_2022_only':True,'prospective_validation_complete':False,
        'all_2024_2026_evaluations_are_retrospective':True,'SP_NRT_transfer_validated':False,
        'physical_ignition_probability_verified':False,'individual_uncertainty_intervals_available':False}
    write(out/'training_report.json',report)
    print(json.dumps(report,indent=2),flush=True)
    print(pd.DataFrame(evaluations).query('scope=="all_regions" and variant=="calibrated"')[['period','model','brier']].to_string(index=False))

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--artifacts',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();train(args.artifacts,args.output)
