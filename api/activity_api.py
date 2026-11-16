"""Explicit observed-activity probability and historical context; department only."""
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from functools import lru_cache
from typing import Annotated,Literal
from zoneinfo import ZoneInfo
import json,os
from fastapi import APIRouter,HTTPException,Query,Request
from pydantic import BaseModel,Field
from risk_api import RiskRecord,RiskPagination,_verified_snapshot

EVENT='at_least_one_eligible_fire_detection_recorded'

class HistoricalReference(BaseModel):
    frequency_percent:float|None=Field(ge=0,le=100)
    positive_weeks:int=Field(ge=0)
    total_weeks:int=Field(ge=0)
    years:list[int]
    seasonal_half_window_days:Literal[14]
    source:str
    is_independent_binomial_sample:Literal[False]
    coverage_corrected:Literal[False]

class ActivityRecord(RiskRecord):
    historical_reference:HistoricalReference
    difference_from_historical_frequency_pp:float|None=Field(ge=-100,le=100)

class ActivityPage(BaseModel):
    metadata:dict
    data:list[ActivityRecord]
    pagination:RiskPagination

@lru_cache(maxsize=4)
def verified(path,manifest,mtime,manifest_mtime,size):
    meta,_,digest,reference,issued=_verified_snapshot(path,manifest,mtime,manifest_mtime,size)
    if meta['target_event']!=EVENT or meta['supported_spatial_units']!=['department']:
        raise ValueError('Wrong target or geographic scope')
    for key in ['province_probability_available','national_probability_available','point_probability_available',
                'probability_is_detection_classification_confidence','probability_is_area_burned_fraction',
                'physical_ignition_probability_verified','difference_is_significance_test']:
        if meta[key] is not False:raise ValueError('Unsupported scientific interpretation')
    if not meta['method_version'].startswith('regional-recorded-fire-activity-'):
        raise ValueError('Wrong method family')
    document=json.loads(Path(path).read_bytes())
    records=[]
    for item in document['data']:
        row=ActivityRecord.model_validate(item);history=row.historical_reference
        if history.positive_weeks>history.total_weeks:raise ValueError('Invalid historical denominator')
        if history.years!=sorted(set(history.years)):raise ValueError('Duplicate or unsorted years')
        if any(y>=row.target_week_start.year for y in history.years):raise ValueError('Historical years include target year')
        if history.total_weeks>=20:
            expected=100*history.positive_weeks/history.total_weeks
            if history.frequency_percent is None or abs(history.frequency_percent-expected)>1e-9:
                raise ValueError('Historical frequency mismatch')
        elif history.frequency_percent is not None:raise ValueError('Insufficient historical support must stay null')
        delta=row.difference_from_historical_frequency_pp
        if row.probability_percent is None or history.frequency_percent is None:
            if delta is not None:raise ValueError('Unavailable difference must stay null')
        elif delta is None or abs(delta-(row.probability_percent-history.frequency_percent))>1e-9:
            raise ValueError('Difference must be expressed in percentage points')
        records.append(row)
    records.sort(key=lambda r:(r.target_week_start,r.region_id))
    return meta,tuple(records),digest,reference,issued

def router(snapshot_path=None,clock=None):
    api=APIRouter(prefix='/v1/fire-activity',tags=['Experimental detected fire activity'])
    path=Path(snapshot_path or os.environ.get('FIRMS_ACTIVITY_SNAPSHOT',
        Path(__file__).resolve().parents[1]/'data/regional_activity_outlook.json')).resolve()
    manifest=path.with_name(path.stem+'_manifest.json')
    now=clock or (lambda:datetime.now(timezone.utc))

    def context(require_fresh=True):
        if not path.is_file() or not manifest.is_file():
            raise HTTPException(503,detail={'code':'activity_snapshot_not_loaded'})
        try:
            meta,records,digest,reference,issued=verified(str(path),str(manifest),path.stat().st_mtime_ns,
                manifest.stat().st_mtime_ns,path.stat().st_size)
        except (ValueError,KeyError,TypeError,OSError) as error:
            raise HTTPException(503,detail={'code':'activity_snapshot_integrity_failure'}) from error
        current=now().astimezone(timezone.utc);expires=reference+timedelta(days=7)
        if require_fresh and (current>=expires or current<issued):
            raise HTTPException(503,detail={'code':'activity_snapshot_expired' if current>=expires else 'activity_snapshot_not_yet_issued',
                'message':'Pronóstico no disponible hasta publicar una emisión vigente.',
                'valid_until':expires.isoformat()})
        info={**meta,'valid_until':expires.isoformat(),'refresh_required':current>=expires,
            'server_time_utc':current.isoformat(),
            'snapshot_sha256':digest,'snapshot_age_hours':(current-issued).total_seconds()/3600,
            'available_target_weeks':sorted({r.target_week_start.isoformat() for r in records}),
            'interpretation_es':meta['ui']['explanation_es']}
        return info,records,current

    def allowed(request,names):
        extra=set(request.query_params)-set(names)
        duplicate=[key for key in request.query_params if len(request.query_params.getlist(key))>1]
        if extra or duplicate:
            raise HTTPException(422,detail={'code':'unsupported_or_ambiguous_activity_filter',
                'unsupported_parameters':sorted(extra),'duplicated_parameters':duplicate,
                'message':'El modelo solo calcula por departamento y semana. No admite filtros provinciales o por punto.'})

    def page(meta,records,limit,offset):
        return {'metadata':meta,'data':records[offset:offset+limit],
            'pagination':{'limit':limit,'offset':offset,'next_offset':offset+limit if offset+limit<len(records) else None}}

    @api.get('/metadata')
    def metadata():return context(require_fresh=False)[0]

    @api.get('/outlook',response_model=ActivityPage)
    def outlook(request:Request,region_id:Annotated[str|None,Query(pattern=r'^\d{2}$')]=None,
                limit:Annotated[int,Query(ge=1,le=1000)]=100,offset:Annotated[int,Query(ge=0,le=1000000)]=0):
        allowed(request,['region_id','limit','offset'])
        info,records,_=context()
        if region_id and region_id not in {r.region_id for r in records}:raise HTTPException(404,detail={'code':'region_not_found'})
        return page(info,[r for r in records if not region_id or r.region_id==region_id],limit,offset)

    @api.get('',response_model=ActivityPage)
    def regional_week(request:Request,region_id:Annotated[str,Query(pattern=r'^\d{2}$')],target_week_start:date):
        allowed(request,['region_id','target_week_start'])
        if target_week_start.weekday()!=0:raise HTTPException(422,detail={'code':'target_week_must_start_on_monday'})
        info,records,current=context()
        if region_id not in {r.region_id for r in records}:raise HTTPException(404,detail={'code':'region_not_found'})
        rows=[r for r in records if r.region_id==region_id and r.target_week_start==target_week_start]
        if not rows:raise HTTPException(404,detail={'code':'target_week_not_in_published_outlook','available_target_weeks':info['available_target_weeks']})
        start=datetime.combine(target_week_start,datetime.min.time(),ZoneInfo('America/Lima'))
        info['target_period_status']='upcoming' if current<start else 'in_progress' if current<start+timedelta(days=7) else 'ended'
        return page(info,rows,1,0)

    return api
