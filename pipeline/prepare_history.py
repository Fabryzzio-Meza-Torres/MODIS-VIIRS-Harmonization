"""Peru historical observations. Positive records remain sparse; absent records are unknown."""
from pathlib import Path
import argparse,hashlib,json
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape
from shapely.ops import transform
from pyproj import Transformer

CRS='+proj=laea +lat_0=-9 +lon_0=-75 +datum=WGS84 +units=m +no_defs'
PLATFORMS=['Aqua','Suomi-NPP','Terra','NOAA-20','NOAA-21']
STOP=pd.Timestamp('2026-07-27',tz='UTC')
START=pd.Timestamp('2000-11-06',tz='UTC')
PLATFORM_STARTS={'Terra':'2000-11-06','Aqua':'2002-07-08','Suomi-NPP':'2012-02-06',
                 'NOAA-20':'2018-04-02','NOAA-21':'2023-03-06'}

def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as s:
        for b in iter(lambda:s.read(1048576),b''):h.update(b)
    return h.hexdigest()

def build(artifacts,out):
    artifacts,out=Path(artifacts),Path(out);out.mkdir(parents=True,exist_ok=True)
    boundary=artifacts/'22_limite_peru/departamentos_minam_malla.geojson'
    source=json.loads(boundary.read_text(encoding='utf-8'))
    original=[shape(f['geometry']) for f in source['features']]
    invalid=sum(not g.is_valid for g in original)
    repaired=[];repair_changes=[]
    repair_project=Transformer.from_crs('EPSG:4326',CRS,always_xy=True)
    for g in original:
        fixed=shapely.make_valid(g) if not g.is_valid else g
        if not g.is_valid:
            old=transform(repair_project.transform,g).area
            change=abs(transform(repair_project.transform,fixed).area-old)/max(old,1)
            assert change<1e-4,'Boundary repair changes too much area.'
            repair_changes.append(change)
        repaired.append(fixed)
    country=shapely.union_all(repaired)
    assert country.is_valid
    shapely.prepare(country)
    projector=Transformer.from_crs('EPSG:4326',CRS,always_xy=True)
    inverse=Transformer.from_crs(CRS,'EPSG:4326',always_xy=True)
    projected=transform(projector.transform,country)
    shapely.prepare(projected)
    xmin,ymin,xmax,ymax=projected.bounds
    ix,iy=np.meshgrid(np.arange(np.floor(xmin/10000),np.floor(xmax/10000)+1,dtype=int),
                      np.arange(np.floor(ymin/10000),np.floor(ymax/10000)+1,dtype=int))
    ix,iy=ix.ravel(),iy.ravel()
    boxes=shapely.box(ix*10000,iy*10000,(ix+1)*10000,(iy+1)*10000)
    keep=shapely.intersects(projected,boxes)
    ix,iy,boxes=ix[keep],iy[keep],boxes[keep]
    full=shapely.contains(projected,boxes)
    areas=np.full(len(boxes),100.)
    areas[~full]=shapely.area(shapely.intersection(boxes[~full],projected))/1e6
    lon,lat=inverse.transform(ix*10000+5000,iy*10000+5000)
    cells=pd.DataFrame({'cell_id':['laea10_'+str(a)+'_'+str(b) for a,b in zip(ix,iy)],
        'ix':ix,'iy':iy,'center_lon':lon,'center_lat':lat,'country_area_km2':areas})
    cells=cells.loc[cells.country_area_km2>0].reset_index(drop=True)
    assert np.isclose(cells.country_area_km2.sum(),projected.area/1e6,rtol=1e-7)
    cells.to_csv(out/'cells.csv',index=False)
    (out/'peru.geojson').write_text(json.dumps({'type':'Feature','properties':{'source':'MINAM'},
                                             'geometry':shapely.geometry.mapping(country)}),encoding='utf-8')
    inventory=pd.read_csv(artifacts/'02_preparacion/inventario.csv')
    collected,flow,hashes=[],[],[]
    cols=['timestamp_utc','platform','latitude_deg','longitude_deg','hotspot_type_code',
          'frp_mw','daynight','scan','track','source_row']
    for row in inventory.query("processing=='SP'").itertuples():
        path=artifacts/'02_preparacion'/row.output_file.replace('\\','/')
        hashes.append({'source':row.source_member,'sha256':sha(path)})
        scope_rows,excluded_country,kept=0,0,0
        for chunk in pd.read_csv(path,usecols=cols,chunksize=150000):
            stamp=pd.to_datetime(chunk.timestamp_utc,utc=True,errors='raise')
            valid=stamp.ge(START)&stamp.lt(STOP)&chunk.hotspot_type_code.eq(0)
            valid &= chunk.platform.isin(PLATFORMS)
            valid &= ~chunk.platform.eq('Suomi-NPP')|stamp.ge(pd.Timestamp('2012-02-06',tz='UTC'))
            for platform,first_week in PLATFORM_STARTS.items():
                valid &= ~chunk.platform.eq(platform)|stamp.ge(pd.Timestamp(first_week,tz='UTC'))
            d=chunk.loc[valid].copy();d['timestamp_utc']=stamp.loc[valid]
            scope_rows+=len(d)
            inside=shapely.intersects_xy(country,d.longitude_deg.to_numpy(),d.latitude_deg.to_numpy())
            excluded_country+=int((~inside).sum());d=d.loc[inside].copy()
            assert d.frp_mw.ge(0).all() and d.latitude_deg.between(-90,90).all()
            x,y=projector.transform(d.longitude_deg.to_numpy(),d.latitude_deg.to_numpy())
            a,b=np.floor(np.asarray(x)/10000).astype('int64'),np.floor(np.asarray(y)/10000).astype('int64')
            d['cell_id']=['laea10_'+str(aa)+'_'+str(bb) for aa,bb in zip(a,b)]
            day=d.timestamp_utc.dt.floor('D')
            d['week_start_utc']=day-pd.to_timedelta(day.dt.dayofweek,unit='D')
            d['is_night']=d.daynight.eq('N').astype(int)
            d['pixel_area_km2']=pd.to_numeric(d.scan)*pd.to_numeric(d.track)
            assert d.pixel_area_km2.gt(0).all()
            grouped=d.groupby(['cell_id','week_start_utc','platform']).agg(
                raw_count=('source_row','size'),frp_sum_mw=('frp_mw','sum'),
                night_count=('is_night','sum'),pixel_area_sum=('pixel_area_km2','sum')).reset_index()
            collected.append(grouped);kept+=len(d)
        flow.append({'source':row.source_member,'type0_in_period':scope_rows,
                     'outside_generalized_MINAM_boundary':excluded_country,'retained':kept})
    observations=pd.concat(collected,ignore_index=True).groupby(
        ['cell_id','week_start_utc','platform'],as_index=False)[
        ['raw_count','frp_sum_mw','night_count','pixel_area_sum']].sum()
    assert observations.raw_count.sum()==sum(r['retained'] for r in flow)
    assert observations.cell_id.isin(cells.cell_id).all()
    observations['coverage_status']='unknown'
    observations.to_csv(out/'observations.csv.gz',index=False,compression={'method':'gzip','compresslevel':1,'mtime':0})
    pd.DataFrame(flow).to_csv(out/'selection_flow.csv',index=False)
    meta={'start':str(START),'end_exclusive':str(STOP),'processing':'SP','type':0,
          'platforms':PLATFORMS,'crs':CRS,'grid_km':10,'cell_count':len(cells),
          'observed_groups':len(observations),'retained_detections':int(observations.raw_count.sum()),
          'country_area_km2':projected.area/1e6,'boundary_generalization_degrees':0.005,
          'refined_department_generalization_degrees':{'PUNO':0.001,'TUMBES':0.001},
          'invalid_department_geometries_repaired':invalid,
          'boundary_repair_relative_area_changes':repair_changes,
          'first_complete_weeks_by_platform':PLATFORM_STARTS,
          'boundary_sha256':sha(boundary),'source_hashes':hashes,
          'missing_policy':'no row is unknown; never a confirmed zero fire count',
          'coverage_corrected':False,'test_outcomes_used_for_model_selection':False}
    (out/'preparation.json').write_text(json.dumps(meta,indent=2),encoding='utf-8')
    return meta

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--artifacts',required=True,type=Path)
    p.add_argument('--out',required=True,type=Path);a=p.parse_args()
    print(json.dumps(build(a.artifacts,a.out),indent=2))
