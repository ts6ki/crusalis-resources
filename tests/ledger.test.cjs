const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const Ledger = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../site/ledger.js'), 'utf8')}\nLedger;`);

const plain = value => JSON.parse(JSON.stringify(value));
const counts = (oil = 0, tungsten = 0) => ({tungsten, aluminum: 0, latex: 0, chromium: 0, oil, factories: 0});
const town = (name, population, oil = 0) => ({id: name, name, population, counts: counts(oil)});
const nation = (name, population, towns, id = name) => ({
  id, name, population, towns,
  counts: counts(towns.reduce((sum, t) => sum + t.counts.oil, 0)),
});
const resources = [
  {key: 'tungsten', label: 'Tungsten', available: true}, {key: 'aluminum', label: 'Aluminum', available: true},
  {key: 'latex', label: 'Latex', available: true}, {key: 'chromium', label: 'Chromium', available: false},
  {key: 'oil', label: 'Oil', available: true}, {key: 'factories', label: 'Factories', available: true},
];

test('columns list towns and population before every resource, keeping availability', () => {
  const columns = plain(Ledger.columns(resources));
  assert.deepEqual(columns.map(c => c.key), ['towns', 'population', 'tungsten', 'aluminum', 'latex', 'chromium', 'oil', 'factories']);
  assert.equal(columns.find(c => c.key === 'chromium').available, false);
  assert.equal(columns.find(c => c.key === 'towns').label, 'Towns');
});

test('values read town counts for nations and report none for towns', () => {
  const berlin = town('Berlin', 124, 2);
  const germany = nation('German_Empire', 474, [berlin, town('Mainz', 120)]);
  assert.equal(Ledger.value(germany, 'towns'), 2);
  assert.equal(Ledger.value(berlin, 'towns'), null);
  assert.equal(Ledger.value(germany, 'population'), 474);
  assert.equal(Ledger.value(germany, 'oil'), 2);
});

test('numeric columns rank largest first, then by population, then by name', () => {
  const nations = [
    nation('Iraq', 12, [town('Tikrit', 12, 10)]),
    nation('Saudi_Arabia', 4, [town('Riyadh', 4, 9)]),
    nation('Soviet_Union', 320, [town('Moskva', 320, 9)]),
    nation('Albania', 9, [town('Kukes', 9)]),
    nation('Norway', 9, [town('Oslo', 9)]),
  ];
  const byOil = [...nations].sort(Ledger.compare('oil')).map(n => n.name);
  assert.deepEqual(byOil, ['Iraq', 'Soviet_Union', 'Saudi_Arabia', 'Albania', 'Norway']);
  const byName = [...nations].sort(Ledger.compare('name')).map(n => n.name);
  assert.deepEqual(byName, ['Albania', 'Iraq', 'Norway', 'Saudi_Arabia', 'Soviet_Union']);
});

test('Independent stays last in every sort', () => {
  const nations = [
    nation('Independent', 900, [town('Free', 900, 50)], null),
    nation('Belgium', 0, [town('Brussels', 0)]),
    nation('Afghanistan', 0, [town('Kabul', 0)]),
  ];
  for (const key of ['name', 'population', 'oil', 'towns']) {
    assert.equal([...nations].sort(Ledger.compare(key)).at(-1).name, 'Independent', key);
  }
});

test('search matches nation names with all their towns, or individual town names', () => {
  const nations = [
    nation('Empire_of_Japan', 112, [town('Tokyo', 32), town('Korea', 21)]),
    nation('German_Empire', 474, [town('Berlin', 124)]),
    nation('Italy', 287, [town('Rome', 91)]),
  ];
  const byNation = plain(Ledger.matches(nations, 'empire'));
  assert.deepEqual(byNation.map(m => [m.nation.name, m.towns.length]), [['Empire_of_Japan', 2], ['German_Empire', 1]]);
  const byTown = plain(Ledger.matches(nations, '  TOKYO '));
  assert.deepEqual(byTown.map(m => [m.nation.name, m.towns.map(t => t.name)]), [['Empire_of_Japan', ['Tokyo']]]);
  assert.equal(Ledger.matches(nations, 'of japan').length, 1);
  assert.equal(Ledger.matches(nations, 'zzzz').length, 0);
  assert.equal(Ledger.matches(nations, '').length, 3);
});

test('ranking by a resource folds nations without it until unfolded', () => {
  const nations = [
    nation('France', 55, [town('Paris', 25)]),
    nation('Iraq', 12, [town('Tikrit', 12, 10)]),
    nation('Greece', 75, [town('Athens', 50)]),
    nation('Romania', 46, [town('Cluj', 46, 7)]),
  ];
  const folded = plain(Ledger.arrange(nations, {sort: 'oil', query: '', unfolded: false}));
  assert.deepEqual(folded.shown.map(m => m.nation.name), ['Iraq', 'Romania']);
  assert.deepEqual(folded.folded.map(m => m.nation.name), ['Greece', 'France']);
  assert.equal(folded.matched.length, 4);
  const open = plain(Ledger.arrange(nations, {sort: 'oil', query: '', unfolded: true}));
  assert.deepEqual(open.shown.map(m => m.nation.name), ['Iraq', 'Romania', 'Greece', 'France']);
});

test('unfolding keeps Independent last even when it holds the resource', () => {
  const nations = [
    nation('Independent', 1, [town('Free', 1, 50)], null),
    nation('Belgium', 0, [town('Brussels', 0)]),
    nation('New_Guangxi', 21, [town('Wuzhou', 21, 2)]),
  ];
  const result = plain(Ledger.arrange(nations, {sort: 'oil', query: '', unfolded: true}));
  assert.deepEqual(result.shown.map(m => m.nation.name), ['New_Guangxi', 'Belgium', 'Independent']);
});

test('search ignores the browser locale when matching letters', () => {
  const nations = [nation('IRAQ', 12, [town('Tikrit', 12)])];
  assert.equal(Ledger.matches(nations, 'iraq').length, 1);
  assert.equal(Ledger.normalized('IRAQ'), 'iraq');
});

test('population and name sorts never fold, and searching turns folding off', () => {
  const nations = [nation('France', 55, [town('Paris', 25)]), nation('Iraq', 12, [town('Tikrit', 12, 10)])];
  for (const sort of ['population', 'name', 'towns']) {
    const result = Ledger.arrange(nations, {sort, query: '', unfolded: false});
    assert.equal(result.shown.length, 2, sort);
    assert.equal(result.folded.length, 0, sort);
  }
  const searching = plain(Ledger.arrange(nations, {sort: 'oil', query: 'paris', unfolded: false}));
  assert.deepEqual(searching.shown.map(m => m.nation.name), ['France']);
  assert.equal(searching.folded.length, 0);
});

test('towns inside a nation follow the same ranking without changing the input', () => {
  const towns = [town('Washington_DC', 29, 11), town('New_York', 6), town('New_Orleans', 18, 13)];
  const usa = nation('United_States_of_America', 76, towns);
  const result = plain(Ledger.arrange([usa], {sort: 'oil', query: '', unfolded: false}));
  assert.deepEqual(result.shown[0].towns.map(t => t.name), ['New_Orleans', 'Washington_DC', 'New_York']);
  const byTownCount = plain(Ledger.arrange([usa], {sort: 'towns', query: '', unfolded: false}));
  assert.deepEqual(byTownCount.shown[0].towns.map(t => t.name), ['Washington_DC', 'New_Orleans', 'New_York']);
  assert.deepEqual(towns.map(t => t.name), ['Washington_DC', 'New_York', 'New_Orleans']);
});

test('totals add every column across nations, including town counts', () => {
  const nations = [
    nation('Iraq', 12, [town('Tikrit', 12, 10)]),
    nation('Soviet_Union', 320, [town('Moskva', 2, 9), town('Kyiv', 88)]),
  ];
  const totals = plain(Ledger.totals(nations, Ledger.columns(resources)));
  assert.equal(totals.towns, 3);
  assert.equal(totals.population, 332);
  assert.equal(totals.oil, 19);
  assert.equal(totals.tungsten, 0);
});

test('readable names replace underscores', () => {
  assert.equal(Ledger.readable('Protectorate_Of_Bohemia_Moravia'), 'Protectorate Of Bohemia Moravia');
});
