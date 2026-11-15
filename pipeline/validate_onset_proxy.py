"""Compare development onset proxies with companion events and registry references.

All retrospective event/static-source fields are diagnostic ONLY. They never
become forecasting features or asserted ground-truth human labels.
"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
import pandas as pd
from pyproj import Transformer
from scipy.spatial import cKDTree
from onset_label_pilot import CRS


def stamp_ns(series):
    return pd.DatetimeIndex(pd.to_datetime(series, utc=True)).as_unit('ns').asi8


def key_columns(frame, time, lat, lon):
    return pd.DataFrame({'time': stamp_ns(frame[time]),
        'lat': frame[lat].round(5).to_numpy(), 'lon': frame[lon].round(5).to_numpy()})


def association(candidate_xyz, references, shift_days=0):
    if not len(references):
        return np.zeros(len(candidate_xyz), dtype=bool)
    # Third coordinate: UTC fractional days centered at Peru local noon.
    radius, days = 5000., 3.5
    scale = np.array([radius, radius, days])
    points = references.copy()
    points[:, 2] += shift_days
    tree = cKDTree(points / scale)
    found = tree.query_ball_point(candidate_xyz / scale, 1., p=np.inf)
    result = np.zeros(len(candidate_xyz), dtype=bool)
    for i, indices in enumerate(found):
        if not indices:
            continue
        delta = points[indices] - candidate_xyz[i]
        spatial = np.square(delta[:, :2]).sum(axis=1) <= radius ** 2
        # Full local-calendar-day support, upper endpoint exclusive.
        temporal = (delta[:, 2] > -days) & (delta[:, 2] <= days)
        result[i] = bool(np.any(spatial & temporal))
    return result


def validate(root, companion, original, registry):
    d = pd.read_csv(root / 'candidate_onsets_pilot.csv.gz', dtype={'region_id': str})
    d['timestamp_utc'] = pd.to_datetime(d.timestamp_utc, utc=True)
    keys = key_columns(d, 'timestamp_utc', 'latitude_deg', 'longitude_deg')
    keys['candidate_id'] = np.arange(len(d))
    parts = []
    for chunk in pd.read_csv(companion / 'detections.tsv.gz', sep='\t', chunksize=150000,
                             usecols=['det_id','event_id','t_utc','lat','lon','satellite']):
        chunk = chunk.loc[chunk.satellite.eq('SNPP') & chunk.t_utc.str.startswith(('2013-', '2014-01-0'))]
        if chunk.empty:
            continue
        canonical = key_columns(chunk, 't_utc', 'lat', 'lon')
        canonical['event_id'] = chunk.event_id.to_numpy()
        canonical['det_id'] = chunk.det_id.to_numpy()
        joined = keys.merge(canonical, on=['time','lat','lon'], how='inner', validate='one_to_one')
        parts.append(joined[['candidate_id','event_id','det_id']])
    matches = pd.concat(parts, ignore_index=True)
    assert not matches.candidate_id.duplicated().any()
    events = pd.read_csv(companion / 'events.tsv.gz', sep='\t',
                         usecols=['event_id','t_start','t_end','event_type','duration_days'])
    matches = matches.merge(events, on='event_id', validate='many_to_one')
    d['candidate_id'] = np.arange(len(d))
    d = d.merge(matches, on='candidate_id', how='left', validate='one_to_one')
    d['companion_matched'] = d.event_id.notna()
    d['companion_age_days'] = (d.timestamp_utc - pd.to_datetime(d.t_start, utc=True)).dt.total_seconds()/86400
    d['companion_event_started_over_5d_earlier'] = d.companion_age_days.gt(5)
    d['companion_event_started_over_1d_earlier'] = d.companion_age_days.gt(1)

    # Reconstruct knowledge of nonvegetation source cells from original archives:
    # only the earliest recorded type 1/2/3 before each candidate can flag it.
    known = []
    for path in sorted(original.glob('fire_archive_*_normalized.csv.gz')):
        for chunk in pd.read_csv(path, chunksize=150000,
                usecols=['timestamp_utc','latitude_deg','longitude_deg','hotspot_type_code']):
            a = chunk.loc[chunk.hotspot_type_code.isin([1,2,3])].copy()
            if a.empty:
                continue
            a['cell'] = (np.rint(a.latitude_deg/.005).astype('int64')*1000000 +
                         np.rint(a.longitude_deg/.005).astype('int64'))
            a['time_ns'] = stamp_ns(a.timestamp_utc)
            known.append(a[['cell','time_ns']])
    first = (pd.concat(known).groupby('cell').time_ns.min() if known else pd.Series(dtype='int64'))
    cells = np.rint(d.latitude_deg/.005).astype('int64')*1000000 + np.rint(d.longitude_deg/.005).astype('int64')
    earliest = cells.map(first)
    # Numeric conversion can round ns at float precision, but acquisition times
    # are minute-granular here; exact simultaneity remains excluded by <.
    d['prior_nonvegetation_cell'] = earliest.notna() & earliest.lt(stamp_ns(d.timestamp_utc))

    static = pd.read_csv(companion/'static_sources.tsv.gz', sep='\t', usecols=['cell'])
    d['companion_full_history_static_cell_diagnostic_only'] = cells.isin(static.cell)
    refs = pd.read_csv(registry, parse_dates=['event_date'])
    refs = refs.loc[refs.event_date.between('2013-01-04', '2014-01-08')].copy()
    project = Transformer.from_crs('EPSG:4326', CRS, always_xy=True)
    x,y = project.transform(d.longitude_deg.to_numpy(), d.latitude_deg.to_numpy())
    candidates = np.column_stack([x,y,stamp_ns(d.timestamp_utc)/86400e9])
    associations = {}
    for origin in ['INDECI','MINAM','ORORATECH']:
        r = refs.loc[refs.origin.eq(origin)]
        xx,yy = project.transform(r.longitude.to_numpy(),r.latitude.to_numpy())
        points = np.column_stack([xx,yy,stamp_ns(r.event_date)/86400e9+17/24])
        for shift in [0,-28,28]:
            hit = association(candidates,points,shift)
            associations[f'{origin}_shift_{shift}'] = {'references':len(r),
                'candidate_matches':int(hit.sum()),'candidate_fraction':float(hit.mean())}
            if shift == 0:
                d[f'registry_{origin}_near_5km_3_calendar_days'] = hit
    d.to_csv(root/'onset_evidence.csv.gz', index=False, compression={'method':'gzip','mtime':0})
    review = pd.read_csv(root/'human_review_cases.csv', dtype={'region_id':str})
    evidence = d.drop(columns=['candidate_id'])
    extra = [c for c in evidence.columns if c not in review.columns] + ['source_row']
    review = review.merge(evidence[extra], on='source_row', how='left', validate='one_to_one')
    review['human_label'] = 'pending'
    review.to_csv(root/'human_review_cases_with_evidence.csv',index=False)
    report = {'status':'diagnostic_only_not_ignition_validation','development_period':'2013',
        'candidates':len(d),'companion_matched':int(d.companion_matched.sum()),
        'companion_event_over_1d_earlier':int(d.companion_event_started_over_1d_earlier.sum()),
        'companion_event_over_5d_earlier':int(d.companion_event_started_over_5d_earlier.sum()),
        'prior_nonvegetation_cells':int(d.prior_nonvegetation_cell.sum()),
        'full_history_static_cell_diagnostic_only':int(d.companion_full_history_static_cell_diagnostic_only.sum()),
        'registry_associations':associations,
        'registry_file_sha256':hashlib.sha256(registry.read_bytes()).hexdigest(),
        'human_review_cases':len(review),'human_review_complete':False,
        'unmatched_is_false_fire':False,'registry_independence_established':False,
        'event_aggregation_is_ground_truth':False,
        'model_trained':False}
    (root/'onset_evidence_report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pilot',type=Path,required=True)
    parser.add_argument('--companion',type=Path,required=True)
    parser.add_argument('--original',type=Path,required=True)
    parser.add_argument('--registry',type=Path,required=True)
    args=parser.parse_args()
    validate(args.pilot,args.companion,args.original,args.registry)
