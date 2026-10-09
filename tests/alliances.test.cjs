const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const alliances = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../site/alliances.js'), 'utf8')}\nAllianceGroups;`);

test('confirmed Axis nations and source names map to Axis', () => {
  for (const name of ['Germany', 'German_Empire', 'Slovakia (German)', 'Slovakia', 'Italy',
    'Japan', 'Empire_of_Japan', 'Manchuria (Japan)', 'Manchuria', 'Finland', 'Romania',
    'Hungary', 'Bulgaria', 'Thailand', 'Axis Spain', 'Nationalist_Spain', 'Argentina',
    'Switzerland', 'Confederacy_of_Switzerland', 'Iran', 'Protectorate_Of_Bohemia_Moravia']) {
    assert.equal(alliances.classify(name), 'Axis', name);
  }
});

test('confirmed Allied nations and source names map to Allies', () => {
  for (const name of ['USA', 'United_States_of_America', 'Philippines (USA)', 'American_Philippines',
    'UK', 'British_Empire', 'Egypt (UK)', 'British_Egypt', 'France', 'Soviets', 'Soviet_Union',
    'Netherlands', 'Indonesia (Dutch)', 'Dutch_East_Indies', 'Yugoslavia', 'Norway', 'Albania',
    'Greece', 'Allied Spain', 'Republican_Spain', 'Liberia', 'Saudi_Arabia', 'Iraq',
    'Nationalist_China', 'Communist China', 'Soviet_China', 'Shaanxi', 'Shaanxi clique']) {
    assert.equal(alliances.classify(name), 'Allies', name);
  }
});

test('unlisted nations stay in Other', () => {
  for (const name of ['Provisional_Government_Of_China', 'Belgium', 'Poland', 'Independent',
    'New Germany', 'Spain', 'Unknown']) {
    assert.equal(alliances.classify(name), 'Other', name);
  }
});

test('case and spacing are normalized without guessing membership', () => {
  assert.equal(alliances.classify('  GERMAN__EMPIRE  '), 'Axis');
  assert.equal(alliances.classify('saudi arabia'), 'Allies');
  assert.equal(alliances.classify('Soviet China'), 'Allies');
});

test('grouping preserves every nation once and sorts within sides', () => {
  const nations = ['Independent', 'Romania', 'France', 'Albania', 'Belgium', 'Argentina', 'Afghanistan']
    .map(name => ({name, id: name === 'Independent' ? null : name, population: 0}));
  const result = JSON.parse(JSON.stringify(alliances.group(nations)));
  assert.deepEqual(result.map(g => g.name), ['Allies', 'Axis', 'Other']);
  assert.deepEqual(result.map(g => g.nations.map(n => n.name)), [
    ['Albania', 'France'], ['Argentina', 'Romania'], ['Afghanistan', 'Belgium', 'Independent']
  ]);
  assert.equal(result.flatMap(g => g.nations).length, nations.length);
  assert.equal(nations[0].name, 'Independent');
});

test('nations sort by descending population within their side, with alphabetical ties', () => {
  const nations = [
    {name: 'Albania', population: 10}, {name: 'France', population: 300},
    {name: 'Greece', population: 10}, {name: 'Germany', population: 600},
    {name: 'Argentina', population: 20}, {name: 'China', population: 80},
    {name: 'Belgium', population: 0},
  ].map(n => ({id: n.name, ...n}));
  const names = JSON.parse(JSON.stringify(alliances.group(nations))).map(g => g.nations.map(n => n.name));
  assert.deepEqual(names, [['France', 'Albania', 'Greece'], ['Germany', 'Argentina'], ['China', 'Belgium']]);
});
