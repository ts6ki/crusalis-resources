'use strict';

// Membership follows the supplied nation-confirmation list, not historical alliances.
// Add renamed nations as explicit aliases here. Unlisted nations stay in Other.
const AllianceGroups = (() => {
  const normalize = name => name.toLowerCase().replace(/[_()]/g, ' ').replace(/\s+/g, ' ').trim();
  const confirmed = {
    Allies: [
      'USA', 'United States of America', 'United States',
      'Philippines', 'Philippines (USA)', 'American Philippines',
      'UK', 'United Kingdom', 'British Empire',
      'Egypt', 'Egypt (UK)', 'British Egypt',
      'France', 'Soviets', 'Soviet Union', 'USSR', 'Netherlands',
      'Indonesia', 'Indonesia (Dutch)', 'Dutch East Indies',
      'Yugoslavia', 'Norway', 'Albania', 'Greece',
      'Allied Spain', 'Republican Spain', 'Liberia', 'Saudi Arabia', 'Iraq',
      'Nationalist China', 'Communist China', 'Soviet China', 'Shaanxi', 'Shaanxi clique',
    ],
    Axis: [
      'Germany', 'German Empire', 'Slovakia', 'Slovakia (German)', 'Italy',
      'Japan', 'Empire of Japan', 'Manchuria', 'Manchuria (Japan)',
      'Finland', 'Romania', 'Hungary', 'Bulgaria', 'Thailand',
      'Axis Spain', 'Nationalist Spain', 'Argentina',
      'Switzerland', 'Confederacy of Switzerland', 'Iran',
      'Protectorate Of Bohemia Moravia',
    ],
  };
  const membership = new Map(Object.entries(confirmed).flatMap(([side, names]) =>
    names.map(name => [normalize(name), side])));
  const classify = name => membership.get(normalize(name)) || 'Other';
  function group(nations) {
    return ['Allies', 'Axis', 'Other'].map(name => ({
      name,
      nations: nations.filter(nation => classify(nation.name) === name).sort((a, b) =>
        Number(a.id === null) - Number(b.id === null) || b.population - a.population ||
        normalize(a.name).localeCompare(normalize(b.name), 'en')),
    }));
  }
  return {classify, group};
})();
