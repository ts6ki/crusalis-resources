'use strict';
// Names are labels. Snapshot assignments are frozen; schema-v1 fallback uses UUIDs only.
const AllianceGroups = (() => {
  const sides = ['Allies', 'Axis', 'Other'];
  let membership = new Map();
  const normalize = name => name.toLowerCase().replace(/[_()]/g, ' ').replace(/\s+/g, ' ').trim();
  function configure(data) {
    if (!data || typeof data.revision !== 'string' || !data.nations ||
        Object.values(data.nations).some(n => !sides.includes(n.side))) throw new Error('Invalid alliance mapping');
    membership = new Map(Object.entries(data.nations).map(([id, n]) => [id, n.side]));
  }
  const classify = nation => nation.id === null ? 'Other' :
    sides.includes(nation.alliance) ? nation.alliance : membership.get(nation.id) || 'Other';
  function group(nations) {
    return sides.map(name => ({name, nations: nations.filter(n => classify(n) === name).sort((a, b) =>
      Number(a.id === null) - Number(b.id === null) || b.population - a.population ||
      normalize(a.name).localeCompare(normalize(b.name), 'en'))}));
  }
  return {configure, classify, group};
})();
