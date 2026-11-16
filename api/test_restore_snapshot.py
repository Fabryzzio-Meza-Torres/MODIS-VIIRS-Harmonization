from pathlib import Path
from contextlib import closing
import gzip,hashlib,json,sqlite3,tempfile,unittest
from restore_snapshot import restore

class RestoreTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
        original=self.root/'original.sqlite'
        with closing(sqlite3.connect(original)) as db,db:db.execute('CREATE TABLE evidence(value INTEGER)')
        raw=original.read_bytes()
        self.compressed=self.root/'snapshot.gz';self.compressed.write_bytes(gzip.compress(raw,mtime=0))
        self.manifest=self.root/'manifest.json'
        self.info={'snapshot':{'compressed_sha256':hashlib.sha256(self.compressed.read_bytes()).hexdigest(),
            'uncompressed_sha256':hashlib.sha256(raw).hexdigest(),'uncompressed_bytes':len(raw)}}
        self.manifest.write_text(json.dumps(self.info))
        self.target=self.root/'api/history.sqlite'
    def tearDown(self):self.temp.cleanup()
    def test_restore_and_idempotency(self):
        self.assertEqual(restore(self.compressed,self.manifest,self.target),'restored_verified')
        self.assertEqual(restore(self.compressed,self.manifest,self.target),'already_verified')
    def test_corruption_is_rejected(self):
        self.compressed.write_bytes(self.compressed.read_bytes()[:-4])
        with self.assertRaises(ValueError):restore(self.compressed,self.manifest,self.target)
        self.assertFalse(self.target.exists())
    def test_existing_different_data_survives_failure(self):
        self.target.parent.mkdir();self.target.write_bytes(b'keep this existing data')
        with self.assertRaises(FileExistsError):restore(self.compressed,self.manifest,self.target)
        self.assertEqual(self.target.read_bytes(),b'keep this existing data')

if __name__=='__main__':unittest.main()
