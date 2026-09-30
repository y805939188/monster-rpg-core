import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { loadSpeciesCatalog, createMonsters, createOwnership, admitMonster, depositMonster, withdrawMonster, reorderParty,
  enableLearning, enableInventory, addItems, enableGrowth, initializeGrowth, enableBattleRewards,
  EncounterSession, resolveLearning, resolveEvolution, evolveWithItem } from 'monster-rpg-core';
import { growthFixture } from './growth.mjs';
import { scriptedActionAdapter, checkpointActionAdapter } from './battle-actions.mjs';

function fixture(second) {
  const catalog = loadSpeciesCatalog([{ id: 'sproutlet', name: 'Sproutlet' }, { id: 'cloudbloom', name: 'Cloudbloom' },
    { id: 'sparkcub', name: 'Sparkcub' }, { id: 'emberlynx', name: 'Emberlynx' }]);
  const [one, two] = createMonsters(catalog, [{ id: 'one', speciesId: 'sproutlet', nickname: 'Sprig' }, { id: 'two', speciesId: 'sproutlet', nickname: 'Leaf' }]);
  let state = createOwnership(catalog, { totalCapacity: 3, partyCapacity: 2 });
  state = admitMonster(state, one, { currentHP: 7, maxHP: 10, condition: 'weary' });
  state = admitMonster(state, two, { currentHP: 3, maxHP: 10, condition: null });
  state = enableLearning(state, { slotCapacity: 1, moves: ['bud', 'tone', 'flare', 'glow'].map(id => ({ id, name: id,
    resource: second ? { kind: 'none' } : { kind: 'finite', maximum: 3 } })) });
  state = enableInventory(state, { stackCapacity: 3, stackLimit: 5, items: [
    { id: 'orb', name: 'Reed Orb', effect: { kind: 'capture' } },
    { id: 'tonic', name: 'Moss Tonic', effect: { kind: 'heal', amount: 4 } },
    { id: 'sunstone', name: 'Sunstone', effect: { kind: 'evolution' } },
  ] });
  state = addItems(addItems(addItems(state, 'orb', 3), 'tonic', 3), 'sunstone', 1);
  state = initializeGrowth(initializeGrowth(enableGrowth(state, growthFixture(second).rules), 'one'), 'two');
  return enableBattleRewards(state, { wild: { experience: second ? 6 : 15, items: [] },
    trainers: [{ id: 'guide', reward: { experience: second ? 6 : 15, items: [] } }],
    defeat: { penalty: [{ itemId: 'orb', count: 1 }], recovery: {
      hp: second ? { kind: 'full' } : { kind: 'fixed', amount: 2 }, clearCondition: second, restoreResources: second,
    } } });
}
const opponent = id => ({ monster: { id, speciesId: 'sparkcub', nickname: id }, health: { currentHP: 10, maxHP: 10, condition: null }, knownMoves: [], visible: true });
const wild = id => ({ kind: 'wild', candidates: [opponent(id)] });
const move = (id, target, moveId = 'bud') => ({ kind: 'move', actorId: id, moveId, targetId: target });
const capture = (id, success) => ({ kind: 'capture', actorId: 'one', targetId: id, itemId: 'orb', success });
const flee = success => ({ kind: 'flee', actorId: 'one', success });
const count = (s, id) => s.inventory.stacks.find(e => e.itemId === id)?.count ?? 0;
function debitMove(checkpoint, index) { const move = checkpoint.party[index].knownMoves[0]; if (move.remaining !== null) move.remaining--; }

// Same contract, independent result sources: small scripted deltas or authored final frames.
function adapter(mode, log) {
  return { setup(request) {
    const id = request.opponents[0].monster.id;
    const base = { party: structuredClone(request.party), opponents: structuredClone(request.opponents), activeId: 'one' };
    let steps = []; let frames = [];
    if (id === 'wildling') {
      steps = [{ damage: 2 }, { actorHP: 3 }, { targetHP: 5, outcome: 'captured' }];
      const first = structuredClone(base); debitMove(first, 0); first.opponents[0].health.currentHP = 8;
      const failed = structuredClone(first); failed.party[0].health.currentHP = 3;
      const captured = structuredClone(failed); captured.opponents[0].health.currentHP = 5;
      frames = [{ checkpoint: first, outcome: 'continue' }, { checkpoint: failed, outcome: 'continue' }, { checkpoint: captured, outcome: 'captured' }];
    } else if (id === 'guide-pet') {
      steps = [{}, { actorHP: 2 }, { damage: 10, outcome: 'victory' }];
      const switched = structuredClone(base); switched.activeId = 'two';
      const before = structuredClone(switched.party[1]); const after = structuredClone(before);
      after.health.currentHP = Math.min(after.health.maxHP, after.health.currentHP + 4);
      const treated = structuredClone(switched); treated.party[1].health.currentHP = 2;
      const won = structuredClone(treated); debitMove(won, 1); won.opponents[0].health.currentHP = 0;
      frames = [{ checkpoint: switched, outcome: 'continue' }, { checkpoint: treated, outcome: 'continue', medicine: { before, after } },
        { checkpoint: won, outcome: 'victory', participants: ['one', 'two'] }];
    } else if (id === 'roamer') {
      steps = [{ actorHP: 2 }, { outcome: 'escaped' }];
      const hurt = structuredClone(base); hurt.party[0].health.currentHP = 2;
      frames = [{ checkpoint: hurt, outcome: 'continue' }, { checkpoint: hurt, outcome: 'escaped' }];
    } else if (id === 'last-trial') {
      steps = [{ partyHP: 0, outcome: 'defeat' }];
      const defeated = structuredClone(base); debitMove(defeated, 0); defeated.party.forEach(e => { e.health.currentHP = 0; });
      frames = [{ checkpoint: defeated, outcome: 'defeat' }];
    }
    return (mode === 'script' ? scriptedActionAdapter(steps, log) : checkpointActionAdapter(frames, log)).setup(request);
  } };
}

export function runAcceptance(second = false, mode = 'script') {
  let initial = fixture(second); const stages = []; const log = [];
  assert.equal(initial.owned[0].monster.speciesId, initial.owned[1].monster.speciesId);
  assert.notEqual(initial.owned[0].monster.id, initial.owned[1].monster.id);
  assert.notEqual(initial.owned[0].health.currentHP, initial.owned[1].health.currentHP);
  initial = withdrawMonster(depositMonster(initial, 'two'), 'two'); initial = reorderParty(initial, ['two', 'one']);
  initial = reorderParty(initial, ['one', 'two']); stages.push('create-and-party');
  const session = new EncounterSession(initial, adapter(mode, log));
  const unchanged = operation => { const before = session.state; const rev = session.revision; const calls = log.length;
    assert.throws(operation); assert.equal(session.state, before); assert.equal(session.revision, rev); assert.equal(log.length, calls); };
  const commit = next => session.commit(session.revision, next);
  session.begin(wild('wildling'), 0); assert.ok(session.state.collection.seen.includes('sparkcub'));
  assert.ok(!session.state.collection.acquired.includes('sparkcub')); unchanged(() => session.serialize());
  session.act(move('one', 'wildling')); session.act(capture('wildling', false));
  assert.equal(count(session.state, 'orb'), 2); assert.equal(session.state.owned.length, 2);
  const failed = session.lastConfirmation; const checkpoint = session.state;
  assert.equal(session.confirm(failed).status, 'already_applied'); assert.equal(session.state, checkpoint);
  unchanged(() => session.confirm({ ...failed, outcome: 'captured' }));
  session.act(capture('wildling', true)); assert.equal(count(session.state, 'orb'), 1);
  assert.equal(session.state.owned.length, 3); assert.deepEqual(session.state.party, ['one', 'two']);
  assert.equal(session.state.owned[2].health.currentHP, 5); assert.ok(session.state.collection.acquired.includes('sparkcub'));
  session.confirm(session.lastConfirmation); assert.equal(session.state.owned.length, 3); unchanged(() => session.confirm(failed));
  stages.push('wild-failed-success-capture-storage');

  const trainer = { kind: 'trainer', trainerId: 'guide', opponents: [opponent('guide-pet')] };
  session.begin(trainer); unchanged(() => session.act(capture('guide-pet', true))); unchanged(() => session.act(flee(true)));
  session.act({ kind: 'switch', actorId: 'one', targetId: 'two' });
  assert.equal(session.state.owned[1].health.currentHP, 3);
  session.act({ kind: 'medicine', actorId: 'two', targetId: 'two', itemId: 'tonic' });
  assert.equal(session.state.owned[1].health.currentHP, 2); assert.equal(count(session.state, 'tonic'), 2);
  session.act(move('two', 'guide-pet')); const terminal = session.lastConfirmation;
  assert.deepEqual(session.state.growth.individuals.map(e => e.level), [3, 3]);
  assert.deepEqual(session.state.owned.slice(0, 2).map(e => e.health.currentHP), [3, 2]);
  const rewarded = session.state; session.confirm(terminal); assert.equal(session.state, rewarded);
  const pendingSave = session.serialize(); const oldRevision = session.revision;
  session.restore(pendingSave); unchanged(() => session.confirm(terminal)); unchanged(() => session.commit(oldRevision, rewarded));
  assert.equal(session.state.training.pending.length, 4); unchanged(() => session.begin(wild('roamer'), 0));
  const decisions = [];
  while (session.state.training.pending.length || session.state.growth.pending.length) {
    if (session.state.training.pending.length) {
      const c = session.state.training.pending[0]; const replace = c.instanceId === 'one' && c.moveId === 'tone';
      commit(resolveLearning(session.state, c.choiceId, c.instanceId, replace ? { kind: 'replace', moveId: 'bud' } : { kind: 'decline' }));
      decisions.push(replace ? 'replace' : 'decline');
    } else {
      const c = session.state.growth.pending[0];
      commit(resolveEvolution(session.state, c.choiceId, c.instanceId, c.toSpeciesId, c.instanceId === 'one' ? 'accept' : 'decline'));
    }
  }
  assert.ok(decisions.includes('replace') && decisions.includes('decline'));
  assert.equal(session.state.owned[0].monster.id, 'one'); assert.equal(session.state.owned[0].monster.nickname, 'Sprig');
  assert.equal(session.state.owned[0].monster.speciesId, 'cloudbloom'); assert.equal(session.state.owned[1].monster.speciesId, 'sproutlet');
  unchanged(() => session.begin(trainer));
  commit(initializeGrowth(session.state, 'wildling')); commit(evolveWithItem(session.state, 'wildling', 'sunstone'));
  assert.equal(count(session.state, 'sunstone'), 0); assert.equal(session.state.owned[2].monster.speciesId, 'emberlynx');
  assert.ok(session.state.collection.acquired.includes('cloudbloom') && session.state.collection.acquired.includes('emberlynx'));
  stages.push('trainer-growth-learning-level-and-item-evolution');

  session.begin(wild('roamer'), 0); unchanged(() => session.act(capture('roamer', true))); // total full, no engine dispatch or stock loss
  session.act(flee(false)); assert.ok(session.activeRequest); session.act(flee(true)); assert.equal(session.activeRequest, undefined);
  stages.push('wild-flee-fail-success');
  session.begin(wild('last-trial'), 0); session.act(move('one', 'last-trial', 'tone'));
  assert.deepEqual(session.state.owned.slice(0, 2).map(e => e.health.currentHP), [0, 0]); assert.equal(count(session.state, 'orb'), 0);
  const deadSave = session.serialize(); session.restore(deadSave); session.recoverDefeat(session.recoveryRequest.requestId);
  unchanged(() => session.recoverDefeat(1)); stages.push('defeat-save-restore-explicit-recovery');
  const saved = session.serialize(); session.restore(saved); assert.equal(session.serialize(), saved);
  session.begin(wild('after-rest'), 0); session.release(); stages.push('save-restore-reencounter');
  assert.equal(log.length, 9);
  return { rules: second ? 'short-none-full' : 'long-finite-fixed', adapter: mode, stages,
    species: session.state.owned.map(e => e.monster.speciesId), hp: session.state.owned.map(e => e.health.currentHP),
    levels: session.state.growth.individuals.map(e => e.level), party: session.state.party,
    remaining: session.state.training.individuals[0].knownMoves[0].remaining, tonic: count(session.state, 'tonic') };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify([false, true].flatMap(second => ['script', 'frames'].map(mode => runAcceptance(second, mode)))));
}
