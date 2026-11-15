"""Seasonal annual-lag forecast of ARCHIVE RECORDS, never wildfire ignition.

Protocol fixed before final test: fit <=2021, probability calibration 2022,
model selection 2023, untouched final test 2024-2025. Spatial blocks excluded
from model training may have their own past observations as lag features.
"""
from pathlib import Path
import argparse,hashlib,json,time,pickle
import numpy as np
import pandas as pd
from scipy.special import expit,logit
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score,brier_score_loss,log_loss,roc_auc_score

FEATURES=['x_100km','y_100km','country_area_fraction','season_sin','season_cos',
          'log_activity_lag52','record_lag52','annual_window_log_mean','record_lag104']

class History:
    def __init__(self,source,series):
        self.cells=pd.read_csv(Path(source)/'cells.csv').sort_values('cell_id').reset_index(drop=True)
        self.weeks=pd.date_range('2000-11-06','2026-11-16',freq='7D',tz='UTC')
        self.n=len(self.cells)
        self.activity=np.full((len(self.weeks),self.n),np.nan,dtype=np.float32)
        fused=pd.read_csv(Path(series)/'forecast_activity_features.csv.gz')
        wi=self.weeks.get_indexer(pd.to_datetime(fused.week_start_utc,utc=True))
        ci=pd.Index(self.cells.cell_id).get_indexer(fused.cell_id)
        assert (wi>=0).all() and (ci>=0).all()
        self.activity[wi,ci]=fused.empirical_activity.to_numpy(dtype=np.float32)
        # This zero means no archive RECORD; it is not a valid fire-free observation.
        self.record=np.isfinite(self.activity)
        self.holdout=((self.cells.ix//20*73856093+self.cells.iy//20*19349663)%7==0).to_numpy()
        self.static=np.column_stack([self.cells.ix/10,self.cells.iy/10,self.cells.country_area_km2/100]).astype('float32')
        self.month=self.weeks.month.to_numpy()-1
        self.observed_end=self.weeks.get_loc(pd.Timestamp('2026-07-20',tz='UTC'))

    def indices(self,start,end):
        # A complete target week must finish before exclusive end.
        return np.flatnonzero((self.weeks>=pd.Timestamp(start,tz='UTC')) &
            (self.weeks+pd.Timedelta(days=7)<=pd.Timestamp(end,tz='UTC')))

    def features(self,t,c):
        t,c=np.asarray(t),np.asarray(c)
        assert (t>=104).all()
        phase=2*np.pi*self.weeks.dayofyear.to_numpy()[t]/365.2425
        past=self.activity[t-52,c]
        window=np.stack([np.log1p(np.nan_to_num(self.activity[t-k,c])) for k in range(50,55)])
        return np.column_stack([self.static[c],np.sin(phase),np.cos(phase),
            np.log1p(np.nan_to_num(past)),np.isfinite(past),window.mean(axis=0),
            self.record[t-104,c]]).astype('float32')

    def grid(self,ids):
        return np.repeat(ids,self.n),np.tile(np.arange(self.n),len(ids))

def metrics(y,p,t,ncells):
    p=np.clip(np.asarray(p),1e-8,1-1e-8)
    # Top 5% is computed separately for each forecast week, with stable tie order.
    hit=0;selected=0
    for week in np.unique(t):
        use=np.flatnonzero(t==week);k=max(1,int(np.ceil(len(use)*.05)))
        top=use[np.argsort(-p[use],kind='stable')[:k]]
        hit+=int(y[top].sum());selected+=k
    return {'rows':len(y),'positive_records':int(y.sum()),'prevalence':float(y.mean()),
        'average_precision':float(average_precision_score(y,p)),
        'brier_score':float(brier_score_loss(y,p)), 'log_loss':float(log_loss(y,p,labels=[0,1])),
        'roc_auc':float(roc_auc_score(y,p)) if len(np.unique(y))==2 else None,
        'top_5pct_capture':float(hit/max(1,y.sum())), 'top_5pct_precision':float(hit/max(1,selected))}

def run(source,series,out):
    started=time.monotonic();out=Path(out);out.mkdir(parents=True,exist_ok=True)
    h=History(source,series);rng=np.random.default_rng(20261114)
    train=h.indices('2013-01-01','2022-01-01')
    t,c=h.grid(train);y=h.record[t,c].astype('int8')
    eligible=~h.holdout[c]
    # Retain all positive training records and 1/8 negatives. Inverse sampling
    # weights recover the original class proportions; evaluation is never sampled.
    sample=eligible & ((y==1)|(rng.random(len(y))<.125))
    ts,cs,ys=t[sample],c[sample],y[sample]
    weights=np.where(ys==1,1.,8.)
    print('Training rows',len(ys),'positive',int(ys.sum()),flush=True)
    model=HistGradientBoostingClassifier(max_iter=100,max_leaf_nodes=15,
        min_samples_leaf=100,learning_rate=.08,l2_regularization=1.,
        early_stopping=False,random_state=20261114)
    model.fit(h.features(ts,cs),ys,sample_weight=weights)
    # Cell/month climatology with a 20-week prior. Holdout cells use month prior.
    global_rate=np.array([y[eligible & (h.month[t]==m)].mean() for m in range(12)])
    sums=np.zeros((12,h.n));denom=np.zeros_like(sums)
    np.add.at(sums,(h.month[t[eligible]],c[eligible]),y[eligible])
    np.add.at(denom,(h.month[t[eligible]],c[eligible]),1)
    climate=(sums+20*global_rate[:,None])/(denom+20)
    def raw_predict(t,c):
        result=np.empty(len(t))
        for start in range(0,len(t),150000):
            s=slice(start,start+150000)
            result[s]=model.predict_proba(h.features(t[s],c[s]))[:,1]
        return result
    # Probability calibration sees 2022 only, excluding spatial test blocks.
    ct,cc=h.grid(h.indices('2022-01-01','2023-01-01'));keep=~h.holdout[cc]
    cy=h.record[ct,cc].astype('int8');cp=raw_predict(ct,cc)
    calibrator=LogisticRegression(C=1.,solver='lbfgs').fit(logit(np.clip(cp[keep],1e-7,1-1e-7))[:,None],cy[keep])
    def predict(t,c,name):
        if name=='climatology':return climate[h.month[t],c]
        return calibrator.predict_proba(logit(np.clip(raw_predict(t,c),1e-7,1-1e-7))[:,None])[:,1]
    results=[]
    vt,vc=h.grid(h.indices('2023-01-01','2024-01-01'));vy=h.record[vt,vc].astype('int8')
    validation_predictions={}
    for name in ['climatology','annual_lag_gradient_boosting']:
        vp=predict(vt,vc,name);validation_predictions[name]=vp
        for split,keep in [('validation_seen_space',~h.holdout[vc]),('validation_heldout_space',h.holdout[vc])]:
            results.append({'period':'2023','split':split,'model':name,**metrics(vy[keep],vp[keep],vt[keep],h.n)})
    seen=[r for r in results if r['split']=='validation_seen_space']
    selected=min(seen,key=lambda r:r['brier_score'])['model']
    protocol={'version':'annual-lag-archive-record-v1','selected':selected,
        'target':'at least one selected-anchor MODIS or VIIRS archive detection in the target cell/week',
        'target_zero':'no archive record; not confirmed absence of fire',
        'features':FEATURES,'fit_period':'2013-2021','probability_calibration_period':'2022',
        'model_selection_period':'2023','selection_metric':'minimum Brier score in seen spatial blocks',
        'final_test_period':'2024-2025','final_test_opened':False,
        'spatial_holdout':'1/7 of fixed 200km blocks; local past annual lags remain available',
        'training_negative_sampling_probability':.125,'inverse_sampling_weighting':True,
        'current_weather_used':False,'recent_2026_detections_used':False,
        'physical_fire_risk_probability':False,'coverage_corrected':False,
        'forecast_is_seasonal_annual_recurrence':True,
        'noaa_platform_transition_2026_validated':False}
    frozen=json.dumps(protocol,sort_keys=True).encode()
    (out/'protocol_before_test.json').write_bytes(frozen)
    protocol['frozen_protocol_sha256']=hashlib.sha256(frozen).hexdigest()
    # Final test opened ONLY after protocol and selected model have been written.
    test_predictions=[]
    for year in [2024,2025]:
        tt,tc=h.grid(h.indices(f'{year}-01-01',f'{year+1}-01-01'))
        ty=h.record[tt,tc].astype('int8')
        for name in ['climatology','annual_lag_gradient_boosting']:
            tp=predict(tt,tc,name)
            for split,keep in [('final_test_seen_space',~h.holdout[tc]),('final_test_heldout_space',h.holdout[tc])]:
                results.append({'period':str(year),'split':split,'model':name,**metrics(ty[keep],tp[keep],tt[keep],h.n)})
            if name==selected:
                bins=np.minimum((tp*10).astype(int),9)
                for b in range(10):
                    use=bins==b
                    if use.any():test_predictions.append({'year':year,'bin':b,'rows':int(use.sum()),
                        'mean_probability':float(tp[use].mean()),'observed_frequency':float(ty[use].mean())})
    # Forecast target Nov16-22 uses annual history only, all available by issue time.
    target=h.weeks.get_loc(pd.Timestamp('2026-11-16',tz='UTC'))
    assert target-50<=h.observed_end
    ft=np.full(h.n,target);fc=np.arange(h.n);prob=predict(ft,fc,selected)
    forecast=h.cells.copy();forecast['record_probability']=prob
    forecast['rank']=pd.Series(prob).rank(method='first',ascending=False).astype(int)
    forecast['target_week_start']='2026-11-16';forecast['target_week_end']='2026-11-22'
    forecast['model_version']=protocol['version'];forecast['experimental']=True
    forecast['quality_flag']='seasonal_recurrence;unknown_coverage;2026_platform_transition_unvalidated'
    forecast.sort_values('rank').to_csv(out/'forecast_cells.csv.gz',index=False)
    pd.DataFrame(results).to_csv(out/'metrics.csv',index=False)
    pd.DataFrame(test_predictions).to_csv(out/'calibration_bins.csv',index=False)
    with (out/'forecast_model.pkl').open('wb') as f:pickle.dump((model,calibrator,climate),f)
    protocol.update(final_test_opened=True,elapsed_seconds=time.monotonic()-started,
        training_rows=len(ys),training_positives=int(ys.sum()),cells=h.n,
        issued_at_utc=pd.Timestamp.now(tz='UTC').isoformat(),target_week_start='2026-11-16',
        target_week_end='2026-11-22',calibration_intercept=float(calibrator.intercept_[0]),
        calibration_slope=float(calibrator.coef_[0,0]))
    (out/'forecast_metadata.json').write_text(json.dumps(protocol,indent=2),encoding='utf-8')
    print(pd.DataFrame(results).to_string(index=False),flush=True)
    print('Selected',selected,'seconds',protocol['elapsed_seconds'],flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for name in ['source','series','out']:p.add_argument('--'+name,required=True,type=Path)
    a=p.parse_args();run(a.source,a.series,a.out)
