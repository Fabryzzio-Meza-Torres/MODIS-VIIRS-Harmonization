"""Restore the published API snapshot using only the Python standard library."""
from pathlib import Path
from contextlib import closing
import argparse,gzip,hashlib,json,os,sqlite3,tempfile

def sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024**2),b''):digest.update(block)
    return digest.hexdigest()

def restore(compressed,manifest,target,replace=False):
    compressed,manifest,target=Path(compressed),Path(manifest),Path(target).resolve()
    expected=json.loads(manifest.read_text(encoding='utf-8'))['snapshot']
    if sha(compressed)!=expected['compressed_sha256']:raise ValueError('Compressed snapshot hash mismatch')
    if target.is_file():
        if sha(target)==expected['uncompressed_sha256']:return 'already_verified'
        if not replace:raise FileExistsError('A different snapshot exists; review it and use --replace to update.')
    target.parent.mkdir(parents=True,exist_ok=True)
    handle,staging=tempfile.mkstemp(dir=target.parent,prefix='history_restore_',suffix='.part')
    staging=Path(staging)
    try:
        with os.fdopen(handle,'wb') as output,gzip.open(compressed,'rb') as source:
            digest=hashlib.sha256();size=0
            while block:=source.read(1024**2):
                size+=len(block)
                if size>expected['uncompressed_bytes']:raise ValueError('Snapshot exceeds declared size')
                output.write(block);digest.update(block)
        if size!=expected['uncompressed_bytes'] or digest.hexdigest()!=expected['uncompressed_sha256']:
            raise ValueError('Uncompressed snapshot integrity mismatch')
        with closing(sqlite3.connect(staging.as_uri()+'?mode=ro',uri=True)) as db:
            if db.execute('PRAGMA integrity_check').fetchone()[0]!='ok':raise ValueError('Invalid SQLite snapshot')
        os.replace(staging,target)
    except Exception:
        if staging.is_file():staging.unlink()
        raise
    return 'restored_verified'

if __name__=='__main__':
    root=Path(__file__).resolve().parents[1]
    p=argparse.ArgumentParser()
    p.add_argument('--compressed',type=Path,default=root/'data/history.sqlite.gz')
    p.add_argument('--manifest',type=Path,default=root/'data/manifest.json')
    p.add_argument('--output',type=Path,default=root/'api/history.sqlite')
    p.add_argument('--replace',action='store_true')
    a=p.parse_args()
    print(restore(a.compressed,a.manifest,a.output,a.replace))
