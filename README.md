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
node --test tests/*.test.cjs
```

Optional browser checks use [Playwright for Python](https://playwright.dev/python/docs/library). With Playwright and Chromium already installed, start `python -m http.server 8000 --bind 127.0.0.1` from the project root, then run `python tests/browser_check.py`. The checks use `/site/` to verify repository-subpath loading. `BROWSER_CHANNEL` or `BROWSER_EXECUTABLE` can select an existing compatible browser. These are development-only checks; the site and updater have no third-party runtime dependencies.

Validation covers collector ownership and population rules, UUID alliance membership, immutable daily archives, Git persistence and retry behavior, table logic, and production calculations. Browser checks cover historical URLs, renamed entities, alliance changes, missing days, absent nations, comparisons, failed requests, stale-response races, keyboard controls, and mobile layouts.

## Host on GitHub Pages

1. Push this folder, including `.github/workflows/pages.yml`, to a GitHub repository.
2. In the repository's **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. In **Actions → Update resources and deploy Pages → Run workflow**, run the workflow on the default branch.
4. Open the site URL displayed by the deployment. No custom domain or secrets are required.

Pages for a private repository needs a GitHub plan that includes it (Pro or higher); on GitHub Free, Pages works only for public repositories. The published site itself is public either way, even when the repository is private. Scheduled runs use Actions minutes on private repositories: six short runs a day, plus the Saturday refresh.

The workflow runs on pushes to `main`, manually, every 4 hours at minute 17 (UTC), Saturdays at 5 PM fixed EST, and nightly at 11:47 PM Pacific (`America/Los_Angeles`, following daylight saving time). Regular runs publish fresh latest data. The nightly run also commits one daily observation to the dedicated `history` branch before deploying. Manual runs default to saving an observation; uncheck `archive` to deploy without creating one. Source code stays on `main`.

GitHub schedules may be delayed and public-repository schedules can be disabled after 60 days without repository activity. The page displays the actual fetch time and warns when the data is over five hours old (the four-hour interval plus one hour for scheduler delays). Re-enable a disabled workflow in Actions. **Reload** reloads the published JSON; use **Run workflow** to fetch fresh upstream data and publish it. A failed update stops deployment, leaving the last successful site available.

## Daily history

The **Through time** panel has a saved-day slider, date picker, previous/next
buttons, and **Latest**. A date changes the entire resource table and its alliance
totals. Open **Trends and changes** to follow a nation or side, choose a metric,
and compare with the previous available observation. URLs preserve the date,
selected nation UUID, metric, search, side, and sorting.

Daily files record their real fetch time and Pacific date. GitHub schedules can
run late or be dropped; a delayed run crossing midnight is saved under its actual
capture date. Missing days stay missing. A manual retry cannot reconstruct a
past day from today's data. Multiple runs on one date keep the first successful
observation unchanged, including an early manual save. History begins when this
feature is enabled; the included empty index is intentional.

A nation or town keeps its history when its UUID survives a rename. Saved names,
alliance assignments, and town-to-nation relationships remain as observed.
Historical search also matches recorded aliases. Charts show absent nations as
gaps. A different UUID is a different entity even if it reuses the same name.
Changes describe observed renames, memberships, and resource-territory owners;
they do not prove conquest or liberation or track individual residents.

Permanent files live on the `history` branch:

```text
history/index.json
history/entities.json
history/YYYY/MM/YYYY-MM-DD.json
history/summaries/YYYY.json
history/relationships.json   # optional confirmed lineage annotations
```

Every deployment includes that branch under `site/data/history/`. The archive
writer uses the automatic repository token with `contents: write`, commits as
`ts6ki`, retries conflicting pushes without force, and writes snapshots before
Pages deployment. Deployment failures therefore do not erase a successful save.
Normal build/deploy jobs retain read-only repository access. Pages artifacts are
kept for one day; they are not the permanent archive. Public standard runners
and Pages require no paid service for this setup.

For an explicitly confirmed recreated entity, maintain an optional array in
`history/relationships.json` on the archive branch, for example:

```json
[{"entityType":"nations","from":"old-uuid","to":"new-uuid","kind":"restoration","date":"2026-10-23","provenance":"Confirmed by server announcement"}]
```

Both IDs must have archived observations. Supported kinds are `merger`,
`restoration`, and `successor`. On the next archive run the annotation appears in
the changes list; original series stay separate and are never summed together.
Use actual confirmed dates and provenance, not inferred population changes.

Run the extra UI check against a local server; its history data stays in a
temporary directory and is intercepted in the test browser:

```sh
python tests/history_browser_check.py http://127.0.0.1:8000/site/
```

The archive tests use temporary local Git remotes and never push to GitHub.
On Windows, Python may need the `tzdata` package for IANA timezone tests; the
Ubuntu Actions runner already provides the timezone database. No additional
runtime dependency is needed in production.

## What the counts mean

### Production visualizer

Open **Production visualizer** in the navigation (or `production.html`) to plan steel, gasoline, and rubber output. It uses the documented example recipes, editable machine counts and operating hours, and explicit factory-tier baseline, stacking, and rounding assumptions. It shows fully supplied capacity alongside output supported by a daily material budget. Each shared input is split proportionally by full-capacity demand, and each line is constrained only by the inputs it uses. Whole batches are counted and leftover materials are not reassigned. This balanced allocation is not an optimization of one chosen product.

Nation selection shows combined resource territory counts and population across all its towns. Independent towns appear as a separate combined scenario. **Use one machine per factory territory** creates an explicitly hypothetical allocation, split as evenly as possible across the three products, with any remainder assigned to steel and then gasoline. Neither installed machines nor town/factory tiers are inferred. The extraction helper requires user-provided hourly rates and a sustained mining-goal bonus; applying it replaces daily latex and oil supply. Town-tier bonuses, bombing, workbench crates, and vehicle assembly are not included. Nothing entered in the visualizer changes the game or the resource snapshot.

With the local server above running and Playwright plus Chrome installed, run `python tests/production_browser_check.py` to check the production view. `BROWSER_CHANNEL` and `PRODUCTION_BASE_URL` can override the browser and server URL.

### Resource browser

- Resources: tungsten, aluminum (`aluminium` in the source), latex, chromium, oil, and factories.
- Each count is the number of distinct owned territories carrying that resource. These are not income or production totals. One territory can contain multiple resources.
- Display order is **Allies → Axis → Other**, following the supplied nation-confirmation list. Nations sort by registered population, largest first, within each side, with alphabetical ties. Towns within a nation follow the same ranking. Towns without a nation appear under **Independent** at the end of Other. Underscores are displayed as spaces.
- Population counts distinct resident UUIDs in the source's town membership records, combined across every town in the nation. It includes offline residents and towns hidden by search. Duplicate memberships do not inflate nation totals. Only counts are published, not resident identities.
- **Totals by side** shows each side's towns, population, and resource territories, with a thin bar for its share of each column. These totals always include every town and never change with search or sorting.
- Below it, one table lists every nation with the same columns. **All sides**, **Allies**, **Axis**, and **Other** filter the table; the counts on those buttons are nations. From 1000px the table header stays visible while scrolling. Between 760px and 999px the table scrolls sideways with the nation column pinned.
- Alliance membership uses nation UUIDs in `site/data/alliances.json`; names are display labels. Danubian Federation (formerly Hungary), Falangist Portugal, and Italy (formerly Roman Empire) are confirmed Axis entries. Renaming a known nation preserves its side. An unknown UUID stays Other even if its name matches an older nation. To explicitly assign or change a side, update the UUID entry and mapping revision; the next collection uses it, and archived snapshots retain their saved assignments.
- Nations start collapsed. Expand a nation to see its towns, then expand a town for territory IDs, core X/Z coordinates, and factory types. Searching opens matching nations automatically; a nation-name match lists all its towns, otherwise only matching towns are listed.
- Below 760px, phones show one figure per row instead of the full table. **Compare by** picks the figure and ranks by it, a sentence and bar summarize the three sides for that figure, and expanding a nation shows all six resources.
- Factory counts are per territory. A generic `factory` marker plus a `factorytier2` marker means one Tier 2 factory territory, not two factories. Unspecified types are shown explicitly, and unfamiliar future factory labels are retained. Multiple specific labels describe one territory together.
- Factories currently have generic markers; tier definitions exist but were not assigned in the inspected snapshot. No production type is inferred from those markers.
- Select a column heading to rank by it, largest first, with population and then name as tie-breakers; **Nation** sorts A–Z. Population is the default. While ranking by a resource, nations without any of it fold into one **Show N nations with no …** row per side; searching shows them all. Nation figures always cover the whole nation.
- The side, ranking, and search are kept in the page URL (`?side=Axis&sort=oil&q=berlin`), so a view can be shared as a link.
- The header shows the update age, a **Dark**/**Light** theme switch, and a **Reload** button. The page opens in a dark theme based on IBM Carbon's Gray 100; a light choice is remembered in the browser (`localStorage`, key `crusalis:theme`).
- Each browser keeps its latest snapshot in `localStorage` under `crusalis:snapshot:v2`. Historical browsing uses a separate bounded memory cache and never replaces the saved Latest copy. Schema-v1 snapshots remain readable during rollout using UUID alliance lookup, but are not eligible for archival or historical comparisons.
- A dash (–) means a supported resource has no holdings; screen readers hear 0. `N/A` means the resource is absent from the source definitions and assignments, and that column can't be ranked.
- Ownership comes from town claims, not temporary wartime occupation. Unclaimed territories are excluded.
- Use ownership records with `role: territory`. The feed also repeats home references with `role: core`; these can be stale or reference another town's territory and do not grant additional ownership. Wartime `captured` and `annexed` records overlay existing territory claims and are ignored: occupation does not transfer holdings, and annexation does not count the same holding twice. Unknown roles still stop the update and are named in the error.

## Data and maintenance

The collector joins [live geometry](https://map.crusalis.net/api-proxy/v1/map/geometry) with [town ownership](https://map.crusalis.net/api-proxy/v1/map/social), using the same endpoints as the live map. The legacy static geometry file omits later resource assignments, including resources added alongside animal or crop nodes. The upstream responses currently omit cross-origin access headers, so GitHub Actions fetches them and the browser loads only the same-site compact snapshot. No proxy service is needed.

Only resource summaries and relevant territory metadata are published; resident/member records and map polygons are excluded. Requests have timeouts and limited retries. Malformed data, duplicate claims, or broken ownership references fail the update instead of publishing incomplete counts. The two upstream endpoints are fetched sequentially and do not offer a shared transaction version.

Edit `site/styles.css` to restyle; colors and sizes are custom properties at the top (dark theme in `:root`, light theme under `[data-theme="light"]`). `site/theme.js` applies the saved theme before the page paints. Page rendering is in `site/app.js`, ranking/search/folding/totals logic is in `site/ledger.js`, and collection and normalization are in `scripts/update_data.py`. IBM Plex Sans and Mono are bundled in `site/fonts/` under the SIL Open Font License (license files alongside), so the page makes no third-party requests. All site paths are relative for repository Pages URLs.

References: [Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [scheduled Actions](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
