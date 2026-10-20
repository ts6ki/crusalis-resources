import copy
import json
import tempfile
import unittest
from pathlib import Path
from scripts.update_data import build_snapshot
from test_update_data import fixture


class IdentityTests(unittest.TestCase):
    def test_snapshot_freezes_uuid_alliance_and_explicit_parent(self):
        geo, social = fixture()
        mapping = {'revision': 'test', 'nations': {'n1': {'name': 'Old', 'side': 'Axis'}}}
        social['nations'][0]['name'] = 'New name'
        result = build_snapshot(geo, social, mapping=mapping)
        nation = next(n for n in result['nations'] if n['id'] == 'n1')
        self.assertEqual(result['schemaVersion'], 2)
        self.assertEqual(result['allianceRevision'], 'test')
        self.assertEqual(nation['alliance'], 'Axis')
        self.assertEqual(nation['towns'][0]['nationId'], 'n1')


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        from scripts.archive_history import archive
        self.archive = archive
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.data = build_snapshot(*fixture())
        self.data['fetchedAt'] = '2026-10-20T06:47:00+00:00'

    def save(self, data=None):
        return self.archive(data or self.data, self.root, 'America/Los_Angeles', 'revision')

    def test_local_date_and_immutable_duplicate(self):
        self.assertEqual(self.save(), '2026-10-19')
        path = self.root / '2026/10/2026-10-19.json'
        before = path.read_bytes()
        changed = copy.deepcopy(self.data)
        changed['nations'][0]['name'] = 'Changed'
        self.assertEqual(self.save(changed), '2026-10-19')
        self.assertEqual(path.read_bytes(), before)
        index = json.loads((self.root / 'index.json').read_text())
        self.assertEqual(len(index['snapshots']), 1)
        self.assertEqual(index['snapshots'][0]['path'], '2026/10/2026-10-19.json')

    def test_midnight_dst_and_missing_days(self):
        for stamp in ['2026-11-01T06:47:00Z', '2026-11-02T07:47:00Z', '2026-11-04T07:47:00Z']:
            self.data['fetchedAt'] = stamp
            self.save()
        index = json.loads((self.root / 'index.json').read_text())
        self.assertEqual([s['date'] for s in index['snapshots']], ['2026-10-31', '2026-11-01', '2026-11-03'])

    def test_renames_disappearance_and_reappearance_keep_entity_history(self):
        self.save()
        self.data['fetchedAt'] = '2026-10-21T06:47:00Z'
        nation = next(n for n in self.data['nations'] if n['id'] == 'n1')
        nation['name'] = 'Renamed'
        self.save()
        self.data['fetchedAt'] = '2026-10-22T06:47:00Z'
        self.data['nations'].remove(nation)
        self.save()
        self.data['fetchedAt'] = '2026-10-23T06:47:00Z'
        self.data['nations'].append(nation)
        self.save()
        entities = json.loads((self.root / 'entities.json').read_text())
        self.assertEqual([a['name'] for a in entities['nations']['n1']['names']], ['Zulu', 'Renamed'])
        summary = json.loads((self.root / 'summaries/2026.json').read_text())
        self.assertNotIn('n1', summary['days'][2]['nations'])
        self.assertIn('n1', summary['days'][3]['nations'])

    def test_invalid_data_and_legacy_schema_never_write(self):
        for bad in [dict(self.data, schemaVersion=1), dict(self.data, fetchedAt='bad')]:
            with self.assertRaises(ValueError):
                self.save(bad)
        bad = copy.deepcopy(self.data)
        bad['nations'][0]['towns'][0]['nationId'] = 'wrong'
        with self.assertRaises(ValueError):
            self.save(bad)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_duplicate_ids_and_unavailable_values(self):
        bad = copy.deepcopy(self.data)
        bad['nations'].append(copy.deepcopy(bad['nations'][0]))
        with self.assertRaises(ValueError):
            self.save(bad)
        self.data['resources'][0]['available'] = False
        self.save()
        summary = json.loads((self.root / 'summaries/2026.json').read_text())
        self.assertIsNone(summary['days'][0]['sides']['All']['tungsten'])


if __name__ == '__main__':
    unittest.main()
