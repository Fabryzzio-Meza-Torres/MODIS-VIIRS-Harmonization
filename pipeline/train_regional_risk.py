"""Frozen candidate comparison and evaluation of experimental regional risk.

Neither the 2024-2025 retrospective test nor 2026 confirmation selects models.
Percentages concern first-detected episodes; physical ignition is not verified.
"""
from pathlib import Path
import argparse
import hashlib
import json
import platform
import time
import joblib
import lightgbm
import numpy as np
import pandas as pd
import sklearn
from sklearn.metrics import average_precision_score,brier_score_loss,log_loss,roc_auc_score
from regional_risk_models import RegionalRiskEstimator,LeadProbabilityCalibrator

SEED=20261115


def sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024**2),b''):digest.update(block)
    return digest.hexdigest()


def macro_lead_brier(frame,p):
    error=np.square(frame.y_new_detected_episode.to_numpy()-p)
    return float(pd.DataFrame({'lead':frame.lead_weeks.to_numpy(),'error':error}).groupby('lead').error.mean().mean())


def metrics(frame,p):
    y=frame.y_new_detected_episode.to_numpy()
    p=np.clip(np.asarray(p),1e-6,1-1e-6)
    bins=np.minimum((p*10).astype(int),9)
    ece=sum(np.sum(bins==b)/len(y)*abs(y[bins==b].mean()-p[bins==b].mean())
            for b in range(10) if np.any(bins==b))
    return {'rows':len(y),'positive_fraction':float(y.mean()),'mean_probability':float(p.mean()),
        'brier':float(brier_score_loss(y,p)),'macro_lead_brier':macro_lead_brier(frame,p),
        'average_precision':float(average_precision_score(y,p)) if y.sum() else None,
        'roc_auc':float(roc_auc_score(y,p)) if len(np.unique(y))==2 else None,
        'log_loss':float(log_loss(y,p,labels=[0,1])),'ece_10_equal_width':float(ece),
        'single_class':bool(len(np.unique(y))<2)}


def capacity_metrics(frame,p):
    d=frame[['issued_at','lead_weeks','region_id','y_new_detected_episode']].copy()
    d['probability']=p
    chosen=[]
    for _,g in d.groupby(['issued_at','lead_weeks']):
        k=max(1,int(np.ceil(.2*len(g))))
        chosen.append(g.sort_values(['probability','region_id'],ascending=[False,True]).head(k))
    top=pd.concat(chosen)
    hit=int(top.y_new_detected_episode.sum())
    total=int(d.y_new_detected_episode.sum())
    return {'capacity_fraction':.2,'selected_rows':len(top),'precision_at_capacity':float(hit/len(top)),
            'recall_at_capacity':float(hit/total) if total else None}


def candidate_spec(features):
    simple=['region_id','lead_weeks','target_season_sin','target_season_cos',
            'log_harmonized_annual_context','harmonized_annual_context_missing',
            'log_ref_records_7d','log_ref_records_28d','days_since_ref_record']
    no_weather=[x for x in features if not x.startswith(('t2m_','rh2m_','ws2m_','rain_'))]
    no_harm=[x for x in features if 'harmonized' not in x]
    return [
        {'name':'constant','kind':'constant','features':['region_id']},
        {'name':'climatology','kind':'climatology','features':['region_id']},
        {'name':'logistic','kind':'logistic','features':simple},
        {'name':'lgbm_small','kind':'lightgbm','features':features,
         'params':{'num_leaves':7,'max_depth':3,'min_child_samples':150,'reg_lambda':10.}},
        {'name':'lgbm_medium','kind':'lightgbm','features':features,
         'params':{'num_leaves':15,'max_depth':4,'min_child_samples':150,'reg_lambda':10.}},
        {'name':'lgbm_deeper','kind':'lightgbm','features':features,
         'params':{'num_leaves':31,'max_depth':5,'min_child_samples':250,'reg_lambda':15.}},
        {'name':'lgbm_without_weather','kind':'lightgbm','features':no_weather,
         'params':{'num_leaves':15,'max_depth':4,'min_child_samples':150,'reg_lambda':10.}},
        {'name':'lgbm_without_harmonization','kind':'lightgbm','features':no_harm,
         'params':{'num_leaves':15,'max_depth':4,'min_child_samples':150,'reg_lambda':10.}}
    ]


def choose(scores):
    rows=scores.set_index('model')
    simple='climatology'
    if rows.loc['logistic','macro_lead_brier']<=.99*rows.loc[simple,'macro_lead_brier']:
        simple='logistic'
    complex_rows=rows.loc[[name for name in rows.index if name.startswith('lgbm_')]]
    best=complex_rows.macro_lead_brier.idxmin()
    return best if rows.loc[best,'macro_lead_brier']<=.99*rows.loc[simple,'macro_lead_brier'] else simple


def block_brier_comparison(frame,selected,baseline):
    dates=pd.DatetimeIndex(pd.to_datetime(frame.target_week_start)).as_unit('ns').asi8
    blocks=dates//(13*7*86400*10**9)
    d=pd.DataFrame({'block':blocks,'gain':np.square(frame.y_new_detected_episode.to_numpy()-baseline)-
                    np.square(frame.y_new_detected_episode.to_numpy()-selected)})
    g=d.groupby('block').gain.agg(['sum','count'])
    rng=np.random.default_rng(SEED)
    draws=rng.integers(0,len(g),size=(1000,len(g)))
    values=g['sum'].to_numpy()[draws].sum(axis=1)/g['count'].to_numpy()[draws].sum(axis=1)
    return {'target_week_blocks':len(g),'block_weeks':13,'replicates':1000,
        'brier_gain_selected_vs_calibrated_climatology':float(d.gain.mean()),
        'lower_95':float(np.quantile(values,.025)),'upper_95':float(np.quantile(values,.975)),
        'uncertainty_scope':'fixed fitted models; resampled target-week blocks, not row-independent errors or ignition uncertainty'}


def run(dataset,output):
    output.mkdir(parents=True,exist_ok=True)
    manifest=json.loads((dataset/'dataset_manifest.json').read_text(encoding='utf-8'))
    data_path=dataset/'regional_risk_training_rows.csv.gz'
    assert sha(data_path)==manifest['training_rows_sha256']
    specifications=candidate_spec(manifest['features'])
    protocol={'status':'frozen_before_training','seed':SEED,'candidates':specifications,
        'selection_year':2022,'calibration_year':2023,'test_years':[2024,2025],
        'confirmation_year':2026,'selection_metric':'unweighted mean of lead-wise Brier scores',
        'complexity_minimum_relative_brier_improvement':.01,
        'spatial_holdout_departments':['05','10','15','20','25'],
        'spatial_shadow_selection_and_calibration_exclude_holdout_labels':True,
        'spatial_scope':'unseen department targets; prior local historical covariates remain available',
        'rebalance_or_oversampling':False,'calibration':'monotonic Platt per lead on 2023 only',
        'capacity_evaluation':'top 20 percent of available regions per issue and lead; no operational alert threshold',
        'dataset_sha256':sha(data_path),'prior_2024_2025_inspection_disclosed':True,
        'physical_ignition_labels_verified':False}
    protocol_path=output/'training_protocol_frozen.json'
    protocol_path.write_text(json.dumps(protocol,ensure_ascii=False,indent=2),encoding='utf-8')
    # Read only fitting/selection/calibration partitions for fitting decisions.
    data=pd.read_csv(data_path,dtype={'region_id':str})
    models={};calibrators={};selection_records=[];choices={};fitting={}
    holdout=set(protocol['spatial_holdout_departments'])
    for scope in ['all_regions','spatial_shadow']:
        permitted=np.ones(len(data),dtype=bool) if scope=='all_regions' else ~data.region_id.isin(holdout)
        train=data.loc[permitted & data.split.eq('train')].copy()
        selection=data.loc[permitted & data.split.eq('selection')].copy()
        calibration=data.loc[permitted & data.split.eq('calibration')].copy()
        models[scope]={};calibrators[scope]={}
        fitting[scope]={'train_rows':len(train),'selection_rows':len(selection),'calibration_rows':len(calibration)}
        for spec in specifications:
            began=time.monotonic()
            model=RegionalRiskEstimator(spec['kind'],spec['features'],spec.get('params')).fit(train,selection)
            probability=model.predict_proba(selection)
            score=metrics(selection,probability)
            record={'scope':scope,'model':spec['name'],**score,
                    'fit_seconds':time.monotonic()-began,
                    'best_iteration':getattr(getattr(model,'model',None),'best_iteration_',None)}
            selection_records.append(record)
            models[scope][spec['name']]=model
            raw_calibration=model.predict_proba(calibration)
            calibrators[scope][spec['name']]=LeadProbabilityCalibrator().fit(
                raw_calibration,calibration.y_new_detected_episode,calibration.lead_weeks)
            print(scope,spec['name'],'selection Brier',round(score['macro_lead_brier'],6),flush=True)
        scores=pd.DataFrame([r for r in selection_records if r['scope']==scope])
        choices[scope]=choose(scores)
        print('Selected',scope,choices[scope],flush=True)
    selection_table=pd.DataFrame(selection_records)
    selection_table.to_csv(output/'selection_metrics.csv',index=False)
    frozen={'choices':choices,'protocol_sha256':sha(protocol_path),'fitting':fitting,
        'calibration_transforms':{scope:{name:c.transforms for name,c in values.items()}
                                  for scope,values in calibrators.items()},
        'test_performance_opened':False}
    frozen_path=output/'model_freeze_before_test.json'
    frozen_path.write_text(json.dumps(frozen,ensure_ascii=False,indent=2),encoding='utf-8')
    bundle={'models':models,'calibrators':calibrators,'selected':choices,
            'dataset_manifest':manifest,'protocol':protocol,'method_version':'regional-onset-proxy-v0.1'}
    bundle_path=output/'regional_risk_models.joblib'
    joblib.dump(bundle,bundle_path,compress=3)
    freeze_sha=sha(frozen_path);model_sha=sha(bundle_path)
    # Only now are the test and confirmation predictions and metrics opened.
    evaluation=[];lead_records=[];region_records=[];prediction_frames=[];comparisons={}
    for scope in ['all_regions','spatial_shadow']:
        for period,mask in [
            ('2024',data.split.eq('retrospective_test') & data.issued_at.str.startswith('2024')),
            ('2025',data.split.eq('retrospective_test') & data.issued_at.str.startswith('2025')),
            ('confirmation_2026',data.split.eq('confirmation_2026'))]:
            if scope=='spatial_shadow':mask &= data.region_id.isin(holdout)
            frame=data.loc[mask].copy()
            probabilities={}
            # All candidates were predeclared; none is selected from these metrics.
            for name,model in models[scope].items():
                raw=model.predict_proba(frame)
                probability=calibrators[scope][name].predict(raw,frame.lead_weeks)
                probabilities[name]=probability
                evaluation.append({'scope':scope,'period':period,'model':name,'calibrated':True,
                    **metrics(frame,probability)})
            name=choices[scope];probability=probabilities[name]
            for lead,g in frame.assign(probability=probability).groupby('lead_weeks'):
                lead_records.append({'scope':scope,'period':period,'model':name,'lead_weeks':int(lead),
                    **metrics(g,g.probability.to_numpy()),**capacity_metrics(g,g.probability.to_numpy())})
            for rid,g in frame.assign(probability=probability).groupby('region_id'):
                region_records.append({'scope':scope,'period':period,'region_id':rid,'model':name,
                    **metrics(g,g.probability.to_numpy())})
            saved=frame[['region_id','region_name','issued_at','target_week_start','lead_weeks','y_new_detected_episode']].copy()
            saved['scope']=scope;saved['period']=period;saved['selected_model']=name
            saved['selected_probability']=probability
            saved['climatology_probability']=probabilities['climatology']
            prediction_frames.append(saved)
        # Combined retrospective confidence comparison; 2026 is not included.
        rows=pd.concat([f for f in prediction_frames if f.scope.iloc[0]==scope and f.period.iloc[0] in ['2024','2025']],ignore_index=True)
        comparisons[scope]=block_brier_comparison(rows,rows.selected_probability.to_numpy(),rows.climatology_probability.to_numpy())
    pd.DataFrame(evaluation).to_csv(output/'evaluation_metrics.csv',index=False)
    pd.DataFrame(lead_records).to_csv(output/'evaluation_by_lead.csv',index=False)
    pd.DataFrame(region_records).to_csv(output/'evaluation_by_region.csv',index=False)
    predictions=pd.concat(prediction_frames,ignore_index=True)
    predictions.to_csv(output/'evaluation_predictions.csv.gz',index=False,compression={'method':'gzip','mtime':0})
    loaded=joblib.load(bundle_path)
    sample=data.loc[data.split.eq('retrospective_test')].head(200)
    selected=choices['all_regions']
    expected=calibrators['all_regions'][selected].predict(models['all_regions'][selected].predict_proba(sample),sample.lead_weeks)
    actual=loaded['calibrators']['all_regions'][selected].predict(loaded['models']['all_regions'][selected].predict_proba(sample),sample.lead_weeks)
    assert np.allclose(actual,expected,rtol=0,atol=1e-12)
    assert sha(bundle_path)==model_sha and sha(frozen_path)==freeze_sha
    report={'status':'experimental_models_fitted_calibrated_and_evaluated','method_version':bundle['method_version'],
        'selected':choices,'model_sha256':model_sha,'freeze_before_test_sha256':freeze_sha,
        'protocol_sha256':sha(protocol_path),'dataset_sha256':sha(data_path),
        'software':{'python':platform.python_version(),'lightgbm':lightgbm.__version__,'sklearn':sklearn.__version__,
                    'pandas':pd.__version__,'numpy':np.__version__},
        'block_comparisons':comparisons,'serialization_prediction_parity_atol':1e-12,
        'retrospective_test_evaluated':True,'confirmation_2026_evaluated_after_freeze':True,
        'model_selection_from_test':False,'physical_ignition_probability_verified':False,
        'SP_NRT_transfer_validated':False,'public_api_modified':False}
    (output/'training_evaluation_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dataset',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();run(a.dataset,a.output)
