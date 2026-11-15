"""Official department catalog and R*Tree-assisted exact point location."""
from functools import lru_cache
from typing import Annotated
import json
from fastapi import APIRouter,HTTPException,Query,Path as RoutePath
from pydantic import BaseModel
from shapely.geometry import shape,Point

Region=Annotated[str|None,Query(pattern=r'^\d{2}$')]

class RegionInfo(BaseModel):
    region_id:str
    name:str
    bbox:list[float]

class RegionPagination(BaseModel):
    limit:int
    offset:int
    next_offset:int|None

class RegionPage(BaseModel):
    metadata:dict
    data:list[RegionInfo]
    pagination:RegionPagination

class LocatedRegion(BaseModel):
    region:RegionInfo
    boundary_matches:list[str]
    metadata:dict

def describe(row):
    return {'region_id':row['region_id'],'name':row['name'],
            'bbox':[row['min_lon'],row['min_lat'],row['max_lon'],row['max_lat']]}

@lru_cache(maxsize=64)
def polygon(encoded):
    # Keyed by the actual geometry, so an atomic database replacement cannot
    # leave stale shapes in the cache.
    return shape(json.loads(encoded))

class RegionalQueries:
    def __init__(self,rows,metadata):
        self.rows=rows;self.metadata=metadata
    def available(self):
        return bool(self.rows("SELECT name FROM sqlite_master WHERE type='table' AND name='regions'"))
    def region(self,ident):
        self.metadata('regions') # gives a controlled 503 if this optional dataset is absent
        found=self.rows('SELECT * FROM regions WHERE region_id=?',(ident,))
        if not found:raise HTTPException(404,detail={'code':'region_not_found','region_id':ident})
        return found[0]
    def locate(self,longitude,latitude):
        info=self.metadata('regions')
        candidates=self.rows('''SELECT r.* FROM region_spatial_index i JOIN regions r ON r.id=i.id
            WHERE i.min_lon<=? AND i.max_lon>=? AND i.min_lat<=? AND i.max_lat>=?
            ORDER BY r.region_id''',(longitude,longitude,latitude,latitude))
        point=Point(longitude,latitude)
        matches=[r for r in candidates if polygon(r['geometry']).covers(point)]
        if not matches:raise HTTPException(404,detail={'code':'point_outside_department_boundaries'})
        return {'region':describe(matches[0]),'boundary_matches':[r['region_id'] for r in matches],
            'metadata':{'boundary_source':info['boundary_source'],'boundary_ambiguous':len(matches)>1,
                        'boundary_detail':'generalized MINAM boundaries','spatial_index':'SQLite R*Tree plus exact polygon'}}
    def router(self):
        api=APIRouter()
        @api.get('/v1/regions',response_model=RegionPage)
        def regions(limit:Annotated[int,Query(ge=1,le=1000)]=100,
                    offset:Annotated[int,Query(ge=0,le=1000000)]=0):
            info=self.metadata('regions')
            found=self.rows('SELECT * FROM regions ORDER BY name LIMIT ? OFFSET ?',(limit+1,offset))
            return {'metadata':info,'data':[describe(r) for r in found[:limit]],'pagination':{
                'limit':limit,'offset':offset,'next_offset':offset+limit if len(found)>limit else None}}
        @api.get('/v1/regions/locate',response_model=LocatedRegion)
        def locate(latitude:Annotated[float,Query(ge=-90,le=90)],
                   longitude:Annotated[float,Query(ge=-180,le=180)]):
            return self.locate(longitude,latitude)
        @api.get('/v1/regions/geometry')
        def geometries():
            info=self.metadata('regions')
            return {'type':'FeatureCollection','metadata':{'boundary_source':info['boundary_source']},
                'features':[{'type':'Feature','properties':describe(r),'geometry':json.loads(r['geometry'])}
                            for r in self.rows('SELECT * FROM regions ORDER BY region_id')]}
        @api.get('/v1/regions/{region_id}/geometry')
        def geometry(region_id:Annotated[str,RoutePath(pattern=r'^\d{2}$')]):
            row=self.region(region_id)
            return {'type':'Feature','properties':describe(row),'geometry':json.loads(row['geometry'])}
        return api
