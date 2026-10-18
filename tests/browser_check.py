"""Optional Playwright UI checks. Serve the project root, then run this file."""
import copy
import os
import sys
from pathlib import Path
from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.update_data import build_snapshot
from test_update_data import fixture

NATIONS = '#nations .nation-row'


def values(page, selector):
    return page.locator(selector).evaluate_all('(cells) => cells.map(c => Number(c.dataset.value ?? -1))')


def check_overview(page, data):
    expect(page.locator('#summary')).to_contain_text('ranked by population')
    expect(page.locator(NATIONS)).to_have_count(len(data['nations']))
    expect(page.locator('#nations .row-toggle[aria-expanded="true"]')).to_have_count(0)
    expect(page.locator('#nations .town-row')).to_have_count(0)
    expect(page.locator('#side-filter [aria-pressed="true"]')).to_contain_text('All')
    by_id = {n['id'] or '': n for n in data['nations']}
    listed = page.locator(NATIONS).evaluate_all('(rows) => rows.map(r => r.dataset.nationId)')
    assert sorted(listed) == sorted(by_id), 'every nation appears exactly once'
    keys = ['population', 'towns', *[r['key'] for r in data['resources']]]
    for key in keys:
        raw = sum(n['population'] if key == 'population' else len(n['towns']) if key == 'towns' else n['counts'][key] for n in data['nations'])
        sides = values(page, f'#totals tbody td[data-key="{key}"] .total-value')
        assert sum(sides) == raw, (key, sides, raw)
        expect(page.locator(f'#totals tfoot td[data-key="{key}"] .total-value')).to_have_attribute('data-value', str(raw))
    for side in ['Allies', 'Axis', 'Other']:
        group = page.locator(f'#nations tbody[data-side="{side}"]')
        ids = group.locator('.nation-row').evaluate_all('(rows) => rows.map(r => r.dataset.nationId)')
        nations = [by_id[i] for i in ids]
        for key in keys:
            expected = sum(n['population'] if key == 'population' else len(n['towns']) if key == 'towns' else n['counts'][key] for n in nations)
            cell = page.locator(f'#totals tr[data-side="{side}"] td[data-key="{key}"] .total-value')
            expect(cell).to_have_attribute('data-value', str(expected))
        populations = [by_id[i]['population'] for i in ids if i]
        assert populations == sorted(populations, reverse=True), side


def check_sorting(page, data):
    totals = page.locator('#totals').inner_text()
    for resource in data['resources']:
        key = resource['key']
        page.locator(f'#nations thead th[data-key="{key}"] button').click()
        expect(page.locator(f'#nations thead th[data-key="{key}"]')).to_have_attribute('aria-sort', 'descending')
        assert f'sort={key}' in page.url
        for side in ['Allies', 'Axis', 'Other']:
            shown = values(page, f'#nations tbody[data-side="{side}"] .nation-row td[data-key="{key}"]')
            assert shown == sorted(shown, reverse=True) and all(v > 0 for v in shown), (key, side, shown)
        folded = page.locator('#nations .fold-toggle')
        for index in range(folded.count()):
            folded.nth(index).click()
        expect(page.locator(NATIONS)).to_have_count(len(data['nations']))
        assert page.locator('#totals').inner_text() == totals
    expect(page.locator('#nations .fold-toggle').first).to_contain_text('Hide')
    page.locator('#nations thead th[data-key="name"] button').click()
    names = page.locator('#nations tbody[data-side="Axis"] .row-name').all_text_contents()
    assert names == sorted(names, key=str.lower), names
    page.locator('#nations thead th[data-key="population"] button').click()
    assert 'sort=' not in page.url


def check_filters_and_expansion(page):
    page.locator('#side-filter [data-side="Allies"]').click()
    expect(page.locator('#nations tbody.side-group')).to_have_count(1)
    assert 'side=Allies' in page.url
    page.locator('#search').fill('Tokyo')
    expect(page.locator('#nations .empty-row')).to_contain_text('No towns or nations in Allies match')
    page.locator('#side-filter [data-side="All"]').click()
    expect(page.locator(NATIONS)).to_have_count(1)
    expect(page.locator('#nations .town-row')).to_have_count(1)
    expect(page.locator('#nations .town-row')).to_contain_text('Tokyo')
    page.get_by_role('button', name='Clear', exact=True).click()
    expect(page.locator('#search')).to_have_value('')

    toggle = page.locator(f'{NATIONS} .row-toggle').first
    toggle.focus()
    page.keyboard.press('Enter')
    expect(page.locator(f'{NATIONS} .row-toggle').first).to_have_attribute('aria-expanded', 'true')
    assert page.evaluate('document.activeElement.dataset.focusKey').startswith('nation:')
    page.locator('#nations .town-row .row-toggle').first.click()
    expect(page.locator('#nations .detail-row')).to_be_visible()
    page.locator(f'{NATIONS} .row-toggle').first.click()
    expect(page.locator('#nations .town-row')).to_have_count(0)


def check_phone(page):
    page.set_viewport_size({'width': 390, 'height': 844})
    expect(page.locator('.totals')).to_be_hidden()
    page.locator('#compare-buttons button', has_text='Oil').click()
    expect(page.locator('#compare-buttons [aria-pressed="true"]')).to_have_text('Oil')
    expect(page.locator('#side-summary')).to_contain_text('oil territories across all sides')
    row = page.locator(NATIONS).first
    expect(row.locator('td:visible')).to_have_count(1)
    expect(row.locator('td[data-key="oil"]')).to_be_visible()
    page.locator('#side-filter [data-side="Axis"]').click()
    expect(page.locator('#side-summary')).to_contain_text('Axis hold')
    row.locator('.row-toggle').click()
    expect(page.locator('#nations .nation-detail-row .resource-grid')).to_be_visible()
    page.locator('#side-filter [data-side="All"]').click()
    page.locator('#compare-buttons button', has_text='Population').click()
    for width in [320, 390, 768, 820, 1024, 1099, 1440]:
        page.set_viewport_size({'width': width, 'height': 900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}px'
    page.set_viewport_size({'width': 1440, 'height': 1000})


def check_failures(page, data, url):
    page.locator('#search').fill('zzzz no match')
    expect(page.locator(NATIONS)).to_have_count(0)
    expect(page.locator('#nations .empty-row')).to_contain_text('No towns or nations match')
    page.get_by_role('button', name='Clear search').click()
    expect(page.locator(NATIONS)).to_have_count(len(data['nations']))
    page.route('**/data/resources.json', lambda route: route.fulfill(status=503, body='Unavailable'))
    page.get_by_role('button', name='Reload snapshot').click()
    expect(page.locator('#status')).to_contain_text('Keeping the previously loaded data')
    expect(page.locator(NATIONS)).to_have_count(len(data['nations']))
    page.reload()
    expect(page.locator('#status')).to_contain_text('HTTP 503')
    expect(page.locator('#status')).to_contain_text('Showing the copy saved in this browser')
    expect(page.locator(NATIONS)).to_have_count(len(data['nations']))
    page.unroute('**/data/resources.json')
    page.route('**/data/resources.json', lambda route: route.abort('internetdisconnected'))
    page.reload()
    expect(page.locator('#status')).to_contain_text('Showing the copy saved in this browser')
    expect(page.locator(NATIONS)).to_have_count(len(data['nations']))
    page.unroute('**/data/resources.json')
    page.goto(url + '?side=Axis&sort=nonsense&q=berlin')
    expect(page.locator('#side-filter [data-side="Axis"]')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('#nations thead th[data-key="population"]')).to_have_attribute('aria-sort', 'descending')
    expect(page.locator('#nations .town-row')).to_contain_text('Berlin')
    page.goto(url + '?sort=oil&q=paris')
    expect(page.locator(NATIONS)).to_have_count(1)
    expect(page.locator(NATIONS)).to_contain_text('France')
    expect(page.locator('#nations .fold-toggle')).to_have_count(0)
    page.goto(url)


def check_controlled_snapshot(page):
    geo, social = fixture()
    social['nations'][0]['name'] = 'Germany'
    social['nations'][1]['name'] = 'France'
    social['towns'][0]['name'] = '<img src=x onerror=alert(1)>'
    social['nations'].append({'uuid': 'n3', 'name': '<b>Bold</b>'})
    social['towns'][1]['nation_uuid'] = 'n3'
    geo['territories']['1']['name'] = '<svg onload=alert(1)>'
    del geo['nodes']['chromium']
    controlled = build_snapshot(geo, social)
    controlled['fetchedAt'] = '2020-01-01T00:00:00Z'
    current = {'data': controlled}
    page.route('**/data/resources.json', lambda route: route.fulfill(json=current['data']))
    page.get_by_role('button', name='Reload snapshot').click()
    expect(page.locator('#status')).to_have_text('')
    expect(page.locator('#freshness')).to_contain_text('stale')
    expect(page.locator('main img, main b, #nations svg[onload]')).to_have_count(0)
    expect(page.locator('#nations tbody[data-side="Other"] .nation-row')).to_contain_text('<b>Bold</b>')
    axis = page.locator('#nations tbody[data-side="Axis"]')
    axis.locator('.nation-row .row-toggle').click()
    axis.locator('.town-row .row-toggle').click()
    expect(axis.locator('.detail-row')).to_contain_text('Tier 2: 1')
    expect(axis.locator('.detail-row')).to_contain_text('<svg onload=alert(1)>')
    expect(axis.locator('.town-row')).to_contain_text('<img src=x onerror=alert(1)>')
    expect(axis.locator('.nation-row td[data-key="chromium"]')).to_have_text('N/A')
    expect(page.locator('#nations thead th[data-key="chromium"] button')).to_be_disabled()
    invalid = copy.deepcopy(controlled)
    invalid['nations'][0]['population'] = -1
    current['data'] = invalid
    page.get_by_role('button', name='Reload snapshot').click()
    expect(page.locator('#status')).to_contain_text('Keeping the previously loaded data')


def check_theme(page):
    background = "getComputedStyle(document.body).backgroundColor"
    expect(page.locator('html')).to_have_attribute('data-theme', 'dark')
    assert page.evaluate(background) == 'rgb(22, 22, 22)', page.evaluate(background)
    expect(page.locator('#theme-switch [data-theme-choice="dark"]')).to_have_attribute('aria-pressed', 'true')
    expect(page.locator('.lede')).to_have_text('Made by tsuki')
    expect(page.locator('footer')).to_have_count(0)
    page.get_by_role('button', name='Light', exact=True).click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'light')
    assert page.evaluate(background) == 'rgb(250, 250, 248)', page.evaluate(background)
    page.reload()
    expect(page.locator(NATIONS).first).to_be_visible()
    expect(page.locator('html')).to_have_attribute('data-theme', 'light')
    expect(page.locator('#theme-switch [data-theme-choice="light"]')).to_have_attribute('aria-pressed', 'true')
    page.get_by_role('button', name='Dark', exact=True).click()
    expect(page.locator('html')).to_have_attribute('data-theme', 'dark')


def check_without_saved_copy(browser, url):
    context = browser.new_context()
    page = context.new_page()
    page.route('**/data/resources.json', lambda route: route.abort('internetdisconnected'))
    page.goto(url)
    expect(page.locator('#status')).to_contain_text('Try Reload')
    expect(page.locator('#freshness')).to_have_text('No data loaded.')
    expect(page.locator(NATIONS)).to_have_count(0)
    page.unroute('**/data/resources.json')
    page.evaluate("localStorage.setItem('crusalis:snapshot:v1', '{not json')")
    page.reload()
    expect(page.locator(NATIONS).first).to_be_visible()
    expect(page.locator('#status')).to_have_text('')
    saved = page.evaluate("JSON.parse(localStorage.getItem('crusalis:snapshot:v1')).schemaVersion")
    assert saved == 1, saved
    context.close()


def run(url='http://127.0.0.1:8000/site/'):
    with sync_playwright() as p:
        browser = p.chromium.launch(channel=os.environ.get('BROWSER_CHANNEL'), executable_path=os.environ.get('BROWSER_EXECUTABLE'))
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(url)
        expect(page.locator(NATIONS).first).to_be_visible()
        data = page.request.get(url + 'data/resources.json').json()
        check_theme(page)
        check_overview(page, data)
        check_sorting(page, data)
        check_filters_and_expansion(page)
        check_phone(page)
        check_failures(page, data, url)
        check_controlled_snapshot(page)
        check_without_saved_copy(browser, url)
        assert not errors, errors
        total_towns = sum(len(n['towns']) for n in data['nations'])
        print(f'UI checks passed: {total_towns} towns, side totals, column ranking and folding, side filter, search, '
              'expansion and focus, phone compare view, URL state, responsive widths, saved-copy fallback, errors, and safe text.')
        browser.close()


if __name__ == '__main__':
    run(sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8000/site/')
