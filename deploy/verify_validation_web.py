"""Verify the published evidence catalog, compressed bytes and document hashes."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime,timezone
from urllib.request import urlopen
from pathlib import Path
import argparse,gzip,hashlib,json

def verify(base):
    base=base.rstrip('/')
    def get(path):
        with urlopen(base+path,timeout=40) as response:return response.read()
    html=get('/visor/').decode('utf-8')
    assert 'id="validacion"' in html and 'src="validation.js"' in html
    summary_raw=get('/visor/validation-data/summary.json')
    summary=json.loads(summary_raw)
    assert summary['catalog_references']==15140
    assert summary['catalog_status_counts']=={'none':7974,'viirs':4192,'both':2638,'modis':336}
    assert summary['interpretation']['association_is_verified_attribution'] is False
    def year(entry):
        raw=gzip.decompress(get('/visor/validation-data/'+entry['compressed_file']))
        assert hashlib.sha256(raw).hexdigest()==entry['sha256'],entry['file']
        records=json.loads(raw)['data']
        assert len(records)==entry['references']
        return len(records)
    with ThreadPoolExecutor(max_workers=3) as pool:total=sum(pool.map(year,summary['years']))
    assert total==15140
    for doc in summary['case_study']['document_hashes']:
        raw=get('/visor/validation-data/documents/'+doc['file'])
        assert hashlib.sha256(raw).hexdigest()==doc['sha256']
        assert raw.startswith(b'%PDF-')
    assert json.loads(get('/health'))['historical_snapshot_available'] is True
    risk=json.loads(get('/v1/fire-risk/metadata'))
    assert risk['forecast_rows']==300
    return {'status':'verified','base_url':base,'verified_at':datetime.now(timezone.utc).isoformat(),
        'catalog_references':total,'year_partitions_verified':len(summary['years']),
        'source_document_hashes_verified':len(summary['case_study']['document_hashes']),
        'summary_sha256':hashlib.sha256(summary_raw).hexdigest(),
        'checks':['section_html','all_year_hashes','all_reference_counts','unmatched_retained',
            'document_hashes','historical_api_preserved','forecast_metadata_preserved']}

if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('base_url');p.add_argument('--output',type=Path)
    args=p.parse_args();result=verify(args.base_url)
    if args.output:args.output.write_text(json.dumps(result,indent=2),encoding='utf-8')
    print(json.dumps(result,indent=2))
