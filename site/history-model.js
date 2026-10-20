'use strict';

const HistoryModel = (() => {
  const keys = ['towns', 'population', 'tungsten', 'aluminum', 'latex', 'chromium', 'oil', 'factories'];
  const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  function validateIndex(data) {
    if (data?.schemaVersion !== 1 || typeof data.timezone !== 'string' || !Array.isArray(data.snapshots)) {
      throw new Error('Invalid history index.');
    }
    new Intl.DateTimeFormat('en', {timeZone: data.timezone});
    let previous = '';
    for (const s of data.snapshots) {
      if (!validDate(s.date) || s.date <= previous ||
          s.path !== `${s.date.slice(0, 4)}/${s.date.slice(5, 7)}/${s.date}.json` ||
          !Number.isFinite(Date.parse(s.fetchedAt))) throw new Error('Invalid history entry.');
      previous = s.date;
    }
    return data;
  }
  function values(data, selection) {
    const [kind, id] = selection.split(':');
    const nations = kind === 'nation' ? data.nations.filter(n => (n.id ?? 'independent') === id) :
      data.nations.filter(n => id === 'All' || n.alliance === id);
    const available = new Map(data.resources.map(r => [r.key, r.available]));
    return Object.fromEntries(keys.map(k => [k, (kind === 'nation' && !nations.length) || available.get(k) === false ? null :
      nations.reduce((sum, n) => sum + (k === 'towns' ? n.towns.length : k === 'population' ? n.population : n.counts[k] || 0), 0)]));
  }
  function delta(before, after, selection) {
    const a = values(before, selection), b = values(after, selection);
    return Object.fromEntries(keys.map(k => [k, a[k] === null || b[k] === null ? null : b[k] - a[k]]));
  }
  function changes(before, after) {
    const result = [];
    for (const kind of ['nation', 'town']) {
      const flatten = data => kind === 'nation' ? data.nations : data.nations.flatMap(n => n.towns);
      const old = new Map(flatten(before).map(n => [n.id, n]));
      const current = new Map(flatten(after).map(n => [n.id, n]));
      for (const [id, n] of current) {
        const prior = old.get(id);
        if (!prior) result.push({kind: 'appeared', entityType: kind, id, name: n.name});
        else {
          if (prior.name !== n.name) result.push({kind: 'rename', entityType: kind, id, name: n.name, before: prior.name, after: n.name});
          if (kind === 'town' && prior.nationId !== n.nationId) result.push({
            kind: 'membership', entityType: kind, id, name: n.name, before: prior.nationId, after: n.nationId});
          if (kind === 'nation' && prior.alliance !== n.alliance) result.push({
            kind: 'alliance', entityType: kind, id, name: n.name, before: prior.alliance, after: n.alliance});
        }
      }
      for (const [id, n] of old) if (!current.has(id)) result.push({kind: 'absent', entityType: kind, id, name: n.name});
    }
    const territories = data => new Map(data.nations.flatMap(n => n.towns.flatMap(t =>
      t.territories.map(r => [r.id, t]))));
    const old = territories(before);
    for (const [id, town] of territories(after)) {
      const prior = old.get(id);
      if (prior && prior.id !== town.id) result.push({kind: 'territory', id, name: id, before: prior.name, after: town.name});
    }
    return result;
  }
  function series(days, selection, metric) {
    const [kind, id] = selection.split(':');
    return days.map(day => ({date: day.date,
      value: (kind === 'nation' ? day.nations[id] : day.sides[id])?.[metric] ?? null}));
  }
  return {keys, validDate, validateIndex, values, delta, changes, series};
})();
