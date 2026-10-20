"""Exercise the real UI against a small dated archive, without publishing fixtures."""
import copy
import json
import os
import sys
import tempfile
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.archive_history import archive
from scripts.update_data import build_snapshot
from test_update_data import fixture


def run(base):
    mapping = {'revision': 'fixture', 'nations': {'n1': {'name': 'Zulu', 'side': 'Axis'}}}
    first = build_snapshot(*fixture(), mapping=mapping)
    first['fetchedAt'] = '2026-10-20T06:47:00Z'
    second = copy.deepcopy(first)
    second['fetchedAt'] = '2026-10-21T06:47:00Z'
    renamed = next(n for n in second['nations'] if n['id'] == 'n1')
    renamed.update(name='Danubian', population=7, alliance='Allies')
    absent = copy.deepcopy(second)
    absent['fetchedAt'] = '2026-10-23T06:47:00Z'
    removed = next(n for n in absent['nations'] if n['id'] == 'n1')
    absent['nations'].remove(removed)
    target = next(n for n in absent['nations'] if n['id'] == 'n2')
    for town in removed['towns']:
        town['nationId'] = target['id']
        target['towns'].append(town)
    target['population'] += removed['population']
    for k in target['counts']:
        target['counts'][k] += removed['counts'][k]
    latest = copy.deepcopy(second)
    latest['fetchedAt'] = '2026-10-25T06:47:00Z'
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        for snapshot in [first, second, absent]:
            archive(snapshot, root)
        with sync_playwright() as p:
            browser = p.chromium.launch(channel=os.environ.get('BROWSER_CHANNEL', 'chrome'))
            page = browser.new_page(viewport={'width': 1440, 'height': 1000})
            errors = []
            page.on('pageerror', lambda error: errors.append(str(error)))

            def history_route(route):
                relative = route.request.url.split('/data/history/')[1]
                path = root / relative
                route.fulfill(status=200, content_type='application/json', body=path.read_text()) if path.exists() else route.fulfill(status=404)

            page.route('**/data/history/**', history_route)
            page.route('**/data/resources.json', lambda route: route.fulfill(json=latest))
            page.goto(base + '?date=2026-10-19&entity=nation:n1')
            expect(page.locator('#history-selected')).to_have_text('2026-10-19')
            expect(page.locator('#freshness')).to_have_text('Saved 2026-10-19')
            expect(page.locator('#nations tbody[data-side="Axis"]')).to_contain_text('Zulu')
            page.locator('#history-details > summary').click()
            expect(page.locator('#history-comparison')).to_contain_text('previous saved observation')
            page.locator('#history-next').click()
            expect(page.locator('#history-selected')).to_have_text('2026-10-20')
            expect(page.locator('#history-deltas')).to_contain_text('+5')
            expect(page.locator('#nations tbody[data-side="Allies"]')).to_contain_text('Danubian')
            page.locator('#search').fill('Zulu')
            expect(page.locator('#nations .nation-row')).to_have_count(1)
            expect(page.locator('#nations .nation-row')).to_contain_text('Danubian')
            page.locator('#search').fill('')
            page.locator('#history-date').fill('2026-10-21')
            expect(page.locator('#history-note')).to_contain_text('No snapshot saved')
            expect(page.locator('#history-selected')).to_have_text('2026-10-20')
            page.locator('#history-next').click()
            expect(page.locator('#history-selected')).to_have_text('2026-10-22')
            expect(page.locator('#history-deltas')).to_contain_text('N/A')
            expect(page.locator('#history-chart-note')).to_contain_text('not present')
            expect(page.locator('#history-changes')).to_contain_text('town membership')
            page.locator('#history-prev').click()
            expect(page.locator('#history-selected')).to_have_text('2026-10-20')
            page.route('**/2026-10-20.json', lambda route: route.fulfill(status=503))
            page.locator('#reload').click()
            expect(page.locator('#history-note')).to_contain_text('previous view is unchanged')
            expect(page.locator('#history-selected')).to_have_text('2026-10-20')
            page.unroute('**/2026-10-20.json')
            for width in [320, 390, 768, 1440]:
                page.set_viewport_size({'width': width, 'height': 900})
                assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
            page.locator('#history-slider').focus()
            page.keyboard.press('Home')
            expect(page.locator('#history-selected')).to_have_text('2026-10-19')
            page.locator('#history-latest').click()
            expect(page.locator('#history-selected')).to_have_text('Latest')
            assert 'date=' not in page.url
            saved = json.loads(page.evaluate("localStorage.getItem('crusalis:snapshot:v2')"))
            assert saved['fetchedAt'] == latest['fetchedAt']
            # Delay an archive response until Latest has completed: it must not win the race.
            pending = []
            page.route('**/2026-10-19.json', lambda route: pending.append(route))
            page.goto(base + '?date=2026-10-19')
            page.wait_for_function("document.querySelector('#history-note').textContent.includes('Loading 2026')")
            page.locator('#history-latest').click()
            expect(page.locator('#nations .nation-row').first).to_be_visible()
            expect(page.locator('#history-selected')).to_have_text('Latest')
            for route in pending:
                route.fulfill(content_type='application/json', body=(root / '2026/10/2026-10-19.json').read_text())
            page.wait_for_timeout(150)
            expect(page.locator('#history-selected')).to_have_text('Latest')
            page.locator('#history-details > summary').click()
            page.screenshot(path=str(Path(os.environ.get('TEMP', directory)) / 'crusalis-history-expanded.png'), full_page=True)
            page.route('**/data/**', lambda route: route.abort('internetdisconnected'))
            page.reload()
            expect(page.locator('#nations .nation-row').first).to_be_visible()
            expect(page.locator('#status')).to_contain_text('Showing the copy saved in this browser')
            page.screenshot(path=str(Path(os.environ.get('TEMP', directory)) / 'crusalis-history.png'), full_page=True)
            assert not errors, errors
            browser.close()
    print('History browser checks passed: dates, UUID renames, saved alliances, gaps, deltas, failures, races, keyboard and mobile.')


if __name__ == '__main__':
    run(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8765/site/')
