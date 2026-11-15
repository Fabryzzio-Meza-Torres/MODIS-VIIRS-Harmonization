"""Package a reviewed inference snapshot without changing its scientific content."""
from pathlib import Path
import argparse,hashlib,json,os,tempfile


def package(source,destination):
    source=Path(source);destination=Path(destination)
    raw=source.read_bytes();document=json.loads(raw)
    meta=document['metadata']
    manifest={'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw),
        'rows':len(document['data']),'snapshot_id':meta['snapshot_id'],
        'method_version':meta['method_version'],'model_sha256':meta['sources']['model_sha256'],
        'issued_at':meta['issued_at'],'purpose':'experimental read-only API snapshot; not physical ignition truth'}
    destination.parent.mkdir(parents=True,exist_ok=True)
    # Hash verification prevents a partially replaced pair from being served.
    for target,content in [(destination,raw),(destination.with_name(destination.stem+'_manifest.json'),
            (json.dumps(manifest,indent=2,ensure_ascii=False)+'\n').encode())]:
        fd,tmp=tempfile.mkstemp(dir=target.parent,suffix='.tmp')
        try:
            with os.fdopen(fd,'wb') as handle:handle.write(content)
            os.chmod(tmp,0o644)
            os.replace(tmp,target)
        finally:
            if Path(tmp).exists():Path(tmp).unlink()
    return manifest


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('source',type=Path)
    parser.add_argument('--destination',type=Path,default=Path('data/regional_outlook.json'))
    args=parser.parse_args()
    print(json.dumps(package(args.source,args.destination),indent=2))
