'use strict';

// Pure view logic for the resource table: columns, ranking, search, folding, and totals.
// No DOM access, so tests can run it in a plain VM context.
const Ledger = (() => {
  const readable = name => name.replaceAll('_', ' ');
  // Locale-independent, so a Turkish browser still matches "Iraq" when typing "iraq".
  const normalized = name => readable(name).toLowerCase();
  const isResourceKey = key => !['name', 'towns', 'population'].includes(key);

  function columns(resources) {
    return [
      {key: 'towns', label: 'Towns', available: true},
      {key: 'population', label: 'Population', available: true},
      ...resources.map(r => ({key: r.key, label: r.label, available: r.available})),
    ];
  }

  // Towns have no town count of their own, so they report null for that column.
  function value(item, key) {
    if (key === 'towns') return Array.isArray(item.towns) ? item.towns.length : null;
    if (key === 'population') return item.population;
    return item.counts[key];
  }

  // Names sort A–Z. Numbers sort largest first, then by population, then by name.
  // Independent (the nation without an id) always closes its side.
  function compare(key) {
    const ranked = (item, fallback) => value(item, key) ?? fallback.population;
    return (a, b) => Number(a.id === null) - Number(b.id === null) ||
      (key === 'name' ? 0 : ranked(b, b) - ranked(a, a) || b.population - a.population) ||
      normalized(a.name).localeCompare(normalized(b.name), 'en');
  }

  // A nation-name match keeps all of its towns; otherwise only matching towns remain.
  function matches(nations, query) {
    const q = normalized(query.trim());
    return nations
      .map(nation => ({
        nation,
        towns: !q || normalized(nation.name).includes(q) ? nation.towns : nation.towns.filter(t => normalized(t.name).includes(q)),
      }))
      .filter(match => match.towns.length > 0);
  }

  // Ranking by a resource folds nations without it, unless the user is searching.
  function arrange(nations, {sort, query, unfolded}) {
    const order = compare(sort);
    const matched = matches(nations, query)
      .sort((a, b) => order(a.nation, b.nation))
      .map(match => ({nation: match.nation, towns: [...match.towns].sort(order)}));
    const fold = isResourceKey(sort) && !query.trim();
    const holders = fold ? matched.filter(m => value(m.nation, sort) > 0) : matched;
    const folded = fold ? matched.filter(m => !(value(m.nation, sort) > 0)) : [];
    return {matched, shown: unfolded ? matched : holders, folded};
  }

  function totals(nations, cols) {
    return Object.fromEntries(cols.map(c => [c.key, nations.reduce((sum, n) => sum + value(n, c.key), 0)]));
  }

  return {readable, normalized, isResourceKey, columns, value, compare, matches, arrange, totals};
})();
