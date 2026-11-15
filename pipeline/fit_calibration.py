"""Predeclared model selection, temporal/spatial validation, block bootstrap.
Does not evaluate 2024-2025 outcomes. Exports empirical, not coverage-corrected factors.
"""
from pathlib import Path
from concurrent.futures import ProcessPoolExecutor
import argparse,json,time
import numpy as np
import pandas as pd
from calibration import fit,fit_bridge,make_pairs,pair_scores,log_response,PLATFORMS,time_block_ids

def window(data,start,end):
    w=pd.DatetimeIndex(data.week)
    return (w>=pd.Timestamp(start,tz='UTC'))&(w+pd.Timedelta(days=7)<=pd.Timestamp(end,tz='UTC'))

def bootstrap_one(args):
    train,bridge,mode,initial,seed=args
    rng=np.random.default_rng(seed)
    def weights(d):
        block=time_block_ids(d.week)
        _,idx=np.unique(block,return_inverse=True)
        draws=rng.exponential(size=idx.max()+1)
        weight=draws[idx]
        return weight/weight.mean()
    model=fit(train,mode,weights(train),initial,required_platforms=[0,1,2,3])
    model=fit_bridge(model,bridge,weights(bridge))
    return model['theta']

def run(source,out,workers=4,n_bootstrap=100):
    source,out=Path(source),Path(out);out.mkdir(parents=True,exist_ok=True)
    obs=pd.read_csv(source/'observations.csv.gz',parse_dates=['week_start_utc'])
    cells=pd.read_csv(source/'cells.csv')
    pairs=make_pairs(obs,cells)
    established=(pairs.left!=4)&(pairs.right!=4)
    nonspatial=~pairs.spatial_holdout
    inner_train=pairs.take(window(pairs,'2002-07-08','2019-01-01')&established&nonspatial)
    inner_val=pairs.take(window(pairs,'2019-01-01','2022-01-01')&established&nonspatial)
    records=[];models=[]
    identity={'mode':'global','theta':[0.]*4,'n_features':1}
    records.append({'candidate':'identity',**pair_scores(identity,inner_val)})
    selected=None;best=None
    for mode in ['global','seasonal','regional_seasonal']:
        model=fit(inner_train,mode,required_platforms=[0,1,2,3])
        score=pair_scores(model,inner_val)
        records.append({'candidate':mode,**score})
        models.append(model)
        print(mode,score,flush=True)
        if selected is None or score['conditional_nll']<best*.99:
            selected=mode;best=score['conditional_nll']
    pd.DataFrame(records).to_csv(out/'inner_validation.csv',index=False)
    training=pairs.take(window(pairs,'2002-07-08','2022-01-01')&established&nonspatial)
    bridge_mask=window(pairs,'2023-03-06','2023-07-01')&nonspatial
    bridge_mask &= ((pairs.left==4)&np.isin(pairs.right,[1,3]))|((pairs.right==4)&np.isin(pairs.left,[1,3]))
    bridge=pairs.take(bridge_mask)
    model=fit(training,selected,required_platforms=[0,1,2,3])
    model=fit_bridge(model,bridge)
    outer=window(pairs,'2022-01-01','2023-03-01')|window(pairs,'2023-07-01','2024-01-01')
    scores=[]
    for label,mask in [('temporal_validation',outer&nonspatial),('spatial_temporal_validation',outer&pairs.spatial_holdout)]:
        d=pairs.take(mask)
        for name,m in [('identity',identity),('selected',model)]:
            scores.append({'split':label,'model':name,**pair_scores(m,d)})
    pd.DataFrame(scores).to_csv(out/'outer_validation.csv',index=False)
    seeds=np.random.SeedSequence(20261114).generate_state(n_bootstrap)
    args=[(training,bridge,selected,model['theta'],int(seed)) for seed in seeds]
    start=time.monotonic()
    with ProcessPoolExecutor(max_workers=workers) as pool:
        draws=list(pool.map(bootstrap_one,args,chunksize=1))
    draws=np.asarray(draws)
    assert np.ptp(draws,axis=0).max()>1e-5,'Bootstrap degenerate: inspect time-block units and weights.'
    np.savez_compressed(out/'bootstrap_parameters.npz',theta=draws)
    factors=[]
    year=2020
    for p in PLATFORMS:
        for month in range(1,13):
            for band,latitude in [('north',-4.),('central',-9.),('south',-15.)]:
                # Pick a Monday whose Thursday midpoint is in the requested month.
                day=pd.Timestamp(year=year,month=month,day=15,tz='UTC')
                week=day-pd.Timedelta(days=day.dayofweek)
                value=float(np.exp(-log_response(model,p,[week],[latitude])[0]))
                boot=[]
                for theta in draws:
                    boot.append(float(np.exp(-log_response({**model,'theta':theta.tolist()},p,[week],[latitude])[0])))
                lo,hi=np.quantile(boot,[.025,.975])
                factors.append({'platform':p,'month':month,'latitude_band':band,'factor':value,
                                'factor_low':min(float(lo),value),'factor_high':max(float(hi),value)})
    pd.DataFrame(factors).to_csv(out/'calibration_factors.csv',index=False)
    metadata={**model,'version':'empirical-positive-pair-v1.1','created_from':'SP type0 cell-week positives',
        'selection_rule':'complexity increases only for >=1% lower conditional NLL on 2019-2021',
        'selection_period':'2019-2021','established_platform_fit':'2002-2021',
        'NOAA21_bridge':'March-June 2023, own relative intercept only',
        'outer_validation':'2022 plus Jan-Feb and Jul-Dec 2023',
        'spatial_holdout':'deterministic 1/7 of 200km blocks excluded from all fitting',
        'final_test_2024_2025_evaluated':False,'n_bootstrap':n_bootstrap,
        'bootstrap_seconds':time.monotonic()-start,
        'bootstrap_training_blocks':int(len(np.unique(time_block_ids(training.week)))),
        'bootstrap_bridge_blocks':int(len(np.unique(time_block_ids(bridge.week)))),
        'timestamp_storage_units_normalized':'ns before integer epoch arithmetic',
        'uncertainty_kind':'28-day block Bayesian-bootstrap calibration-factor band only',
        'coverage_corrected':False,'physically_complete_harmonization':False,
        'selection_bias_assumption':'Poisson relative response conditional on paired positives; unknown coverage is not recovered',
        'count_unit':'reported detections on the geometric-mean Aqua/SNPP response scale',
        'new_platform_counts_must_not_be_summed':True,
        'source_priority':'Aqua for MODIS, Suomi-NPP for VIIRS; bridges only for national-week anchor outages',
        'Terra_post2023_fallback_allowed':False}
    (out/'model.json').write_text(json.dumps(metadata,indent=2),encoding='utf-8')
    print('Selected',selected,'bootstrap',draws.shape,flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',required=True,type=Path)
    p.add_argument('--out',required=True,type=Path);p.add_argument('--workers',type=int,default=4)
    p.add_argument('--bootstrap',type=int,default=100);a=p.parse_args()
    run(a.source,a.out,a.workers,a.bootstrap)
