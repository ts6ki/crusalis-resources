"""Build a small public resource snapshot; Python 3.10+, no dependencies."""

import argparse
import json
import math
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

GEOMETRY_URL = 'https://map.crusalis.net/map/map/geometry.json'
SOCIAL_URL = 'https://map.crusalis.net/api-proxy/v1/map/social'
RESOURCES = {
    'tungsten': ('Tungsten', 'tungsten'),
    'aluminum': ('Aluminum', 'aluminium'),
    'latex': ('Latex', 'latex'),
    'chromium': ('Chromium', 'chromium'),
    'oil': ('Oil', 'oil'),
    'factories': ('Factories', 'factory'),
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def empty_counts():
    return dict.fromkeys(RESOURCES, 0)


def index_records(records, label):
    require(isinstance(records, list), f'{label} must be an array')
    indexed = {}
    for record in records:
        require(isinstance(record, dict), f'Invalid {label} record')
        key, name = record.get('uuid'), record.get('name')
        require(isinstance(key, str) and key and isinstance(name, str) and name.strip(),
                f'Invalid {label} UUID/name')
        require(key not in indexed, f'Duplicate {label} UUID: {key}')
        indexed[key] = record
    return indexed


def factory_type(nodes):
    specific = sorted(node for node in nodes if node.startswith('factory') and node != 'factory')
    labels = []
    for node in specific:
        tier = re.fullmatch(r'factorytier(\d+)', node)
        labels.append(f'Tier {tier[1]}' if tier else node)
    # Multiple labels describe one territory, not additional factories.
    return ' + '.join(labels) if labels else 'Unspecified type'


def build_snapshot(geometry, social):
    require(isinstance(geometry, dict) and isinstance(social, dict), 'Sources must be objects')
    definitions = geometry.get('nodes')
    territories = geometry.get('territories')
    require(isinstance(definitions, dict) and definitions, 'Missing node definitions')
    require(isinstance(territories, dict) and territories, 'Missing territory geometry')
    nations = index_records(social.get('nations'), 'nations')
    towns = index_records(social.get('towns'), 'towns')
    require(bool(towns), 'No towns in source; refusing to replace snapshot')
    ownership = social.get('territories')
    require(isinstance(ownership, list), 'Missing territory ownership')
    members = social.get('members')
    require(isinstance(members, list), 'Missing population membership data')
    town_residents = {key: set() for key in towns}
    for member in members:
        require(isinstance(member, dict), 'Invalid membership record')
        town_id, resident_id = member.get('town_uuid'), member.get('resident_uuid')
        require(isinstance(town_id, str) and town_id in towns, 'Unknown membership town')
        require(isinstance(resident_id, str) and resident_id.strip(), 'Invalid resident UUID')
        town_residents[town_id].add(resident_id)

    # Validate all territories, including unclaimed ones, to detect schema changes.
    normalized = {}
    all_nodes = set(definitions)
    for territory_id, territory in territories.items():
        require(isinstance(territory, dict), f'Invalid territory {territory_id}')
        nodes = territory.get('nodes')
        require(isinstance(nodes, list) and all(isinstance(n, str) for n in nodes),
                f'Invalid nodes for territory {territory_id}')
        core = territory.get('core')
        require(isinstance(core, list) and len(core) == 2
                and all(type(v) in (int, float) and math.isfinite(v) for v in core),
                f'Invalid core coordinates for territory {territory_id}')
        name = territory.get('name', '')
        require(isinstance(name, str), f'Invalid territory name: {territory_id}')
        normalized[str(territory_id)] = (territory, set(nodes))
        all_nodes.update(nodes)

    groups = {key: {'id': key, 'name': n['name'], 'towns': [], 'counts': empty_counts()}
              for key, n in nations.items()}
    groups[None] = {'id': None, 'name': 'Independent', 'towns': [], 'counts': empty_counts()}
    output_towns = {}
    for key, town in towns.items():
        require('nation_uuid' in town, f'Missing nation field for town {key}')
        nation_id = town['nation_uuid']
        require(nation_id is None or isinstance(nation_id, str), f'Invalid nation for town {key}')
        require(nation_id in groups, f'Unknown nation {nation_id} for town {key}')
        output = {'id': key, 'name': town['name'], 'population': len(town_residents[key]), 'counts': empty_counts(),
                  'factories': {}, 'territories': []}
        output_towns[key] = output
        groups[nation_id]['towns'].append(output)

    seen = set()
    for claim in ownership:
        require(isinstance(claim, dict), 'Invalid ownership record')
        require(claim.get('role') in ('core', 'territory'), 'Unknown ownership role')
        # Core records are home references, duplicated alongside actual claims;
        # a stale core can even point to territory claimed by a different town.
        if claim['role'] == 'core':
            continue
        raw_id = claim.get('territory_id')
        require(type(raw_id) in (int, str) and str(raw_id).isdigit(), 'Invalid territory ID')
        territory_id = str(raw_id)
        require(territory_id not in seen, f'Duplicate/conflicting ownership: {territory_id}')
        seen.add(territory_id)
        town_id = claim.get('town_uuid')
        require(isinstance(town_id, str) and town_id in output_towns, f'Unknown town: {town_id}')
        require(territory_id in normalized, f'Unknown territory: {territory_id}')
        territory, nodes = normalized[territory_id]
        found = [key for key, (_, source) in RESOURCES.items()
                 if key != 'factories' and source in nodes]
        has_factory = any(node.startswith('factory') for node in nodes)
        if has_factory:
            found.append('factories')
        if not found:
            continue
        town = output_towns[town_id]
        for resource in found:
            town['counts'][resource] += 1
        factory = factory_type(nodes) if has_factory else None
        if factory:
            town['factories'][factory] = town['factories'].get(factory, 0) + 1
        town['territories'].append({
            'id': territory_id, 'name': territory.get('name', ''), 'core': territory['core'],
            'resources': found, 'factoryType': factory,
            'factoryNodes': sorted(n for n in nodes if n.startswith('factory')),
        })

    ordered = []
    for group in groups.values():
        if not group['towns']:
            continue
        group['towns'].sort(key=lambda t: (t['name'].casefold(), t['id']))
        group['population'] = len(set().union(*(town_residents[t['id']] for t in group['towns'])))
        for town in group['towns']:
            town['territories'].sort(key=lambda t: int(t['id']))
            for resource, count in town['counts'].items():
                group['counts'][resource] += count
        ordered.append(group)
    ordered.sort(key=lambda n: (n['id'] is None, n['name'].casefold(), n['id'] or ''))
    return {
        'schemaVersion': 1,
        'fetchedAt': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'sources': {'geometry': GEOMETRY_URL, 'social': SOCIAL_URL},
        'resources': [
            {'key': key, 'label': label, 'available':
             any(n.startswith('factory') for n in all_nodes) if key == 'factories' else source in all_nodes}
            for key, (label, source) in RESOURCES.items()
        ],
        'nations': ordered,
    }


def fetch_json(url):
    request = Request(url, headers={'User-Agent': 'CrusalisResourceBrowser/1.0', 'Accept': 'application/json'})
    for attempt in range(3):
        try:
            with urlopen(request, timeout=45) as response:
                return json.loads(response.read())
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
            retryable = not isinstance(error, HTTPError) or error.code in (408, 429) or error.code >= 500
            if attempt == 2 or not retryable:
                raise RuntimeError(f'Could not fetch {url}: {error}') from error
            time.sleep(2 ** (attempt + 1))
    raise AssertionError('Unreachable')


def update(output):
    snapshot = build_snapshot(fetch_json(GEOMETRY_URL), fetch_json(SOCIAL_URL))
    output = Path(output)
    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=output.parent,
                                         suffix='.tmp', delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(snapshot, handle, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
            handle.write('\n')
        os.replace(temporary, output)
    finally:
        if temporary and temporary.exists():
            temporary.unlink()
    print(f'Wrote {sum(len(n["towns"]) for n in snapshot["nations"])} towns to {output}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'site/data/resources.json')
    args = parser.parse_args()
    try:
        update(args.output)
    except (ValueError, RuntimeError, OSError) as error:
        parser.exit(1, f'Update failed: {error}\n')


if __name__ == '__main__':
    main()
