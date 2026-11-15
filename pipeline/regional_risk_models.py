"""Reusable experimental regional first-detection forecast estimators."""
import numpy as np
import pandas as pd
from scipy.special import expit,logit
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder,StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.pipeline import Pipeline
from sklearn.linear_model import LogisticRegression
from lightgbm import LGBMClassifier,early_stopping

REGIONS=[f'{i:02d}' for i in range(1,26)]


class RegionalRiskEstimator:
    def __init__(self,kind,features,params=None):
        self.kind=kind;self.features=list(features);self.params=params or {}

    def inputs(self,frame):
        values=frame[self.features].copy()
        values['region_id']=values.region_id.astype(str).str.zfill(2)
        if self.kind=='lightgbm':
            values['region_id']=pd.Categorical(values.region_id,categories=REGIONS)
        return values

    def fit(self,frame,selection=None):
        y=frame.y_new_detected_episode.to_numpy()
        if self.kind in ['constant','climatology']:
            unique=frame.drop_duplicates(['region_id','target_week_start'])
            self.prior=float((unique.y_new_detected_episode.sum()+.5)/(len(unique)+1))
            self.regional={};self.monthly={};self.global_month={}
            unique=unique.assign(month=pd.to_datetime(unique.target_week_start).dt.month)
            for rid,g in unique.groupby('region_id'):
                self.regional[str(rid)]=float((g.y_new_detected_episode.sum()+4*self.prior)/(len(g)+4))
            for month,g in unique.groupby('month'):
                self.global_month[int(month)]=float((g.y_new_detected_episode.sum()+8*self.prior)/(len(g)+8))
            for (rid,month),g in unique.groupby(['region_id','month']):
                p=self.regional[str(rid)]
                self.monthly[(str(rid),int(month))]=float((g.y_new_detected_episode.sum()+8*p)/(len(g)+8))
        elif self.kind=='logistic':
            numeric=[c for c in self.features if c!='region_id']
            transforms=ColumnTransformer([
                ('region',OneHotEncoder(handle_unknown='ignore',sparse_output=False),['region_id']),
                ('numeric',Pipeline([('impute',SimpleImputer(strategy='median',add_indicator=True,keep_empty_features=True)),
                                     ('scale',StandardScaler())]),numeric)])
            self.model=Pipeline([('features',transforms),('estimator',LogisticRegression(C=1.,max_iter=2000))])
            self.model.fit(self.inputs(frame),y)
        elif self.kind=='lightgbm':
            self.model=LGBMClassifier(objective='binary',n_estimators=500,learning_rate=.035,
                verbosity=-1,n_jobs=4,random_state=20261115,deterministic=True,
                force_col_wise=True,**self.params)
            options={}
            if selection is not None:
                options={'eval_set':[(self.inputs(selection),selection.y_new_detected_episode.to_numpy())],
                    'eval_metric':'binary_logloss','callbacks':[early_stopping(35,verbose=False)]}
            self.model.fit(self.inputs(frame),y,**options)
        else:
            raise ValueError(self.kind)
        return self

    def predict_proba(self,frame):
        if self.kind=='constant':
            return np.full(len(frame),self.prior)
        if self.kind=='climatology':
            months=pd.to_datetime(frame.target_week_start).dt.month
            return np.array([self.monthly.get((str(rid),int(month)),
                self.regional.get(str(rid),self.global_month.get(int(month),self.prior)))
                for rid,month in zip(frame.region_id,months)])
        return self.model.predict_proba(self.inputs(frame))[:,1]


class LeadProbabilityCalibrator:
    """Monotonic Platt transforms, fit on the separate 2023 period."""
    def fit(self,probability,labels,leads):
        self.transforms={}
        probability=np.clip(np.asarray(probability),1e-6,1-1e-6)
        labels=np.asarray(labels);leads=np.asarray(leads)
        for lead in range(1,13):
            mask=leads==lead
            y=labels[mask]
            if len(y)<30 or len(np.unique(y))<2:
                self.transforms[lead]={'slope':1.,'intercept':0.,'kind':'identity_insufficient_calibration','rows':len(y)}
                continue
            model=LogisticRegression(C=1.,max_iter=1000)
            model.fit(logit(probability[mask]).reshape(-1,1),y)
            slope=float(model.coef_[0,0]);intercept=float(model.intercept_[0])
            if slope<0:
                slope=0.;intercept=float(logit((y.sum()+.5)/(len(y)+1)))
                kind='constant_nonpositive_slope'
            else:
                kind='monotonic_platt'
            self.transforms[lead]={'slope':slope,'intercept':intercept,'kind':kind,'rows':len(y)}
        return self

    def predict(self,probability,leads):
        values=logit(np.clip(np.asarray(probability),1e-6,1-1e-6))
        return np.array([expit(self.transforms[int(lead)]['slope']*v+
                              self.transforms[int(lead)]['intercept'])
                         for v,lead in zip(values,leads)])
