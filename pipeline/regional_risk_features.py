"""Forecast feature extractor checked against the frozen training matrix.

Feature reference time is the scheduled Sunday cutoff. Actual publication time
is separate and must never be backdated to that reference time.
"""
from pathlib import Path
from contextlib import closing
import sqlite3
import numpy as np
import pandas as pd

DAY_NS=86400*10**9


class RegionalFeatureStore:
    def __init__(self,regions,detections,weather,harmonized):
        self.regions={str(r.region_id).zfill(2):r for r in regions.itertuples()}
        self.harmonized=harmonized
        self.reference={};self.weather={};self.cache={}
        for rid in self.regions:
            a=detections.loc[detections.region_id.eq(rid)].sort_values('timestamp_utc')
            times=pd.DatetimeIndex(a.timestamp_utc).as_unit('ns').asi8
            self.reference[rid]=(times,np.r_[0.,a.frp_mw.to_numpy().cumsum()],
                np.r_[0,a.is_candidate_onset.astype(bool).to_numpy(dtype=np.int64).cumsum()])
            w=weather.loc[weather.region_id.eq(rid)].sort_values('date').reset_index(drop=True)
            if w.empty:raise ValueError(f'Missing weather point for {rid}')
            if w.date.duplicated().any():raise ValueError('Duplicate weather dates')
            if (w.date.diff().dropna()!=pd.Timedelta(days=1)).any():
                raise ValueError('Weather calendar has gaps; missing days must be explicit')
            available=pd.DatetimeIndex(w.date).as_unit('ns').asi8+8*DAY_NS
            features={}
            for window in [7,28,90]:
                for field in ['T2M','RH2M','WS2M']:
                    features[f'{field.lower()}_mean_{window}d']=w[field].rolling(window,min_periods=window).mean().to_numpy()
                features[f'rain_sum_{window}d']=w.PRECTOTCORR.rolling(window,min_periods=window).sum().to_numpy()
            self.weather[rid]=(w,available,features)

    @classmethod
    def from_files(cls,repo,detections,weather):
        repo=Path(repo)
        if not isinstance(detections,pd.DataFrame):
            detections=pd.read_csv(detections,dtype={'region_id':str})
            detections['timestamp_utc']=pd.to_datetime(detections.timestamp_utc,utc=True)
        if not isinstance(weather,pd.DataFrame):
            weather=pd.read_csv(weather,dtype={'region_id':str},parse_dates=['date'])
        with closing(sqlite3.connect((repo/'api/history.sqlite').resolve().as_uri()+'?mode=ro',uri=True)) as db:
            regions=pd.read_sql_query('SELECT region_id,name,min_lon,min_lat,max_lon,max_lat FROM regions ORDER BY region_id',db)
        history=pd.read_csv(repo/'data/regional_series.csv.gz',dtype={'region_id':str})
        history['week_start_utc']=pd.to_datetime(history.week_start_utc)
        harmonized={}
        for key,g in history.groupby(['region_id','week_start_utc']):
            values=g.harmonized_count.dropna().to_numpy()
            harmonized[(key[0],key[1].strftime('%Y-%m-%d'))]=(float(values.mean()) if len(values) else np.nan,len(values))
        return cls(regions,detections,weather,harmonized)

    def _past(self,rid,reference):
        key=(rid,reference.isoformat())
        if key in self.cache:return self.cache[key]
        times,cum_frp,cum_onsets=self.reference[rid]
        cutoff=reference.as_unit('ns').value-3*DAY_NS
        right=np.searchsorted(times,cutoff,side='left')
        previous={}
        for window in [7,28,90]:
            left=np.searchsorted(times,cutoff-window*DAY_NS,side='left')
            previous[f'log_ref_records_{window}d']=float(np.log1p(right-left))
            previous[f'log_ref_frp_sum_{window}d']=float(np.log1p(cum_frp[right]-cum_frp[left]))
            previous[f'log_detected_onsets_{window}d']=float(np.log1p(cum_onsets[right]-cum_onsets[left]))
        previous['days_since_ref_record']=float(min((cutoff-times[right-1])/DAY_NS,365.)) if right else 365.
        previous['ref_no_records_90d']=int(previous['log_ref_records_90d']==0)
        w,available,features=self.weather[rid]
        wi=np.searchsorted(available,reference.as_unit('ns').value,side='right')-1
        if wi<0:raise ValueError('No weather available before reference time')
        if right:assert times[right-1]<cutoff
        assert available[wi]<=reference.as_unit('ns').value
        result={'weather_value_day':w.date.iloc[wi].strftime('%Y-%m-%d'),
            'reference_cutoff_exclusive':pd.Timestamp(cutoff,tz='UTC').isoformat(),
            **previous,**{k:float(v[wi]) for k,v in features.items()}}
        self.cache[key]=result
        return result

    def vector(self,rid,reference_time,target_week_start,lead):
        rid=str(rid).zfill(2)
        if rid not in self.regions:raise ValueError('Unknown region')
        reference=pd.Timestamp(reference_time)
        target=pd.Timestamp(target_week_start)
        if reference.tzinfo is None or target.tzinfo is None:
            raise ValueError('Reference and target must have explicit timezones')
        reference=reference.tz_convert('America/Lima');target=target.tz_convert('America/Lima')
        if reference.dayofweek!=6 or reference.time()!=pd.Timestamp('00:00').time():
            raise ValueError('Feature reference must be Sunday 00:00 America/Lima')
        if int(lead) not in range(1,13) or lead!=int(lead):raise ValueError('Lead must be 1..12')
        expected=reference+pd.Timedelta(days=1+7*(int(lead)-1))
        if target!=expected:raise ValueError('Target week does not match lead/reference')
        annual_week=target-pd.Timedelta(weeks=52)
        assert annual_week+pd.Timedelta(days=7)<reference
        annual,n=self.harmonized.get((rid,annual_week.strftime('%Y-%m-%d')),(np.nan,0))
        phase=2*np.pi*(target.dayofyear-1)/365.2425
        region=self.regions[rid]
        return {'target_season_sin':float(np.sin(phase)),'target_season_cos':float(np.cos(phase)),
            'center_lon':(region.min_lon+region.max_lon)/2,'center_lat':(region.min_lat+region.max_lat)/2,
            'log_harmonized_annual_context':float(np.log1p(annual)) if np.isfinite(annual) else np.nan,
            'harmonized_annual_context_missing':int(not np.isfinite(annual)),
            'harmonized_context_instruments':n,**self._past(rid,reference)}
