const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test} = require('node:test');
const Production = vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '../site/production-model.js'), 'utf8')}\nProduction;`);
const plain = value => JSON.parse(JSON.stringify(value));
const scenario = overrides => ({hours: 24, tier: 1, baseline: 'tier1', stacking: 'linear', rounding: 'fractional', rubber: 'latex', counts: {steel: 1, gasoline: 1, rubber: 1}, supply: {iron: 12960, coal: 8640, latex: 5760, oil: 5760}, ...overrides});

test('documented two-minute recipes give 720 batches per machine per day', () => {
  const result = Production.calculate(scenario());
  assert.deepEqual(plain(result.lines.map(l => l.capacity)), [[1440, 2880], [2880, 4320], [2880, 5760]]);
  assert.deepEqual(plain(result.demand), {iron: 12960, coal: 8640, latex: 5760, oil: 5760});
  assert.equal(result.ratio, 1);
});
test('tier 3 linear upgrades shorten cycles and increase yield using the selected baseline', () => {
  const result = Production.calculate(scenario({tier: 3}));
  assert.equal(result.seconds, 96);
  assert.equal(result.outputFactor, 1.2);
  assert.equal(result.lines[0].cycles, 900);
  assert.deepEqual(plain(result.lines[0].capacity), [2160, 4320]);
  const firstBonus = Production.calculate(scenario({tier: 1, baseline: 'tier0'}));
  assert.equal(firstBonus.seconds, 108);
  assert.equal(firstBonus.outputFactor, 1.1);
});
test('compound assumptions and per-batch rounding are independent controls', () => {
  const result = Production.calculate(scenario({tier: 3, stacking: 'compound', rounding: 'floor'}));
  assert.ok(Math.abs(result.seconds - 97.2) < 1e-9);
  assert.equal(result.lines[0].min, 2);
  assert.equal(result.lines[0].max, 4);
});
test('refinery and alternative rubber recipe share one oil budget', () => {
  const result = Production.calculate(scenario({rubber: 'oil', supply: {iron: 12960, coal: 15120, latex: 0, oil: 14400}}));
  assert.equal(result.demand.oil, 28800);
  assert.equal(result.ratio, 2 / 3);
  assert.equal(result.used.oil, 14400);
  assert.equal(result.lines[1].supportedCycles, 360);
  assert.equal(result.lines[2].supportedCycles, 360);
});
test('whole batches never overspend any material at a fractional allocation', () => {
  const result = Production.calculate(scenario({supply: {iron: 101, coal: 32, latex: 400, oil: 40}}));
  for (const k of Object.keys(result.supply)) assert.ok(result.used[k] <= result.supply[k]);
  for (const l of result.lines) assert.ok(Number.isInteger(l.supportedCycles));
  assert.deepEqual(plain(result.bottlenecks), ['iron', 'coal', 'latex', 'oil']);
});
test('shortages constrain only affected products and unused inputs do not constrain production', () => {
  const emptyOil = Production.calculate(scenario({supply: {iron: 12960, coal: 8640, latex: 5760, oil: 0}}));
  assert.equal(emptyOil.lines[1].supportedCycles, 0);
  assert.equal(emptyOil.lines[0].supportedCycles, 720);
  assert.equal(emptyOil.lines[2].supportedCycles, 720);
  const onlySteel = Production.calculate(scenario({counts: {steel: 1, gasoline: 0, rubber: 0}, supply: {iron: 12960, coal: 6480, latex: 0, oil: 0}}));
  assert.equal(onlySteel.ratio, 1);
});
test('zero hours or machines produce no batches or material demand', () => {
  for (const settings of [scenario({hours: 0}), scenario({counts: {steel: 0, gasoline: 0, rubber: 0}})]) {
    const result = Production.calculate(settings);
    assert.ok(result.lines.every(l => l.cycles === 0 && l.capacity[1] === 0));
    assert.ok(Object.values(result.demand).every(v => v === 0));
  }
});
test('partial cycles are excluded separately for each parallel machine', () => {
  const result = Production.calculate(scenario({hours: 0.05, counts: {steel: 3, gasoline: 0, rubber: 0}}));
  assert.equal(result.lines[0].cycles, 3);
  assert.equal(result.demand.iron, 54);
});
