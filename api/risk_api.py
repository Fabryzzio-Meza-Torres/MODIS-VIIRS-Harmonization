"""Read-only experimental regional forecasts with integrity and freshness gates.

No scientific/training dependencies are needed in the serving process.
"""
from datetime import date,datetime,timedelta,timezone
from pathlib import Path
from typing import Annotated,Literal
from functools import lru_cache
from zoneinfo import ZoneInfo
import hashlib,json,os
from fastapi import APIRouter,HTTPException,Query
from pydantic import BaseModel,Field


class RiskRecord(BaseModel):
    region_id:str
    region_name:str
    issued_at:datetime
    target_week_start:date
    target_week_end_exclusive:date
    lead_weeks:int=Field(ge=1,le=12)
    probability:float|None=Field(default=None,ge=0,le=1)
    probability_percent:float|None=Field(default=None,ge=0,le=100)
    estimation_status:Literal['estimated','unavailable']
    quality_status:Literal['experimental','insufficient_support']
    unavailable_reasons:list[str]
    features_outside_region_training_range:list[str]


class RiskPagination(BaseModel):
    limit:int
    offset:int
    next_offset:int|None


class RiskPage(BaseModel):
    metadata:dict
    data:list[RiskRecord]
    pagination:RiskPagination


def _reject_constant(value):
    raise ValueError('Non-finite JSON constant')


@lru_cache(maxsize=4)
def _verified_snapshot(path,manifest_path,mtime_ns,manifest_mtime_ns,size):
    raw=Path(path).read_bytes()
    manifest=json.loads(Path(manifest_path).read_text(encoding='utf-8'),parse_constant=_reject_constant)
    if len(raw)>4*1024**2 or len(raw)!=manifest['bytes']:
        raise ValueError('Forecast snapshot length mismatch')
    digest=hashlib.sha256(raw).hexdigest()
    if digest!=manifest['sha256']:raise ValueError('Forecast snapshot hash mismatch')
    document=json.loads(raw,parse_constant=_reject_constant)
    meta=document['metadata']
    if meta['snapshot_id']!=manifest['snapshot_id'] or meta['method_version']!=manifest['method_version']:
        raise ValueError('Snapshot metadata mismatch')
    if meta['physical_ignition_probability_verified'] is not False:
        raise ValueError('This endpoint only serves the reviewed experimental proxy')
    reference=datetime.fromisoformat(meta['feature_reference_at'])
    if reference.tzinfo is None:raise ValueError('Reference must include timezone')
    reference=reference.astimezone(ZoneInfo('America/Lima'))
    issued=datetime.fromisoformat(meta['issued_at'])
    if issued.tzinfo is None or issued<reference or reference.weekday()!=6 or reference.time()!=datetime.min.time():
        raise ValueError('Invalid reference/issue time')
    ingested=datetime.fromisoformat(meta['NRT_ingested_at'])
    acquired=datetime.fromisoformat(meta['NRT_last_acquisition_utc'])
    if ingested.tzinfo is None or acquired.tzinfo is None or acquired>ingested or ingested>issued:
        raise ValueError('Invalid acquisition/ingestion/publication ordering')
    records=[];keys=set()
    for item in document['data']:
        record=RiskRecord.model_validate(item)
        if record.region_id not in {f'{i:02d}' for i in range(1,26)}:
            raise ValueError('Unknown region')
        key=(record.region_id,record.lead_weeks)
        if key in keys:raise ValueError('Duplicate region/lead')
        keys.add(key)
        expected=(reference+timedelta(days=1+7*(record.lead_weeks-1))).date()
        if record.target_week_start!=expected or record.target_week_end_exclusive!=expected+timedelta(days=7):
            raise ValueError('Target week/lead mismatch')
        if record.issued_at!=issued:raise ValueError('Mixed issue times')
        if record.estimation_status=='estimated':
            if record.probability is None or record.probability_percent is None:
                raise ValueError('Estimated probability missing')
            if abs(record.probability*100-record.probability_percent)>1e-9:
                raise ValueError('Probability/percent mismatch')
            if record.quality_status!='experimental' or record.unavailable_reasons:
                raise ValueError('Estimated status mismatch')
        elif record.probability is not None or record.probability_percent is not None or not record.unavailable_reasons or record.quality_status!='insufficient_support':
            raise ValueError('Unavailable probability must stay null with a reason')
        records.append(record)
    if len(keys)!=300 or len(records)!=manifest['rows'] or len(records)!=meta['forecast_rows']:
        raise ValueError('Incomplete forecast grid')
    records.sort(key=lambda r:(r.target_week_start,r.region_id))
    return meta,tuple(records),digest,reference,issued


def router(snapshot_path=None,clock=None):
    api=APIRouter(prefix='/v1/fire-risk',tags=['Experimental regional forecasts'])
    path=Path(snapshot_path or os.environ.get('FIRMS_RISK_SNAPSHOT',
        Path(__file__).resolve().parents[1]/'data/regional_outlook.json')).resolve()
    manifest_path=path.with_name(path.stem+'_manifest.json')
    now=clock or (lambda:datetime.now(timezone.utc))

    def loaded():
        if not path.is_file() or not manifest_path.is_file():
            raise HTTPException(503,detail={'code':'risk_snapshot_not_loaded'})
        try:
            return _verified_snapshot(str(path),str(manifest_path),path.stat().st_mtime_ns,
                                      manifest_path.stat().st_mtime_ns,path.stat().st_size)
        except (ValueError,KeyError,TypeError,OSError) as error:
            raise HTTPException(503,detail={'code':'risk_snapshot_integrity_failure'}) from error

    def context(require_fresh=True):
        meta,records,digest,reference,issued=loaded()
        current=now().astimezone(timezone.utc)
        expires=reference+timedelta(days=7)
        expired=current>=expires
        if require_fresh and (expired or current<issued):
            raise HTTPException(503,detail={'code':'risk_snapshot_expired' if expired else 'risk_snapshot_not_yet_issued',
                'issued_at':issued.isoformat(),'valid_until':expires.isoformat(),
                'message':'No se sirve un porcentaje vigente sin un snapshot actualizado.'})
        info={k:v for k,v in meta.items() if k not in ['status','public_api_modified']}
        info.update(status='experimental_snapshot',snapshot_sha256=digest,
            valid_until=expires.isoformat(),refresh_required=expired,
            snapshot_age_hours=(current-issued).total_seconds()/3600,
            NRT_last_acquisition_age_hours_now=(current-datetime.fromisoformat(meta['NRT_last_acquisition_utc'])).total_seconds()/3600,
            available_target_weeks=sorted({r.target_week_start.isoformat() for r in records}),
            interpretation_es='Probabilidad experimental de al menos un nuevo episodio detectado en la región durante esa semana; no ignición física verificada.')
        return info,records,current

    @api.get('/metadata')
    def metadata():
        info,_,_=context(require_fresh=False)
        return info

    @api.get('/outlook',response_model=RiskPage)
    def outlook(region_id:Annotated[str|None,Query(pattern=r'^\d{2}$')]=None,
                limit:Annotated[int,Query(ge=1,le=1000)]=100,
                offset:Annotated[int,Query(ge=0,le=1000000)]=0):
        info,records,_=context()
        if region_id and region_id not in {r.region_id for r in records}:
            raise HTTPException(404,detail={'code':'region_not_found'})
        found=[r for r in records if not region_id or r.region_id==region_id]
        return {'metadata':info,'data':found[offset:offset+limit],
            'pagination':{'limit':limit,'offset':offset,'next_offset':offset+limit if offset+limit<len(found) else None}}

    @api.get('',response_model=RiskPage)
    def regional_week(region_id:Annotated[str,Query(pattern=r'^\d{2}$')],target_week_start:date):
        if target_week_start.weekday()!=0:
            raise HTTPException(422,detail={'code':'target_week_must_start_on_monday'})
        info,records,current=context()
        if region_id not in {r.region_id for r in records}:
            raise HTTPException(404,detail={'code':'region_not_found'})
        found=[r for r in records if r.region_id==region_id and r.target_week_start==target_week_start]
        if not found:
            raise HTTPException(404,detail={'code':'target_week_not_in_published_outlook',
                'available_target_weeks':info['available_target_weeks']})
        start=datetime.combine(target_week_start,datetime.min.time(),ZoneInfo('America/Lima'))
        info={**info,'target_period_status':'upcoming' if current<start else 'in_progress' if current<start+timedelta(days=7) else 'ended',
              'prediction_is_recomputed_per_request':False}
        return {'metadata':info,'data':found,'pagination':{'limit':1,'offset':0,'next_offset':None}}

    return api
