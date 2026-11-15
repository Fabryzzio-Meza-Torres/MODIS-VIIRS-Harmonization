"""Independent implementation of Sofiev & Kouznetsov 2026 Eqs. 5-7.

For a hypothetical pixel FRP under valid retrieval, not an inverse count correction.
Numerical constants transcribed from the published tables 1/2 (CC BY 4.0).
No FRP_OOp repository source code is imported or copied.

Status: research diagnostic. Not validated for Peru or enabled in production.
Eq.6 A0 is fixed to zero here: this assumption is explicit because the tables
do not supply A0. Textual nadir summaries disagree with some table evaluations.
"""
import numpy as np
from scipy.special import expit

SOURCE='https://doi.org/10.5194/gmd-19-10123-2026'
# slope MW/km2, intercept MW, rate shift 1/MW, rate scale km2/MW, cutoff.
COEFFICIENTS={
    ('MODIS','D'):(4.44,.52,.07,1.26,.045),
    ('MODIS','N'):(4.43,1.01,.11,1.06,.045),
    ('VIIRS','D'):(6.17,1.44,.61,.21,.05),
    ('VIIRS','N'):(1.38,.35,2.12,1.02,.05),
}

def parameters(area_km2,instrument,daynight):
    area,sensor,dn=np.broadcast_arrays(np.asarray(area_km2,dtype=float),
        np.asarray(instrument,dtype=str),np.asarray(daynight,dtype=str))
    if np.any(~np.isfinite(area)|(area<=0)):raise ValueError('Finite positive area required.')
    if np.any(~np.isin(sensor,['MODIS','VIIRS'])) or np.any(~np.isin(dn,['D','N'])):
        raise ValueError('Expected MODIS/VIIRS and D/N.')
    coeff=np.zeros((*area.shape,5))
    for key,values in COEFFICIENTS.items():coeff+=((sensor==key[0])&(dn==key[1]))[...,None]*values
    midpoint=coeff[...,0]*area+coeff[...,1]
    rate=coeff[...,2]+coeff[...,3]/area
    return midpoint,rate,coeff[...,4]

def response_weight(frp_mw,area_km2,instrument,daynight):
    """FRP operator response factor on valid pixels. Not an omission estimate.
    Applying it to reported (already selected) FRP does not infer missing fires.
    """
    power=np.asarray(frp_mw,dtype=float)
    if np.any(~np.isfinite(power)|(power<0)):raise ValueError('Finite nonnegative FRP required.')
    midpoint,rate,cutoff=parameters(area_km2,instrument,daynight)
    return np.clip((expit(rate*(power-midpoint))-cutoff)/(1-cutoff),0,1)

def forward_frp(frp_mw,area_km2,instrument,daynight,retrieval_valid=True):
    """Predicted observed FRP for a hypothetical input; invalid retrieval stays NaN."""
    value=np.asarray(frp_mw,dtype=float)*response_weight(frp_mw,area_km2,instrument,daynight)
    return np.where(retrieval_valid,value,np.nan)
