import test from 'node:test';
import assert from 'node:assert/strict';
import { enableGrowth, initializeGrowth, awardExperience, resolveEvolution, evolveWithItem, resolveLearning, useMove,
  EncounterSession, admitMonster, createMonsters, healMonster, useMedicine } from 'monster-rpg-core';
import { scriptedActionAdapter } from '../examples/battle-actions.mjs';
import { growthFixture, runGrowthExample } from '../examples/growth.mjs';

const setup = (second = false) => { const f = growthFixture(second); return initializeGrowth(enableGrowth(f.state, f.rules), 'one'); };
function unchanged(state, run) { const before = structuredClone(state); assert.throws(run); assert.deepEqual(state, before); }
function clearLearning(state) { while (state.training.pending.length) { const c = state.training.pending[0]; state = resolveLearning(state, c.choiceId, c.instanceId, { kind: 'decline' }); } return state; }
const adapter = { setup: () => ({ release() {} }) };

test('multi-level experience caps safely and HP growth never heals; second curve and no-resource rules work', () => {
  for (const second of [false, true]) {
    let state = setup(second); const before = state;
    state = useMove(state, 'one', 'bud', 1);
    state = awardExperience(state, 'one', Number.MAX_SAFE_INTEGER);
    assert.deepEqual(state.growth.individuals[0], { instanceId: 'one', experience: second ? 6 : 30, level: second ? 3 : 4 });
    assert.equal(state.owned[0].health.currentHP, second ? 4 : 7);
    assert.equal(state.owned[0].health.maxHP, second ? 8 : 22);
    assert.equal(state.training.individuals[0].knownMoves[0].remaining, second ? null : 2);
    assert.equal(before.growth.individuals[0].experience, 0);
  }
});

test('learning triggers queue in level/tie order, require explicit replacement/decline before evolution', () => {
  let state = awardExperience(setup(), 'one', 15);
  assert.deepEqual(state.training.pending.map(c => [c.choiceId, c.moveId]), [[1, 'tone'], [2, 'flare']]);
  assert.deepEqual(state.growth.pending, [{ choiceId: 1, instanceId: 'one', fromSpeciesId: 'sproutlet', toSpeciesId: 'cloudbloom', level: 3 }]);
  unchanged(state, () => resolveEvolution(state, 1, 'one', 'cloudbloom', 'accept'));
  unchanged(state, () => awardExperience(state, 'one', 1));
  state = resolveLearning(state, 1, 'one', { kind: 'replace', moveId: 'bud' });
  assert.deepEqual(state.training.individuals[0].knownMoves, [{ moveId: 'tone', remaining: 3 }]);
  state = resolveLearning(state, 2, 'one', { kind: 'decline' });
  state = resolveEvolution(state, 1, 'one', 'cloudbloom', 'accept');
  assert.equal(state.owned[0].monster.id, 'one'); assert.equal(state.owned[0].monster.nickname, 'Sprig');
  assert.equal(state.growth.individuals[0].experience, 15); assert.equal(state.owned[0].health.currentHP, 7);
  assert.equal(state.owned[0].health.maxHP, 12); assert.equal(state.owned[0].health.condition, 'weary');
  assert.equal(state.training.pending[0].moveId, 'glow'); assert.equal(state.training.pending[0].choiceId, 3);
  assert.ok(state.collection.acquired.includes('cloudbloom')); assert.ok(state.collection.seen.includes('cloudbloom'));
});

test('declined level evolution consumes exact choice, no reoffer on later gain/cap; no duplicate resolution', () => {
  let state = clearLearning(awardExperience(setup(), 'one', 15));
  for (const args of [[2, 'one', 'cloudbloom', 'accept'], [1, 'two', 'cloudbloom', 'accept'], [1, 'one', 'emberlynx', 'accept'], [1, 'one', 'cloudbloom', 'bad']]) {
    unchanged(state, () => resolveEvolution(state, ...args));
  }
  state = resolveEvolution(state, 1, 'one', 'cloudbloom', 'decline');
  unchanged(state, () => resolveEvolution(state, 1, 'one', 'cloudbloom', 'accept'));
  state = awardExperience(state, 'one', 15); assert.equal(state.growth.pending.length, 0);
  state = awardExperience(state, 'one', Number.MAX_SAFE_INTEGER); assert.equal(state.growth.pending.length, 0);
  assert.equal(state.owned[0].monster.speciesId, 'sproutlet');
});

test('HP shrink on evolution clamps absolute health, fainted remains zero, resources remain spent', () => {
  let state = useMove(setup(), 'one', 'bud', 2);
  state = clearLearning(awardExperience(state, 'one', 15)); state = healMonster(state, 'one', 100);
  state = resolveEvolution(state, 1, 'one', 'cloudbloom', 'accept');
  assert.equal(state.owned[0].health.currentHP, 12); assert.equal(state.training.individuals[0].knownMoves[0].remaining, 1);
  const f = growthFixture(); let fainted = initializeGrowth(enableGrowth(f.state, f.rules), 'two');
  fainted = awardExperience(fainted, 'two', 30); assert.equal(fainted.owned[1].health.currentHP, 0);
  fainted = evolveWithItem(fainted, 'two', 'sunstone'); assert.equal(fainted.owned[1].health.currentHP, 0);
  assert.equal(fainted.owned[1].health.maxHP, 16);
});

test('item evolution debits once only on valid success, rejects wrong/no stock/target/replay', () => {
  const f = growthFixture(); let state = initializeGrowth(enableGrowth(f.state, f.rules), 'two');
  for (const [id, item] of [['one', 'sunstone'], ['two', 'unknown'], ['missing', 'sunstone']]) unchanged(state, () => evolveWithItem(state, id, item));
  const empty = { ...state, inventory: { ...state.inventory, stacks: [] } };
  unchanged(empty, () => evolveWithItem(empty, 'two', 'sunstone'));
  unchanged(state, () => useMedicine(state, 'sunstone', 'two'));
  const prior = state; state = evolveWithItem(state, 'two', 'sunstone');
  assert.equal(state.inventory.stacks[0].count, 2); assert.equal(prior.inventory.stacks[0].count, 3);
  assert.equal(state.owned[1].monster.id, 'two'); assert.equal(state.owned[1].monster.speciesId, 'emberlynx');
  unchanged(state, () => evolveWithItem(state, 'two', 'sunstone'));
});

test('new enrollment is explicit; existing admission/battle lifecycle remain compatible and no competing state', () => {
  let state = setup(); const f = growthFixture();
  const [newborn] = createMonsters(f.catalog, [{ id: 'third', speciesId: 'sparkcub' }]);
  state = admitMonster(state, newborn, { currentHP: 13, maxHP: 20, condition: null });
  assert.equal(state.growth.individuals.length, 1); assert.equal(state.owned[2].health.currentHP, 13);
  state = initializeGrowth(state, 'third'); assert.equal(state.owned[2].health.currentHP, 9);
  unchanged(state, () => initializeGrowth(state, 'third'));
  const session = new EncounterSession(state, adapter);
  session.begin({ kind: 'wild', candidates: [{ monster: { id: 'enemy', speciesId: 'sparkcub', nickname: 'Wild' }, health: { currentHP: 5, maxHP: 5, condition: null }, knownMoves: [], visible: true }] }, 0);
  assert.throws(() => session.commit(session.revision, awardExperience(state, 'third', 1)));
  session.release(); session.commit(session.revision, awardExperience(session.state, 'third', 1));
  assert.equal(session.state.growth.individuals.find(e => e.instanceId === 'third').experience, 1);
});

test('malformed growth rules reject unknown refs, invalid curves/HP/order/cycles and mismatched item tags', () => {
  const changes = [r => { r.thresholds[0] = 1; }, r => { r.thresholds[1] = 0; }, r => { r.thresholds[1] = NaN; },
    r => { r.species[0].maxHP[0] = 0; }, r => { r.species[0].maxHP.pop(); }, r => { r.species.pop(); },
    r => { r.species[0].speciesId = 'missing'; }, r => { r.species[0].learnset[0].moveId = 'unknown'; },
    r => { r.species[0].learnset.reverse(); }, r => { r.species[0].evolution.toSpeciesId = 'missing'; },
    r => { r.species[1].evolution = { kind: 'level', level: 1, toSpeciesId: 'sproutlet' }; },
    r => { r.species[2].evolution.itemId = 'missing'; }, r => { r.species[0].evolution.level = 5; },
    r => { r.species[0].evolution.itemId = 'sunstone'; }, r => { r.extra = true; },
  ];
  for (const change of changes) { const f = growthFixture(); change(f.rules); unchanged(f.state, () => enableGrowth(f.state, f.rules)); }
  const f = growthFixture(); const state = structuredClone(f.state); state.inventory.rules.items[0].effect.kind = 'capture';
  unchanged(state, () => enableGrowth(state, f.rules));
});

test('external progression/choice snapshots validate XP-level-HP, ownership, references, sequence and eligibility', () => {
  const state = clearLearning(awardExperience(setup(), 'one', 15));
  const corruptions = [s => { s.growth.individuals[0].level = 4; }, s => { s.growth.individuals[0].experience = 31; },
    s => { s.growth.individuals[0].experience = Infinity; }, s => { s.growth.individuals[0].instanceId = 'missing'; },
    s => { s.growth.individuals.push(s.growth.individuals[0]); }, s => { s.owned[0].health.maxHP++; },
    s => { s.growth.pending[0].fromSpeciesId = 'sparkcub'; }, s => { s.growth.pending[0].toSpeciesId = 'emberlynx'; },
    s => { s.growth.pending[0].level = 2; }, s => { s.growth.pending[0].instanceId = 'two'; },
    s => { s.growth.pending[0].choiceId++; }, s => { s.growth.nextChoiceId++; }, s => { s.growth.resolvedThrough++; },
  ];
  for (const corrupt of corruptions) { const forged = structuredClone(state); corrupt(forged); assert.throws(() => new EncounterSession(forged, adapter)); }
});

test('zero/invalid amounts and rule input aliases; failure after computed growth remains atomic', () => {
  const f = growthFixture(); let state = enableGrowth(f.state, f.rules); f.rules.thresholds[1] = 99;
  assert.equal(state.growth.rules.thresholds[1], 5); state = initializeGrowth(state, 'one');
  assert.throws(() => { state.growth.individuals[0].level = 9; }, TypeError);
  assert.deepEqual(awardExperience(state, 'one', 0), state);
  for (const amount of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1]) unchanged(state, () => awardExperience(state, 'one', amount));
  const exhausted = { ...state, growth: { ...state.growth, nextChoiceId: Number.MAX_SAFE_INTEGER, resolvedThrough: Number.MAX_SAFE_INTEGER - 1 } };
  unchanged(exhausted, () => awardExperience(exhausted, 'one', 15));
});

test('no-UI example yields hand-computed independent rule outcomes', () => {
  assert.deepEqual(runGrowthExample(), [
    { variant: 'long-finite', level: 3, species: ['cloudbloom', 'emberlynx'], hp: [7, 0], maxHP: [12, 7], remaining: 3, stones: 2 },
    { variant: 'short-none', level: 3, species: ['cloudbloom', 'emberlynx'], hp: [4, 0], maxHP: [5, 2], remaining: null, stones: 2 },
  ]);
});


test('acyclic consecutive evolutions have stable new IDs and cannot resolve a different pending candidate', () => {
  const f = growthFixture(); f.rules.species[1].evolution = { kind: 'level', level: 2, toSpeciesId: 'emberlynx' };
  let state = initializeGrowth(enableGrowth(f.state, f.rules), 'one');
  state = clearLearning(awardExperience(state, 'one', 15));
  state = resolveEvolution(state, 1, 'one', 'cloudbloom', 'accept');
  assert.equal(state.growth.pending[0].choiceId, 2); assert.equal(state.growth.pending[0].toSpeciesId, 'emberlynx');
  unchanged(state, () => resolveEvolution(state, 2, 'one', 'emberlynx', 'accept')); // learning first
  state = clearLearning(state);
  unchanged(state, () => resolveEvolution(state, 1, 'one', 'cloudbloom', 'accept'));
  state = resolveEvolution(state, 2, 'one', 'emberlynx', 'accept');
  assert.equal(state.owned[0].monster.id, 'one'); assert.equal(state.owned[0].monster.speciesId, 'emberlynx');
  assert.equal(state.growth.pending.length, 0); assert.equal(state.growth.resolvedThrough, 2);
  assert.ok(state.collection.acquired.includes('cloudbloom')); assert.ok(state.collection.acquired.includes('emberlynx'));
});

test('equal-level learns keep authored order and known moves are not initialized twice', () => {
  const f = growthFixture(); f.rules.species[0].learnset[2].level = 2;
  let state = initializeGrowth(enableGrowth(f.state, f.rules), 'one');
  state = useMove(state, 'one', 'bud', 1); state = awardExperience(state, 'one', 5);
  assert.deepEqual(state.training.pending.map(c => c.moveId), ['tone', 'flare']);
  assert.equal(state.training.individuals[0].knownMoves[0].remaining, 2);
  state = clearLearning(state); state = awardExperience(state, 'one', 0);
  assert.equal(state.training.pending.length, 0); assert.equal(state.training.individuals[0].knownMoves[0].remaining, 2);
});

test('failed post-evolution learning generation never consumes item; last valid item removes stack', () => {
  const f = growthFixture(); f.rules.species[2].learnset = [{ level: 1, moveId: 'bud' }];
  f.rules.species[3].learnset = [{ level: 1, moveId: 'glow' }];
  let state = initializeGrowth(enableGrowth(f.state, f.rules), 'two');
  const exhausted = { ...state, training: { ...state.training, nextChoiceId: Number.MAX_SAFE_INTEGER, resolvedThrough: Number.MAX_SAFE_INTEGER - 1 } };
  unchanged(exhausted, () => evolveWithItem(exhausted, 'two', 'sunstone'));
  state = { ...state, inventory: { ...state.inventory, stacks: [{ itemId: 'sunstone', count: 1 }] } };
  state = evolveWithItem(state, 'two', 'sunstone'); assert.equal(state.inventory.stacks.length, 0);
  assert.equal(state.training.pending[0].instanceId, 'two'); assert.equal(state.training.pending[0].moveId, 'glow');
});

test('actual battle checkpoints preserve enrolled progression and do not grant growth rewards', () => {
  const state = setup(); const session = new EncounterSession(state, scriptedActionAdapter([{ damage: 1, actorHP: 3 }, { damage: 9, outcome: 'victory' }]));
  session.begin({ kind: 'wild', candidates: [{ monster: { id: 'enemy', speciesId: 'sparkcub', nickname: 'Wild' }, health: { currentHP: 10, maxHP: 10, condition: null }, knownMoves: [], visible: true }] }, 0);
  const action = { kind: 'move', actorId: 'one', moveId: 'bud', targetId: 'enemy' };
  session.act(action); session.act(action);
  assert.equal(session.state.owned[0].health.currentHP, 3); assert.equal(session.state.owned[0].health.maxHP, 10);
  assert.deepEqual(session.state.growth, state.growth); assert.equal(session.state.training.individuals[0].knownMoves[0].remaining, 1);
});
