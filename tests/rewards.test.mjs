import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EncounterSession,
  enableBattleRewards,
  resolveLearning,
  resolveEvolution,
  initializeGrowth,
  admitMonster,
  createMonsters,
  depositMonster,
  withdrawMonster,
  reorderParty,
  reviveMonster,
} from 'monster-rpg-core';
import {
  rewardFixture,
  rewardMove,
  resolveRewardChoices,
  runRewardExample,
} from '../examples/rewards.mjs';
import { scriptedActionAdapter } from '../examples/battle-actions.mjs';
import { completeFixture, capture, flee } from '../examples/complete-battle.mjs';

const stock = (s) =>
  s.state.inventory.stacks.find((e) => e.itemId === 'sunstone')?.count ?? 0;
function unchanged(session, fn) {
  const state = session.state;
  const revision = session.revision;
  assert.throws(fn);
  assert.equal(session.state, state);
  assert.equal(session.revision, revision);
}
function open(steps, trainer = false, second = false) {
  const f = rewardFixture(second);
  const log = [];
  const session = new EncounterSession(f.state, scriptedActionAdapter(steps, log));
  session.begin(trainer ? f.trainer : f.wild, trainer ? undefined : 0);
  return { ...f, session, log };
}
function victory(command) {
  const checkpoint = structuredClone(command.checkpoint);
  if (command.action.kind === 'move') {
    const resource = checkpoint.party.find((e) => e.monster.id === command.action.actorId)
      .knownMoves[0];
    if (resource.remaining !== null) {
      resource.remaining--;
    }
  }
  if (command.action.kind === 'switch') {
    checkpoint.activeId = command.action.targetId;
  }
  checkpoint.opponents.forEach((e) => {
    e.health.currentHP = 0;
  });
  return {
    generation: command.generation,
    commandId: command.commandId,
    revision: command.revision,
    outcome: 'victory',
    checkpoint,
    participants: [...command.participants],
  };
}

test('victory awards only activated participants; bench excluded; final HP not healed, duplicate terminal does not award', () => {
  const { session } = open([{ damage: 10, actorHP: 2, outcome: 'victory' }]);
  session.act(rewardMove());
  assert.equal(session.state.growth.individuals[0].experience, 15);
  assert.equal(session.state.growth.individuals[1].experience, 0);
  assert.equal(session.state.owned[0].health.currentHP, 2);
  assert.equal(session.state.owned[0].health.maxHP, 18);
  assert.equal(session.activeRequest, undefined);
  const final = session.lastConfirmation;
  const state = session.state;
  assert.equal(session.confirm(final).status, 'already_applied');
  assert.equal(session.state, state);
  for (const bad of [
    { ...final, commandId: final.commandId + 1 },
    { ...final, revision: 0 },
    { ...final, generation: 9 },
    { ...final, participants: ['two'] },
  ]) {
    unchanged(session, () => session.confirm(bad));
  }
});

test('trainer completes once, batch XP includes every participant and choices stay ordered without half award', () => {
  const { session, trainer, wild } = open([{}, { damage: 10, outcome: 'victory' }], true);
  session.act({ kind: 'switch', actorId: 'one', targetId: 'two' });
  session.act(rewardMove('two'));
  assert.deepEqual(
    session.state.growth.individuals.map((e) => e.experience),
    [15, 15],
  );
  assert.deepEqual(session.lastConfirmation.participants, ['one', 'two']);
  assert.deepEqual(session.state.battleRewards.completedTrainers, ['reed-guide']);
  assert.equal(stock(session), 2);
  unchanged(session, () => session.begin(wild, 0)); // choices are exposed, never silently dropped
  const c = session.state.training.pending[0];
  session.commit(
    session.revision,
    resolveLearning(session.state, c.choiceId, c.instanceId, {
      kind: 'replace',
      moveId: 'bud',
    }),
  );
  const second = session.state.training.pending[0];
  session.commit(
    session.revision,
    resolveLearning(session.state, second.choiceId, second.instanceId, {
      kind: 'decline',
    }),
  );
  const evolution = session.state.growth.pending[0];
  session.commit(
    session.revision,
    resolveEvolution(
      session.state,
      evolution.choiceId,
      evolution.instanceId,
      evolution.toSpeciesId,
      'accept',
    ),
  );
  resolveRewardChoices(session);
  unchanged(session, () => session.begin(trainer));
  assert.equal(session.state.owned[0].monster.speciesId, 'cloudbloom');
  assert.equal(session.state.owned[0].health.currentHP, 7);
});

test('intentionally new wild battle awards again, old result cannot replay across generation; cap is bounded', () => {
  const { session, wild } = open([{ damage: 10, outcome: 'victory' }]);
  session.act(rewardMove());
  const prior = session.lastConfirmation;
  resolveRewardChoices(session);
  session.begin(wild, 0);
  unchanged(session, () => session.confirm(prior));
  session.act(rewardMove());
  assert.equal(session.state.growth.individuals[0].experience, 30);
  assert.equal(session.state.growth.individuals[0].level, 4);
  assert.equal(session.lastConfirmation.generation, 2);
  assert.equal(session.lastConfirmation.commandId, 2);
  session.begin(wild, 0);
  session.act(rewardMove());
  assert.equal(session.state.growth.individuals[0].experience, 30);
});

test('illegal participants, missing acknowledgments and arbitrary engine reward fields fault without rewards', () => {
  for (const corrupt of [
    (r) => {
      r.participants = ['one', 'two'];
    },
    (r) => {
      r.participants = ['missing'];
    },
    (r) => {
      r.participants = ['one', 'one'];
    },
    (r) => {
      r.participants = [];
    },
    (r) => {
      delete r.participants;
    },
    (r) => {
      r.reward = { experience: 999 };
    },
    (r) => {
      r.inventory = [];
    },
    (r) => {
      r.commandId++;
    },
  ]) {
    const f = rewardFixture();
    const session = new EncounterSession(f.state, {
      setup: () => ({
        execute(command) {
          const r = victory(command);
          corrupt(r);
          return r;
        },
        release() {},
      }),
    });
    session.begin(f.trainer);
    unchanged(session, () => session.act(rewardMove()));
    assert.equal(session.fault.reason, 'invalid_confirmation');
    assert.equal(stock(session), 1);
    assert.deepEqual(session.state.battleRewards.completedTrainers, []);
    assert.equal(session.state.growth.individuals[0].experience, 0);
    session.abandonFaultedEncounter();
  }
});

test('configured reward overflow after engine advance faults and preserves prior cost, never completes trainer', () => {
  const f = rewardFixture();
  const state = {
    ...f.state,
    inventory: { ...f.state.inventory, stacks: [{ itemId: 'sunstone', count: 3 }] },
  };
  const session = new EncounterSession(
    state,
    scriptedActionAdapter([{ damage: 1 }, { damage: 9, outcome: 'victory' }]),
  );
  session.begin(f.trainer);
  session.act(rewardMove());
  const retained = session.state;
  unchanged(session, () => session.act(rewardMove()));
  assert.equal(session.state.training.individuals[0].knownMoves[0].remaining, 2);
  assert.equal(session.abandonFaultedEncounter(), retained);
  assert.equal(stock(session), 3);
  assert.deepEqual(session.state.battleRewards.completedTrainers, []);
  assert.equal(session.state.growth.individuals[0].experience, 0);
});

test('terminal release failure withholds XP/items/choices/completion and blocks replay execution', () => {
  for (const kind of ['throw', 'scalar']) {
    const f = rewardFixture();
    let calls = 0;
    let fail = true;
    const session = new EncounterSession(f.state, {
      setup: () => ({
        execute(command) {
          calls++;
          return victory(command);
        },
        release() {
          if (fail) {
            if (kind === 'throw') {
              throw Error('partial release');
            }
            return 1;
          }
        },
      }),
    });
    session.begin(f.trainer);
    unchanged(session, () => session.act(rewardMove()));
    assert.equal(session.fault.reason, 'release_failed');
    unchanged(session, () => session.act(rewardMove()));
    assert.equal(calls, 1);
    assert.equal(session.state.growth.individuals[0].experience, 0);
    assert.equal(stock(session), 1);
    assert.equal(session.state.training.pending.length, 0);
    assert.equal(session.state.growth.pending.length, 0);
    assert.deepEqual(session.state.battleRewards.completedTrainers, []);
    fail = false;
    session.abandonFaultedEncounter();
    assert.equal(session.recoveryRequest, null);
  }
});

test('defeat gives no victory reward, penalties apply once, explicit host recovery supports two rules', () => {
  for (const second of [false, true]) {
    const { session, trainer } = open([{ partyHP: 0, outcome: 'defeat' }], true, second);
    session.act(rewardMove());
    assert.equal(stock(session), 0);
    assert.deepEqual(
      session.state.growth.individuals.map((e) => e.experience),
      [0, 0],
    );
    assert.deepEqual(session.state.battleRewards.completedTrainers, []);
    assert.deepEqual(
      session.state.owned.map((e) => e.health.currentHP),
      [0, 0],
    );
    assert.deepEqual(session.recoveryRequest, { requestId: 1, party: ['one', 'two'] });
    const last = session.lastConfirmation;
    const dead = session.state;
    session.confirm(last);
    assert.equal(session.state, dead);
    unchanged(session, () => session.begin(trainer));
    unchanged(session, () => session.commit(session.revision, dead));
    unchanged(session, () => session.recoverDefeat(2));
    session.recoverDefeat(1);
    assert.deepEqual(
      session.state.owned.map((e) => e.health.currentHP),
      second ? [4, 5] : [2, 2],
    );
    assert.equal(session.state.owned[0].health.condition, second ? null : 'weary');
    assert.equal(
      session.state.training.individuals[0].knownMoves[0].remaining,
      second ? null : 2,
    );
    assert.equal(session.recoveryRequest, null);
    unchanged(session, () => session.recoverDefeat(1));
    const recovered = session.state;
    session.confirm(last);
    assert.equal(session.state, recovered);
    session.begin(trainer); // defeat did not mark completion
  }
});

test('defeat cleanup failure cannot debit penalty or expose recovery; abandon is not defeat', () => {
  const f = rewardFixture();
  let fail = true;
  const script = scriptedActionAdapter([{ partyHP: 0, outcome: 'defeat' }]);
  const session = new EncounterSession(f.state, {
    setup(request) {
      const handle = script.setup(request);
      return {
        execute: (c) => handle.execute(c),
        release() {
          if (fail) {
            throw Error('release');
          }
          handle.release();
        },
      };
    },
  });
  session.begin(f.wild, 0);
  unchanged(session, () => session.act(rewardMove()));
  assert.equal(session.recoveryRequest, null);
  assert.equal(stock(session), 1);
  fail = false;
  session.abandonFaultedEncounter();
  assert.equal(session.state.owned[0].health.currentHP, 7);
  assert.equal(session.recoveryRequest, null);
});

test('capture, escape and ordinary cancellation never receive victory rewards/completion', () => {
  for (const outcome of ['captured', 'escaped', 'cancel']) {
    const f = completeFixture();
    const state = enableBattleRewards(f.state, {
      wild: { experience: 0, items: [{ itemId: 'moss-tonic', count: 1 }] },
      trainers: [],
      defeat: {
        penalty: [],
        recovery: {
          hp: { kind: 'fixed', amount: 1 },
          clearCondition: false,
          restoreResources: false,
        },
      },
    });
    const session = new EncounterSession(state, scriptedActionAdapter([{ outcome }]));
    session.begin(f.config, 0);
    if (outcome === 'cancel') {
      session.release();
    } else {
      session.act(outcome === 'captured' ? capture(true) : flee(true));
    }
    assert.equal(
      session.state.inventory.stacks.find((e) => e.itemId === 'moss-tonic').count,
      3,
    );
    assert.equal(session.state.owned.length, outcome === 'captured' ? 3 : 2);
    assert.equal(session.recoveryRequest, null);
    assert.deepEqual(session.state.battleRewards.completedTrainers, []);
  }
});

test('invalid reward content/state and setup refs fail before dispatch', () => {
  const f = rewardFixture();
  const { battleRewards, ...plain } = f.state;
  for (const corrupt of [
    (r) => {
      r.wild.experience = -1;
    },
    (r) => {
      r.wild.experience = Infinity;
    },
    (r) => {
      r.wild.experience = Number.MAX_SAFE_INTEGER + 1;
    },
    (r) => {
      r.trainers[0].reward.items[0].count = 4;
    },
    (r) => {
      r.trainers[0].reward.items[0].itemId = 'unknown';
    },
    (r) => {
      r.trainers.push(r.trainers[0]);
    },
    (r) => {
      r.defeat.recovery.hp.amount = 0;
    },
    (r) => {
      r.defeat.recovery.clearCondition = 1;
    },
    (r) => {
      r.defeat.penalty[0].count = 0;
    },
    (r) => {
      r.extra = true;
    },
  ]) {
    const rules = structuredClone(f.rules);
    corrupt(rules);
    assert.throws(() => enableBattleRewards(plain, rules));
  }
  const rules = structuredClone(f.rules);
  const enabled = enableBattleRewards(plain, rules);
  rules.wild.experience = 1;
  assert.equal(enabled.battleRewards.rules.wild.experience, 15);
  let calls = 0;
  const session = new EncounterSession(enabled, {
    setup() {
      calls++;
      return { release() {} };
    },
  });
  unchanged(session, () => session.begin({ ...f.trainer, trainerId: 'missing' }));
  const { trainerId, ...noId } = f.trainer;
  unchanged(session, () => session.begin(noId));
  assert.equal(calls, 0);
  for (const corrupt of [
    (s) => {
      s.battleRewards.completedTrainers = ['missing'];
    },
    (s) => {
      s.battleRewards.completedTrainers = ['reed-guide', 'reed-guide'];
    },
    (s) => {
      s.battleRewards.nextRecoveryId = 0;
    },
    (s) => {
      s.battleRewards.recovery = { requestId: 1, party: ['one'] };
    },
  ]) {
    const state = structuredClone(enabled);
    corrupt(state);
    assert.throws(() => new EncounterSession(state, scriptedActionAdapter([])));
  }
});

test('multi-owner pending choices retain every award and counter overflow rolls whole settlement back', () => {
  const f = rewardFixture();
  const [third] = createMonsters(f.state.catalog, [
    { id: 'three', speciesId: 'sproutlet' },
  ]);
  let state = admitMonster({ ...f.state, partyCapacity: 3 }, third, {
    currentHP: 5,
    maxHP: 10,
    condition: null,
  });
  state = initializeGrowth(state, 'three');
  const session = new EncounterSession(
    state,
    scriptedActionAdapter([{}, { damage: 10, outcome: 'victory' }]),
  );
  session.begin(f.wild, 0);
  session.act({ kind: 'switch', actorId: 'one', targetId: 'three' });
  session.act(rewardMove('three'));
  assert.deepEqual(
    session.state.growth.individuals.map((e) => e.experience),
    [15, 0, 15],
  );
  assert.deepEqual(
    session.state.training.pending.map((c) => c.instanceId),
    ['one', 'one', 'three', 'three'],
  );
  assert.deepEqual(
    session.state.growth.pending.map((c) => c.instanceId),
    ['one', 'three'],
  );
  resolveRewardChoices(session);
  assert.equal(session.state.training.pending.length, 0);
  assert.equal(session.state.growth.pending.length, 0);
  const exhausted = {
    ...f.state,
    growth: {
      ...f.state.growth,
      nextChoiceId: Number.MAX_SAFE_INTEGER,
      resolvedThrough: Number.MAX_SAFE_INTEGER - 1,
    },
  };
  const bad = new EncounterSession(
    exhausted,
    scriptedActionAdapter([{ damage: 10, outcome: 'victory' }]),
  );
  bad.begin(f.trainer);
  unchanged(bad, () => bad.act(rewardMove()));
  assert.equal(stock(bad), 1);
});

test('no-UI integrated rewards and defeat use two substantial original configs', () => {
  assert.deepEqual(runRewardExample(), [
    {
      rules: 'long-fixed',
      levels: [3, 3],
      choices: ['tone', 'flare'],
      completed: ['reed-guide'],
      fainted: [0, 0],
      recovered: [2, 2],
      stones: 1,
    },
    {
      rules: 'short-full',
      levels: [3, 3],
      choices: ['tone', 'flare'],
      completed: ['reed-guide'],
      fainted: [0, 0],
      recovered: [8, 9],
      stones: 1,
    },
  ]);
});

test('later participant overflow rolls back earlier computed XP/items/choices in the same terminal batch', () => {
  const f = rewardFixture();
  const [third] = createMonsters(f.state.catalog, [
    { id: 'three', speciesId: 'sproutlet' },
  ]);
  let state = initializeGrowth(
    admitMonster({ ...f.state, partyCapacity: 3 }, third, {
      currentHP: 5,
      maxHP: 10,
      condition: null,
    }),
    'three',
  );
  state = {
    ...state,
    growth: {
      ...state.growth,
      nextChoiceId: Number.MAX_SAFE_INTEGER - 1,
      resolvedThrough: Number.MAX_SAFE_INTEGER - 2,
    },
  };
  const session = new EncounterSession(
    state,
    scriptedActionAdapter([{}, { damage: 10, outcome: 'victory' }]),
  );
  session.begin(f.trainer);
  session.act({ kind: 'switch', actorId: 'one', targetId: 'three' });
  const checkpoint = session.state;
  unchanged(session, () => session.act(rewardMove('three')));
  assert.deepEqual(
    session.state.growth.individuals.map((e) => e.experience),
    [0, 0, 0],
  );
  assert.equal(stock(session), 1);
  assert.equal(session.state.training.pending.length, 0);
  assert.deepEqual(session.state.battleRewards.completedTrainers, []);
  assert.equal(session.abandonFaultedEncounter(), checkpoint);
});

test('recovery counter bounds, repeated defeat IDs, finite resource restore and immutable request', () => {
  const f = rewardFixture();
  const state = structuredClone(f.state);
  state.battleRewards.rules.defeat.recovery = {
    hp: { kind: 'full' },
    clearCondition: true,
    restoreResources: true,
  };
  const session = new EncounterSession(
    state,
    scriptedActionAdapter([{ partyHP: 0, outcome: 'defeat' }]),
  );
  session.begin(f.wild, 0);
  session.act(rewardMove());
  const request = session.recoveryRequest;
  assert.throws(() => {
    request.party[0] = 'two';
  }, TypeError);
  session.recoverDefeat(request.requestId);
  assert.equal(session.state.training.individuals[0].knownMoves[0].remaining, 3);
  assert.equal(session.state.owned[0].health.condition, null);
  session.begin(f.wild, 0);
  session.act(rewardMove());
  assert.equal(session.recoveryRequest.requestId, 2);
  unchanged(session, () => session.recoverDefeat(1));
  session.recoverDefeat(2);
  assert.equal(stock(session), 0);
  const exhausted = {
    ...state,
    battleRewards: { ...state.battleRewards, nextRecoveryId: Number.MAX_SAFE_INTEGER },
  };
  const bad = new EncounterSession(
    exhausted,
    scriptedActionAdapter([{ partyHP: 0, outcome: 'defeat' }]),
  );
  bad.begin(f.wild, 0);
  unchanged(bad, () => bad.act(rewardMove()));
  assert.equal(bad.recoveryRequest, null);
  assert.equal(stock(bad), 1);
});

test('reward acknowledgment aliases and engine reentrancy cannot mutate participant authority or trigger recovery', () => {
  const f = rewardFixture();
  let session;
  let result;
  session = new EncounterSession(f.state, {
    setup: () => ({
      execute(command) {
        assert.deepEqual(command.participants, ['one']);
        assert.throws(() => command.participants.push('two'), TypeError);
        assert.throws(() => session.recoverDefeat(1));
        assert.throws(() => session.commit(session.revision, f.state));
        assert.throws(() => session.act(rewardMove()));
        result = victory(command);
        return result;
      },
      release() {
        assert.throws(() => session.recoverDefeat(1));
      },
    }),
  });
  session.begin(f.wild, 0);
  session.act(rewardMove());
  result.participants[0] = 'two';
  assert.deepEqual(session.lastConfirmation.participants, ['one']);
  assert.equal(session.state.growth.individuals[1].experience, 0);
  assert.throws(() => {
    session.state.battleRewards.rules.wild.experience = 999;
  }, TypeError);
});

test('rewards without XP need no growth/inventory; safe maximum XP caps and unregistered party rejects before setup', () => {
  const f = rewardFixture();
  const state = structuredClone(f.state);
  state.battleRewards.rules.wild.experience = Number.MAX_SAFE_INTEGER;
  const session = new EncounterSession(
    state,
    scriptedActionAdapter([{ damage: 10, outcome: 'victory' }]),
  );
  session.begin(f.wild, 0);
  session.act(rewardMove());
  assert.equal(session.state.growth.individuals[0].experience, 30);
  const unregistered = structuredClone(f.state);
  unregistered.growth.individuals.pop();
  let setups = 0;
  const bad = new EncounterSession(unregistered, {
    setup() {
      setups++;
      return { release() {} };
    },
  });
  unchanged(bad, () => bad.begin(f.wild, 0));
  assert.equal(setups, 0);
  const { battleRewards, growth, inventory, ...plain } = f.state;
  const minimal = enableBattleRewards(plain, {
    wild: { experience: 0, items: [] },
    trainers: [],
    defeat: {
      penalty: [],
      recovery: {
        hp: { kind: 'fixed', amount: 1 },
        clearCondition: false,
        restoreResources: false,
      },
    },
  });
  const zero = new EncounterSession(
    minimal,
    scriptedActionAdapter([{ damage: 10, outcome: 'victory' }]),
  );
  zero.begin(f.wild, 0);
  zero.act(rewardMove());
  assert.equal(zero.state.growth, undefined);
  assert.equal(zero.state.inventory, undefined);
});

test('public ownership transitions cannot return inconsistent pending-recovery state; work after explicit recovery', () => {
  const f = rewardFixture();
  const [third] = createMonsters(f.state.catalog, [
    { id: 'three', speciesId: 'sparkcub' },
  ]);
  const state = depositMonster(
    admitMonster({ ...f.state, partyCapacity: 3 }, third, {
      currentHP: 0,
      maxHP: 9,
      condition: null,
    }),
    'three',
  );
  const session = new EncounterSession(
    state,
    scriptedActionAdapter([{ partyHP: 0, outcome: 'defeat' }]),
  );
  session.begin(f.wild, 0);
  session.act(rewardMove());
  const dead = session.state;
  const before = structuredClone(dead);
  for (const operation of [
    () => depositMonster(dead, 'one'),
    () => reorderParty(dead, ['two', 'one']),
    () => withdrawMonster(dead, 'three'),
    () => reviveMonster(dead, 'one', 2),
  ]) {
    assert.throws(operation, RangeError);
    assert.deepEqual(dead, before);
  }
  // Valid no-op transitions remain valid snapshots.
  assert.doesNotThrow(
    () =>
      new EncounterSession(reorderParty(dead, ['one', 'two']), {
        setup: () => ({ release() {} }),
      }),
  );
  session.recoverDefeat(session.recoveryRequest.requestId);
  const recovered = session.state;
  const deposited = depositMonster(recovered, 'one');
  assert.deepEqual(deposited.party, ['two']);
  const reordered = reorderParty(recovered, ['two', 'one']);
  assert.deepEqual(reordered.party, ['two', 'one']);
  const withdrawn = withdrawMonster(recovered, 'three');
  assert.deepEqual(withdrawn.party, ['one', 'two', 'three']);
  const revived = reviveMonster(recovered, 'three', 2);
  assert.equal(revived.owned[2].health.currentHP, 2);
  for (const output of [deposited, reordered, withdrawn, revived]) {
    assert.doesNotThrow(
      () => new EncounterSession(output, { setup: () => ({ release() {} }) }),
    );
  }
});
