import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError, URLError

from scripts.update_data import build_snapshot, fetch_json, update


def fixture():
    geometry = {
        'nodes': {key: {} for key in ('tungsten', 'aluminium', 'latex', 'chromium', 'oil', 'factory', 'factorytier2')},
        'territories': {
            '1': {'nodes': ['aluminium', 'oil', 'oil'], 'name': 'Port', 'core': [10, 20]},
            '2': {'nodes': ['factory', 'factorytier2', 'latex'], 'core': [-5, 2]},
            '3': {'nodes': ['factory'], 'core': [0, 0]},
            '4': {'nodes': ['tungsten'], 'core': [1, 1]},
        },
    }
    social = {
        'nations': [{'uuid': 'n1', 'name': 'Zulu'}, {'uuid': 'n2', 'name': 'Alpha'}],
        'towns': [
            {'uuid': 't1', 'name': 'Port_Town', 'nation_uuid': 'n1'},
            {'uuid': 't2', 'name': 'Free', 'nation_uuid': None},
            {'uuid': 't3', 'name': 'Empty', 'nation_uuid': 'n2'},
        ],
        'territories': [
            {'town_uuid': 't1', 'territory_id': 1, 'role': 'territory'},
            {'town_uuid': 't1', 'territory_id': 2, 'role': 'territory'},
            {'town_uuid': 't2', 'territory_id': 3, 'role': 'territory'},
        ],
        'residents': [{'uuid': 'private', 'username': 'Do not export'}],
        'members': [
            {'town_uuid': 't1', 'resident_uuid': 'resident-a'},
            {'town_uuid': 't1', 'resident_uuid': 'resident-b'},
            {'town_uuid': 't2', 'resident_uuid': 'resident-c'},
        ],
    }
    return geometry, social


class SnapshotTests(unittest.TestCase):
    def setUp(self):
        self.geometry, self.social = fixture()

    def snapshot(self):
        return build_snapshot(self.geometry, self.social)

    def test_joins_counts_and_excludes_unclaimed_and_personal_data(self):
        result = self.snapshot()
        town = next(t for n in result['nations'] for t in n['towns'] if t['id'] == 't1')
        self.assertEqual(town['counts'], dict(tungsten=0, aluminum=1, latex=1, chromium=0, oil=1, factories=1))
        self.assertEqual([t['id'] for t in town['territories']], ['1', '2'])
        self.assertEqual(town['territories'][0]['core'], [10, 20])
        self.assertEqual(sum(n['counts']['tungsten'] for n in result['nations']), 0)
        self.assertNotIn('Do not export', json.dumps(result))

    def test_nation_order_independents_and_zero_resource_towns(self):
        result = self.snapshot()
        self.assertEqual([n['name'] for n in result['nations']], ['Alpha', 'Zulu', 'Independent'])
        self.assertEqual(result['nations'][0]['towns'][0]['name'], 'Empty')
        self.assertEqual(result['nations'][0]['counts']['oil'], 0)
        self.assertEqual(result['nations'][-1]['towns'][0]['factories'], {'Unspecified type': 1})

    def test_factory_tier_is_not_counted_twice(self):
        town = self.snapshot()['nations'][1]['towns'][0]
        self.assertEqual(town['counts']['factories'], 1)
        self.assertEqual(town['factories'], {'Tier 2': 1})

    def test_population_uses_unique_registered_members_across_all_towns(self):
        self.social['towns'].append({'uuid': 't4', 'name': 'No_resources', 'nation_uuid': 'n1'})
        self.social['members'].extend([
            {'town_uuid': 't1', 'resident_uuid': 'resident-a'},
            {'town_uuid': 't4', 'resident_uuid': 'resident-a'},
            {'town_uuid': 't4', 'resident_uuid': 'resident-d'},
        ])
        result = self.snapshot()
        nation = next(n for n in result['nations'] if n['id'] == 'n1')
        self.assertEqual(nation['population'], 3)
        self.assertEqual([t['population'] for t in nation['towns']], [2, 2])
        self.assertEqual(result['nations'][0]['population'], 0)
        self.assertEqual(result['nations'][-1]['population'], 1)
        self.assertNotIn('resident-a', json.dumps(result))

    def test_missing_or_invalid_members_fail_instead_of_showing_zero(self):
        for value in (None, [{'town_uuid': 'unknown', 'resident_uuid': 'r'}],
                      [{'town_uuid': 't1', 'resident_uuid': None}]):
            self.social['members'] = value
            with self.subTest(value=value), self.assertRaises(ValueError): self.snapshot()

    def test_core_references_do_not_grant_or_duplicate_ownership(self):
        # The live feed repeats homes as core records; some point at another town's claim.
        self.social['territories'].extend([
            {'town_uuid': 't1', 'territory_id': 1, 'role': 'core'},
            {'town_uuid': 't2', 'territory_id': 2, 'role': 'core'},
            {'town_uuid': 't3', 'territory_id': 4, 'role': 'core'},
        ])
        result = self.snapshot()
        self.assertEqual(result['nations'][1]['towns'][0]['counts']['factories'], 1)
        self.assertEqual(result['nations'][-1]['towns'][0]['counts']['latex'], 0)
        self.assertEqual(result['nations'][0]['towns'][0]['counts']['tungsten'], 0)

    def test_unknown_ownership_role_rejected(self):
        self.social['territories'][0]['role'] = 'new-role'
        with self.assertRaises(ValueError): self.snapshot()

    def test_non_resource_claim_and_empty_nation(self):
        self.geometry['territories']['1']['nodes'] = []
        self.social['nations'].append({'uuid': 'unused', 'name': 'Unused'})
        result = self.snapshot()
        self.assertEqual(len(result['nations']), 3)
        self.assertEqual(len(result['nations'][1]['towns'][0]['territories']), 1)

    def test_future_factory_labels_are_preserved(self):
        self.geometry['territories']['2']['nodes'] = ['factory', 'factory_aircraft']
        self.geometry['nodes']['factory_aircraft'] = {}
        town = self.snapshot()['nations'][1]['towns'][0]
        self.assertEqual(town['factories'], {'factory_aircraft': 1})

    def test_missing_definition_distinguished_from_zero(self):
        del self.geometry['nodes']['chromium']
        resources = {r['key']: r for r in self.snapshot()['resources']}
        self.assertFalse(resources['chromium']['available'])
        self.assertTrue(resources['tungsten']['available'])

    def test_invalid_ownership_and_references_rejected(self):
        cases = []
        for change in ('duplicate', 'missing_town', 'missing_territory', 'missing_nation', 'duplicate_town'):
            geo, social = fixture()
            if change == 'duplicate': social['territories'].append(dict(social['territories'][0]))
            if change == 'missing_town': social['territories'][0]['town_uuid'] = 'unknown'
            if change == 'missing_territory': social['territories'][0]['territory_id'] = 999
            if change == 'missing_nation': social['towns'][0]['nation_uuid'] = 'unknown'
            if change == 'duplicate_town': social['towns'].append(dict(social['towns'][0]))
            cases.append((change, geo, social))
        for label, geo, social in cases:
            with self.subTest(label=label), self.assertRaises(ValueError):
                build_snapshot(geo, social)

    def test_malformed_source_rejected(self):
        for geo, social in [({}, self.social), (self.geometry, {}), (self.geometry, {'nations': [], 'towns': [], 'territories': []})]:
            with self.subTest(geo=geo.keys()), self.assertRaises(ValueError):
                build_snapshot(geo, social)
        for value in [None, 'oil', [4]]:
            geo = copy.deepcopy(self.geometry)
            geo['territories']['1']['nodes'] = value
            with self.assertRaises(ValueError):
                build_snapshot(geo, self.social)


class FetchTests(unittest.TestCase):
    @patch('scripts.update_data.time.sleep')
    @patch('scripts.update_data.urlopen')
    def test_retries_network_failure(self, opener, sleep):
        response = opener.return_value.__enter__.return_value
        response.read.return_value = b'{"ok": true}'
        opener.side_effect = [URLError('temporary'), opener.return_value]
        self.assertEqual(fetch_json('https://example.com/data'), {'ok': True})
        self.assertEqual(opener.call_count, 2)
        sleep.assert_called_once()

    @patch('scripts.update_data.time.sleep')
    @patch('scripts.update_data.urlopen', side_effect=URLError('offline'))
    def test_retries_are_bounded(self, opener, sleep):
        with self.assertRaises(RuntimeError): fetch_json('https://example.com/data')
        self.assertEqual(opener.call_count, 3)

    @patch('scripts.update_data.urlopen')
    def test_does_not_retry_missing_endpoint(self, opener):
        opener.side_effect = HTTPError('https://example.com', 404, 'missing', {}, None)
        with self.assertRaises(RuntimeError): fetch_json('https://example.com/data')
        self.assertEqual(opener.call_count, 1)

    @patch('scripts.update_data.fetch_json')
    def test_atomic_update_and_failed_update_preserves_existing(self, fetch):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'data' / 'resources.json'
            fetch.side_effect = fixture()
            update(output)
            previous = output.read_bytes()
            self.assertEqual(json.loads(previous)['schemaVersion'], 1)
            fetch.side_effect = [ValueError('bad source')]
            with self.assertRaises(ValueError): update(output)
            self.assertEqual(output.read_bytes(), previous)


if __name__ == '__main__':
    unittest.main()
