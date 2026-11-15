"""Reproducible offline model pipeline after original ZIP/boundary preparation."""
from pathlib import Path
import argparse,os,subprocess,sys

def run(artifacts,workers):
    artifacts=Path(artifacts).resolve();here=Path(__file__).resolve().parent
    root=artifacts/'23_demo_historica'
    env=os.environ.copy();env.setdefault('OMP_NUM_THREADS',str(workers))
    env.setdefault('OPENBLAS_NUM_THREADS','1');env.setdefault('MKL_NUM_THREADS','1')
    def call(script,*args):
        subprocess.run([sys.executable,str(here/script),*map(str,args)],check=True,env=env)
    call('prepare_history.py','--artifacts',artifacts,'--out',root/'data')
    call('fit_calibration.py','--source',root/'data','--out',root/'model','--workers',workers,'--bootstrap',100)
    call('export_series.py','--source',root/'data','--model-folder',root/'model','--out',root/'series')
    call('forecast.py','--source',root/'data','--series',root/'series','--out',root/'forecast')
    call('evaluate_final.py','--source',root/'data','--model-folder',root/'model')
    print('Empirical pipeline finished. Full historical coverage correction is not complete.')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--artifacts',type=Path,required=True)
    p.add_argument('--workers',type=int,default=min(8,os.cpu_count() or 1));a=p.parse_args()
    if not 1<=a.workers<=32:p.error('workers must be between 1 and 32')
    run(a.artifacts,a.workers)
