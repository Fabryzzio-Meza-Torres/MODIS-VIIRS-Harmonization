"""Check the actual published URL; no credentials or third-party dependencies."""
import argparse
import json
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def verify(base, timeout=120):
    parsed = urlsplit(base)
    if parsed.scheme not in ('http', 'https') or not parsed.netloc:
        raise ValueError('Provide the real http(s) base URL')
    base = base.rstrip('/')
    def get(path, origin=False):
        headers = {'Origin': 'https://example.com'} if origin else {}
        with urlopen(Request(base + path, headers=headers), timeout=timeout) as response:
            body = response.read()
            if origin:
                assert response.headers.get('Access-Control-Allow-Origin') == '*', 'Public CORS missing'
            return json.loads(body)
    health = get('/health')
    assert health['historical_snapshot_available'] is True, 'Historical snapshot missing'
    regions = get('/v1/regions', origin=True)
    assert len(regions['data']) == 25, 'Expected 25 departments/Callao'
    located = get('/v1/regions/locate?latitude=-13.5319&longitude=-71.9675')
    assert located['region']['region_id'] == '08', 'Cusco location failed'
    series = get('/v1/empirical/series?region_id=08&start=2023-08-07&end=2023-08-14')
    records = {row['instrument']: row for row in series['data']}
    assert records['MODIS']['raw_count'] == 7, 'MODIS snapshot differs'
    assert records['VIIRS']['raw_count'] == 100, 'VIIRS snapshot differs'
    assert abs(records['MODIS']['harmonized_count'] - 13.956484543631605) < 1e-8
    assert abs(records['VIIRS']['harmonized_count'] - 50.15589691025829) < 1e-8
    forecast = get('/v1/forecasts?region_id=08&limit=1')
    assert forecast['data'], 'Regional forecast missing'
    for path in ('/index/rebuild', '/v1/index/rebuild'):
        try:
            urlopen(Request(base + path, data=b'', method='POST'), timeout=timeout).close()
        except HTTPError as error:
            assert error.code in (404, 405), 'Unexpected administrative endpoint response'
        else:
            raise AssertionError('An administrative endpoint is public')
    return {'status': 'verified', 'base_url': base,
            'checks': ['snapshot', 'cors', 'regions', 'point_location',
                       'regional_series_values', 'forecast', 'no_public_index_rebuild'],
            'events_integration': 'not_included_in_this_service'}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base_url')
    args = parser.parse_args()
    print(json.dumps(verify(args.base_url), ensure_ascii=False, indent=2))
