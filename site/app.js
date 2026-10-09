'use strict';

const ui = Object.fromEntries(['freshness', 'freshness-dot', 'reload', 'status', 'totals', 'totals-note', 'summary',
  'side-filter', 'search-form', 'search', 'clear-search', 'compare-buttons', 'side-summary', 'nations']
  .map(id => [id, document.getElementById(id)]));
const SIDES = ['Allies', 'Axis', 'Other'];
const SIDE_FILTERS = ['All', ...SIDES];
const DEFAULT_SORT = 'population';
// Snapshots publish every 2 hours and GitHub schedules can run late, so allow an hour of slack.
const STALE_MINUTES = 180;
const MAX_QUERY_LENGTH = 100;
const FETCH_TIMEOUT_MS = 20000;
// Bump the version if the snapshot schema changes, so old saved copies are ignored.
const CACHE_KEY = 'crusalis:snapshot:v1';
const SVG_NS = 'http://www.w3.org/2000/svg';
const ICONS = {
  chevron: {box: '0 0 12 12', path: 'M4.5 2.5 8 6l-3.5 3.5'},
  down: {box: '0 0 10 10', path: 'M5 1.5v7M2 5.5l3 3 3-3'},
  up: {box: '0 0 10 10', path: 'M5 8.5V1.5M2 4.5l3-3 3 3'},
};

// Side, sort, and search also live in the URL. Expansion and folds survive reloads of the snapshot.
const state = {
  side: 'All',
  sort: DEFAULT_SORT,
  query: '',
  nationOpen: new Set(),
  townOpen: new Set(),
  searchCollapsed: new Set(),
  unfolded: new Set(),
};
let snapshot = null;
let snapshotSource = null; // 'saved' (this browser's copy) or 'network'
let groups = [];
let columns = [];

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function icon(name, className) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'icon ' + className);
  svg.setAttribute('viewBox', ICONS[name].box);
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', ICONS[name].path);
  svg.append(path);
  return svg;
}

function swatch(side) {
  const mark = element('span', undefined, 'swatch side-' + side.toLowerCase());
  mark.setAttribute('aria-hidden', 'true');
  return mark;
}

function plural(count, word, many = word + 's') {
  return count.toLocaleString('en-US') + ' ' + (count === 1 ? word : many);
}

function sortWord(key) {
  return key === 'name' ? 'name' : columns.find(c => c.key === key).label.toLowerCase();
}

// Phones show one figure per row: the ranked column, or population while sorting by name.
function focusColumn() {
  return state.sort === 'name' ? 'population' : state.sort;
}

// Zero prints as a dash so holdings stand out; screen readers still hear "0".
function fillCount(target, value, available = true) {
  if (!available) {
    target.textContent = 'N/A';
    target.classList.add('is-na');
    target.title = 'Not reported by the source';
    return;
  }
  if (value === null) return;
  target.dataset.value = value;
  if (value !== 0) {
    target.textContent = value.toLocaleString('en-US');
    return;
  }
  const dash = element('span', '–');
  dash.setAttribute('aria-hidden', 'true');
  target.classList.add('is-zero');
  target.append(dash, element('span', '0', 'visually-hidden'));
}

function validate(data) {
  const expected = ['tungsten', 'aluminum', 'latex', 'chromium', 'oil', 'factories'];
  if (data?.schemaVersion !== 1 || !Number.isFinite(Date.parse(data.fetchedAt)) ||
      !Array.isArray(data.nations) || !Array.isArray(data.resources) ||
      data.resources.length !== expected.length ||
      data.resources.some((r, i) => r.key !== expected[i] || typeof r.label !== 'string' || typeof r.available !== 'boolean')) {
    throw new Error('Snapshot format is invalid.');
  }
  const validCounts = counts => counts && expected.every(key => Number.isSafeInteger(counts[key]) && counts[key] >= 0);
  const validPopulation = value => Number.isSafeInteger(value) && value >= 0;
  for (const nation of data.nations) {
    if (!(nation.id === null || typeof nation.id === 'string') || typeof nation.name !== 'string' || !validPopulation(nation.population) || !validCounts(nation.counts) || !Array.isArray(nation.towns)) throw new Error('Invalid nation data.');
    for (const town of nation.towns) {
      if (typeof town.id !== 'string' || typeof town.name !== 'string' || !validPopulation(town.population) || !validCounts(town.counts) ||
          !town.factories || typeof town.factories !== 'object' || !Object.values(town.factories).every(validPopulation) ||
          !Array.isArray(town.territories)) throw new Error('Invalid town data.');
      for (const territory of town.territories) {
        if (typeof territory.id !== 'string' || typeof territory.name !== 'string' ||
            !Array.isArray(territory.core) || territory.core.length !== 2 || !territory.core.every(Number.isFinite) ||
            !Array.isArray(territory.resources) || !territory.resources.every(key => expected.includes(key)) ||
            !(territory.factoryType === null || typeof territory.factoryType === 'string')) throw new Error('Invalid territory data.');
      }
    }
  }
  return data;
}

function updateFreshness() {
  if (!snapshot) return;
  const date = new Date(snapshot.fetchedAt);
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
  const age = minutes < 1 ? 'just now' : minutes < 60 ? minutes + ' min ago' :
    minutes < 1440 ? Math.floor(minutes / 60) + ' h ago' : Math.floor(minutes / 1440) + ' d ago';
  const stale = minutes >= STALE_MINUTES;
  ui.freshness.textContent = 'Updated ' + age + (stale ? ' · may be stale' : '');
  ui.freshness.title = 'Data fetched ' + date.toLocaleString();
  ui.freshness.dateTime = snapshot.fetchedAt;
  ui.freshness.classList.toggle('warning', stale);
  ui['freshness-dot'].dataset.state = stale ? 'stale' : 'fresh';
}

function renderTotals() {
  const grand = Ledger.totals(snapshot.nations, columns);
  const headRow = element('tr');
  headRow.append(element('th', 'Side', 'name-col'), ...columns.map(c => element('th', c.label, 'num')));
  headRow.querySelectorAll('th').forEach(th => { th.scope = 'col'; });
  const body = element('tbody');
  for (const group of groups) {
    const sums = Ledger.totals(group.nations, columns);
    const row = element('tr');
    row.dataset.side = group.name;
    const label = element('th', undefined, 'side-cell');
    label.scope = 'row';
    label.append(swatch(group.name), element('span', group.name, 'side-name'), element('span', plural(group.nations.length, 'nation'), 'side-meta'));
    row.append(label, ...columns.map(col => totalCell(col, sums[col.key], grand[col.key], group.name)));
    body.append(row);
  }
  const footRow = element('tr');
  const footLabel = element('th', undefined, 'side-cell');
  footLabel.scope = 'row';
  footLabel.append(element('span', 'All sides', 'side-name'), element('span', plural(snapshot.nations.length, 'nation'), 'side-meta'));
  footRow.append(footLabel, ...columns.map(col => totalCell(col, grand[col.key])));
  const head = element('thead');
  const foot = element('tfoot');
  head.append(headRow);
  foot.append(footRow);
  ui.totals.replaceChildren(head, body, foot);
  ui['totals-note'].textContent = 'All ' + plural(grand.towns, 'town') + '. Search and sorting below don’t change these.';
}

// Each side's figure carries a thin bar showing its share of that column across all sides.
function totalCell(col, value, grandValue, side) {
  const cell = element('td', undefined, 'num');
  cell.dataset.key = col.key;
  const figure = element('span', undefined, 'total-value');
  fillCount(figure, value, col.available);
  cell.append(figure);
  if (side && col.available) {
    const share = element('span', undefined, 'share');
    const fill = element('span', undefined, 'share-fill side-' + side.toLowerCase());
    share.setAttribute('aria-hidden', 'true');
    fill.style.width = (grandValue ? (value / grandValue) * 100 : 0) + '%';
    share.append(fill);
    cell.append(share);
  }
  return cell;
}

function renderSideFilter() {
  const counts = {All: snapshot.nations.length, ...Object.fromEntries(groups.map(g => [g.name, g.nations.length]))};
  ui['side-filter'].replaceChildren(...SIDE_FILTERS.map(side => {
    const button = element('button', undefined, 'side-button');
    button.type = 'button';
    button.dataset.side = side;
    button.dataset.focusKey = 'side:' + side;
    button.setAttribute('aria-pressed', String(side === state.side));
    if (side === 'All') {
      const label = element('span', 'All', 'side-label');
      label.append(element('span', ' sides', 'wide-only'));
      button.append(label);
    } else {
      button.append(swatch(side), element('span', side, 'side-label'));
    }
    button.append(element('span', counts[side].toLocaleString('en-US'), 'side-count'));
    return button;
  }));
}

function renderCompare() {
  const focus = focusColumn();
  ui['compare-buttons'].replaceChildren(...columns.map(col => {
    const button = element('button', col.label, 'compare-button');
    button.type = 'button';
    button.dataset.focusKey = 'compare:' + col.key;
    button.setAttribute('aria-pressed', String(col.key === focus));
    button.disabled = !col.available;
    button.addEventListener('click', () => setSort(col.key));
    return button;
  }));
}

// Phone-only summary of the focused column: one sentence, one bar, one legend.
function renderSideSummary() {
  const key = focusColumn();
  const col = columns.find(c => c.key === key);
  const sums = groups.map(g => ({side: g.name, value: Ledger.totals(g.nations, [col])[key]}));
  const grand = sums.reduce((sum, s) => sum + s.value, 0);
  const noun = key === 'towns' ? 'towns' : key === 'population' ? 'registered residents' :
    (key === 'factories' ? 'factory' : col.label.toLowerCase()) + ' territories';
  const sentence = element('p', undefined, 'side-sentence');
  const selected = sums.find(s => s.side === state.side);
  if (selected) {
    const verb = Ledger.isResourceKey(key) ? ' hold ' : ' have ';
    sentence.append(element('strong', selected.side), verb + selected.value.toLocaleString('en-US') + ' of the ' + grand.toLocaleString('en-US') + ' ' + noun + '.');
  } else {
    sentence.textContent = grand.toLocaleString('en-US') + ' ' + noun + ' across all sides.';
  }
  const bar = element('div', undefined, 'share-bar');
  bar.setAttribute('aria-hidden', 'true');
  const legend = element('p', undefined, 'share-legend');
  for (const s of sums) {
    if (s.value > 0) {
      const segment = element('span', undefined, 'share-fill side-' + s.side.toLowerCase());
      segment.style.width = (s.value / grand) * 100 + '%';
      bar.append(segment);
    }
    const item = element('span', undefined, 'legend-item');
    item.append(swatch(s.side), s.side + ' ' + s.value.toLocaleString('en-US'));
    legend.append(item);
  }
  ui['side-summary'].replaceChildren(sentence, bar, legend);
}

function sortHeader(key, label, available) {
  const sorted = state.sort === key;
  const th = element('th', undefined, key === 'name' ? 'name-col' : 'num');
  th.scope = 'col';
  th.dataset.key = key;
  th.classList.toggle('is-sorted', sorted);
  th.classList.toggle('is-focus', key === focusColumn());
  if (sorted) th.setAttribute('aria-sort', key === 'name' ? 'ascending' : 'descending');
  const button = element('button', undefined, 'sort-button');
  button.type = 'button';
  button.dataset.focusKey = 'sort:' + key;
  button.disabled = !available;
  button.title = !available ? 'Not reported by the source' : key === 'name' ? 'Sort A–Z' : 'Rank by ' + label.toLowerCase();
  const text = element('span', label);
  if (!sorted) button.append(text);
  else if (key === 'name') button.append(text, icon('up', 'sort-icon'));
  else button.append(icon('down', 'sort-icon'), text);
  button.addEventListener('click', () => setSort(key));
  th.append(button);
  return th;
}

function valueCells(item) {
  const focus = focusColumn();
  return columns.map(col => {
    const cell = element('td', undefined, 'num');
    cell.dataset.key = col.key;
    cell.classList.toggle('is-sorted', col.key === state.sort);
    cell.classList.toggle('is-focus', col.key === focus);
    fillCount(cell, Ledger.value(item, col.key), col.available);
    return cell;
  });
}

function toggleButton(label, meta, expanded, focusKey, onToggle) {
  const button = element('button', undefined, 'row-toggle');
  button.type = 'button';
  button.dataset.focusKey = focusKey;
  button.setAttribute('aria-expanded', String(expanded));
  const text = element('span', undefined, 'row-text');
  text.append(element('span', label, 'row-name'), element('span', meta, 'row-meta'));
  button.append(icon('chevron', 'chevron'), text);
  button.addEventListener('click', onToggle);
  return button;
}

function rowHeader(content) {
  const th = element('th', undefined, 'name-cell');
  th.scope = 'row';
  th.append(content);
  return th;
}

function fullWidthRow(className, content) {
  const row = element('tr', undefined, className);
  const cell = element('td');
  cell.colSpan = columns.length + 1;
  cell.append(content);
  row.append(cell);
  return row;
}

function isSearching() {
  return state.query.trim() !== '';
}

// Searching opens every matching nation; closing one then only lasts for that search.
function isNationOpen(key) {
  return isSearching() ? !state.searchCollapsed.has(key) : state.nationOpen.has(key);
}

function toggle(set, key) {
  if (set.has(key)) set.delete(key);
  else set.add(key);
  render();
}

function nationRows({nation, towns}) {
  const key = nation.id ?? 'independent';
  const open = isNationOpen(key);
  const row = element('tr', undefined, 'nation-row');
  row.classList.toggle('is-open', open);
  row.dataset.nationId = nation.id ?? '';
  const shownTowns = towns.length === nation.towns.length ? plural(towns.length, 'town') : towns.length + ' of ' + plural(nation.towns.length, 'town');
  const meta = shownTowns + ' · ' + plural(nation.population, 'resident');
  const button = toggleButton(Ledger.readable(nation.name), meta, open, 'nation:' + key,
    () => toggle(isSearching() ? state.searchCollapsed : state.nationOpen, key));
  row.append(rowHeader(button), ...valueCells(nation));
  if (!open) return [row];
  return [row, nationDetailRow(nation), ...towns.flatMap(town => townRows(town))];
}

// Phones show every resource for an open nation, since its row only carries one figure.
function nationDetailRow(nation) {
  const grid = element('dl', undefined, 'resource-grid');
  for (const col of columns.filter(c => Ledger.isResourceKey(c.key))) {
    const item = element('div');
    const figure = element('dd');
    item.classList.toggle('is-focus', col.key === focusColumn());
    fillCount(figure, nation.counts[col.key], col.available);
    item.append(element('dt', col.label), figure);
    grid.append(item);
  }
  return fullWidthRow('nation-detail-row', grid);
}

function townRows(town) {
  const open = state.townOpen.has(town.id);
  const row = element('tr', undefined, 'town-row');
  row.dataset.townId = town.id;
  const button = toggleButton(Ledger.readable(town.name), plural(town.population, 'resident'), open, 'town:' + town.id,
    () => toggle(state.townOpen, town.id));
  row.append(rowHeader(button), ...valueCells(town));
  return open ? [row, townDetailRow(town)] : [row];
}

function carries(territory) {
  return territory.resources.map(key => {
    if (key === 'factories') return territory.factoryType ? 'Factory · ' + territory.factoryType : 'Factory';
    return snapshot.resources.find(r => r.key === key).label;
  }).join(', ');
}

function townDetailRow(town) {
  const detail = element('div', undefined, 'town-detail');
  const factories = Object.entries(town.factories).map(([type, count]) => type + ': ' + count).join(' · ');
  if (factories) detail.append(element('p', 'Factories — ' + factories, 'factory-summary'));
  if (!town.territories.length) {
    detail.append(element('p', 'This town holds no resource territories.', 'empty-note'));
    return fullWidthRow('detail-row', detail);
  }
  const table = element('table', undefined, 'territories');
  const head = element('thead');
  const headRow = element('tr');
  for (const label of ['Territory', 'Carries', 'Core X, Z']) {
    const th = element('th', label);
    th.scope = 'col';
    headRow.append(th);
  }
  head.append(headRow);
  const body = element('tbody');
  for (const territory of town.territories) {
    const row = element('tr');
    const label = element('td');
    label.append(element('span', '#' + territory.id, 'mono'));
    if (territory.name) label.append(' ' + Ledger.readable(territory.name));
    row.append(label, element('td', carries(territory)), element('td', territory.core[0] + ', ' + territory.core[1], 'mono coords'));
    body.append(row);
  }
  table.append(head, body);
  detail.append(table);
  return fullWidthRow('detail-row', detail);
}

function foldRow(side, count) {
  const key = side + ':' + state.sort;
  const open = state.unfolded.has(key);
  const button = element('button', undefined, 'fold-toggle');
  button.type = 'button';
  button.dataset.focusKey = 'fold:' + side;
  button.setAttribute('aria-expanded', String(open));
  button.append(icon('chevron', 'chevron'), element('span', (open ? 'Hide ' : 'Show ') + plural(count, 'nation') + ' with no ' + sortWord(state.sort)));
  button.addEventListener('click', () => toggle(state.unfolded, key));
  return fullWidthRow('fold-row', button);
}

function groupBody(group, arranged) {
  const body = element('tbody', undefined, 'side-group');
  body.dataset.side = group.name;
  const townTotal = group.nations.reduce((sum, n) => sum + n.towns.length, 0);
  const meta = isSearching()
    ? arranged.matched.length + ' of ' + plural(group.nations.length, 'nation') + ' match'
    : plural(group.nations.length, 'nation') + ' · ' + plural(townTotal, 'town');
  const heading = element('th', undefined, 'side-heading');
  heading.scope = 'rowgroup';
  heading.colSpan = columns.length + 1;
  heading.append(swatch(group.name), element('span', group.name, 'side-name'), element('span', meta, 'side-meta'));
  const headingRow = element('tr', undefined, 'side-row');
  headingRow.append(heading);
  body.append(headingRow, ...arranged.shown.flatMap(match => nationRows(match)));
  if (arranged.folded.length) body.append(foldRow(group.name, arranged.folded.length));
  return body;
}

function emptyBody() {
  const where = state.side === 'All' ? '' : ' in ' + state.side;
  const content = element('div', undefined, 'empty-state');
  if (isSearching()) {
    const clear = element('button', 'Clear search', 'text-button');
    clear.type = 'button';
    clear.addEventListener('click', clearSearch);
    content.append(element('p', 'No towns or nations' + where + ' match “' + state.query.trim() + '”.'), clear);
  } else {
    content.append(element('p', 'No nations' + where + ' in this snapshot.'));
  }
  const body = element('tbody');
  body.append(fullWidthRow('empty-row', content));
  return body;
}

function renderNations() {
  const headRow = element('tr');
  headRow.append(sortHeader('name', 'Nation', true), ...columns.map(c => sortHeader(c.key, c.label, c.available)));
  const head = element('thead');
  head.append(headRow);
  const bodies = [];
  let nationCount = 0;
  let townCount = 0;
  for (const group of groups) {
    if (state.side !== 'All' && state.side !== group.name) continue;
    const arranged = Ledger.arrange(group.nations, {sort: state.sort, query: state.query, unfolded: state.unfolded.has(group.name + ':' + state.sort)});
    nationCount += arranged.matched.length;
    townCount += arranged.matched.reduce((sum, m) => sum + m.towns.length, 0);
    if (arranged.matched.length) bodies.push(groupBody(group, arranged));
  }
  ui.nations.replaceChildren(head, ...(bodies.length ? bodies : [emptyBody()]));
  ui.summary.textContent = plural(nationCount, 'nation') + ' · ' + plural(townCount, 'town') + ' · ' +
    (state.sort === 'name' ? 'sorted A–Z' : 'ranked by ' + sortWord(state.sort));
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  const side = params.get('side');
  state.side = SIDE_FILTERS.includes(side) ? side : 'All';
  state.sort = params.get('sort') || DEFAULT_SORT;
  state.query = (params.get('q') || '').slice(0, MAX_QUERY_LENGTH);
  ui.search.value = state.query;
}

function writeUrl() {
  const url = new URL(location.href);
  const entries = [['side', state.side, 'All'], ['sort', state.sort, DEFAULT_SORT], ['q', state.query.trim(), '']];
  for (const [name, value, fallback] of entries) {
    if (value && value !== fallback) url.searchParams.set(name, value);
    else url.searchParams.delete(name);
  }
  if (url.href === location.href) return;
  try {
    history.replaceState(null, '', url);
  } catch {
    // Some embedded or sandboxed contexts block history updates; the page works without shareable URLs.
  }
}

function isValidSort(key) {
  return key === 'name' || columns.some(c => c.key === key && c.available);
}

// Re-rendering replaces controls, so keyboard focus moves to the matching new control.
function render() {
  if (!snapshot) return;
  const focusKey = document.activeElement?.dataset?.focusKey;
  renderSideFilter();
  renderCompare();
  renderSideSummary();
  renderNations();
  ui['clear-search'].hidden = !state.query;
  writeUrl();
  if (focusKey) document.querySelector('[data-focus-key="' + CSS.escape(focusKey) + '"]')?.focus();
}

function clearSearch() {
  ui.search.value = '';
  state.query = '';
  state.searchCollapsed.clear();
  render();
  ui.search.focus();
}

function setSort(key) {
  state.sort = key;
  render();
}

function setStatus(text, className = '') {
  ui.status.className = className;
  ui.status.textContent = text;
}

// The last good snapshot is kept in this browser, so the page opens instantly
// and still works when the network or the host is down.
function readSavedSnapshot() {
  let saved = null;
  try {
    saved = localStorage.getItem(CACHE_KEY);
  } catch {
    return null; // Storage is blocked (privacy settings or some file:// pages); load from the network only.
  }
  if (!saved) return null;
  try {
    return validate(JSON.parse(saved));
  } catch {
    forgetSavedSnapshot(); // Corrupt or from an older format: drop it and use the network copy.
    return null;
  }
}

function saveSnapshot(text) {
  try {
    localStorage.setItem(CACHE_KEY, text);
  } catch {
    // Storage is full or blocked. The page works without a saved copy; it just can't fall back to one.
  }
}

function forgetSavedSnapshot() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Nothing to clean up when storage is blocked.
  }
}

function applySnapshot(next, source) {
  snapshot = next;
  snapshotSource = source;
  groups = AllianceGroups.group(snapshot.nations);
  columns = Ledger.columns(snapshot.resources);
  if (!isValidSort(state.sort)) state.sort = DEFAULT_SORT;
  renderTotals();
  updateFreshness();
  render();
}

function fallbackNote() {
  if (!snapshot) return 'Try Reload.';
  return snapshotSource === 'saved' ? 'Showing the copy saved in this browser.' : 'Keeping the previously loaded data.';
}

// "no-cache" revalidates with the host on every load, so an unchanged snapshot costs a small 304 response.
async function load({quiet = false} = {}) {
  ui.reload.disabled = true;
  if (!quiet) setStatus('Loading resource data…');
  try {
    const response = await fetch(new URL('./data/resources.json', document.baseURI), {cache: 'no-cache', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)});
    if (!response.ok) throw new Error('Snapshot request failed (HTTP ' + response.status + ').');
    const text = await response.text();
    applySnapshot(validate(JSON.parse(text)), 'network');
    saveSnapshot(text);
    setStatus('');
  } catch (error) {
    setStatus('Unable to load the latest snapshot. ' + error.message + ' ' + fallbackNote(), snapshot ? 'warning' : 'error');
    if (!snapshot) {
      ui.freshness.textContent = 'No data loaded.';
      ui['freshness-dot'].dataset.state = 'error';
    }
  } finally {
    ui.reload.disabled = false;
  }
}

function start() {
  readUrl();
  const saved = readSavedSnapshot();
  if (saved) {
    applySnapshot(saved, 'saved');
    setStatus('');
  }
  load({quiet: Boolean(saved)});
}

ui['side-filter'].addEventListener('click', event => {
  const button = event.target.closest('button[data-side]');
  if (!button) return;
  state.side = button.dataset.side;
  render();
});
ui['search-form'].addEventListener('submit', event => event.preventDefault());
ui.search.addEventListener('input', () => {
  state.query = ui.search.value.slice(0, MAX_QUERY_LENGTH);
  state.searchCollapsed.clear();
  render();
});
ui['clear-search'].addEventListener('click', clearSearch);
ui.reload.addEventListener('click', () => load());
setInterval(updateFreshness, 60000);
start();
