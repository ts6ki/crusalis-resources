# Crusalis resources

A small static town resource browser. Plain HTML, CSS, and JavaScript; Python 3.10+ for data updates, with no third-party dependencies.

## Run locally

From this folder:

```sh
python scripts/update_data.py
python -m http.server 8000 --bind 127.0.0.1 --directory site
```

Open http://127.0.0.1:8000. An initial snapshot is included, so updating is optional for previewing. Use an HTTP server; opening `index.html` as a file does not support loading the JSON reliably. On Windows, use `py` instead of `python` if needed.

```sh
python -m unittest discover -s tests -v
node --check site/app.js
node --test tests/alliances.test.cjs tests/ledger.test.cjs
```

Optional browser checks use [Playwright for Python](https://playwright.dev/python/docs/library). With Playwright and Chromium already installed, start `python -m http.server 8000 --bind 127.0.0.1` from the project root, then run `python tests/browser_check.py`. The checks use `/site/` to verify repository-subpath loading. `BROWSER_CHANNEL` or `BROWSER_EXECUTABLE` can select an existing compatible browser. These are development-only checks; the site and updater have no third-party runtime dependencies.

Validation includes 16 collector tests, 6 alliance tests, 12 table-logic tests (ranking, search, folding, totals), browser checks against the included 102-town snapshot, and independent live-source resource comparisons for five towns. The UI checks cover side totals, ranking by every column, folding nations without a resource, the side filter, search, expansion with keyboard focus, the phone compare view, URL state, widths from 320px to 1440px, factory details, failed reload recovery, and safe rendering of source names. The Pages workflow is prepared but has not been run on GitHub.

## Host on GitHub Pages

1. Push this folder, including `.github/workflows/pages.yml`, to a GitHub repository.
2. In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. In **Actions → Update resources and deploy Pages → Run workflow**, run the workflow on the default branch.
4. Open the site URL displayed by the deployment. No custom domain or secrets are required.

Pages for a private repository needs a GitHub plan that includes it (Pro or higher); on GitHub Free, Pages works only for public repositories. The published site itself is public either way, even when the repository is private. Scheduled runs use Actions minutes on private repositories: about 12 short runs a day.

The workflow runs on default-branch pushes, manually, and every 2 hours at minute 17 (UTC). Each run tests the collector, fetches both sources, and publishes the generated snapshot with the page in one Pages artifact. It does not commit generated data back into the repository. Your checked-in local snapshot only changes when you run the collector locally.

GitHub schedules may be delayed and public-repository schedules can be disabled after 60 days without repository activity. The page displays the actual fetch time and warns when the data is over three hours old. Re-enable a disabled workflow in Actions. **Reload** reloads the published JSON; use **Run workflow** to fetch fresh upstream data and publish it. A failed update stops deployment, leaving the last successful site available.

## What the counts mean

- Resources: tungsten, aluminum (`aluminium` in the source), latex, chromium, oil, and factories.
- Each count is the number of distinct owned territories carrying that resource. These are not income or production totals. One territory can contain multiple resources.
- Display order is **Allies → Axis → Other**, following the supplied nation-confirmation list. Nations sort by registered population, largest first, within each side, with alphabetical ties. Towns within a nation follow the same ranking. Towns without a nation appear under **Independent** at the end of Other. Underscores are displayed as spaces.
- Population counts distinct resident UUIDs in the source's town membership records, combined across every town in the nation. It includes offline residents and towns hidden by search. Duplicate memberships do not inflate nation totals. Only counts are published, not resident identities.
- **Totals by side** shows each side's towns, population, and resource territories, with a thin bar for its share of each column. These totals always include every town and never change with search or sorting.
- Below it, one table lists every nation with the same columns. **All sides**, **Allies**, **Axis**, and **Other** filter the table; the counts on those buttons are nations. From 1000px the table header stays visible while scrolling. Between 760px and 999px the table scrolls sideways with the nation column pinned.
- Protectorate of Bohemia Moravia belongs to Axis. The three Chinese United Front nations—Nationalist China, Communist China (Soviet China in the source), and Shaanxi—belong to Allies. Unlisted nations appear under Other. Membership uses exact aliases in `site/alliances.js`; historical allegiances are not inferred. Nationalist Spain maps to Axis Spain, and Republican Spain to Allied Spain. Source names such as German Empire, British Empire, American Philippines, and Dutch East Indies are mapped to their supplied country names.
- Nations start collapsed. Expand a nation to see its towns, then expand a town for territory IDs, core X/Z coordinates, and factory types. Searching opens matching nations automatically; a nation-name match lists all its towns, otherwise only matching towns are listed.
- Below 760px, phones show one figure per row instead of the full table. **Compare by** picks the figure and ranks by it, a sentence and bar summarize the three sides for that figure, and expanding a nation shows all six resources.
- Factory counts are per territory. A generic `factory` marker plus a `factorytier2` marker means one Tier 2 factory territory, not two factories. Unspecified types are shown explicitly, and unfamiliar future factory labels are retained. Multiple specific labels describe one territory together.
- Factories currently have generic markers; tier definitions exist but were not assigned in the inspected snapshot. No production type is inferred from those markers.
- Select a column heading to rank by it, largest first, with population and then name as tie-breakers; **Nation** sorts A–Z. Population is the default. While ranking by a resource, nations without any of it fold into one **Show N nations with no …** row per side; searching shows them all. Nation figures always cover the whole nation.
- The side, ranking, and search are kept in the page URL (`?side=Axis&sort=oil&q=berlin`), so a view can be shared as a link.
- The header shows the update age, a **Dark**/**Light** theme switch, and a **Reload** button. The page opens in a dark theme based on IBM Carbon's Gray 100; a light choice is remembered in the browser (`localStorage`, key `crusalis:theme`).
- Each browser keeps the last snapshot it loaded (in `localStorage`, key `crusalis:snapshot:v1`). Return visits show it instantly while the latest snapshot loads. If loading fails, for example because the host is down or the device is offline, the page keeps showing that saved copy and says so; the update age shows how old it is. The snapshot request revalidates with the host each time, so an unchanged snapshot costs only a small `304 Not Modified` response. Pages opened as a file, or browsers that block storage, simply skip the saved copy.
- A dash (–) means a supported resource has no holdings; screen readers hear 0. `N/A` means the resource is absent from the source definitions and assignments, and that column can't be ranked.
- Ownership comes from town claims, not temporary wartime occupation. Unclaimed territories are excluded.
- Use ownership records with `role: territory`. The feed also repeats home references with `role: core`; these can be stale or reference another town's territory and do not grant additional ownership.

## Data and maintenance

The collector joins [geometry](https://map.crusalis.net/map/map/geometry.json) with [town ownership](https://map.crusalis.net/api-proxy/v1/map/social). The upstream responses currently omit cross-origin access headers, so GitHub Actions fetches them and the browser loads only the same-site compact snapshot. No proxy service is needed.

Only resource summaries and relevant territory metadata are published; resident/member records and map polygons are excluded. Requests have timeouts and limited retries. Malformed data, duplicate claims, or broken ownership references fail the update instead of publishing incomplete counts. The two upstream endpoints are fetched sequentially and do not offer a shared transaction version.

Edit `site/styles.css` to restyle; colors and sizes are custom properties at the top (dark theme in `:root`, light theme under `[data-theme="light"]`). `site/theme.js` applies the saved theme before the page paints. Page rendering is in `site/app.js`, ranking/search/folding/totals logic is in `site/ledger.js`, and collection and normalization are in `scripts/update_data.py`. IBM Plex Sans and Mono are bundled in `site/fonts/` under the SIL Open Font License (license files alongside), so the page makes no third-party requests. All site paths are relative for repository Pages URLs. `PLAN.md` records the implementation plan.

References: [Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [scheduled Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
