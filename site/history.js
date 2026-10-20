'use strict';

const HistoryView = (() => {
  const $ = id => document.getElementById('history-' + id);
  const readable = name => name.replaceAll('_', ' ');
  const node = (tag, text) => { const n = document.createElement(tag); n.textContent = text; return n; };
  const label = key => key[0].toUpperCase() + key.slice(1);
  function create({validate, apply, loadLatest, setStatus}) {
    let index = {snapshots: [], timezone: 'America/Los_Angeles'};
    let entities = {nations: {}, towns: {}, relationships: []};
    let days = [], current = null, currentSource = 'network', activeDate = '', sequence = 0, comparisonSequence = 0, debounce;
    let selection = new URLSearchParams(location.search).get('entity') || 'side:All';
    const cache = new Map();
    const metric = new URLSearchParams(location.search).get('metric');
    if (HistoryModel.keys.includes(metric)) $('metric').value = metric;
    const report = text => { $('note').textContent = text; };
    const urlState = () => {
      const url = new URL(location.href);
      for (const [key, value, fallback] of [['date', activeDate, ''], ['entity', selection, 'side:All'],
        ['metric', $('metric').value, 'population']]) {
        if (value !== fallback) url.searchParams.set(key, value);
        else url.searchParams.delete(key);
      }
      try { history.replaceState(null, '', url); } catch { /* Embedded browser. */ }
    };
    async function fetchJSON(path) {
      const response = await fetch(new URL('./data/history/' + path, document.baseURI),
        {cache: 'no-cache', signal: AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      return response.json();
    }
    async function getSnapshot(entry, fresh = false) {
      if (!fresh && cache.has(entry.date)) return cache.get(entry.date);
      const data = validate(await fetchJSON(entry.path));
      if (data.schemaVersion !== 2 || data.history?.date !== entry.date ||
          data.history?.timezone !== index.timezone || data.fetchedAt !== entry.fetchedAt) {
        throw new Error('Archived snapshot does not match its index.');
      }
      cache.set(entry.date, data);
      if (cache.size > 8) cache.delete(cache.keys().next().value);
      return data;
    }
    function annotate(data) {
      return {...data, nations: data.nations.map(n => ({...n,
        aliases: entities.nations[n.id ?? 'independent']?.names?.map(a => a.name) || [],
        towns: n.towns.map(t => ({...t, aliases: entities.towns[t.id]?.names?.map(a => a.name) || []})),
      }))};
    }
    function controls() {
      const entries = index.snapshots;
      const pos = activeDate ? entries.findIndex(e => e.date === activeDate) : entries.length;
      $('slider').max = String(entries.length);
      $('slider').value = String(Math.max(0, pos));
      $('slider').disabled = !entries.length;
      $('slider').setAttribute('aria-valuetext', activeDate || 'Latest');
      $('prev').disabled = !entries.length || pos <= 0;
      $('next').disabled = !entries.length || !activeDate;
      $('date').disabled = !entries.length;
      $('date').min = entries[0]?.date || '';
      $('date').max = entries.at(-1)?.date || '';
      $('date').value = activeDate;
      $('selected').textContent = activeDate || 'Latest';
      if (!entries.length) report('No saved days yet. Daily saves are scheduled for 11:47 PM Pacific; actual capture times may vary.');
      else {
        const last = entries.at(-1);
        const stale = Date.now() - Date.parse(last.fetchedAt) > 48 * 3600000;
        report(`${entries.length} saved ${entries.length === 1 ? 'day' : 'days'} · ${index.timezone} · Last save ${last.date}` +
          (stale ? ' · Archive is overdue. Check the GitHub Actions workflow.' : '') +
          (activeDate && current ? ' · Captured ' + new Date(current.fetchedAt).toLocaleString() : ''));
      }
    }
    function options() {
      const records = new Map(Object.entries(entities.nations).map(([id, e]) =>
        [id, `${readable(e.names.at(-1)?.name || id)} · ${e.firstSeen} · ${id.slice(0, 8)}`]));
      for (const n of current?.nations || []) {
        const id = n.id ?? 'independent';
        const entry = entities.nations[id];
        records.set(id, readable(n.name) + (entry ? ` · ${entry.firstSeen} · ${id.slice(0, 8)}` : ''));
      }
      $('entity').replaceChildren(...['All', 'Allies', 'Axis', 'Other'].map(s =>
        new Option(s === 'All' ? 'All sides' : s, 'side:' + s)),
      ...[...records].sort((a, b) => a[1].localeCompare(b[1])).map(([id, name]) => new Option(name, 'nation:' + id)));
      if (![...$('entity').options].some(o => o.value === selection)) {
        // Keep a requested UUID instead of silently showing a different entity.
        $('entity').add(new Option('Unknown nation · ' + selection.slice(7), selection));
      }
      $('entity').value = selection;
    }
    function drawChart() {
      const svg = $('chart');
      svg.replaceChildren();
      const series = HistoryModel.series(days, selection, $('metric').value);
      const known = series.filter(p => p.value !== null);
      if (!known.length) {
        $('chart-note').textContent = 'No saved observations for this selection yet.';
        return;
      }
      const selected = series.find(p => p.date === activeDate) || (!activeDate ? series.at(-1) : null);
      $('chart-note').textContent = `${label($('metric').value)} · ${series[0].date} to ${series.at(-1).date}` +
        (selected ? ` · ${selected.date}: ${selected.value === null ? 'not present / unavailable' : selected.value.toLocaleString()}` : '');
      const max = Math.max(1, ...known.map(p => p.value));
      const start = Date.parse(series[0].date), span = Math.max(86400000, Date.parse(series.at(-1).date) - start);
      const x = p => 16 + (Date.parse(p.date) - start) / span * 928;
      const y = p => 140 - p.value / max * 120;
      const make = (tag, attrs) => {
        const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
        for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
        return el;
      };
      let path = '', previous = null;
      for (const p of series) {
        if (p.value === null) { previous = null; continue; }
        const continuous = previous && Date.parse(p.date) - Date.parse(previous.date) === 86400000;
        path += `${continuous ? 'L' : 'M'}${x(p)},${y(p)} `;
        previous = p;
      }
      svg.append(make('path', {d: path, fill: 'none', stroke: 'currentColor', 'stroke-width': 2}));
      for (const p of known) {
        const circle = make('circle', {cx: x(p), cy: y(p), r: p.date === activeDate ? 6 : 3,
          fill: 'currentColor'});
        const title = make('title', {}); title.textContent = `${p.date}: ${p.value.toLocaleString()}`;
        circle.append(title); svg.append(circle);
      }
      svg.setAttribute('aria-label', $('chart-note').textContent);
    }
    async function comparison() {
      const request = ++comparisonSequence;
      $('deltas').replaceChildren(); $('changes').replaceChildren();
      if (!current) return;
      if (current.schemaVersion !== 2) {
        $('comparison').textContent = 'Comparisons begin with UUID-based saved snapshots.';
        return;
      }
      const entry = [...index.snapshots].reverse().find(e =>
        activeDate ? e.date < activeDate : Date.parse(e.fetchedAt) < Date.parse(current.fetchedAt));
      if (!entry) { $('comparison').textContent = 'A previous saved observation is needed to show changes.'; return; }
      $('comparison').textContent = 'Loading comparison…';
      try {
        const before = await getSnapshot(entry);
        if (request !== comparisonSequence) return;
        const delta = HistoryModel.delta(before, current, selection);
        $('comparison').textContent = `Change from ${entry.date} to ${activeDate || 'Latest'} · ${$('entity').selectedOptions[0]?.textContent}`;
        for (const [key, value] of Object.entries(delta)) {
          const item = node('div', '');
          const amount = node('dd', value === null ? 'N/A' : (value > 0 ? '+' : '') + value.toLocaleString());
          amount.className = value > 0 ? 'gain' : value < 0 ? 'loss' : '';
          item.append(node('dt', label(key)), amount); $('deltas').append(item);
        }
        const nameOf = (data, id) => readable(data.nations.find(n => n.id === id)?.name || (id === null ? 'Independent' : id));
        const events = HistoryModel.changes(before, current);
        for (const event of events) {
          let description = `${readable(event.name)}: `;
          if (event.kind === 'rename') description = `${readable(event.before)} → ${readable(event.after)} (renamed)`;
          else if (event.kind === 'membership') description += `${nameOf(before, event.before)} → ${nameOf(current, event.after)} (town membership)`;
          else if (event.kind === 'alliance') description += `${event.before} → ${event.after} (alliance assignment)`;
          else if (event.kind === 'territory') description = `Resource territory ${event.id}: ${readable(event.before)} → ${readable(event.after)}`;
          else description += event.kind === 'absent' ? 'not present in this snapshot' : 'appeared in this snapshot';
          $('changes').append(node('li', description));
        }
        for (const r of entities.relationships || []) {
          if (r.date > entry.date && r.date <= (activeDate || new Date(current.fetchedAt).toISOString().slice(0, 10))) {
            const collection = entities[r.entityType];
            $('changes').append(node('li', `Confirmed ${r.kind}: ${readable(collection[r.from].names.at(-1).name)} → ${readable(collection[r.to].names.at(-1).name)} (${r.provenance})`));
          }
        }
        if (!events.length && !$('changes').children.length) $('changes').append(node('li', 'No observed name, membership, alliance, or resource-owner changes.'));
      } catch (error) {
        if (request === comparisonSequence) $('comparison').textContent = 'Comparison unavailable. ' + error.message;
      }
    }
    function observe(data, source) {
      current = data;
      currentSource = source;
      activeDate = source === 'history' ? data.history.date : '';
      controls(); options(); drawChart(); comparison(); urlState();
    }
    async function select(date, fresh = false) {
      clearTimeout(debounce);
      const request = ++sequence;
      ++comparisonSequence;
      if (!date) {
        await loadLatest({guard: () => request === sequence});
        if (request === sequence) controls();
        return;
      }
      const entry = index.snapshots.find(s => s.date === date);
      if (!entry) {
        controls(); report('No snapshot saved for ' + date + '. Choose a saved day on the slider.');
        if (!current) setStatus('No historical snapshot loaded. Choose a saved day or Latest.', 'warning');
        return;
      }
      report('Loading ' + date + '…');
      try {
        const data = await getSnapshot(entry, fresh);
        if (request !== sequence) return;
        apply(annotate(data), 'history');
      } catch (error) {
        if (request !== sequence) return;
        controls(); report('Unable to load ' + date + '. ' + error.message + ' The previous view is unchanged.');
        if (!current) setStatus('No historical snapshot loaded. Choose a saved day or Latest.', 'warning');
      }
    }
    async function start() {
      const requested = new URLSearchParams(location.search).get('date');
      const latest = requested ? Promise.resolve() : select('');
      try {
        index = HistoryModel.validateIndex(await fetchJSON('index.json'));
        controls();
        // These small derived files power alias search and trends, not initial table loading.
        const metadata = Promise.all([
          fetchJSON('entities.json').then(data => {
            if (data?.schemaVersion !== 1 || !data.nations || !data.towns || !Array.isArray(data.relationships)) throw new Error('Invalid history entities');
            entities = data;
            if (current) apply(annotate(current), currentSource);
            else options();
          }),
          Promise.all([...new Set(index.snapshots.map(s => s.date.slice(0, 4)))].map(year =>
            fetchJSON('summaries/' + year + '.json'))).then(results => {
            const expected = new Set(index.snapshots.map(s => s.date));
            days = results.flatMap(r => {
              if (r?.schemaVersion !== 1 || !Array.isArray(r.days)) throw new Error('Invalid history summary');
              return r.days;
            }).filter(d => expected.has(d.date)).sort((a, b) => a.date.localeCompare(b.date));
            drawChart();
          }),
        ]).catch(error => report('Some history details could not load. ' + error.message + ' Saved-date browsing is still available.'));
        if (requested) await select(requested);
        await metadata;
      } catch (error) {
        report('History unavailable. ' + error.message + (requested ? ' Choose Latest to view current data.' : ' Latest data remains available.'));
        if (requested && !current) setStatus('No historical snapshot loaded. Choose Latest to view current data.', 'warning');
      }
      await latest;
    }
    $('slider').addEventListener('input', () => {
      clearTimeout(debounce);
      ++sequence; // Invalidate in-flight responses immediately, before debounce.
      const date = index.snapshots[Number($('slider').value)]?.date || '';
      $('selected').textContent = date || 'Latest';
      debounce = setTimeout(() => select(date), 100);
    });
    $('date').addEventListener('change', () => select($('date').value));
    $('latest').addEventListener('click', () => select(''));
    $('prev').addEventListener('click', () => {
      const pos = activeDate ? index.snapshots.findIndex(e => e.date === activeDate) : index.snapshots.length;
      if (pos > 0) select(index.snapshots[pos - 1].date);
    });
    $('next').addEventListener('click', () => {
      const pos = index.snapshots.findIndex(e => e.date === activeDate);
      select(index.snapshots[pos + 1]?.date || '');
    });
    $('entity').addEventListener('change', () => { selection = $('entity').value; drawChart(); comparison(); urlState(); });
    $('metric').addEventListener('change', () => { drawChart(); urlState(); });
    return {start, observe, annotate, reload: () => select(activeDate || new URLSearchParams(location.search).get('date') || '', true)};
  }
  return {create};
})();
