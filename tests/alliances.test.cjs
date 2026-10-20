const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {test} = require('node:test');
const groups = vm.runInNewContext(fs.readFileSync('site/alliances.js', 'utf8') + '\nAllianceGroups;', {},
  {filename: require('node:path').resolve('site/alliances.js')});
const mapping = {revision: 'test', nations: {a: {name: 'Hungary', side: 'Axis'}, b: {name: 'France', side: 'Allies'}}};
test('UUID membership survives renames and never follows a reused name', () => {
  groups.configure(mapping);
  assert.equal(groups.classify({id: 'a', name: 'Danubian Federation'}), 'Axis');
  assert.equal(groups.classify({id: 'new', name: 'Hungary'}), 'Other');
  assert.equal(groups.classify({id: null, name: 'France'}), 'Other');
});
test('saved alliance wins over current mapping for historical snapshots', () => {
  groups.configure(mapping);
  assert.equal(groups.classify({id: 'a', name: 'Hungary', alliance: 'Allies'}), 'Allies');
});
test('grouping preserves nations, orders population and puts Independent last', () => {
  groups.configure(mapping);
  const nations = [{id: null, name: 'Independent', population: 500}, {id: 'x', name: 'X', population: 1},
    {id: 'a', name: 'Renamed', population: 2}, {id: 'b', name: 'France', population: 4}];
  assert.deepEqual(JSON.parse(JSON.stringify(groups.group(nations))).map(g => g.nations.map(n => n.id)),
    [['b'], ['a'], ['x', null]]);
  assert.equal(nations[0].id, null);
});
test('invalid configuration is rejected', () => {
  assert.throws(() => groups.configure({nations: {a: {side: 'Unknown'}}}));
});
