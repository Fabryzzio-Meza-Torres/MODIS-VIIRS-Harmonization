"""Relative platform calibration with explicit positive-count selection.

Poisson mean assumption: mu_sg = exposure_sg * activity_g * response_sg.
Conditioning on paired total removes activity_g. For unknown coverage, only
positive pairs are used and the binomial is conditioned on both counts > 0.
This empirical path cannot identify or correct historical observation exposure.
The same score accepts known exposure offsets and non-truncated observed zeros.
"""
from dataclasses import dataclass
from itertools import combinations
import numpy as np
import pandas as pd
from scipy.optimize import minimize
from scipy.special import expit,gammaln

PLATFORMS=['Aqua','Suomi-NPP','Terra','NOAA-20','NOAA-21']
# log responses: Aqua/SNPP have geometric mean one. Other platforms are bridges.
EMBED=np.array([[.5,0,0,0],[-.5,0,0,0],[.5,1,0,0],[-.5,0,1,0],[-.5,0,0,1]],dtype=float)

def features(weeks,latitude,mode):
    month=(pd.DatetimeIndex(weeks)+pd.Timedelta(days=3)).month.to_numpy()
    x=[np.ones(len(month))]
    if mode in ['seasonal','regional_seasonal']:
        x += [np.sin(2*np.pi*(month-1)/12),np.cos(2*np.pi*(month-1)/12)]
    if mode=='regional_seasonal':
        x += [(np.asarray(latitude)>-6).astype(float),(np.asarray(latitude)<-12).astype(float)]
    return np.column_stack(x)

@dataclass
class Pairs:
    left: np.ndarray
    right: np.ndarray
    nleft: np.ndarray
    total: np.ndarray
    week: np.ndarray
    latitude: np.ndarray
    spatial_holdout: np.ndarray
    truncated: np.ndarray
    offset: np.ndarray

    def take(self,mask):
        return Pairs(**{k:np.asarray(v)[mask] for k,v in self.__dict__.items()})

def make_pairs(observations,cells):
    wide=observations.pivot(index=['cell_id','week_start_utc'],columns='platform',values='raw_count').reindex(columns=PLATFORMS)
    meta=wide.index.to_frame(index=False).merge(cells[['cell_id','center_lat','ix','iy']],on='cell_id',how='left')
    block_x=np.floor_divide(meta.ix.to_numpy(),20)
    block_y=np.floor_divide(meta.iy.to_numpy(),20)
    holdout=np.mod(block_x*73856093+block_y*19349663,7)==0
    allpairs=[]
    for left,right in combinations(range(len(PLATFORMS)),2):
        a,b=wide.iloc[:,left].to_numpy(),wide.iloc[:,right].to_numpy()
        use=np.isfinite(a)&np.isfinite(b)&((a+b)>=3)
        idx=np.flatnonzero(use)
        if not len(idx):continue
        allpairs.append(Pairs(np.full(len(idx),left),np.full(len(idx),right),a[idx],a[idx]+b[idx],
                             pd.to_datetime(meta.week_start_utc,utc=True).to_numpy()[idx],
                             meta.center_lat.to_numpy()[idx],holdout[idx],
                             np.ones(len(idx),dtype=bool),np.zeros(len(idx))))
    if not allpairs:raise ValueError('No informative positive pairs.')
    return Pairs(**{k:np.concatenate([getattr(p,k) for p in allpairs]) for k in allpairs[0].__dict__})

def check_connected(data,required_platforms=None):
    required=set(range(len(PLATFORMS))) if required_platforms is None else set(required_platforms)
    edges=[set([int(a),int(b)]) for a,b in set(zip(data.left,data.right))]
    seen={0}
    for _ in PLATFORMS:
        for edge in edges:
            if seen.intersection(edge):seen.update(edge)
    if not required.issubset(seen):
        raise ValueError('Calibration overlap graph disconnected; no common scale identifiable.')

def terms(b,data):
    logp=-np.logaddexp(0.,-b)
    logq=-np.logaddexp(0.,b)
    p=np.exp(logp);q=np.exp(logq)
    n=data.total
    norm=np.zeros(len(n));dnorm=np.zeros(len(n))
    truncated=data.truncated
    if truncated.any():
        nn=n[truncated];lp=logp[truncated];lq=logq[truncated]
        u,v=nn*lp,nn*lq
        logsum=np.logaddexp(u,v)
        denom=-np.expm1(logsum)
        if np.any(denom<=0):raise FloatingPointError('Degenerate positive-pair normalization.')
        norm[truncated]=np.log(denom)
        dnorm[truncated]=-nn*(np.exp(u+lq)-np.exp(v+lp))/denom
    loss=-data.nleft*logp-(n-data.nleft)*logq+norm
    derivative=n*p-data.nleft+dnorm
    return loss,derivative,logp,logq,norm

def fit(data,mode='global',weights=None,initial=None,required_platforms=None):
    check_connected(data,required_platforms)
    x=features(data.week,data.latitude,mode)
    embedding=EMBED[data.left]-EMBED[data.right]
    # Each row has four platform-contrast blocks, with a few covariates per block.
    design=np.einsum('ij,ik->ijk',embedding,x).reshape(len(x),-1)
    weights=np.ones(len(x)) if weights is None else np.asarray(weights,dtype=float)
    penalty=np.tile(np.array([1e-5]+([20.,20.] if x.shape[1]>=3 else [])+
                             ([100.,100.] if x.shape[1]>=5 else [])),4)
    bounds=[(-8.,8.) for _ in penalty]
    # NOAA-21 bridge only covers part of 2023: do not fit its own annual harmonic.
    for i in range(3*x.shape[1]+1,4*x.shape[1]):bounds[i]=(0.,0.)
    if required_platforms is not None and 4 not in required_platforms:
        for i in range(3*x.shape[1],4*x.shape[1]):bounds[i]=(0.,0.)
    def objective(theta):
        loss,derivative,*_=terms(design@theta+data.offset,data)
        return (float(weights@loss+.5*np.sum(penalty*theta**2)),
                design.T@(weights*derivative)+penalty*theta)
    start=np.zeros(design.shape[1]) if initial is None else np.asarray(initial)
    result=minimize(objective,start,jac=True,method='L-BFGS-B',bounds=bounds,
                    options={'maxiter':300,'ftol':1e-10,'gtol':1e-5})
    if not result.success:raise RuntimeError('Calibration did not converge: '+result.message)
    return {'mode':mode,'theta':result.x.tolist(),'n_features':x.shape[1],
            'training_pairs':len(x),'iterations':int(result.nit),'objective':float(result.fun),
            'coverage_corrected':not data.truncated.any(),
            'reference':'geometric-mean response of Aqua and Suomi-NPP equals one'}

def fit_bridge(model,data,weights=None):
    """Freeze established-platform responses; fit NOAA21's relative intercept only."""
    from scipy.optimize import minimize_scalar
    base=log_response(model,data.left,data.week,data.latitude)-log_response(model,data.right,data.week,data.latitude)+data.offset
    direction=(EMBED[data.left]-EMBED[data.right])[:,3]
    assert np.isin(direction,[-1.,1.]).all()
    weights=np.ones(len(base)) if weights is None else weights
    old=np.asarray(model['theta']).reshape(4,-1)[3,0]
    base=base-direction*old
    def objective(delta):
        loss=terms(base+direction*delta,data)[0]
        return float(weights@loss+.5*1e-5*delta**2)
    result=minimize_scalar(objective,bounds=(-8,8),method='bounded',options={'xatol':1e-8})
    if not result.success:raise RuntimeError('NOAA21 bridge did not converge')
    theta=np.asarray(model['theta']).reshape(4,-1).copy();theta[3,:]=0;theta[3,0]=result.x
    return {**model,'theta':theta.ravel().tolist(),'noaa21_bridge_pairs':len(base),
            'noaa21_bridge_changes_established_platforms':False}

def log_response(model,platform,weeks,latitude):
    x=features(weeks,latitude,model['mode'])
    theta=np.asarray(model['theta']).reshape(4,-1)
    if isinstance(platform,str):embedding=EMBED[PLATFORMS.index(platform)]
    else:embedding=EMBED[np.asarray(platform,dtype=int)]
    return np.sum((x@theta.T)*embedding,axis=-1)

def pair_scores(model,data):
    b=log_response(model,data.left,data.week,data.latitude)-log_response(model,data.right,data.week,data.latitude)+data.offset
    loss,_,lp,lq,norm=terms(b,data)
    logchoose=gammaln(data.total+1)-gammaln(data.nleft+1)-gammaln(data.total-data.nleft+1)
    expected=data.total*np.exp(lp)
    t=data.truncated
    expected[t]=data.total[t]*np.exp(lp[t])*(-np.expm1((data.total[t]-1)*lp[t]))/np.exp(norm[t])
    err=expected-data.nleft
    return {'pairs':len(data.total),'conditional_nll':float(np.mean(loss-logchoose)),
            'conditional_allocation_mae':float(np.mean(abs(err))),
            'conditional_allocation_rmse':float(np.sqrt(np.mean(err**2))),
            'mean_log_response_contrast':float(np.mean(b))}
