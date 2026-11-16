"""API REST de consulta. Sirve artefactos precalculados; no entrena por petición."""
from contextlib import closing
from datetime import date
from pathlib import Path
from typing import Annotated, Any, Generic, Literal, TypeVar
import json
import os
import sqlite3

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

Cell = Annotated[str, Query(pattern=r'^laea10_-?\d{1,5}_-?\d{1,5}$')]
Limit = Annotated[int, Query(ge=1, le=1000)]
Offset = Annotated[int, Query(ge=0, le=1000000)]
T = TypeVar('T')


class Pagination(BaseModel):
    limit: int
    offset: int
    next_offset: int | None


class Page(BaseModel, Generic[T]):
    metadata: dict[str, Any]
    data: list[T]
    pagination: Pagination


class RawRecord(BaseModel):
    week_start_utc: date
    platform: str
    raw_count: int
    coverage_status: str


class SeriesRecord(BaseModel):
    week_start_utc: date
    harmonized_count: float | None
    lower_bound: float | None
    upper_bound: float | None
    coverage_status: Literal['valid','partial','unknown','no_observation']
    estimation_status: Literal['estimated','imputed','unavailable']
    platforms_used: list[str]
    method_version: str
    source_snapshot_id: str


class NationalRecord(BaseModel):
    week_start_utc: date
    raw_aqua: float | None
    raw_snpp: float | None
    aqua_equivalent_estimate: float | None
    coverage_status: str
    method_version: str


class CoverageRecord(BaseModel):
    fire_file: str
    geo_product: str
    roi_cell_area_km2: float
    candidate_usable_area_km2: float
    area_status: str


class CellRecord(BaseModel):
    cell_id: str


def create_app(database_path=None, origins=None, risk_snapshot_path=None, risk_clock=None,
               activity_snapshot_path=None,activity_clock=None):
    database = Path(database_path or os.environ.get(
        'FIRMS_API_DB', Path(__file__).with_name('firms.sqlite'))).resolve()
    app = FastAPI(title='MODIS–VIIRS Series API', version='0.5.0',
        description='Series y soporte de observación versionados. Histórico UTC; pronósticos regionales America/Lima; fin exclusivo. '
                    'La serie final solo se habilita tras publicar un método validado.')
    origins = origins if origins is not None else [
        x.strip() for x in os.environ.get('FIRMS_CORS_ORIGINS', '*').split(',') if x.strip()]
    app.add_middleware(CORSMiddleware, allow_origins=origins,
                       allow_methods=['GET'], allow_headers=['Accept'], allow_credentials=False)

    def connect():
        if not database.is_file():
            raise HTTPException(503, detail={'code':'data_not_loaded'})
        db = sqlite3.connect(database.as_uri()+'?mode=ro', uri=True)
        db.row_factory = sqlite3.Row
        db.execute('PRAGMA query_only=ON')
        return closing(db)

    def rows(sql, params=()):
        with connect() as db:
            return [dict(r) for r in db.execute(sql, params)]

    def metadata(name):
        found = rows('SELECT payload FROM datasets WHERE name=?', (name,))
        if not found:
            raise HTTPException(404, detail={'code':'dataset_not_found'})
        return json.loads(found[0]['payload'])

    def check_dates(start, end):
        if start >= end:
            raise HTTPException(422, detail='start debe ser anterior a end (fin exclusivo).')
        if (end-start).days > 366*30:
            raise HTTPException(422, detail='El intervalo máximo es de 30 años.')

    def page(items, info, limit, offset):
        more = len(items)>limit
        return {'metadata':info,'data':items[:limit],
                'pagination':{'limit':limit,'offset':offset,
                              'next_offset':offset+limit if more else None}}

    @app.get('/health')
    def health():
        history=Path(os.environ.get('FIRMS_HISTORY_DB',Path(__file__).with_name('history.sqlite')))
        return {'service':'ok','database_available':database.is_file(),
                'historical_snapshot_available':history.is_file()}

    @app.get('/v1/datasets')
    def datasets():
        return {'data':[json.loads(r['payload']) for r in rows('SELECT payload FROM datasets ORDER BY name')]}

    @app.get('/v1/cells', response_model=Page[CellRecord])
    def cells(limit: Limit=100, offset: Offset=0):
        found=rows('SELECT cell_id FROM cells ORDER BY cell_id LIMIT ? OFFSET ?', (limit+1,offset))
        return page(found, {'grid_km':10,'crs':metadata('raw')['crs']}, limit, offset)

    @app.get('/v1/raw-series', response_model=Page[RawRecord])
    def raw_series(cell_id: Cell, start: date, end: date, limit: Limit=100, offset: Offset=0):
        check_dates(start,end)
        found=rows('''SELECT week_start_utc,platform,raw_count,coverage_status
                      FROM raw WHERE cell_id=? AND week_start_utc>=? AND week_start_utc<?
                      ORDER BY week_start_utc,platform LIMIT ? OFFSET ?''',
                   (cell_id,start.isoformat(),end.isoformat(),limit+1,offset))
        return page(found,metadata('raw'),limit,offset)

    @app.get('/v1/series', response_model=Page[SeriesRecord],
             responses={503:{'description':'Dataset not loaded or final harmonization not published'}})
    def series(cell_id: Cell, start: date, end: date, limit: Limit=100, offset: Offset=0):
        check_dates(start,end)
        info=metadata('harmonized')
        if info.get('status') != 'validated_published':
            raise HTTPException(503, detail={'code':'harmonization_not_published',
                'message':'La serie armonizada final sigue en validación.', 'metadata':info})
        found=rows('''SELECT week_start_utc,harmonized_count,lower_bound,upper_bound,
                      coverage_status,estimation_status,platforms_used,method_version,source_snapshot_id
                      FROM harmonized WHERE cell_id=? AND week_start_utc>=? AND week_start_utc<?
                      ORDER BY week_start_utc LIMIT ? OFFSET ?''',
                   (cell_id,start.isoformat(),end.isoformat(),limit+1,offset))
        for item in found:
            item['platforms_used']=json.loads(item['platforms_used'])
        return page(found,info,limit,offset)

    @app.get('/v1/baselines/national', response_model=Page[NationalRecord])
    def national(start: date, end: date, limit: Limit=100, offset: Offset=0):
        check_dates(start,end)
        found=rows('''SELECT week_start_utc,raw_aqua,raw_snpp,aqua_equivalent_estimate,
                      coverage_status,method_version FROM national
                      WHERE week_start_utc>=? AND week_start_utc<?
                      ORDER BY week_start_utc LIMIT ? OFFSET ?''',
                   (start.isoformat(),end.isoformat(),limit+1,offset))
        return page(found,metadata('baseline_national'),limit,offset)

    @app.get('/v1/coverage/pilot', response_model=Page[CoverageRecord])
    def pilot(cell_id: Cell, limit: Limit=100, offset: Offset=0):
        found=rows('''SELECT fire_file,geo_product,roi_cell_area_km2,candidate_usable_area_km2,area_status
                      FROM pilot WHERE cell_id=? ORDER BY fire_file LIMIT ? OFFSET ?''',
                   (cell_id,limit+1,offset))
        return page(found,metadata('coverage_pilot'),limit,offset)

    from history_api import router
    app.include_router(router())
    from risk_api import router as risk_router
    app.include_router(risk_router(risk_snapshot_path,clock=risk_clock))
    from activity_api import router as activity_router
    app.include_router(activity_router(activity_snapshot_path,clock=activity_clock))
    web=Path(__file__).resolve().parents[1]/'web'
    if web.is_dir():
        from fastapi.staticfiles import StaticFiles
        app.mount('/visor',StaticFiles(directory=web,html=True),name='regional_viewer')
    return app


app=create_app()
