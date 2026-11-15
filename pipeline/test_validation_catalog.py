"""Conservation, source identity and all published association witnesses."""
from pathlib import Path
from datetime import datetime,date
from zoneinfo import ZoneInfo
import gzip,hashlib,json,unittest

FOLDER=Path(__file__).resolve().parents[1]/'web/validation-data'

class ValidationCatalogTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.summary=json.loads((FOLDER/'summary.json').read_text(encoding='utf-8'))
        cls.cases=[]
        for item in cls.summary['years']:
            cls.cases.extend(json.loads((FOLDER/item['file']).read_text(encoding='utf-8'))['data'])

    def test_complete_catalog_not_only_successes(self):
        self.assertEqual(len(self.cases),15140)
        self.assertEqual(len({r['id'] for r in self.cases}),15140)
        self.assertEqual(sum(r['registry_locations'] for r in self.cases),22473)
        self.assertEqual(sum(r['match_status']=='none' for r in self.cases),7974)
        self.assertEqual(sum(r['match_status']=='both' for r in self.cases),2638)

    def test_year_hashes_and_compressed_identity(self):
        for entry in self.summary['years']:
            raw=(FOLDER/entry['file']).read_bytes()
            self.assertEqual(hashlib.sha256(raw).hexdigest(),entry['sha256'])
            self.assertEqual(gzip.decompress((FOLDER/entry['compressed_file']).read_bytes()),raw)
            data=json.loads(raw)['data']
            self.assertEqual(len(data),entry['references'])
            self.assertTrue(all(r['year']==entry['year'] for r in data))

    def test_every_witness_satisfies_the_published_rule(self):
        counts={'MODIS':0,'VIIRS':0}
        for case in self.cases:
            self.assertEqual(len(set(case['registry_object_ids'])),case['registry_locations'])
            for witness in case['matches']:
                counts[witness['instrument']]+=1
                self.assertIn(witness['registry_object_id'],case['registry_object_ids'])
                self.assertLessEqual(witness['distance_projected_km'],5)
                self.assertGreaterEqual(witness['distance_projected_km'],0)
                self.assertEqual(witness['type'],0)
                self.assertEqual(witness['processing'],'SP')
                self.assertIn(witness['normalized_source'],self.summary['satellite_sources_sha256'])
                detection=datetime.fromisoformat(witness['timestamp_utc']).astimezone(ZoneInfo('America/Lima')).date()
                delta=(detection-date.fromisoformat(witness['registry_date'])).days
                self.assertEqual(delta,witness['calendar_day_difference'])
                self.assertLessEqual(abs(delta),3)
            self.assertEqual(case['match_status']=='none',not case['matches'])
        self.assertEqual(counts,{'MODIS':2974,'VIIRS':6830})

    def test_documents_and_limitations_preserved(self):
        for doc in self.summary['case_study']['document_hashes']:
            self.assertEqual(hashlib.sha256((FOLDER/'documents'/doc['file']).read_bytes()).hexdigest(),doc['sha256'])
        self.assertTrue(all(value is False for value in self.summary['interpretation'].values()))
        self.assertFalse(self.summary['case_study']['confirmed_incident_attribution'])
        self.assertFalse(self.summary['case_study']['sensor_omission_established'])
        self.assertTrue(self.summary['live_source_verification']['fields_and_geometry_match'])
        self.assertEqual(self.summary['live_source_verification']['sample_rows'],13)

if __name__=='__main__':unittest.main()
