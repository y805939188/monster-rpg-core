import test from 'node:test';
import assert from 'node:assert/strict';
import { EncounterSession, resolveLearning, resolveEvolution } from 'monster-rpg-core';
import { rewardFixture, rewardMove } from '../examples/rewards.mjs';
import { scriptedActionAdapter } from '../examples/battle-actions.mjs';
import { runSaveExample } from '../examples/save-roundtrip.mjs';

const idleAdapter = { setup: () => ({ release() {} }) };
function won() {
  const f = rewardFixture();
  const session = new EncounterSession(
    f.state,
    scriptedActionAdapter([{ damage: 10, outcome: 'victory' }]),
  );
  session.begin(f.trainer);
  session.act(rewardMove());
  return { ...f, session };
}
function unchanged(session, operation) {
  const state = session.state;
  const revision = session.revision;
  const last = session.lastConfirmation;
  assert.throws(operation);
  assert.equal(session.state, state);
  assert.equal(session.revision, revision);
  assert.equal(session.lastConfirmation, last);
}

test('canonical roundtrip preserves all optional state, definitions, counters, pending choices and completion', () => {
  const { session, state } = won();
  const json = session.serialize();
  const parsed = JSON.parse(json);
  assert.deepEqual(Object.keys(parsed), [
    'format',
    'version',
    'contentVersion',
    'rulesVersion',
    'state',
    'counters',
  ]);
  assert.equal(parsed.counters.nextCommandId, 2);
  assert.ok(parsed.state.collection);
  assert.equal(parsed.state.training.pending.length, 2);
  assert.equal(parsed.state.growth.pending.length, 1);
  assert.deepEqual(parsed.state.battleRewards.completedTrainers, ['reed-guide']);
  for (const absent of [
    'generation',
    'revision',
    'adapter',
    'lastConfirmation',
    'activeRequest',
  ]) {
    assert.equal(Object.hasOwn(parsed, absent), false);
  }
  const restored = new EncounterSession(state, idleAdapter);
  restored.restore(json);
  assert.deepEqual(restored.state, session.state);
  assert.equal(restored.serialize(), json);
  assert.equal(restored.lastConfirmation, undefined);
  assert.equal(restored.activeRequest, undefined);
  assert.throws(() => {
    restored.state.training.pending[0].moveId = 'bad';
  }, TypeError);
  assert.deepEqual(runSaveExample(), {
    stable: true,
    owned: ['one', 'two', 'enemy'],
    capturedHP: 5,
    capturedMaxHP: 11,
    level: 2,
    orbs: 2,
  });
});

test('restored learning/evolution choices resolve once; captured old revision cannot publish and rollback is explicit', () => {
  const { session } = won();
  const saved = session.serialize();
  const oldRevision = session.revision;
  const first = session.state.training.pending[0];
  const prepared = resolveLearning(session.state, first.choiceId, first.instanceId, {
    kind: 'decline',
  });
  session.restore(saved);
  unchanged(session, () => session.commit(oldRevision, prepared));
  session.commit(
    session.revision,
    resolveLearning(session.state, first.choiceId, first.instanceId, { kind: 'decline' }),
  );
  assert.throws(() =>
    resolveLearning(session.state, first.choiceId, first.instanceId, { kind: 'decline' }),
  );
  const second = session.state.training.pending[0];
  session.commit(
    session.revision,
    resolveLearning(session.state, second.choiceId, second.instanceId, {
      kind: 'decline',
    }),
  );
  const evolution = session.state.growth.pending[0];
  const evolutionSave = session.serialize();
  session.restore(evolutionSave);
  session.commit(
    session.revision,
    resolveEvolution(
      session.state,
      evolution.choiceId,
      evolution.instanceId,
      evolution.toSpeciesId,
      'decline',
    ),
  );
  assert.throws(() =>
    resolveEvolution(
      session.state,
      evolution.choiceId,
      evolution.instanceId,
      evolution.toSpeciesId,
      'accept',
    ),
  );
  session.restore(saved);
  assert.equal(session.state.training.pending[0].choiceId, first.choiceId); // rollback restores then-pending choice, not global dedup
});

test('pending defeat recovery survives idle save and resumes once through explicit controller recovery', () => {
  const f = rewardFixture();
  const defeated = new EncounterSession(
    f.state,
    scriptedActionAdapter([{ partyHP: 0, outcome: 'defeat' }]),
  );
  defeated.begin(f.wild, 0);
  defeated.act(rewardMove());
  const json = defeated.serialize();
  const restored = new EncounterSession(f.state, idleAdapter);
  restored.restore(json);
  assert.deepEqual(restored.recoveryRequest, defeated.recoveryRequest);
  assert.deepEqual(
    restored.state.owned.map((e) => e.health.currentHP),
    [0, 0],
  );
  assert.equal(restored.serialize(), json);
  restored.recoverDefeat(1);
  assert.deepEqual(
    restored.state.owned.map((e) => e.health.currentHP),
    [2, 2],
  );
  unchanged(restored, () => restored.recoverDefeat(1));
});

test('restore/newGame invalidate old confirmations and revisions; command IDs/generations never reset in current controller', () => {
  const f = rewardFixture(); // disable opt-in rewards for repeatable simple terminal commands
  const { battleRewards, ...state } = f.state;
  const session = new EncounterSession(
    state,
    scriptedActionAdapter([{ damage: 10, outcome: 'victory' }]),
  );
  const originalSave = session.serialize();
  session.begin(f.wild, 0);
  session.act(rewardMove());
  const old = session.lastConfirmation;
  const oldRevision = session.revision;
  session.restore(originalSave);
  unchanged(session, () => session.confirm(old));
  unchanged(session, () => session.commit(oldRevision, state));
  assert.equal(JSON.parse(session.serialize()).counters.nextCommandId, 2); // rollback cannot reuse command1
  session.begin(f.wild, 0);
  session.act(rewardMove());
  const second = session.lastConfirmation;
  assert.equal(second.commandId, 2);
  assert.equal(second.generation, old.generation + 2);
  session.newGame(state);
  unchanged(session, () => session.confirm(second));
  session.begin(f.wild, 0);
  session.act(rewardMove());
  assert.equal(session.lastConfirmation.commandId, 3);
  assert.equal(session.lastConfirmation.generation, second.generation + 2);
});

test('corrupt JSON/versions/shape/refs/numerics/queues reject before any state installation', () => {
  const { session } = won();
  const saved = session.serialize();
  for (const input of [
    null,
    {},
    '',
    '{',
    'null',
    '[]',
    '{"version":1}',
    saved.replace('"nextCommandId":2', '"nextCommandId":1e400'),
  ]) {
    unchanged(session, () => session.restore(input));
  }
  const corruptions = [
    (s) => {
      s.version = 2;
    },
    (s) => {
      s.contentVersion = 2;
    },
    (s) => {
      s.rulesVersion = 2;
    },
    (s) => {
      s.format = 'other';
    },
    (s) => {
      s.extra = true;
    },
    (s) => {
      s.counters.nextCommandId = 0;
    },
    (s) => {
      s.counters.nextCommandId = Number.MAX_SAFE_INTEGER + 1;
    },
    (s) => {
      s.counters.generation = 0;
    },
    (s) => {
      s.state.owned[0].monster.speciesId = 'unknown';
    },
    (s) => {
      s.state.owned.push(s.state.owned[0]);
    },
    (s) => {
      s.state.party = ['one', 'one'];
    },
    (s) => {
      s.state.owned[0].health.currentHP = 99;
    },
    (s) => {
      s.state.owned[0].health.currentHP = 0.5;
    },
    (s) => {
      s.state.training.individuals[0].knownMoves[0].remaining = -1;
    },
    (s) => {
      s.state.training.pending[0].moveId = 'unknown';
    },
    (s) => {
      s.state.training.pending.reverse();
    },
    (s) => {
      s.state.growth.pending[0].toSpeciesId = 'sparkcub';
    },
    (s) => {
      s.state.growth.individuals[0].level = 1;
    },
    (s) => {
      s.state.growth.nextChoiceId++;
    },
    (s) => {
      s.state.inventory.stacks[0].count = 0;
    },
    (s) => {
      s.state.collection.acquired.push('unknown');
    },
    (s) => {
      s.state.battleRewards.completedTrainers = ['unknown'];
    },
    (s) => {
      s.state.battleRewards.recovery = { requestId: 1, party: ['one'] };
    },
  ];
  for (const corrupt of corruptions) {
    const data = JSON.parse(saved);
    corrupt(data);
    unchanged(session, () => session.restore(JSON.stringify(data)));
  }
  assert.equal(session.serialize(), saved);
  assert.equal(session.confirm(session.lastConfirmation).status, 'already_applied');
  unchanged(session, () => session.newGame({}));
});

test('failed restore keeps runtime generation/next command usable unchanged', () => {
  const f = rewardFixture();
  const { battleRewards, ...state } = f.state;
  const session = new EncounterSession(
    state,
    scriptedActionAdapter([{ damage: 10, outcome: 'victory' }]),
  );
  session.begin(f.wild, 0);
  session.act(rewardMove());
  const prior = session.lastConfirmation;
  unchanged(session, () => session.restore('{bad'));
  session.begin(f.wild, 0);
  session.act(rewardMove());
  assert.equal(session.lastConfirmation.generation, prior.generation + 1);
  assert.equal(session.lastConfirmation.commandId, prior.commandId + 1);
});

test('save/restore/newGame refuse active, faulted and cleanup-failed sessions without dropping handle', () => {
  for (const phase of ['active', 'faulted', 'cleanup']) {
    const f = rewardFixture();
    let failRelease = phase === 'cleanup';
    const session = new EncounterSession(f.state, {
      setup: () => ({
        execute() {
          throw Error('advanced');
        },
        release() {
          if (failRelease) {
            throw Error('cleanup');
          }
        },
      }),
    });
    const saved = session.serialize();
    session.begin(f.wild, 0);
    if (phase === 'faulted') {
      assert.throws(() => session.act(rewardMove()));
    }
    if (phase === 'cleanup') {
      assert.throws(() => session.release());
    }
    const handleRequest = session.activeRequest;
    unchanged(session, () => session.serialize());
    unchanged(session, () => session.restore(saved));
    unchanged(session, () => session.newGame(f.state));
    assert.equal(session.activeRequest, handleRequest);
    failRelease = false;
    if (phase === 'faulted') {
      session.abandonFaultedEncounter();
    } else {
      session.release();
    }
    assert.doesNotThrow(() => session.serialize());
  }
});

test('setup/execute/release callbacks cannot serialize or replace a live controller', () => {
  const f = rewardFixture();
  let session;
  let saved;
  const visits = [];
  const blocked = (phase) => {
    visits.push(phase);
    assert.throws(() => session.serialize());
    assert.throws(() => session.restore(saved));
    assert.throws(() => session.newGame(f.state));
  };
  session = new EncounterSession(f.state, {
    setup(request) {
      blocked('setup');
      const engine = scriptedActionAdapter([{}]).setup(request);
      return {
        execute(command) {
          blocked('execute');
          return engine.execute(command);
        },
        release() {
          blocked('release');
          engine.release();
        },
      };
    },
  });
  saved = session.serialize();
  session.begin(f.wild, 0);
  session.act(rewardMove());
  session.release();
  assert.deepEqual(visits, ['setup', 'execute', 'release']);
});

test('safe command counter exhaustion is preserved, unsafe values rejected; optional plain state still roundtrips', () => {
  const f = rewardFixture();
  const { battleRewards, growth, inventory, training, ...plain } = f.state;
  const session = new EncounterSession(plain, {
    setup: () => ({
      execute() {
        throw Error('must not dispatch');
      },
      release() {},
    }),
  });
  const saved = JSON.parse(session.serialize());
  saved.counters.nextCommandId = Number.MAX_SAFE_INTEGER;
  session.restore(JSON.stringify(saved));
  assert.equal(
    JSON.parse(session.serialize()).counters.nextCommandId,
    Number.MAX_SAFE_INTEGER,
  );
  session.begin({ kind: 'wild', candidates: f.wild.candidates }, 0);
  unchanged(session, () =>
    session.act({ kind: 'switch', actorId: 'one', targetId: 'two' }),
  );
  assert.equal(session.fault, undefined);
  session.release();
  assert.equal(session.state.growth, undefined);
  assert.equal(session.state.training, undefined);
});
