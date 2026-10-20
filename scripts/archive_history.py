"""Persist validated daily observations. Git commits make multi-file updates atomic."""
import argparse
import copy
import json
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

SIDES = ('Allies', 'Axis', 'Other')
RESOURCES = ('tungsten', 'aluminum', 'latex', 'chromium', 'oil', 'factories')


def require(ok, message):
    if not ok:
        raise ValueError(message)


def timestamp(value):
    require(isinstance(value, str), 'Invalid fetch timestamp')
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    require(result.tzinfo is not None, 'Timestamp needs a timezone')
    return result


def validate(data):
    require(isinstance(data, dict) and data.get('schemaVersion') == 2, 'Archive requires schema 2')
    timestamp(data.get('fetchedAt'))
    require(isinstance(data.get('allianceRevision'), str) and data['allianceRevision'], 'Missing alliance revision')
    resources = data.get('resources')
    require(isinstance(resources, list) and [r.get('key') for r in resources] == list(RESOURCES),
            'Invalid resources')
    require(all(type(r.get('available')) is bool and isinstance(r.get('label'), str) for r in resources),
            'Invalid resource availability')
    require(isinstance(data.get('nations'), list) and data['nations'], 'No nations')
    nation_ids, town_ids, territory_ids = set(), set(), set()

    def counts(item):
        require(type(item.get('population')) is int and item['population'] >= 0, 'Invalid population')
        require(isinstance(item.get('name'), str) and item['name'], 'Invalid name')
        require(isinstance(item.get('counts'), dict) and all(
            type(item['counts'].get(k)) is int and item['counts'][k] >= 0 for k in RESOURCES), 'Invalid counts')

    for nation in data['nations']:
        key = nation.get('id')
        require(key is None or isinstance(key, str) and key, 'Invalid nation ID')
        require(key not in nation_ids, 'Duplicate nation ID')
        nation_ids.add(key)
        require(nation.get('alliance') in SIDES, 'Invalid alliance')
        require(key is not None or nation['alliance'] == 'Other', 'Independent must be Other')
        counts(nation)
        require(isinstance(nation.get('towns'), list), 'Invalid towns')
        for town in nation['towns']:
            tid = town.get('id')
            require(isinstance(tid, str) and tid and tid not in town_ids, 'Invalid/duplicate town ID')
            town_ids.add(tid)
            require('nationId' in town and town['nationId'] == key, 'Town parent mismatch')
            counts(town)
            require(isinstance(town.get('factories'), dict) and all(
                type(v) is int and v >= 0 for v in town['factories'].values()), 'Invalid factories')
            require(isinstance(town.get('territories'), list), 'Invalid territories')
            for territory in town['territories']:
                tid = territory.get('id')
                require(isinstance(tid, str) and tid and tid not in territory_ids, 'Duplicate/invalid territory')
                territory_ids.add(tid)
                require(isinstance(territory.get('resources'), list) and all(
                    r in RESOURCES for r in territory['resources']), 'Invalid territory resources')
    return data


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as handle:
            temp = Path(handle.name)
            json.dump(value, handle, ensure_ascii=False, separators=(',', ':'), allow_nan=False)
            handle.write('\n')
        os.replace(temp, path)
    finally:
        if temp and temp.exists():
            temp.unlink()


def summarize(data, date):
    keys = ('towns', 'population', *RESOURCES)
    available = {r['key']: r['available'] for r in data['resources']}
    sides = {side: {k: 0 if available.get(k, True) else None for k in keys}
             for side in ('All', *SIDES)}
    nations = {}
    for n in data['nations']:
        values = {'towns': len(n['towns']), 'population': n['population'],
                  **{k: n['counts'][k] if available[k] else None for k in RESOURCES}}
        nations[n['id'] or 'independent'] = dict(values, name=n['name'], alliance=n['alliance'])
        for side in ('All', n['alliance']):
            for k, v in values.items():
                if v is not None:
                    sides[side][k] += v
    return {'date': date, 'fetchedAt': data['fetchedAt'], 'nations': nations, 'sides': sides}


def rebuild(root, zone):
    """Derive indexes from immutable files; safe to rerun after an interrupted write."""
    snapshots, years = [], {}
    entities = {'schemaVersion': 1, 'nations': {}, 'towns': {}, 'relationships': []}
    for path in sorted(root.glob('*/*/*.json')):
        data = validate(json.loads(path.read_text(encoding='utf-8')))
        date = timestamp(data['fetchedAt']).astimezone(ZoneInfo(zone)).date().isoformat()
        require(path.relative_to(root).as_posix() == f'{date[:4]}/{date[5:7]}/{date}.json',
                'Archive date/path mismatch')
        require(data.get('history', {}).get('timezone') == zone, 'Archive timezone mismatch')
        snapshots.append({'date': date, 'path': path.relative_to(root).as_posix(),
                          'fetchedAt': data['fetchedAt']})
        years.setdefault(date[:4], []).append(summarize(data, date))
        for n in data['nations']:
            for kind, records in [('nations', [n]), ('towns', n['towns'])]:
                for record in records:
                    key = record['id'] or 'independent'
                    entry = entities[kind].setdefault(key, {'id': record['id'], 'names': [],
                                                          'firstSeen': date, 'lastSeen': date})
                    entry['lastSeen'] = date
                    alias = next((a for a in entry['names'] if a['name'] == record['name']), None)
                    if alias:
                        alias['lastSeen'] = date
                    else:
                        entry['names'].append({'name': record['name'], 'firstSeen': date, 'lastSeen': date})
    # Optional explicit, reviewed lineage records. IDs stay distinct.
    lineage = root / 'relationships.json'
    if lineage.exists():
        relationships = json.loads(lineage.read_text(encoding='utf-8'))
        require(isinstance(relationships, list), 'Invalid relationships')
        for r in relationships:
            require(r.get('kind') in ('merger', 'restoration', 'successor') and
                    r.get('entityType') in ('nations', 'towns') and
                    r.get('from') in entities[r['entityType']] and r.get('to') in entities[r['entityType']] and
                    r['from'] != r['to'] and isinstance(r.get('provenance'), str) and r['provenance'] and
                    re.fullmatch(r'\d{4}-\d{2}-\d{2}', r.get('date', '')), 'Invalid lineage record')
        entities['relationships'] = relationships
    # Validate everything before replacing any derived file.
    for year, days in years.items():
        write_json(root / f'summaries/{year}.json', {'schemaVersion': 1, 'days': days})
    write_json(root / 'entities.json', entities)
    write_json(root / 'index.json', {'schemaVersion': 1, 'timezone': zone, 'snapshots': snapshots})


def archive(data, root, zone='America/Los_Angeles', revision='unknown'):
    validate(data)
    root = Path(root)
    date = timestamp(data['fetchedAt']).astimezone(ZoneInfo(zone)).date().isoformat()
    path = root / f'{date[:4]}/{date[5:7]}/{date}.json'
    if not path.exists():
        saved = copy.deepcopy(data)
        saved['history'] = {'date': date, 'timezone': zone, 'codeRevision': revision}
        write_json(path, saved)
    else:
        validate(json.loads(path.read_text(encoding='utf-8')))
    rebuild(root, zone)
    return date


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--snapshot', type=Path, default=Path('site/data/resources.json'))
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--timezone', default='America/Los_Angeles')
    parser.add_argument('--revision', default='unknown')
    args = parser.parse_args()
    data = json.loads(args.snapshot.read_text(encoding='utf-8'))
    age = (datetime.now(timezone.utc) - timestamp(data.get('fetchedAt'))).total_seconds()
    require(-60 <= age <= 3600, 'Refusing to archive stale or future data')
    print('Archived observation for ' + archive(data, args.root, args.timezone, args.revision))


if __name__ == '__main__':
    main()
