'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const keys = Object.keys(Production.recipes);
  const materials = Object.keys(Production.materials);
  const format = n => n.toLocaleString('en-US', {maximumFractionDigits: 2});
  const range = values => format(values[0]) + '–' + format(values[1]);
  const readable = name => name.replaceAll('_', ' ');
  let towns = new Map();
  let selected = null;
  let lastResult = null;

  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function settings() {
    return {
      hours: Number($('hours').value), tier: Number($('tier').value),
      baseline: $('baseline').value, stacking: $('stacking').value, rounding: $('rounding').value,
      rubber: $('rubber-recipe').value,
      counts: Object.fromEntries(keys.map(k => [k, Number($(k + '-count').value)])),
      supply: Object.fromEntries(materials.map(k => [k, Number($(k + '-supply').value)])),
    };
  }
  function showTown() {
    selected = towns.get($('town').value) || null;
    $('allocate').disabled = !selected;
    if (!selected) {
      $('town-context').textContent = 'Custom scenario. Factory counts and supply are editable below.';
      return;
    }
    const c = selected.counts;
    $('town-context').textContent = `${readable(selected.name)} · ${readable(selected.nation)} · ${format(selected.population)} residents · ${format(c.factories)} factory territories · ${format(c.latex)} latex territories · ${format(c.oil)} oil territories. Installed machines and tiers are not reported; changing towns keeps your factory plan and daily supply.`;
    $('latex-nodes').value = c.latex;
    $('oil-nodes').value = c.oil;
  }

  function extraction() {
    const ids = ['hours', 'latex-nodes', 'oil-nodes', 'latex-rate', 'oil-rate', 'mining-bonus'];
    if (ids.some(id => !$(id).checkValidity() || $(id).value === '')) {
      $('extraction-estimate').textContent = 'Enter valid hourly rates for both resources (use 0 for none).';
      $('apply-extraction').disabled = true;
      return null;
    }
    const factor = Number($('hours').value) * (1 + Number($('mining-bonus').value) / 100);
    const result = Object.fromEntries(['latex', 'oil'].map(k => [k, Number($(k + '-nodes').value) * Number($(k + '-rate').value) * factor]));
    const tooLarge = Object.values(result).some(v => v > 1e12);
    $('apply-extraction').disabled = tooLarge;
    $('extraction-estimate').textContent = tooLarge ? 'Estimate exceeds the daily supply limit. Reduce the extraction inputs.' : `${format(result.latex)} latex and ${format(result.oil)} crude oil per day at the assumed hourly rate and sustained bonus. Apply again after changing extraction settings.`;
    return tooLarge ? null : result;
  }

  function render() {
    extraction();
    // Empty or invalid fields must never silently turn into a zero/NaN scenario.
    const controls = ['hours', ...keys.map(k => k + '-count'), ...materials.map(k => k + '-supply')];
    const invalid = controls.find(id => !$(id).checkValidity());
    $('match-supply').disabled = Boolean(invalid);
    if (invalid) {
      $('calculation-status').textContent = 'Enter valid, non-negative values to calculate output. Hours must be between 0 and 24; factory counts must be whole numbers.';
      $('calculation-status').className = 'warning';
      $('output-cards').replaceChildren();
      $('supply-results').replaceChildren();
      $('run-description').textContent = '';
      lastResult = null;
      return;
    }
    const config = settings();
    const result = Production.calculate(config);
    lastResult = result;
    $('run-description').textContent = `${format(config.hours)} hours · ${format(result.seconds)} seconds / batch · ${format(result.outputFactor)}× yield before rounding`;
    const active = result.lines.some(l => l.cycles > 0);
    $('calculation-status').className = active && result.ratio < 1 ? 'warning' : 'note';
    $('calculation-status').textContent = !active ? 'No completed batches in this scenario. Add factories or increase operating hours.' : result.ratio < 1 ? `Supply shortfalls: ${result.bottlenecks.map(k => Production.materials[k].toLowerCase()).join(' and ')}. Supply supports ${format(result.ratio * 100)}% of total planned batches; each product is limited only by its own inputs.` : 'Daily supply covers every planned batch.';
    const cards = result.lines.map(line => {
      const card = node('article', undefined, 'output-card');
      card.dataset.product = line.key;
      const heading = node('div', undefined, 'section-head');
      heading.append(node('h3', line.label), node('span', `${format(line.count)} ${line.count === 1 ? 'machine' : 'machines'}`, 'note'));
      const supportedLabel = node('p', 'With your daily supply', 'note');
      const value = node('p', range(line.supported), 'output-value');
      value.dataset.result = 'supported';
      const capacity = node('p', 'Full capacity: ' + range(line.capacity), 'note');
      capacity.dataset.result = 'capacity';
      const progress = node('div', undefined, 'production-bar');
      const percent = line.cycles ? line.supportedCycles / line.cycles * 100 : 0;
      progress.setAttribute('role', 'meter');
      progress.setAttribute('aria-label', line.label + ' share of full batch capacity');
      progress.setAttribute('aria-valuemin', '0'); progress.setAttribute('aria-valuemax', '100');
      progress.setAttribute('aria-valuenow', String(percent));
      const fill = node('span'); fill.style.width = percent + '%'; progress.append(fill);
      card.append(heading, supportedLabel, value, capacity, progress, node('p', `${format(line.supportedCycles)} / ${format(line.cycles)} completed batches · ${format(percent)}% of full capacity`, 'note'));
      return card;
    });
    $('output-cards').replaceChildren(...cards);
    $('supply-results').replaceChildren(...materials.map(k => {
      const row = node('tr'); const label = node('th', Production.materials[k]); label.scope = 'row'; row.append(label);
      for (const value of [result.demand[k], result.supply[k], result.used[k], Math.max(0, result.supply[k] - result.used[k])]) row.append(node('td', format(value)));
      return row;
    }));
  }

  async function load() {
    $('reload').disabled = true;
    $('load-status').textContent = 'Loading town resource data…';
    try {
      const response = await fetch('./data/resources.json', {cache: 'no-cache', signal: AbortSignal.timeout(20000)});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (data.schemaVersion !== 1 || !Array.isArray(data.nations) || !Number.isFinite(Date.parse(data.fetchedAt))) throw new Error('Invalid snapshot');
      const options = [new Option('Custom scenario', '')];
      const nextTowns = new Map();
      for (const nation of [...data.nations].sort((a, b) => a.name.localeCompare(b.name))) {
        const group = node('optgroup'); group.label = readable(nation.name);
        for (const town of [...nation.towns].sort((a, b) => a.name.localeCompare(b.name))) {
          if (typeof town.id !== 'string' || typeof town.name !== 'string' || !town.counts || !['factories', 'latex', 'oil'].every(k => Number.isSafeInteger(town.counts[k]) && town.counts[k] >= 0)) throw new Error('Invalid town data');
          nextTowns.set(town.id, {...town, nation: nation.name});
          group.append(new Option(readable(town.name), town.id));
        }
        options.push(group);
      }
      const previous = $('town').value;
      $('town').replaceChildren(...options);
      towns = nextTowns;
      $('town').value = towns.has(previous) ? previous : '';
      showTown();
      const date = new Date(data.fetchedAt);
      $('freshness').textContent = 'Snapshot ' + date.toLocaleDateString();
      $('freshness').dateTime = data.fetchedAt;
      $('freshness').title = 'Data fetched ' + date.toLocaleString();
      const stale = Date.now() - date.getTime() >= 300 * 60000;
      $('freshness-dot').dataset.state = stale ? 'stale' : 'fresh';
      $('load-status').textContent = `${format(towns.size)} towns loaded. ${stale ? 'Snapshot is over five hours old. ' : ''}Resource territories describe holdings, not installed factories.`;
      $('load-status').className = stale ? 'note warning' : 'note';
      render();
    } catch (error) {
      $('load-status').textContent = 'Unable to refresh town data. ' + error.message + ' You can continue with the custom scenario or previously loaded towns.';
      $('load-status').className = 'note warning';
      if (!towns.size) { $('freshness').textContent = 'No town data'; $('freshness-dot').dataset.state = 'error'; }
    } finally { $('reload').disabled = false; }
  }

  document.querySelectorAll('.production-page input, .production-page select').forEach(control => control.addEventListener('input', () => {
    if (control.id === 'town') showTown();
    render();
  }));
  $('allocate').addEventListener('click', () => {
    if (!selected) return;
    const count = selected.counts.factories;
    keys.forEach((k, i) => { $(k + '-count').value = Math.floor(count / 3) + (i < count % 3 ? 1 : 0); });
    render();
  });
  $('match-supply').addEventListener('click', () => {
    if (!lastResult) return;
    materials.forEach(k => { $(k + '-supply').value = lastResult.demand[k]; });
    render();
  });
  $('apply-extraction').addEventListener('click', () => {
    const values = extraction();
    if (!values) return;
    for (const k of ['latex', 'oil']) $(k + '-supply').value = values[k];
    render();
  });
  $('reset-scenario').addEventListener('click', () => {
    document.querySelectorAll('.production-page input').forEach(input => { input.value = input.defaultValue; });
    document.querySelectorAll('.production-page select').forEach(select => { select.selectedIndex = 0; });
    showTown(); render();
  });
  $('reload').addEventListener('click', load);
  render(); load();
})();
