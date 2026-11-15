"""Read-only empirical series and experimental forecast, separate from full coverage gate."""
from contextlib import closing
from datetime import date,timedelta
from pathlib import Path
from typing import Annotated,Literal
import json,os,sqlite3
from fastapi import APIRouter,HTTPException,Query
from pydantic import BaseModel
from regional_api import RegionalQueries,Region

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
    regional=RegionalQueries(rows,metadata)
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

    def geographic_filter(bbox,region_id):
        where,args=bounds(bbox)
        where=where.replace('center_lon','c.center_lon').replace('center_lat','c.center_lat')
        join='';info={}
        if bbox is not None and regional.available():
            west,south,east,north=[float(v) for v in bbox.split(',')]
            join=' JOIN cell_spatial_index spatial ON spatial.id=c.spatial_id '
            where+=' AND spatial.min_lon<=? AND spatial.max_lon>=? AND spatial.min_lat<=? AND spatial.max_lat>=?'
            args.extend([east,west,north,south]);info['spatial_index']='SQLite R*Tree with exact center bounds filter'
        if region_id:
            from regional_api import describe
            info['region']=describe(regional.region(region_id))
            where+=' AND c.cell_id IN (SELECT cell_id FROM region_cells WHERE region_id=?)'
            args.append(region_id)
            info['region_cell_selection']='positive area intersection; counts are assigned by original point location'
        return join,where,args,info

    @api.get('/v1/empirical/cells',response_model=CellPage)
    def cells(bbox:str|None=None,region_id:Region=None,limit:Limit=100,offset:Offset=0):
        join,where,args,info=geographic_filter(bbox,region_id)
        found=rows('SELECT c.cell_id,c.center_lon,c.center_lat,c.country_area_km2 FROM cells c'+join+' WHERE 1=1'+where+
            ' ORDER BY c.cell_id LIMIT ? OFFSET ?',[*args,limit+1,offset])
        return page(found,{'country':'PER','grid_km':10,
            'bbox_filter':'cell centers; clipped boundary cells may have centers outside Peru',**info},limit,offset)

    @api.get('/v1/empirical/series',response_model=SeriesPage)
    def series(start:date,end:date,cell_id:Cell=None,region_id:Region=None,
               instrument:Literal['MODIS','VIIRS']|None=None,
               week_selection:Literal['starts_within','overlap']='starts_within',
               limit:Limit=100,offset:Offset=0):
        if start>=end or (end-start).days>366*30:raise HTTPException(422,detail='Intervalo inválido; end exclusivo, máximo 30 años.')
        if cell_id and region_id:raise HTTPException(422,detail='Elige cell_id o region_id; las celdas pueden intersectar varios departamentos.')
        meta=metadata('series')
        instruments=[instrument] if instrument else ['MODIS','VIIRS']
        first=(start-timedelta(days=start.weekday()) if week_selection=='overlap'
               else start+timedelta(days=(-start.weekday())%7))
        calendar=[];week=max(first,date(2000,11,6))
        while week<end and week<=date(2026,7,20):
            calendar.extend((week.isoformat(),i) for i in instruments)
            week+=timedelta(days=7)
        meta={**meta,'requested_start':start.isoformat(),'requested_end_exclusive':end.isoformat(),
            'week_selection':week_selection,'partial_week_policy':'whole weekly totals; not daily prorated counts',
            'effective_week_start':calendar[0][0] if calendar else None,
            'effective_end_exclusive':(date.fromisoformat(calendar[-1][0])+timedelta(days=7)).isoformat() if calendar else None}
        args=[first.isoformat(),end.isoformat()];condition=''
        if instrument:condition=' AND instrument=?';args.append(instrument)
        if cell_id or region_id:
            if region_id:
                from regional_api import describe
                selected=regional.region(region_id)
                found=rows('SELECT week_start_utc,instrument,platform,raw_count,harmonized_count,lower_bound,upper_bound FROM regional_series WHERE region_id=? AND week_start_utc>=? AND week_start_utc<?'+condition,
                           [region_id,*args])
                meta={**meta,'scope':'region','region':describe(selected),
                    'regional_count_assignment':'original detection point containment, not cell-center allocation',
                    'regional_interval_method':metadata('regions')['region_interval_method']}
            else:
                if not rows('SELECT cell_id FROM cells WHERE cell_id=?',(cell_id,)):raise HTTPException(404,detail='cell_id no pertenece a la malla Perú.')
                found=rows('SELECT week_start_utc,instrument,platform,raw_count,harmonized_count,lower_bound,upper_bound FROM cell_series WHERE cell_id=? AND week_start_utc>=? AND week_start_utc<?'+condition,
                           [cell_id,*args])
                meta={**meta,'scope':'cell','cell_id':cell_id}
                if regional.available():
                    meta['intersecting_regions']=rows('''SELECT r.region_id,r.name,rc.overlap_area_km2
                        FROM region_cells rc JOIN regions r ON r.region_id=rc.region_id
                        WHERE rc.cell_id=? ORDER BY r.region_id''',(cell_id,))
            lookup={(r['week_start_utc'],r['instrument']):r for r in found}
            records=[]
            for week,i in sorted(calendar):
                item=lookup.get((week,i),{'week_start_utc':week,'instrument':i})
                item.update(coverage_status='unknown',estimation_status='estimated' if item.get('harmonized_count') is not None else 'unavailable')
                records.append(item)
            found=records[offset:offset+limit+1]
        else:
            found=rows('SELECT week_start_utc,instrument,platform,raw_count,harmonized_count,lower_bound,upper_bound,coverage_status,estimation_status FROM national_series WHERE week_start_utc>=? AND week_start_utc<?'+condition+
                ' ORDER BY week_start_utc,instrument LIMIT ? OFFSET ?',[*args,limit+1,offset])
            meta={**meta,'scope':'PER'}
        return page(found,meta,limit,offset)

    @api.get('/v1/forecasts',response_model=ForecastPage)
    def forecasts(bbox:str|None=None,cell_id:Cell=None,region_id:Region=None,limit:Limit=100,offset:Offset=0):
        join,where,args,info=geographic_filter(bbox,region_id)
        if cell_id:where+=' AND f.cell_id=?';args.append(cell_id)
        found=rows('SELECT f.cell_id,f.center_lon,f.center_lat,f.country_area_km2,f.record_probability,f.rank,f.target_week_start,f.target_week_end,f.quality_flag FROM forecasts f JOIN cells c ON c.cell_id=f.cell_id'+join+' WHERE 1=1'+where+
            ' ORDER BY f.rank LIMIT ? OFFSET ?',[*args,limit+1,offset])
        if region_id:info['probability_spatial_support']='entire cell; not a probability restricted to its department intersection'
        return page(found,{**metadata('forecast'),**info},limit,offset)
    api.include_router(regional.router())
    return api
