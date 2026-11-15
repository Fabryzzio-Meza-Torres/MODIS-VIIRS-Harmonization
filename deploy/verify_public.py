"""Check the actual published URL; no credentials or third-party dependencies."""
import argparse
import json
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen


def verify(base, timeout=120, require_risk=False):
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
    checks=['snapshot','cors','regions','point_location','regional_series_values',
            'forecast','no_public_index_rebuild']
    result={'status':'verified','base_url':base,'checks':checks,
            'events_integration':'not_included_in_this_service'}
    if require_risk:
        info=get('/v1/fire-risk/metadata')
        assert info['forecast_rows']==300
        assert info['physical_ignition_probability_verified'] is False
        assert info['refresh_required'] is False,'A refreshed weekly outlook is required'
        data=get('/v1/fire-risk/outlook?limit=300',origin=True)['data']
        assert len({(r['region_id'],r['lead_weeks']) for r in data})==300
        week=info['available_target_weeks'][0]
        response=get('/v1/fire-risk?region_id=08&target_week_start='+week)
        assert len(response['data'])==1 and response['data'][0]['region_id']=='08'
        assert response['metadata']['snapshot_id']==info['snapshot_id']
        assert all(r['probability'] is None or 0<=r['probability']<=1 for r in data)
        checks.extend(['risk_metadata','risk_grid_300','risk_region_week','risk_cors'])
        result['risk_snapshot_id']=info['snapshot_id']
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('base_url')
    parser.add_argument('--require-risk',action='store_true',help='Require the reviewed regional model endpoints')
    args = parser.parse_args()
    print(json.dumps(verify(args.base_url,require_risk=args.require_risk), ensure_ascii=False, indent=2))
