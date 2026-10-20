# Daily history and timeline plan

Status: proposed; no application or workflow changes made.

## Goal

Automatically preserve a daily Crusalis resource snapshot and let visitors scrub
through dates on the existing GitHub Pages site, with no paid service.

## Verified starting point

- Repository: `ts6ki/crusalis-resources`, public, default branch `main`.
- `.github/workflows/pages.yml` fetches live data every four hours, with an
  additional Saturday run, and deploys `site/` through GitHub Actions.
- Generated data is currently deployed but not committed as an archive.
- `scripts/update_data.py` validates the sources and publishes compact JSON.
- The checked-in snapshot is 83,030 bytes. At that size, 365 full daily copies
  take about 30 MB before Git overhead and additional history metadata.
  This is an estimate; game growth will change it.
- `site/app.js` can already apply a snapshot and redraw the existing table.
- Nation and town IDs are available for comparisons across renames.
- Alliance membership currently comes from today's `site/alliances.js`.

### Confirmed ID behavior

The collector reads `nations[].uuid`, `towns[].uuid`, and
`towns[].nation_uuid` from the social feed, preserving nation and town UUIDs
as `id` in the published snapshot. Town membership is represented by nesting
under its nation in that snapshot.

Comparison of the checked-in snapshot (`2026-10-18T15:45:13+00:00`) with the
published snapshot (`2026-10-20T01:37:54+00:00`) confirms names changed while
nation IDs remained the same:

| Earlier name | Later name | Nation UUID |
| --- | --- | --- |
| Hungary | Danubian_Federation | `88fe2814-0d6c-40b8-b752-2aed5b71554a` |
| Roman_Empire | Italy | `fc826e13-190e-4793-a1ba-e87136f2ee0a` |

This supports using UUIDs for rename continuity. It does not establish whether
deletion and recreation, mergers, or liberation preserve the original UUID.
The remaining name-based identity dependency is alliance classification in
`site/alliances.js`; migrate confirmed memberships to UUID keys, with names
used as display labels and explicitly reviewed bootstrap aliases.

## Required UUID migration

Complete this before enabling history collection. Nation/town UUIDs are the
identity keys for alliance lookup, comparisons, charts, selection, expansion
state, and entity links. Names are mutable labels and search aliases.

1. Add a shared, versioned nation-to-alliance data file keyed by nation UUID,
   readable by both the Python collector and browser JavaScript. Include a
   human-readable reference name for maintainers, but never use it for lookup.
2. Seed it by matching the existing confirmed alliance aliases against a fresh,
   validated social snapshot. Review conflicts and unmatched entries rather
   than choosing an ID by fuzzy matching. Preserve approved IDs even if their
   nations disappear from the latest feed.
3. Explicitly include these verified Axis entries:
   - `88fe2814-0d6c-40b8-b752-2aed5b71554a`: Danubian Federation, formerly Hungary.
   - `46b55fc6-9e4c-490c-af26-a8ef7c338119`: Falangist Portugal.
   - `fc826e13-190e-4793-a1ba-e87136f2ee0a`: Italy, formerly Roman Empire.
4. Change `site/alliances.js` and its callers to classify by nation ID.
   Unknown IDs remain Other until explicitly assigned, even when their name
   matches an older nation. Reserve `id: null` for the synthetic Independent
   group, not a real nation. Do not keep an automatic name-based fallback.
5. Store the resolved alliance and mapping revision in each newly collected
   snapshot. Historical rendering uses that saved assignment, while newly
   fetched snapshots use the current approved mapping. An alliance-policy
   change updates Latest on the next successful collection and leaves all
   archived dates unchanged.
6. Record each town's `nationId` explicitly from `nation_uuid`, alongside the
   existing grouping. Validate that this reference agrees with its parent
   nation, including `null` for independent towns. Keep source UUIDs unchanged.
7. Version the snapshot schema and browser cache together. Handle existing
   schema-v1 latest snapshots deliberately during rollout; do not claim their
   historically correct alliance can be recovered from today's mapping.

Acceptance examples:

- Hungary renamed to Danubian Federation retains its ID, Axis membership,
  selected chart, and continuous population/resource history.
- A different nation named Hungary with a different UUID is a separate entity
  and does not inherit Axis membership through the name.
- A town's UUID stays constant while its `nationId` changes: record the
  membership change without assuming a cause or transferring its old history.
- A liberated nation returning under the same UUID resumes its series.
  A new UUID requires an explicitly confirmed lineage link; the names alone
  never merge series or assign an alliance.

## Recommended behavior

1. Keep the current four-hour latest-data updates.
2. Add a nightly capture targeting 23:47 in `America/Los_Angeles`, an assumption
   based on the workspace timezone. Make timezone configuration explicit.
3. Save one validated snapshot per actual local capture date. Store the exact
   UTC fetch timestamp and timezone alongside it.
4. Show a date slider, calendar selection, previous/next day, and Latest button.
   Changing the date updates the existing totals and nation/town table.
5. Add changes versus the previous available snapshot: population, towns,
   resource counts, and factories. Clearly state the comparison dates.
6. Add a small metric chart for a selected nation or alliance, with the selected
   date highlighted. Touch and keyboard controls must work.
7. Historical URLs retain date, search, sorting, and alliance filter.

GitHub schedules can run late or be dropped. The UI must show actual capture
times and gaps; this is an end-of-day observation, not guaranteed midnight data.
If the job crosses midnight, use the actual capture date and disclose the missed
scheduled day. Never backdate freshly fetched data.

## Renames, capture, mergers, and liberation

User-supplied game rules: captured nations merge into the capturing nation.
Residents may stay or move to another nation, and captured towns/nations can
later be liberated. Historical identity and ownership must support these cases.

- Store each nation's and town's source ID and name as observed on each date,
  plus each town's nation ID and each resource territory's town owner.
  Never replace historical names or ownership with current values.
- A rename with the same ID continues the same history. Let historical search
  find an entity through its recorded names while displaying the selected day's
  name. Track alliance assignment by nation ID, seeded from the confirmed name
  mapping, so a rename alone does not silently move a nation into Other.
  An explicit alliance change takes effect only for subsequent snapshots.
- Track town membership and resource-territory ownership changes independently
  of nation totals. Show observed changes such as "Town X: Nation A -> Nation B"
  between two dated snapshots. These relationships remain traceable through
  a merger and later liberation when the underlying IDs survive.
- Keep disappeared nations in the historical entity index and date selector.
  Their charts have a gap marked "not present in snapshot", not a false zero.
  A return with the same ID resumes the series; it does not erase the gap.
- A recreated nation or town may have a new ID. Do not assume that identical
  names mean identical entities, or that different IDs imply unrelated history.
  Support an optional, explicitly confirmed relationship record for predecessor,
  successor, merger, or restoration, with effective date and provenance.
  Keep original IDs and snapshots intact; label any linked chart segments.
- Do not splice the captured nation's old totals into the captor's past.
  Each nation's chart shows its own observed membership and totals for that day.
  Avoid double-counting towns/resources across predecessor and successor views.
- Population reflects the observed residents remaining in each nation at each
  capture. Do not assume all residents moved with a conquered town or add old
  populations together to estimate a merger. Continue publishing counts only;
  individual resident movements cannot be reconstructed from those counts.
- Snapshot differences establish observed membership/ownership changes, not
  their cause. Use "capture", "merger", or "liberation" as confirmed event labels
  only when supported by an explicit upstream event or a confirmed annotation.
  Otherwise describe the change without guessing.
- Before implementation, inspect how the upstream feed represents these cases.
  The current collector ignores temporary `captured`/`annexed` overlays and uses
  canonical territory ownership. Verify how completed mergers and liberations
  affect nation/town IDs and membership; do not reinterpret overlays solely
  from their names.
- Daily snapshots show changes between observations. A capture and liberation
  occurring entirely between two captures may be invisible, and the exact event
  time is unknown unless a separate event source provides it.

## Storage and deployment

Use a dedicated `history` branch in the same repository, containing:

```text
history/index.json
history/entities.json
history/2026/10/2026-10-20.json
history/summaries/2026.json
```

- Full dated JSON enables the existing town and territory drill-down.
- Each snapshot includes schema version, actual capture time, reporting timezone,
  code revision, and the resolved alliance for every nation at capture time.
- Archived alliance assignments remain fixed when the current alliance list
  changes. Record a mapping revision to make changes explainable.
- The index contains dates, relative paths, timestamps, and snapshot status.
- The entity index is keyed by entity type and UUID and records observed names
  with their observation dates, including entities absent from the latest
  snapshot. Keep observed aliases separate from confirmed lineage links.
- Summary files contain only the data needed for trend charts. Match entities
  by ID; distinguish a missing entity from a reported zero or unavailable metric.
- Completed daily snapshots are immutable. Re-running a successful capture
  verifies the existing record and makes no duplicate or silent replacement.
- Build the snapshot, index, and summaries together, validate them, then commit
  atomically. Serialize writers and use bounded retry for a non-fast-forward push;
  never force-push the archive.
- Every Pages build reads the archive branch and includes its files under
  `site/data/history/`. Read the branch afresh at build time, rather than relying
  on whatever existed when the workflow was queued.
- The nightly run archives and deploys in the same workflow. Restrict source
  push triggers to `main`; do not depend on an archive push triggering deployment.
- Give `contents: write` only to the archive-writing job. Authenticate with the
  repository's automatic `GITHUB_TOKEN`; no personal token is required.
- Use the verified `ts6ki` author identity for archive commits. GitHub Actions
  remains the authenticated automation actor; it is not a personal login.
- Keep the current Pages deployment permissions and serialize deployments.
  A deploy failure must not delete an already committed capture.

## Frontend integration

Add history controls to `site/index.html`, styling to `site/styles.css`, and a
small history module used by `site/app.js`.

- Load the small index first; fetch full snapshots only when selected.
- Debounce scrubbing, cache recently viewed dates, and cancel or disregard
  stale requests so fast dragging cannot display the wrong day.
- Keep latest-data cache separate from historical data.
- Historical mode displays its date rather than today's stale-data warning.
- Preserve filters while navigating; close expansions for entities no longer
  present in the selected snapshot.
- Use UUIDs in nation/town selections and URL parameters. Show archived names
  for the selected date; where names collide, distinguish entries with context
  such as their observed dates rather than combining them.
- Reload refreshes the selected mode. Latest explicitly returns to live data.
- Empty history, one available date, missing dates, unavailable files, and
  offline failures receive clear states.
- Daily differences describe changes in observations. Do not infer a battle,
  transfer, or production event solely from a change in resource totals.

## Failure handling and limits

- Failed or invalid upstream fetches never create a new daily snapshot from old
  data. Retry transient errors and leave a visible gap if the capture fails.
- Preserve the last successful Pages deployment on failure.
- A manual workflow run can capture the current day or retry deployment.
  It cannot reconstruct a missed historical day from today's live source.
- History starts when collection is enabled. Existing Git snapshots or surviving
  artifacts may be assessed for import, but only with their original timestamps
  and recoverable alliance mapping; do not promise complete past coverage.
- Monitor deployed size and keep deployment artifact retention short. Store the
  permanent archive in Git, not retained workflow artifacts or Actions caches.
- Public schedules can be disabled after 60 days of repository inactivity.
  Daily archive commits provide ongoing activity while captures succeed; the
  site should still show archive freshness and explain how to re-enable a
  workflow after prolonged failure.

## Implementation order and acceptance

1. **UUID migration:** introduce the shared UUID alliance mapping, update
   classification and callers, preserve explicit town nation references, and
   verify schema/cache compatibility and rename behavior.
2. **Archive writer:** add a script and fixtures for snapshot metadata, dates,
   immutable daily files, summaries, and index validation.
3. **Workflow integration:** add nightly scheduling, branch persistence, minimum
   token permissions, and archive inclusion in every deployment.
4. **Timeline and comparison UI:** implement date controls, historical rendering,
   deltas, chart, and shareable URLs using the existing plain JavaScript stack.
5. **Verify and release:** run Python and JavaScript suites plus browser checks;
   manually exercise a workflow and confirm persisted data survives the next
   normal deployment.

Required cases: local midnight and DST, delayed capture, failed source fetch,
duplicate rerun, concurrent writes, deployment failure after archive commit,
rename with stable ID, renamed nation retaining its confirmed alliance, town
transfer, nation merger, resident departure, disappearance and restoration with
the same ID, recreation with a new ID, reused names, confirmed lineage without
double-counting, entity removal, alliance reassignment, unavailable resources,
fast scrubbing, first-day history, mobile layout, keyboard controls, and date
URLs. Confirm browser requests use the Pages origin and require no GitHub login
or API token.

For this first version, historical browsing applies to the resource browser.
The production calculator continues to use the latest snapshot unless historical
calculator behavior is requested separately.

## Cost and current official references

The public repository can use free standard GitHub-hosted runners and free
GitHub Pages. No database, external scheduler, paid runner, or new domain is
needed. Remain within Pages size/bandwidth limits; free does not mean unlimited.

- [Standard hosted runners](https://docs.github.com/en/actions/how-tos/write-workflows/choose-where-workflows-run/choose-the-runner-for-a-job)
- [GitHub Pages availability and limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Schedules, timezone support, delays, and inactivity](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)
- [GITHUB_TOKEN does not recursively trigger push workflows](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Workflow artifacts expire](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/download-workflow-artifacts)
