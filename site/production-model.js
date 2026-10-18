'use strict';

// Assumptions are explicit inputs. No town-tier multiplier is applied to factories.
const Production = (() => {
  const recipes = {
    steel: {label: 'Steel', factory: 'Steel mills', min: 2, max: 4, inputs: {iron: 18, coal: 9}},
    gasoline: {label: 'Gasoline', factory: 'Oil refineries', min: 4, max: 6, inputs: {oil: 8}},
    rubber: {label: 'Rubber', factory: 'Rubber factories', min: 4, max: 8, inputs: {latex: 8, coal: 3}},
  };
  const materials = {iron: 'Iron', coal: 'Coal', latex: 'Latex', oil: 'Crude oil'};
  const bounded = (n, max, fallback = 0) => Number.isFinite(Number(n)) ? Math.min(max, Math.max(0, Number(n))) : fallback;

  function calculate(settings) {
    const hours = bounded(settings.hours, 24);
    const steps = Math.max(0, Math.trunc(bounded(settings.tier, 3, 1)) - (settings.baseline === 'tier1' ? 1 : 0));
    const durationFactor = settings.stacking === 'compound' ? 0.9 ** steps : 1 - 0.1 * steps;
    const outputFactor = settings.stacking === 'compound' ? 1.1 ** steps : 1 + 0.1 * steps;
    const seconds = 120 * durationFactor;
    const demand = Object.fromEntries(Object.keys(materials).map(k => [k, 0]));
    const lines = Object.entries(recipes).map(([key, recipe]) => {
      const count = Math.trunc(bounded(settings.counts[key], 10000));
      const inputs = key === 'rubber' && settings.rubber === 'oil' ? {oil: 32, coal: 12} : recipe.inputs;
      const cycles = Math.floor(hours * 3600 / seconds + 1e-9) * count;
      const round = settings.rounding === 'floor' ? Math.floor : settings.rounding === 'nearest' ? Math.round : n => n;
      const min = round(recipe.min * outputFactor), max = round(recipe.max * outputFactor);
      for (const [material, qty] of Object.entries(inputs)) demand[material] += cycles * qty;
      return {key, ...recipe, inputs, count, cycles, min, max};
    });
    const supply = Object.fromEntries(Object.keys(materials).map(k => [k, bounded(settings.supply[k], 1e12)]));
    // Split each scarce material proportionally by full-capacity demand.
    // Only lines using it are constrained; an iron shortage cannot stop a refinery.
    // This prevents two lines from spending the same oil or coal budget.
    const materialRatios = Object.fromEntries(Object.keys(materials).map(k => [k, demand[k] ? Math.min(1, supply[k] / demand[k]) : 1]));
    const used = Object.fromEntries(Object.keys(materials).map(k => [k, 0]));
    for (const line of lines) {
      const lineRatio = Math.min(1, ...Object.keys(line.inputs).map(k => materialRatios[k]));
      line.supportedCycles = Math.floor(line.cycles * lineRatio + 1e-9);
      for (const [k, qty] of Object.entries(line.inputs)) used[k] += line.supportedCycles * qty;
      line.capacity = [line.cycles * line.min, line.cycles * line.max];
      line.supported = [line.supportedCycles * line.min, line.supportedCycles * line.max];
    }
    const bottlenecks = Object.keys(materials).filter(k => materialRatios[k] < 1);
    const capacityCycles = lines.reduce((sum, l) => sum + l.cycles, 0);
    const ratio = capacityCycles ? lines.reduce((sum, l) => sum + l.supportedCycles, 0) / capacityCycles : 1;
    return {lines, seconds, outputFactor, demand, supply, used, ratio, bottlenecks};
  }
  return {recipes, materials, calculate};
})();
