"""Read-only empirical series and experimental forecast, separate from full coverage gate."""
from contextlib import closing
from datetime import date,timedelta
from pathlib import Path
from typing import Annotated,Literal
import json,os,sqlite3
from fastapi import APIRouter,HTTPException,Query
from pydantic import BaseModel

class EmpiricalRecord(BaseModel):
    week_start_utc:date
    instrument:Literal['MODIS','VIIRS']
    platform:str|None=None
    raw_count:int|None=None
    harmonized_count:float|None=None
    lower_bound:float|None=None
    upper_bound:float|None=None
    coverage_status:Literal['unknown']='unknown'
    estimation_status:Literal['estimated','unavailable']='unavailable'

class PageInfo(BaseModel):
    limit:int
    offset:int
    next_offset:int|None

class SeriesPage(BaseModel):
    metadata:dict
    data:list[EmpiricalRecord]
    pagination:PageInfo

class GeographicCell(BaseModel):
    cell_id:str
    center_lon:float
    center_lat:float
    country_area_km2:float

class CellPage(BaseModel):
    metadata:dict
    data:list[GeographicCell]
    pagination:PageInfo

class ForecastRecord(GeographicCell):
    record_probability:float
    rank:int
    target_week_start:date
    target_week_end:date
    quality_flag:str

class ForecastPage(BaseModel):
    metadata:dict
    data:list[ForecastRecord]
    pagination:PageInfo

Limit=Annotated[int,Query(ge=1,le=1000)]
Offset=Annotated[int,Query(ge=0,le=1000000)]
Cell=Annotated[str|None,Query(pattern=r'^laea10_-?\d{1,5}_-?\d{1,5}$')]

def router(database_path=None):
    api=APIRouter()
    path=Path(database_path or os.environ.get('FIRMS_HISTORY_DB',Path(__file__).with_name('history.sqlite'))).resolve()
    def rows(sql,args=()):
        if not path.is_file():raise HTTPException(503,detail={'code':'empirical_data_not_loaded'})
        with closing(sqlite3.connect(path.as_uri()+'?mode=ro',uri=True)) as db:
            db.row_factory=sqlite3.Row
            return [dict(r) for r in db.execute(sql,args)]
    def metadata(name):
        r=rows('SELECT payload FROM metadata WHERE name=?',(name,))
        if not r:raise HTTPException(503,detail={'code':'dataset_not_loaded','dataset':name})
        return json.loads(r[0]['payload'])
    def page(found,info,limit,offset):
        return {'metadata':info,'data':found[:limit], 'pagination':{
            'limit':limit,'offset':offset,'next_offset':offset+limit if len(found)>limit else None}}
    def bounds(bbox):
        if bbox is None:return '',[]
        try:
            v=[float(x) for x in bbox.split(',')]
            if len(v)!=4 or not(-180<=v[0]<v[2]<=180 and -90<=v[1]<v[3]<=90):raise ValueError()
        except ValueError:raise HTTPException(422,detail='bbox: oeste,sur,este,norte, en grados.')
        return ' AND center_lon>=? AND center_lat>=? AND center_lon<=? AND center_lat<=?',v

    @api.get('/v1/empirical/metadata')
    def info():return {'series':metadata('series'),'forecast':metadata('forecast')}

    @api.get('/v1/validation')
    def validation():return metadata('validation')

    @api.get('/v1/empirical/cells',response_model=CellPage)
    def cells(bbox:str|None=None,limit:Limit=100,offset:Offset=0):
        where,args=bounds(bbox)
        found=rows('SELECT cell_id,center_lon,center_lat,country_area_km2 FROM cells WHERE 1=1'+where+
            ' ORDER BY cell_id LIMIT ? OFFSET ?',[*args,limit+1,offset])
        return page(found,{'country':'PER','grid_km':10,'bbox_filter':'cell centers; clipped boundary cells may have centers outside Peru'},limit,offset)

    @api.get('/v1/empirical/series',response_model=SeriesPage)
    def series(start:date,end:date,cell_id:Cell=None,instrument:Literal['MODIS','VIIRS']|None=None,
               limit:Limit=100,offset:Offset=0):
        if start>=end or (end-start).days>366*30:raise HTTPException(422,detail='Intervalo inválido; end exclusivo, máximo 30 años.')
        meta=metadata('series')
        instruments=[instrument] if instrument else ['MODIS','VIIRS']
        args=[start.isoformat(),end.isoformat()];condition=''
        if instrument:condition=' AND instrument=?';args.append(instrument)
        if cell_id:
            if not rows('SELECT cell_id FROM cells WHERE cell_id=?',(cell_id,)):raise HTTPException(404,detail='cell_id no pertenece a la malla Perú.')
            # Generate only the requested calendar: absence stays null, including before sensor launch.
            first=start+timedelta(days=(-start.weekday())%7)
            week=first;calendar=[]
            while week<end and week<=date(2026,7,20):
                if week>=date(2000,11,6):calendar.extend((week.isoformat(),i) for i in instruments)
                week+=timedelta(days=7)
            found=rows('SELECT week_start_utc,instrument,platform,raw_count,harmonized_count,lower_bound,upper_bound FROM cell_series WHERE cell_id=? AND week_start_utc>=? AND week_start_utc<?'+condition,
                       [cell_id,*args])
            lookup={(r['week_start_utc'],r['instrument']):r for r in found}
            records=[]
            for week,i in sorted(calendar):
                item=lookup.get((week,i),{'week_start_utc':week,'instrument':i})
                item.update(coverage_status='unknown',estimation_status='estimated' if item.get('harmonized_count') is not None else 'unavailable')
                records.append(item)
            found=records[offset:offset+limit+1];meta={**meta,'scope':'cell','cell_id':cell_id}
        else:
            found=rows('SELECT week_start_utc,instrument,platform,raw_count,harmonized_count,lower_bound,upper_bound,coverage_status,estimation_status FROM national_series WHERE week_start_utc>=? AND week_start_utc<?'+condition+
                ' ORDER BY week_start_utc,instrument LIMIT ? OFFSET ?',[*args,limit+1,offset])
            meta={**meta,'scope':'PER'}
        return page(found,meta,limit,offset)

    @api.get('/v1/forecasts',response_model=ForecastPage)
    def forecasts(bbox:str|None=None,cell_id:Cell=None,limit:Limit=100,offset:Offset=0):
        where,args=bounds(bbox)
        if cell_id:where+=' AND cell_id=?';args.append(cell_id)
        found=rows('SELECT cell_id,center_lon,center_lat,country_area_km2,record_probability,rank,target_week_start,target_week_end,quality_flag FROM forecasts WHERE 1=1'+where+
            ' ORDER BY rank LIMIT ? OFFSET ?',[*args,limit+1,offset])
        return page(found,metadata('forecast'),limit,offset)
    return api
