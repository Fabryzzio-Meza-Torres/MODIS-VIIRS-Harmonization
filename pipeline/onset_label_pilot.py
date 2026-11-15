"""Development-only audit of causal first-detection episode labels, not ignition truth.

Uses the unmasked original SNPP SP archive. No future-derived event fields or
companion full-history static-source exclusions enter the candidate labels.
"""
from pathlib import Path
from contextlib import closing
import argparse
import hashlib
import json
import sqlite3
import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape
from pyproj import Transformer
from scipy.spatial import cKDTree
from scipy.sparse import coo_matrix
from scipy.sparse.csgraph import connected_components

CRS = '+proj=laea +lat_0=-9 +lon_0=-75 +datum=WGS84 +units=m +no_defs'


def causal_onsets(xy, timestamp_ns, radius_m=1250., quiet_days=5.):
    """Return representative indices of new batches, using no later timestamps.

    Earlier spatial detections within the inclusive quiet window continue an
    episode. Same-timestamp connected components are processed together; a
    component linked to any earlier point is a continuation. Later observations
    never merge or relabel earlier onsets. This is a proposed operational proxy.
    """
    xy = np.asarray(xy, dtype=float)
    times = np.asarray(timestamp_ns, dtype=np.int64)
    if len(xy) != len(times) or (np.diff(times) < 0).any():
        raise ValueError('Coordinates/times must be aligned and chronological')
    if not np.isfinite(xy).all() or radius_m <= 0 or quiet_days <= 0:
        raise ValueError('Invalid coordinates or episode parameters')
    if not len(times):
        return np.array([], dtype=np.int64)
    day_ns = 86400 * 10 ** 9
    window_ns = int(quiet_days * day_ns)
    has_past = np.zeros(len(times), dtype=bool)
    # Each tree is bounded to the preceding window plus the current day.
    # Future points in the same tree are explicitly excluded by timestamp.
    day = times // day_ns
    cuts = np.r_[0, np.flatnonzero(np.diff(day)) + 1, len(times)]
    for lo, hi in zip(cuts[:-1], cuts[1:]):
        begin = np.searchsorted(times, times[lo] - window_ns, side='left')
        tree = cKDTree(xy[begin:hi])
        neighbors = tree.query_ball_point(xy[lo:hi], radius_m)
        for i, indices in enumerate(neighbors, lo):
            candidate_times = times[begin + np.asarray(indices, dtype=np.int64)]
            has_past[i] = np.any((candidate_times < times[i]) &
                                (candidate_times >= times[i] - window_ns))
    starts = []
    cuts = np.r_[0, np.flatnonzero(np.diff(times)) + 1, len(times)]
    for lo, hi in zip(cuts[:-1], cuts[1:]):
        if has_past[lo:hi].all():
            continue
        if hi - lo == 1:
            starts.append(lo)
            continue
        pairs = cKDTree(xy[lo:hi]).query_pairs(radius_m, output_type='ndarray')
        graph = coo_matrix((np.ones(len(pairs)), (pairs[:, 0], pairs[:, 1])),
                           shape=(hi - lo, hi - lo))
        labels = connected_components(graph, directed=False)[1]
        for label in np.unique(labels):
            members = np.flatnonzero(labels == label) + lo
            if not has_past[members].any():
                starts.append(int(members[0]))
    return np.asarray(starts, dtype=np.int64)


def hash_file(path):
    result = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 ** 2), b''):
            result.update(block)
    return result.hexdigest()


def pilot(artifacts, repo, output, source_name='fire_archive_SV-C2_848901_normalized.csv.gz',
          reference_platform='Suomi-NPP', start_text='2013-01-07',
          end_text='2014-01-06', single_rule=False, frozen_static=False):
    output.mkdir(parents=True, exist_ok=True)
    original = artifacts / '02_preparacion/datos_normalizados' / source_name
    start = pd.Timestamp(start_text, tz='America/Lima').tz_convert('UTC')
    end = pd.Timestamp(end_text, tz='America/Lima').tz_convert('UTC')
    assert start.dayofweek == end.dayofweek == 0 and start < end
    columns = ['timestamp_utc', 'source_row', 'latitude_deg', 'longitude_deg',
               'hotspot_type_code', 'confidence_viirs_category', 'frp_mw', 'daynight']
    parts = []
    for chunk in pd.read_csv(original, usecols=columns, chunksize=150_000):
        chunk['timestamp_utc'] = pd.to_datetime(chunk.timestamp_utc, utc=True)
        mask = (chunk.timestamp_utc >= start-pd.Timedelta(days=14)) & (chunk.timestamp_utc < end)
        mask &= chunk.hotspot_type_code.eq(0) & chunk.confidence_viirs_category.isin(['nominal', 'high'])
        parts.append(chunk.loc[mask].copy())
    frame = pd.concat(parts, ignore_index=True)
    raw_rows = len(frame)
    frame = frame.drop_duplicates(['timestamp_utc', 'latitude_deg', 'longitude_deg'])
    duplicates = raw_rows - len(frame)
    static_count = static_removed = 0
    if frozen_static:
        known_cells = []
        for path in sorted(original.parent.glob('fire_archive_*_normalized.csv.gz')):
            for chunk in pd.read_csv(path, chunksize=150000, usecols=[
                    'timestamp_utc','latitude_deg','longitude_deg','hotspot_type_code']):
                observed = pd.to_datetime(chunk.timestamp_utc, utc=True)
                known = chunk.loc[observed.lt(start) & chunk.hotspot_type_code.isin([1,2,3])]
                if not known.empty:
                    known_cells.extend((np.rint(known.latitude_deg/.005).astype('int64')*1000000 +
                                        np.rint(known.longitude_deg/.005).astype('int64')).tolist())
        known_cells = np.unique(known_cells)
        static_count = len(known_cells)
        candidate_cells = (np.rint(frame.latitude_deg/.005).astype('int64')*1000000 +
                           np.rint(frame.longitude_deg/.005).astype('int64'))
        excluded = np.isin(candidate_cells, known_cells)
        static_removed = int(excluded.sum())
        frame = frame.loc[~excluded].copy()
        pd.DataFrame({'source_cell': known_cells}).to_csv(output/'frozen_nonvegetation_cells.csv',index=False)
    with closing(sqlite3.connect((repo / 'api/history.sqlite').resolve().as_uri() + '?mode=ro', uri=True)) as db:
        regions = pd.read_sql_query('SELECT region_id,name,geometry FROM regions ORDER BY region_id', db)
    polygons = [shape(json.loads(item)) for item in regions.geometry]
    tree = shapely.STRtree(polygons)
    points = shapely.points(frame.longitude_deg.to_numpy(), frame.latitude_deg.to_numpy())
    i, j = tree.query(points, predicate='covered_by')
    assignments = pd.DataFrame({'point': i, 'region': j}).sort_values(['point', 'region']).drop_duplicates('point')
    frame = frame.iloc[assignments.point].copy()
    frame['region_id'] = regions.region_id.to_numpy()[assignments.region]
    frame['region_name'] = regions.name.to_numpy()[assignments.region]
    frame = frame.sort_values(['timestamp_utc', 'source_row'], kind='stable').reset_index(drop=True)
    transformer = Transformer.from_crs('EPSG:4326', CRS, always_xy=True)
    x, y = transformer.transform(frame.longitude_deg.to_numpy(), frame.latitude_deg.to_numpy())
    xy = np.column_stack([x, y])
    times = frame.timestamp_utc.astype('datetime64[ns, UTC]').array.asi8
    scope = frame.timestamp_utc.ge(start) & frame.timestamp_utc.lt(end)
    sensitivity = []
    selected = None
    selected_flag = None
    rules = [(1250., 5.)] if single_rule else [(1250., 5.), (1000., 3.), (2500., 7.)]
    for radius, days in rules:
        indices = causal_onsets(xy, times, radius, days)
        flags = np.zeros(len(frame), dtype=bool)
        flags[indices] = True
        candidates = frame.loc[flags & scope].copy()
        local = candidates.timestamp_utc.dt.tz_convert('America/Lima')
        candidates['target_week_start'] = (local.dt.normalize() - pd.to_timedelta(local.dt.dayofweek, unit='D')).dt.strftime('%Y-%m-%d')
        counts = candidates.groupby(['region_id', 'target_week_start']).size()
        weeks = pd.date_range(start_text, end_text, freq='7D', inclusive='left').strftime('%Y-%m-%d')
        calendar = pd.MultiIndex.from_product([regions.region_id, weeks], names=['region_id', 'target_week_start'])
        labels = counts.reindex(calendar, fill_value=0).rename('new_detected_episode_count').reset_index()
        labels['has_new_detected_episode'] = labels.new_detected_episode_count.gt(0).astype('int8')
        sensitivity.append({'radius_m': radius, 'quiet_days': days,
            'new_detected_episode_candidates': len(candidates),
            'regional_week_rows': len(labels), 'positive_regional_weeks': int(labels.has_new_detected_episode.sum()),
            'regional_positive_fraction': float(labels.has_new_detected_episode.mean())})
        if radius == 1250.:
            selected, selected_flag = candidates, flags
            labels.to_csv(output / 'regional_week_proxy_pilot.csv', index=False)
            prevalence = labels.groupby('region_id').agg(positive_fraction=('has_new_detected_episode', 'mean'), candidate_episodes=('new_detected_episode_count', 'sum')).reset_index().merge(regions[['region_id', 'name']], on='region_id')
            prevalence.to_csv(output / 'regional_prevalence_pilot.csv', index=False)
    selected.to_csv(output / 'candidate_onsets_pilot.csv.gz', index=False, compression={'method': 'gzip', 'mtime': 0})
    if single_rule:
        saved = frame.copy()
        saved['is_candidate_onset'] = selected_flag
        saved.to_csv(output/'eligible_reference_detections.csv.gz',index=False,
                     compression={'method':'gzip','compresslevel':1,'mtime':0})
    review = frame.loc[scope].copy()
    review['candidate_onset'] = selected_flag[scope.to_numpy()]
    review = review.groupby(['region_id', 'candidate_onset'], group_keys=False).sample(n=1, random_state=20261115)
    review['human_label'] = 'pending'
    review['human_evidence'] = ''
    review['review_question'] = 'new ignition / continuation / agricultural or static source / unclear'
    review.to_csv(output / 'human_review_cases.csv', index=False)
    report = {'status': 'development_pilot_not_approved_labels', 'physical_ignition_ground_truth': False,
        'source_sha256': hash_file(original), 'source': original.name,
        'reference_platform': reference_platform+'; single reference, no increase from adding platforms',
        'confidence': ['nominal', 'high'], 'type': 0,
        'full_history_static_mask_used': False, 'time_unit': 'America/Lima Monday-Sunday week',
        'time_scope': [start_text, end_text+' exclusive'],
        'frozen_nonvegetation_mask': {'enabled':frozen_static,'cutoff':str(start),
            'known_source_cells':static_count,'excluded_detections':static_removed,
            'rule':'type 1/2/3 observed before cutoff in a rounded 0.005 degree cell; no full-history persistence rule'},
        'raw_rows_in_buffer': raw_rows, 'exact_duplicate_rows_removed': duplicates,
        'country_rows_in_buffer': len(frame), 'rows_in_pilot': int(scope.sum()),
        'sensitivity': sensitivity, 'human_review_cases': len(review),
        'human_review_complete': False, 'model_trained': False,
        'limitations': ['First observed episode is not verified ignition.',
            'Five days without a nearby detection is not proof of extinguishment.',
            'Moving fire fronts can produce apparent new episodes.',
            'Same-timestamp components use one representative original point; border-origin ambiguity needs review.',
            'Sources classified type 0 can include agricultural burning or persistent sources.',
            'No independent event reconstruction or real-time arrival latency validated.']}
    (output / 'onset_pilot_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifacts', type=Path, required=True)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--source-name', default='fire_archive_SV-C2_848901_normalized.csv.gz')
    parser.add_argument('--platform', default='Suomi-NPP')
    parser.add_argument('--start', default='2013-01-07')
    parser.add_argument('--end', default='2014-01-06')
    parser.add_argument('--single-rule', action='store_true')
    parser.add_argument('--frozen-static', action='store_true')
    args = parser.parse_args()
    pilot(args.artifacts, args.repo, args.output, args.source_name, args.platform,
          args.start,args.end,args.single_rule,args.frozen_static)
