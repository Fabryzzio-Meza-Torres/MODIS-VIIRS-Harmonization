"""Audit companion snapshot without executing its SQL or changing a database.

Requires Docker (postgres:15-alpine) and pandas/numpy in the science environment.
The output directory must contain fires.dump and its verified source_manifest.json.
"""
from pathlib import Path
from collections import Counter
import argparse
import csv
import gzip
import hashlib
import json
import re
import subprocess
import urllib.request
import numpy as np
import pandas as pd

TABLES = ('meta', 'events', 'detections', 'static_sources')


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 ** 2), b''):
            digest.update(block)
    return digest.hexdigest()


def extract_table(root, table):
    """Only extract a named COPY payload. No emitted SQL is executed."""
    if table not in TABLES:
        raise ValueError('Unsupported table')
    target = root / f'{table}.tsv.gz'
    partial = target.with_suffix('.gz.part')
    command = ['docker', 'run', '--rm', '--network', 'none', '--read-only',
               '--mount', f'type=bind,source={root.resolve().as_posix()},target=/input,readonly',
               'postgres:15-alpine', 'pg_restore', '--data-only', '--table', table,
               '--file', '-', '/input/fires.dump']
    columns = None
    count = 0
    complete = False
    with (root / f'{table}.stderr.txt').open('w', encoding='utf-8') as errors:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors,
                                   text=True, encoding='utf-8')
        try:
            with partial.open('wb') as raw, gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=0) as out:
                for line in process.stdout:
                    if columns is None:
                        match = re.fullmatch(rf'COPY public\.{table} \(([^)]+)\) FROM stdin;\n', line)
                        if match:
                            columns = match[1].split(', ')
                            out.write(('\t'.join(columns) + '\n').encode('utf-8'))
                    elif not complete:
                        if line.rstrip('\n') == r'\.':
                            complete = True
                        else:
                            if len(line.rstrip('\n').split('\t')) != len(columns):
                                raise ValueError(f'Invalid COPY row in {table}')
                            out.write(line.encode('utf-8'))
                            count += 1
                            if count > 5_000_000:
                                raise ValueError('Unexpected table size')
            if process.wait() != 0:
                raise RuntimeError(f'pg_restore failed; see {table}.stderr.txt')
            if not columns or not complete:
                raise ValueError('Incomplete COPY payload')
            partial.replace(target)
        except BaseException:
            if process.poll() is None:
                process.kill()
                process.wait()
            raise
        finally:
            process.stdout.close()
    print(f'{table}: {count:,} rows extracted', flush=True)
    return {'rows': count, 'columns': columns, 'sha256': sha(target)}


def read(root, table, **kwargs):
    # PostgreSQL COPY escapes are retained; no SQL or escape text is evaluated.
    return pd.read_csv(root / f'{table}.tsv.gz', sep='\t', quoting=csv.QUOTE_NONE,
                       na_values=[r'\N'], keep_default_na=False, **kwargs)


def audit(root, repo):
    source = json.loads((root / 'source_manifest.json').read_text(encoding='utf-8'))
    assert source['verified'] and sha(root / 'fires.dump') == source['sha256']
    report = {'stage': 'input_audit_only', 'model_trained': False, 'source': source}
    report['tables'] = {table: extract_table(root, table) for table in TABLES}
    meta = read(root, 'meta', dtype=str)
    report['companion_metadata'] = dict(zip(meta.key, meta.value))
    for table, key in [('events', 'n_events'), ('detections', 'n_detections'), ('static_sources', 'n_static_cells')]:
        assert report['tables'][table]['rows'] == int(report['companion_metadata'][key])

    event_ids = []
    types = Counter()
    events_missing = Counter()
    invalid_events = 0
    for frame in read(root, 'events', chunksize=100_000):
        event_ids.append(frame.event_id.to_numpy(dtype=np.int64))
        types.update(frame.event_type.fillna('<missing>'))
        events_missing.update({col: int(n) for col, n in frame.isna().sum().items()})
        start = pd.to_datetime(frame.t_start, utc=True, errors='coerce')
        end = pd.to_datetime(frame.t_end, utc=True, errors='coerce')
        invalid_events += int((start.isna() | end.isna() | (end < start)).sum())
    event_ids = np.concatenate(event_ids)
    assert len(np.unique(event_ids)) == len(event_ids), 'Duplicate event IDs'
    report['events'] = {'types': dict(types), 'missing_by_column': dict(events_missing),
                        'invalid_time_intervals': invalid_events}

    counters = {name: Counter() for name in ['instrument', 'satellite', 'processing', 'confidence', 'type', 'daynight']}
    missing = Counter()
    invalid_coords = invalid_times = invalid_frp = missing_events = 0
    ids = []
    first = last = None
    for frame in read(root, 'detections', chunksize=100_000):
        ids.append(frame.det_id.to_numpy(dtype=np.int64))
        missing.update({col: int(n) for col, n in frame.isna().sum().items()})
        for name, counter in counters.items():
            counter.update(frame[name].fillna('<missing>').astype(str))
        times = pd.to_datetime(frame.t_utc, utc=True, errors='coerce')
        invalid_times += int(times.isna().sum())
        if times.notna().any():
            low, high = times.min(), times.max()
            first = low if first is None else min(first, low)
            last = high if last is None else max(last, high)
        invalid_coords += int((~np.isfinite(frame.lat) | ~np.isfinite(frame.lon)
                               | ~frame.lat.between(-90, 90) | ~frame.lon.between(-180, 180)).sum())
        invalid_frp += int((~np.isfinite(frame.frp) | (frame.frp < 0)).sum())
        missing_events += int((~frame.event_id.isin(event_ids)).sum())
    ids = np.concatenate(ids)
    report['detections'] = {'time_min': str(first), 'time_max': str(last),
        'duplicate_ids': int(len(ids) - len(np.unique(ids))), 'missing_by_column': dict(missing),
        'invalid_coordinates': invalid_coords, 'invalid_timestamps': invalid_times,
        'invalid_or_negative_frp': invalid_frp, 'missing_event_references': missing_events,
        'categories': {name: dict(counter) for name, counter in counters.items()}}
    assert not (report['detections']['duplicate_ids'] or invalid_coords or invalid_times or missing_events)

    report['our_series_metadata'] = json.loads((repo / 'data/series_metadata.json').read_text(encoding='utf-8'))
    report['our_snapshot_sha256_verified'] = (sha(repo / 'data/history.sqlite.gz') ==
        json.loads((repo / 'data/manifest.json').read_text(encoding='utf-8'))['snapshot']['compressed_sha256'])
    base = 'https://modis-viirs-harmonization-production.up.railway.app'
    with urllib.request.urlopen(base + '/v1/empirical/metadata', timeout=30) as response:
        api_meta = json.load(response)
        assert api_meta['series']['source_snapshot_id'] == report['our_series_metadata']['source_snapshot_id']
    report['public_api_snapshot_matches'] = True
    report['leakage_findings'] = [
        'Event centroids, duration, totals, final type and confidence use detections after issuance.',
        'Static-source masks in companion archive.py are fitted using the full 2012-2026 archive.',
        'Event IDs and connected components are constructed retrospectively over the full archive.',
        'date_local is solar longitude-based time; use t_utc and explicit America/Lima for operational dates.',
        'Our full weekly estimates are only usable after the week ends, plus actual publication latency.',
        'SP archives cannot reproduce historical NRT arrival times; operational equivalence is unverified.'
    ]
    report['interpretation'] = 'Filtered retrospective records; absence is not proof of no physical wildfire.'
    (root / 'audit_report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({'tables': {k: v['rows'] for k, v in report['tables'].items()},
                      'detections': report['detections'], 'api_snapshot_matches': True}, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--input-dir', type=Path, required=True)
    parser.add_argument('--repo', type=Path, default=Path(__file__).resolve().parents[1])
    args = parser.parse_args()
    audit(args.input_dir.resolve(), args.repo.resolve())
