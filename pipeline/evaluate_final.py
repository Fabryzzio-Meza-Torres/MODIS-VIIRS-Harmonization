"""One final evaluation after model selection. Never refits from test outcomes."""
from pathlib import Path
import argparse,hashlib,json
import pandas as pd
from calibration import make_pairs,pair_scores
from fit_calibration import window

def evaluate(source,model_folder):
    source,model_folder=Path(source),Path(model_folder)
    model_bytes=(model_folder/'model.json').read_bytes()
    model=json.loads(model_bytes)
    obs=pd.read_csv(source/'observations.csv.gz',parse_dates=['week_start_utc'])
    cells=pd.read_csv(source/'cells.csv');pairs=make_pairs(obs,cells)
    records=[]
    for year in [2024,2025]:
        period=window(pairs,f'{year}-01-01',f'{year+1}-01-01')
        for split,space in [('seen_space',~pairs.spatial_holdout),('heldout_space',pairs.spatial_holdout)]:
            subset=pairs.take(period&space)
            for name,m in [('identity',{'mode':'global','theta':[0.]*4,'n_features':1}),('selected',model)]:
                records.append({'year':year,'split':split,'model':name,**pair_scores(m,subset)})
    report=pd.DataFrame(records);report.to_csv(model_folder/'final_test_2024_2025.csv',index=False)
    frozen={'model_sha256_before_test':hashlib.sha256(model_bytes).hexdigest(),
        'final_test_evaluated':True,'model_json_is_frozen_pre_test_snapshot':True,
        'model_changed_during_test':model_bytes!=(model_folder/'model.json').read_bytes(),
        'evaluation':'conditional allocation on co-positive pairs, not recovery of real wildfire counts',
        'test_period':'complete weeks within each of 2024 and 2025',
        'tuning_after_test':False,'coverage_corrected':False}
    assert not frozen['model_changed_during_test']
    (model_folder/'final_evaluation.json').write_text(json.dumps(frozen,indent=2))
    print(report.to_string(index=False))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--model-folder',type=Path,required=True)
    a=p.parse_args();evaluate(a.source,a.model_folder)
