"""Serve site on port 8000, then run this optional Playwright/Chrome check."""
import os

from playwright.sync_api import expect, sync_playwright


def main():
    base = os.environ.get('PRODUCTION_BASE_URL', 'http://127.0.0.1:8000/').rstrip('/') + '/'
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(channel=os.environ.get('BROWSER_CHANNEL', 'chrome'), headless=True)
        page = browser.new_page(viewport={'width': 1440, 'height': 1000})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.goto(base + 'production.html')
        page.wait_for_function("document.querySelector('#nation').options.length > 1")
        expect(page.locator('[data-product=steel] [data-result=supported]')).to_have_text('1,440–2,880')
        page.locator('#iron-supply').fill('0')
        expect(page.locator('[data-product=steel] [data-result=supported]')).to_have_text('0–0')
        expect(page.locator('[data-product=gasoline] [data-result=supported]')).to_have_text('2,880–4,320')
        page.locator('#tier').select_option('3')
        page.locator('#match-supply').click()
        expect(page.locator('[data-product=steel] [data-result=supported]')).to_have_text('2,160–4,320')
        page.locator('#rubber-recipe').select_option('oil')
        page.locator('#match-supply').click()
        expect(page.locator('#calculation-status')).to_have_text('Daily supply covers every planned batch.')
        page.locator('#hours').fill('0')
        assert page.locator('[data-result=supported]').all_text_contents() == ['0–0'] * 3
        page.locator('#hours').fill('-1')
        expect(page.locator('#output-cards article')).to_have_count(0)
        page.locator('#reset-scenario').click()
        snapshot = page.request.get(base + 'data/resources.json').json()
        expect(page.locator('#nation option')).to_have_count(len(snapshot['nations']) + 1)
        nation = next(n for n in snapshot['nations'] if n['id'] is not None and len(n['towns']) > 1 and n['counts']['factories'] > 0)
        page.locator('#nation').select_option(nation['id'])
        for resource in ('factories', 'latex', 'oil'):
            assert nation['counts'][resource] == sum(t['counts'][resource] for t in nation['towns'])
        expect(page.locator('#nation-context')).to_contain_text(f"{len(nation['towns'])} towns")
        expect(page.locator('#latex-nodes')).to_have_value(str(nation['counts']['latex']))
        expect(page.locator('#oil-nodes')).to_have_value(str(nation['counts']['oil']))
        expect(page.locator('#allocate')).to_be_enabled()
        page.locator('#allocate').click()
        planned = sum(int(page.locator(f'#{key}-count').input_value()) for key in ('steel', 'gasoline', 'rubber'))
        assert planned == nation['counts']['factories']
        expect(page.locator('#nation-context')).to_contain_text(f'{planned} factory territories')
        if any(n['id'] is None for n in snapshot['nations']):
            page.locator('#nation').select_option('independent')
            expect(page.locator('#nation-context')).to_contain_text('Independent towns (combined)')
        page.locator('summary').filter(has_text='Estimate latex').click()
        for field, value in {'latex-nodes': '2', 'oil-nodes': '3', 'latex-rate': '10', 'oil-rate': '20', 'mining-bonus': '50'}.items():
            page.locator('#' + field).fill(value)
        page.locator('#apply-extraction').click()
        expect(page.locator('#latex-supply')).to_have_value('720')
        expect(page.locator('#oil-supply')).to_have_value('2160')
        page.locator('[data-theme-choice=light]').click()
        expect(page.locator('html')).to_have_attribute('data-theme', 'light')
        page.locator('[data-theme-choice=dark]').click()
        for width in (320, 390, 760, 1000, 1440):
            page.set_viewport_size({'width': width, 'height': 900})
            assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), f'Overflow at {width}'
        page.route('**/data/resources.json', lambda route: route.fulfill(status=503, body='Unavailable'))
        page.locator('#reload').click()
        expect(page.locator('#load-status')).to_contain_text('Unable to refresh nation data')
        expect(page.locator('#allocate')).to_be_enabled()
        page.unroute('**/data/resources.json')
        page.goto(base)
        page.wait_for_selector('#nations .nation-row')
        page.get_by_role('link', name='Production visualizer').click()
        page.wait_for_selector('#output-cards article')
        assert not errors, errors
        browser.close()
    print('Production UI checks passed: calculations, supplies, nations, extraction, validation, themes, reload recovery, navigation, and responsive widths.')


if __name__ == '__main__':
    main()
