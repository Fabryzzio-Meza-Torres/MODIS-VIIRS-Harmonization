"""Exact point-to-department aggregation on the published country/week anchors.
Grid cells intersecting several departments are never wholly assigned to one
department for count aggregation. Shared-boundary points use the lowest IDDPTO
as a deterministic tie-break; all such cases are reported.
"""
from pathlib import Path
import argparse,hashlib,json,time
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape,mapping
from shapely.ops import transform
from pyproj import Transformer

CRS='+proj=laea +lat_0=-9 +lon_0=-75 +datum=WGS84 +units=m +no_defs'

def assign_points(tree,longitude,latitude):
    pairs=tree.query(shapely.points(longitude,latitude),predicate='intersects')
    assigned=np.full(len(longitude),-1,dtype=int)
    if not pairs.size:return assigned,0
    order=np.lexsort((pairs[1],pairs[0]));point,region=pairs[:,order]
    ids,first,counts=np.unique(point,return_index=True,return_counts=True)
    assigned[ids]=region[first]
    return assigned,int((counts>1).sum())

def build(artifacts,out):
    started=time.monotonic();artifacts,out=Path(artifacts),Path(out);out.mkdir(parents=True,exist_ok=True)
    history=artifacts/'23_demo_historica'
    preparation=json.loads((history/'data/preparation.json').read_text())
    boundary=artifacts/'22_limite_peru/departamentos_minam_malla.geojson'
    assert hashlib.sha256(boundary.read_bytes()).hexdigest()==preparation['boundary_sha256']
    model=json.loads((history/'model/model.json').read_text())
    if model['mode']!='global':
        raise ValueError('Regional intervals require shared bootstrap aggregation for a non-global model.')
    features=json.loads(boundary.read_text(encoding='utf-8'))['features']
    features.sort(key=lambda f:str(f['properties']['IDDPTO']).zfill(2))
    geometries=[shapely.make_valid(shape(f['geometry'])) for f in features]
    ids=[str(f['properties']['IDDPTO']).zfill(2) for f in features]
    assert len(ids)==len(set(ids))==25
    tree=shapely.STRtree(geometries)
    canonical={'type':'FeatureCollection','features':[{'type':'Feature',
        'properties':{'region_id':rid,'name':f['properties']['NOMBDEP']},
        'geometry':mapping(g)} for rid,f,g in zip(ids,features,geometries)]}
    (out/'regions.geojson').write_text(json.dumps(canonical,ensure_ascii=False),encoding='utf-8')
    choices=pd.read_csv(history/'series/platform_selection.csv')
    choices=choices.loc[choices.selected_platform.notna(),['week_start_utc','instrument','selected_platform']].copy()
    choices['week_start_utc']=pd.to_datetime(choices.week_start_utc,utc=True)
    factors=pd.read_csv(history/'model/calibration_factors.csv')
    factors=factors[['platform','factor','factor_low','factor_high']].drop_duplicates()
    assert factors.platform.is_unique,'Global response factors must not vary by season or spatial band.'
    inventory=pd.read_csv(artifacts/'02_preparacion/inventario.csv')
    pieces=[];ties=0;retained=0;outside=0;source_rows=0
    columns=['timestamp_utc','platform','latitude_deg','longitude_deg','hotspot_type_code']
    for row in inventory.query("processing=='SP'").itertuples():
        path=artifacts/'02_preparacion'/row.output_file.replace('\\','/')
        for chunk in pd.read_csv(path,usecols=columns,chunksize=150000):
            t=pd.to_datetime(chunk.timestamp_utc,utc=True)
            use=chunk.hotspot_type_code.eq(0)&t.ge('2000-11-06')&t.lt('2026-07-27')
            d=chunk.loc[use].copy();t=t.loc[use]
            if d.empty:continue
            day=t.dt.floor('D')
            d['week_start_utc']=day-pd.to_timedelta(day.dt.dayofweek,unit='D')
            d=d.merge(choices,left_on=['week_start_utc','platform'],
                right_on=['week_start_utc','selected_platform'],how='inner',validate='many_to_one')
            if d.empty:continue
            source_rows+=len(d)
            assigned,ambiguous=assign_points(tree,d.longitude_deg.to_numpy(),d.latitude_deg.to_numpy())
            ties+=ambiguous;outside+=int((assigned<0).sum())
            d=d.loc[assigned>=0].copy()
            d['region_id']=np.asarray(ids)[assigned[assigned>=0]]
            retained+=len(d)
            pieces.append(d.groupby(['region_id','week_start_utc','instrument','platform']).size().rename('raw_count').reset_index())
    regional=pd.concat(pieces,ignore_index=True).groupby(
        ['region_id','week_start_utc','instrument','platform'],as_index=False).raw_count.sum()
    regional=regional.merge(factors,on='platform',validate='many_to_one')
    regional['harmonized_count']=regional.raw_count*regional.factor
    regional['lower_bound']=regional.raw_count*regional.factor_low
    regional['upper_bound']=regional.raw_count*regional.factor_high
    regional['coverage_status']='unknown';regional['estimation_status']='estimated'
    reference=pd.read_csv(history/'series/national_series.csv',parse_dates=['week_start_utc'])
    check=regional.groupby(['week_start_utc','instrument'],as_index=False).agg(
        raw_count=('raw_count','sum'),harmonized_count=('harmonized_count','sum'))
    compared=check.merge(reference.loc[reference.raw_count.notna(),['week_start_utc','instrument','raw_count','harmonized_count']],
        on=['week_start_utc','instrument'],how='outer',suffixes=('_regions','_country'),validate='one_to_one')
    assert compared.notna().all().all()
    assert (compared.raw_count_regions==compared.raw_count_country).all()
    np.testing.assert_allclose(compared.harmonized_count_regions,compared.harmonized_count_country,rtol=1e-12,atol=1e-8)
    assert retained==int(reference.raw_count.sum())
    regional.drop(columns=['factor','factor_low','factor_high']).to_csv(out/'regional_series.csv.gz',index=False,
        compression={'method':'gzip','compresslevel':1,'mtime':0})
    # Map cells to every department with positive land overlap for discovery/maps.
    # This mapping never reallocates observations or splits forecast probabilities.
    project=Transformer.from_crs('EPSG:4326',CRS,always_xy=True)
    projected=[transform(project.transform,g) for g in geometries]
    cells=pd.read_csv(history/'data/cells.csv')
    boxes=shapely.box(cells.ix*10000,cells.iy*10000,(cells.ix+1)*10000,(cells.iy+1)*10000)
    candidates=shapely.STRtree(projected).query(boxes,predicate='intersects')
    intersection=shapely.intersection(boxes[candidates[0]],np.asarray(projected,dtype=object)[candidates[1]])
    areas=shapely.area(intersection)/1e6;keep=areas>1e-9
    mapping_rows=pd.DataFrame({'cell_id':cells.cell_id.to_numpy()[candidates[0][keep]],
        'region_id':np.asarray(ids)[candidates[1][keep]],'overlap_area_km2':areas[keep]})
    assert mapping_rows.cell_id.nunique()==len(cells)
    assert not mapping_rows.duplicated(['cell_id','region_id']).any()
    mapping_rows.sort_values(['region_id','cell_id']).to_csv(out/'region_cells.csv',index=False)
    report={'country':'PER','administrative_level':'departments including Callao','regions':len(ids),
        'boundary_source':'https://geoservidorperu.minam.gob.pe/arcgis/rest/services/ServicioCFOI/MapServer/15',
        'source_boundary_sha256':preparation['boundary_sha256'],'points_assigned':retained,
        'candidate_source_points':source_rows,'outside_country_excluded':outside,'multi_region_point_matches':ties,
        'point_tie_rule':'lowest IDDPTO, single assignment','regional_rows_with_records':len(regional),
        'national_count_conservation_verified':True,'national_estimates_conservation_verified':True,
        'count_assignment':'exact point containment in the same generalized MINAM polygons used by the country domain',
        'cells_mapping':'all positive-area department intersections; not a distribution of detections by area',
        'forecast_mapping':'a forecast concerns the entire cell; department intersection does not rescale probability',
        'region_interval_method':'shared global factor quantile times regional count; cell bands are not summed',
        'method_version':model['version'],'coverage_corrected':False,
        'source_snapshot_id':json.loads((history/'series/series_metadata.json').read_text())['source_snapshot_id'],
        'elapsed_seconds':time.monotonic()-started}
    (out/'regional_metadata.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--artifacts',type=Path,required=True);p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();build(a.artifacts,a.out)
