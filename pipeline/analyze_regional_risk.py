"""Diagnostics of already frozen regional risk models; never selects/refits them."""
from pathlib import Path
import argparse,json
import joblib
import numpy as np
import pandas as pd
from sklearn.inspection import permutation_importance
from sklearn.metrics import confusion_matrix
from train_regional_risk import metrics,sha


def analyze(dataset,output):
    bundle=joblib.load(output/'regional_risk_models.joblib')
    data=pd.read_csv(dataset/'regional_risk_training_rows.csv.gz',dtype={'region_id':str})
    name=bundle['selected']['all_regions']
    model=bundle['models']['all_regions'][name]
    calibrator=bundle['calibrators']['all_regions'][name]
    ret=data.loc[data.split.eq('retrospective_test')].copy()
    raw=model.predict_proba(ret)
    probability=calibrator.predict(raw,ret.lead_weeks)
    before_after={'selected_model':name,'calibration_fitted_on':'2023 only',
        'retrospective_before':metrics(ret,raw),'retrospective_after':metrics(ret,probability),
        'changes_selection':False}
    (output/'calibration_diagnostic.json').write_text(json.dumps(before_after,indent=2),encoding='utf-8')
    selection=data.loc[data.split.eq('selection')]
    if model.kind=='lightgbm':
        importance=permutation_importance(model.model,model.inputs(selection),selection.y_new_detected_episode,
            scoring='neg_brier_score',n_repeats=3,n_jobs=1,random_state=20261115)
        pd.DataFrame({'feature':model.features,'brier_increase_mean':importance.importances_mean,
            'brier_increase_std':importance.importances_std}).sort_values('brier_increase_mean',ascending=False).to_csv(output/'permutation_importance_selection.csv',index=False)
    predictions=pd.read_csv(output/'evaluation_predictions.csv.gz',dtype={'region_id':str})
    predictions=predictions.loc[predictions.scope.eq('all_regions') & predictions.period.isin(['2024','2025'])]
    matched=[]
    for period,g in predictions.groupby('period'):
        common=set.intersection(*[set(h.target_week_start) for _,h in g.groupby('lead_weeks')])
        for lead,h in g.loc[g.target_week_start.isin(common)].groupby('lead_weeks'):
            matched.append({'period':period,'lead_weeks':int(lead),'common_target_weeks':len(common),
                **metrics(h,h.selected_probability.to_numpy()),
                'climatology_brier':float(np.mean(np.square(h.y_new_detected_episode-h.climatology_probability)))})
    pd.DataFrame(matched).to_csv(output/'matched_target_week_lead_metrics.csv',index=False)
    scenarios=[]
    for scenario in ['weather_missing','record_counts_minus30percent','record_counts_plus30percent']:
        changed=ret.copy()
        if scenario=='weather_missing':
            changed[[c for c in model.features if c.startswith(('t2m_','rh2m_','ws2m_','rain_'))]]=np.nan
        else:
            factor=.7 if 'minus' in scenario else 1.3
            columns=[c for c in model.features if c.startswith(('log_ref_records_','log_detected_onsets_'))]
            changed[columns]=np.log1p(np.expm1(changed[columns])*factor)
        p=calibrator.predict(model.predict_proba(changed),changed.lead_weeks)
        scenarios.append({'scenario':scenario,'brier':metrics(changed,p)['brier'],
            'mean_absolute_probability_change':float(np.mean(np.abs(p-probability))),
            'is_real_NRT_validation':False})
    robustness={'baseline':metrics(ret,probability),'scenarios':scenarios,'selected_model_changed':False}
    (output/'robustness_diagnostic.json').write_text(json.dumps(robustness,indent=2),encoding='utf-8')
    calibration_rows=[]
    baseline_model=bundle['models']['all_regions']['climatology']
    baseline=bundle['calibrators']['all_regions']['climatology'].predict(baseline_model.predict_proba(ret),ret.lead_weeks)
    y=ret.y_new_detected_episode.to_numpy()
    for label,p in [('selected_raw',raw),('selected_calibrated',probability),('climatology_calibrated',baseline)]:
        bins=np.minimum((p*10).astype(int),9)
        for b in range(10):
            use=bins==b
            if use.any():calibration_rows.append({'variant':label,'bin':b,'rows':int(use.sum()),
                'mean_probability':float(p[use].mean()),'observed_fraction':float(y[use].mean())})
    pd.DataFrame(calibration_rows).to_csv(output/'calibration_bins.csv',index=False)
    confusion=confusion_matrix(y,probability>=.5,labels=[0,1]).tolist()
    (output/'diagnostic_confusion.json').write_text(json.dumps({
        'threshold':.5,'threshold_is_operational_policy':False,
        'labels':['no new episode recorded','new episode recorded'],
        'matrix_true_rows_predicted_columns':confusion},indent=2),encoding='utf-8')
    trace={'model_sha256':sha(output/'regional_risk_models.joblib'),
        'dataset_sha256':sha(dataset/'regional_risk_training_rows.csv.gz'),
        'selection_changed':False,'calibration_policy_changed_after_test':False,
        'importance_period':'2022 selection; marginal feature permutation, not causal effects',
        'lead_comparison':'same target weeks within each retrospective issue year',
        'perturbations_prove_NRT_transfer':False}
    (output/'diagnostic_sources.json').write_text(json.dumps(trace,indent=2),encoding='utf-8')
    print('Frozen-model diagnostics ready; before/after Brier:',
          before_after['retrospective_before']['brier'],before_after['retrospective_after']['brier'],flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--dataset',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();analyze(a.dataset,a.output)
