"""Public CMR acquisition manifest. Metadata only; no protected bulk downloads.
Candidate swaths intersect the Peru bbox, NOT necessarily the exact country polygon.
All files (including fire-free swaths) are retained for later exposure processing.
"""
from pathlib import Path
import argparse,gzip,json,time
from urllib.parse import urlencode
from urllib.request import Request,urlopen

PRODUCTS=[('MOD14','061','2000-11-06'),('MYD14','061','2002-07-08'),
          ('VNP14IMG','002','2012-02-06'),('VJ114IMG','002','2018-04-02'),
          ('VJ214IMG','002','2023-03-06')]
BASE='https://cmr.earthdata.nasa.gov/search/'
BBOX='-81.5,-18.5,-68.5,0.1'

def fetch(endpoint,params,headers=None):
    for attempt in range(3):
        try:
            request=Request(BASE+endpoint+'?'+urlencode(params),headers={'User-Agent':'Peru-FIRMS-research-metadata/1.0',**(headers or {})})
            with urlopen(request,timeout=90) as response:return json.load(response),dict(response.headers)
        except Exception:
            if attempt==2:raise
            time.sleep(2**attempt)

def run(out):
    out=Path(out);out.mkdir(parents=True,exist_ok=True);summary=[]
    for product,version,start in PRODUCTS:
        marker=out/(product+'_complete.json')
        if marker.is_file():
            summary.append(json.loads(marker.read_text()));continue
        data,_=fetch('collections.json',{'short_name':product,'provider':'LPCLOUD','page_size':100})
        matches=[e for e in data['feed']['entry'] if e.get('version_id') in [version,str(int(version)),{'061':'6.1','002':'2'}[version]]]
        assert len(matches)==1,(product,'Ambiguous collection')
        concept=matches[0]['id']
        params={'collection_concept_id':concept,'bounding_box':BBOX,
            'temporal':start+'T00:00:00Z,2026-07-26T23:59:59Z','page_size':2000,'sort_key':'start_date'}
        temporary=out/(product+'.partial.jsonl.gz');target=out/(product+'.jsonl.gz')
        count=0;cursor=None;seen=set();sizes=[];expected=None
        with gzip.open(temporary,'wt',encoding='utf-8') as stream:
            while True:
                page,headers=fetch('granules.json',params,{'CMR-Search-After':cursor} if cursor else {})
                lower={k.lower():v for k,v in headers.items()}
                if expected is None:expected=int(lower['cmr-hits'])
                entries=page['feed']['entry']
                if not entries:break
                for e in entries:
                    assert e['id'] not in seen,'Duplicate CMR concept in search-after sequence'
                    seen.add(e['id']);size=float(e.get('granule_size',0));sizes.append(size)
                    links=[l for l in e.get('links',[]) if not l.get('inherited') and
                        ('data#' in l.get('rel','') or 'opendap' in l.get('title','').lower() or 'opendap' in l.get('href','').lower())]
                    row={'product':product,'collection_concept_id':concept,'concept_id':e['id'],
                        'producer_granule_id':e.get('producer_granule_id',e.get('title')),
                        'start':e.get('time_start'),'end':e.get('time_end'),'catalog_size_MB':size,
                        'links':links,'boxes':e.get('boxes',[]),'polygons':e.get('polygons',[])}
                    stream.write(json.dumps(row)+'\n');count+=1
                cursor=lower.get('cmr-search-after')
                print(product,count,'/',expected,flush=True)
                if count>=expected:break
                if not cursor:raise RuntimeError('Missing search-after cursor before completing manifest')
        assert count==expected,(count,expected)
        temporary.replace(target)
        record={'product':product,'collection_id':concept,'bbox':BBOX,'start':start,
            'end':'2026-07-26','matching_fire_granules':count,'catalog_size_MB_sum':sum(sizes),
            'geolocation_included':False,'file_bytes_verified':False,'protected_data_downloaded':False}
        marker.write_text(json.dumps(record,indent=2));summary.append(record)
    report={'scope':'maximum demo historical interval, all five platforms','products':summary,
        'total_fire_granules':sum(r['matching_fire_granules'] for r in summary),
        'catalog_size_is_not_verified_download_bytes':True,'geolocation_manifest_complete':False,
        'coverage_harmonization_complete':False,'country_filter':'candidate bbox; exact-polygon processing still required'}
    (out/'inventory_summary.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--out',type=Path,required=True)
    a=p.parse_args();run(a.out)
