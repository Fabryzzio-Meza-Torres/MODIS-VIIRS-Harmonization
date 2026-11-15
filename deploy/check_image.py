"""Fail an image build if its final runtime user cannot query the snapshot."""
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'api'))
from fastapi.testclient import TestClient
from api import app

with TestClient(app) as client:
    for path in (
        '/v1/empirical/metadata',
        '/v1/regions',
        '/v1/regions/locate?latitude=-13.5319&longitude=-71.9675',
        '/v1/empirical/series?region_id=08&start=2023-08-07&end=2023-08-14',
        '/v1/forecasts?region_id=08&limit=1',
    ):
        response = client.get(path)
        assert response.status_code == 200, (path, response.status_code, response.text)
    assert client.get('/v1/regions').json()['data']
print('Runtime-user snapshot, regional and spatial queries verified')
