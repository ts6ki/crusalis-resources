const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
function model() {
  return vm.runInNewContext(fs.readFileSync('site/history-model.js', 'utf8') + '\nHistoryModel;', {},
    {filename: require('node:path').resolve('site/history-model.js')});
}
const data = (name, nationId = 'a') => ({resources: [{key: 'oil', available: true}],
  nations: [{id: nationId, name, alliance: 'Axis', population: 10, counts: {oil: 2},
    towns: [{id: 't', name: 'Town', nationId, population: 10, counts: {oil: 2}, territories: []}]}]});
test('renames preserve comparisons; missing entities are not zero', () => {
  const h = model();
  assert.equal(h.delta(data('Old'), data('New'), 'nation:a').population, 0);
  assert.equal(h.delta(data('Old'), data('New', 'b'), 'nation:a').population, null);
  assert.equal(h.changes(data('Old'), data('New'))[0].kind, 'rename');
});
test('town membership changes are reported without inferring conquests', () => {
  const changes = model().changes(data('Old'), data('New', 'b'));
  assert.ok(changes.some(c => c.kind === 'membership' && c.id === 't' && c.before === 'a' && c.after === 'b'));
});
test('unavailable resources remain unknown', () => {
  const after = data('New'); after.resources[0].available = false;
  assert.equal(model().delta(data('Old'), after, 'side:All').oil, null);
});
test('archive paths and dates are validated before fetch', () => {
  const h = model();
  assert.throws(() => h.validateIndex({schemaVersion: 1, snapshots: [{date: '2026-10-19', path: '../secret'}]}));
  const index = {schemaVersion: 1, timezone: 'America/Los_Angeles', snapshots: [
    {date: '2026-10-19', path: '2026/10/2026-10-19.json', fetchedAt: '2026-10-20T06:47:00Z'}]};
  assert.equal(h.validateIndex(index).snapshots.length, 1);
  assert.throws(() => h.validateIndex({...index, snapshots: [...index.snapshots, ...index.snapshots]}));
});
test('chart series keeps absent days as gaps', () => {
  const days = [{date: '2026-10-19', nations: {a: {population: 12}}, sides: {}},
    {date: '2026-10-20', nations: {}, sides: {}}];
  assert.deepEqual(JSON.parse(JSON.stringify(model().series(days, 'nation:a', 'population'))),
    [{date: '2026-10-19', value: 12}, {date: '2026-10-20', value: null}]);
});
