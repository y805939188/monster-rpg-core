import { pathToFileURL } from 'node:url';
import { loadSpeciesCatalog, createMonsters, createOwnership, admitMonster, enableLearning, enableInventory, addItems,
  enableGrowth, initializeGrowth, awardExperience, resolveLearning, resolveEvolution, evolveWithItem } from 'monster-rpg-core';

export function growthFixture(second = false) {
  const catalog = loadSpeciesCatalog([{ id: 'sproutlet', name: 'Sproutlet' }, { id: 'cloudbloom', name: 'Cloudbloom' },
    { id: 'sparkcub', name: 'Sparkcub' }, { id: 'emberlynx', name: 'Emberlynx' }]);
  const [one, two] = createMonsters(catalog, [{ id: 'one', speciesId: 'sproutlet', nickname: 'Sprig' }, { id: 'two', speciesId: 'sparkcub' }]);
  let state = createOwnership(catalog, { totalCapacity: 5, partyCapacity: 2 });
  state = admitMonster(state, one, { currentHP: 7, maxHP: 10, condition: 'weary' });
  state = admitMonster(state, two, { currentHP: 0, maxHP: 9, condition: null });
  state = enableLearning(state, { slotCapacity: 1, moves: ['bud', 'tone', 'flare', 'glow'].map(id => ({ id, name: id,
    resource: second ? { kind: 'none' } : { kind: 'finite', maximum: 3 } })) });
  state = addItems(enableInventory(state, { stackCapacity: 1, stackLimit: 3, items: [
    { id: 'sunstone', name: 'Sunstone', effect: { kind: 'evolution' } },
  ] }), 'sunstone', 3);
  const rules = { thresholds: second ? [0, 2, 6] : [0, 5, 15, 30], species: [
    { speciesId: 'sproutlet', maxHP: second ? [4, 6, 8] : [10, 14, 18, 22], learnset: [
      { level: 1, moveId: 'bud' }, { level: 2, moveId: 'tone' }, { level: 3, moveId: 'flare' },
    ], evolution: { kind: 'level', level: 3, toSpeciesId: 'cloudbloom' } },
    { speciesId: 'cloudbloom', maxHP: second ? [3, 4, 5] : [8, 9, 12, 16], learnset: [{ level: 1, moveId: 'glow' }], evolution: null },
    { speciesId: 'sparkcub', maxHP: second ? [5, 7, 9] : [9, 12, 15, 18], learnset: [], evolution: { kind: 'item', itemId: 'sunstone', toSpeciesId: 'emberlynx' } },
    { speciesId: 'emberlynx', maxHP: second ? [2, 3, 4] : [7, 10, 13, 16], learnset: [], evolution: null },
  ] };
  return { state, rules, catalog };
}
export function runGrowthExample() {
  return [false, true].map(second => {
    const f = growthFixture(second); let state = initializeGrowth(enableGrowth(f.state, f.rules), 'one');
    state = initializeGrowth(state, 'two');
    state = awardExperience(state, 'one', second ? 6 : 15);
    state = resolveLearning(state, 1, 'one', { kind: 'decline' });
    state = resolveLearning(state, 2, 'one', { kind: 'replace', moveId: 'bud' });
    state = resolveEvolution(state, 1, 'one', 'cloudbloom', 'accept');
    state = resolveLearning(state, 3, 'one', { kind: 'decline' });
    state = evolveWithItem(state, 'two', 'sunstone');
    return { variant: second ? 'short-none' : 'long-finite', level: state.growth.individuals[0].level,
      species: state.owned.map(e => e.monster.speciesId), hp: state.owned.map(e => e.health.currentHP),
      maxHP: state.owned.map(e => e.health.maxHP), remaining: state.training.individuals[0].knownMoves[0].remaining,
      stones: state.inventory.stacks[0].count };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(runGrowthExample()));
