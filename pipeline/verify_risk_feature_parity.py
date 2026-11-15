"""Check operational extraction against all rows of the frozen training matrix."""
from pathlib import Path
import argparse,json
import numpy as np
import pandas as pd
from regional_risk_features import RegionalFeatureStore
from train_regional_risk import sha


def verify(repo,reference,weather,dataset,output):
    store=RegionalFeatureStore.from_files(repo,reference/'eligible_reference_detections.csv.gz',
                                         weather/'regional_point_weather.csv.gz')
    data=pd.read_csv(dataset/'regional_risk_training_rows.csv.gz',dtype={'region_id':str})
    manifest=json.loads((dataset/'dataset_manifest.json').read_text(encoding='utf-8'))
    names=[c for c in manifest['features'] if c not in ['region_id','lead_weeks']]
    maximum={name:0. for name in names}
    for rid,chunk in data.groupby('region_id'):
        actual=[]
        for row in chunk.itertuples():
            target=pd.Timestamp(row.target_week_start,tz='America/Lima')
            values=store.vector(rid,pd.Timestamp(row.issued_at),target,row.lead_weeks)
            assert values['weather_value_day']==row.weather_value_day
            assert pd.Timestamp(values['reference_cutoff_exclusive'])==pd.Timestamp(row.reference_cutoff_exclusive)
            actual.append([values[c] for c in names])
        a=np.asarray(actual,dtype=float);b=chunk[names].to_numpy(dtype=float)
        assert np.array_equal(np.isnan(a),np.isnan(b)),f'Missingness mismatch: {rid}'
        difference=np.abs(np.nan_to_num(a)-np.nan_to_num(b))
        assert np.allclose(a,b,rtol=0,atol=1e-12,equal_nan=True),f'Feature mismatch: {rid}'
        for j,name in enumerate(names):maximum[name]=max(maximum[name],float(difference[:,j].max()))
        print('Feature parity',rid,len(chunk),'rows OK',flush=True)
    report={'status':'all_frozen_training_features_match','rows_checked':len(data),
        'absolute_tolerance':1e-12,'rtol':0,'missingness_matches':True,
        'max_absolute_difference_by_feature':maximum,
        'dataset_sha256':sha(dataset/'regional_risk_training_rows.csv.gz'),
        'extractor_sha256':sha(Path(__file__).with_name('regional_risk_features.py')),
        'model_refitted':False,'real_historical_release_times_verified':False}
    output.mkdir(parents=True,exist_ok=True)
    (output/'feature_parity_report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
    print(json.dumps({k:v for k,v in report.items() if k!='max_absolute_difference_by_feature'},indent=2),flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo',type=Path,default=Path(__file__).resolve().parents[1])
    p.add_argument('--reference',type=Path,required=True)
    p.add_argument('--weather',type=Path,required=True)
    p.add_argument('--dataset',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();verify(a.repo,a.reference,a.weather,a.dataset,a.output)
