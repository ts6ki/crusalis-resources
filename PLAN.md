# Crusalis town resource browser

## Implemented UI revisions

- Desktop: three columns for Allies, Axis, and Other with full group totals.
- Mobile/tablet: switch between groups using tabs; compact header and wrapping resource counts.
- Nations start collapsed, show totals and population, and expand into town details. Search opens matching nations.
- Population sorting remains the default; selected-resource sorting ranks matching holdings. Resource selection filters immediately; All resources includes every town.
- Full group totals remain fixed under filtering, with separate matching totals shown.
- Membership corrections: Protectorate of Bohemia Moravia is Axis; Nationalist China, Soviet China (Communist China), and Shaanxi are Allies. Remaining unlisted nations are Other.
- Password protection is deferred.

## Goal

Create one minimally styled static page for GitHub Pages that lists towns grouped and sorted alphabetically by nation, showing their tungsten, aluminum, latex, chromium, oil, and factory resources. Implement locally first; publishing is a later user step.

## Verified source behavior

- Resource definitions and territory nodes: https://map.crusalis.net/map/map/geometry.json
- Nations, towns, and territory ownership: https://map.crusalis.net/api-proxy/v1/map/social
- Join `social.territories[].town_uuid` to `social.towns[].uuid`, then `territory_id` to the keys of `geometry.territories`. Join `town.nation_uuid` to `social.nations[].uuid`.
- Implementation finding: only `role: territory` records grant ownership. `role: core` records repeat home references, including stale references to another town's claim. Ignore core references; reject duplicate/conflicting actual claims.
- Display source key `aluminium` as **Aluminum** and `latex` as **Latex**, with one column for each resource.
- The inspected geometry contains 144 territories marked `factory`. It defines `factorytier1`, `factorytier2`, and `factorytier3`, but no territories currently use these tier markers. Show current factories as **Unspecified type**; do not invent their production type or tier.
- Both source responses lack `Access-Control-Allow-Origin` for a GitHub Pages origin. The page should load a snapshot from its own site instead of fetching these endpoints directly in the browser.
- Geometry is approximately 10.8 MB. Publish a compact resource summary rather than the full source files.

## Implementation

1. **Collect and join the data.** Add a Python script using only the standard library. Fetch both endpoints with timeouts and bounded retries, validate their structure and ownership joins, and generate `site/data/resources.json`. Include fetch timestamp, resource availability, nations, towns, counts, and relevant territory IDs, names, and core coordinates. Exclude resident/member records and map polygon data. Include towns with no target resources and group towns without a nation under **Independent**. Exclude unclaimed territories from town counts. Reject duplicate/conflicting ownership and broken references rather than silently publishing misleading counts.

2. **Normalize resource and factory counts.** Count distinct owned territories containing each resource, not production output. Each factory territory counts once even if it has both a generic factory marker and a tier marker. Preserve supplied factory labels and show the specific tier when available; otherwise use **Unspecified type**. Preserve unfamiliar future factory labels for inspection. Treat source-wide unsupported resources differently from a supported resource with zero town holdings.

3. **Build the page.** Use plain HTML, CSS, and JavaScript, with a nation heading and town table for each nation. Columns: Town, Tungsten, Aluminum, Latex, Chromium, Oil, Factories. Add nation totals, a town/nation search box, a resource filter, and a toggle to hide towns with no matching resources. Expand a town to see territory IDs, coordinates, resources, and factory breakdown. Show data age, loading/error/empty states, and a button to reload the latest published snapshot. That button does not trigger an upstream refresh. Keep styling limited to readable spacing, table borders, and horizontal overflow on small screens. Render source names as text.

4. **Prepare GitHub Pages updates.** Add an Actions workflow that fetches data, builds a Pages artifact from `site/`, and deploys that same artifact. Run on default-branch pushes, manual dispatch, and a schedule every 30 minutes. Scheduled runs can be delayed; display the actual data timestamp and a stale-data notice. A failed fetch or validation must stop deployment so the previous published site remains available. Use relative asset/data URLs so repository subpaths work. Include instructions for enabling Pages with GitHub Actions, running the collector locally, and previewing with a local HTTP server. Do not publish during implementation.

5. **Verify behavior.** Add focused standard-library tests for ownership joins, independent towns, missing resources, aluminum normalization, factory tiers without double counting, invalid data, and towns with zero resources. Compare several generated town counts against the source. Check search/filter behavior, town expansion, errors, and repository-subpath loading in a browser. Keep tests focused on data correctness and useful behavior.

## Proposed files

```text
site/index.html
site/styles.css
site/app.js
site/data/resources.json
scripts/update_data.py
tests/test_update_data.py
.github/workflows/pages.yml
README.md
```

## Hosting references

- Custom Pages workflows: https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages
- Scheduled Actions: https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule

Scheduled workflows run from the default branch and can be disabled after 60 days of inactivity in public repositories. Document this and the manual refresh workflow in the README.

## Completion criteria

The local page correctly shows towns under their nations, with resource territory counts and factory details derived from a validated snapshot. Unspecified factory types are explicit. The repository includes a verified update script, focused data tests, and a ready-to-enable Pages workflow. No frontend framework, database, API key, or separately hosted server is needed.
