import test from 'node:test';
import assert from 'node:assert/strict';
import { EncounterSession, useMedicine } from 'monster-rpg-core';
import { scriptedActionAdapter } from '../examples/battle-actions.mjs';
import {
  completeFixture,
  capture,
  flee,
  medicine,
  move,
  runCompleteExample,
} from '../examples/complete-battle.mjs';

const stock = (session, id = 'reed-orb') =>
  session.state.inventory.stacks.find((e) => e.itemId === id)?.count ?? 0;
function open(steps, none = false, transform = (s) => s) {
  const f = completeFixture(none);
  const log = [];
  const session = new EncounterSession(
    transform(f.state),
    scriptedActionAdapter(steps, log),
  );
  session.begin(f.config, 0);
  return { session, log, ...f };
}
function unchanged(session, run) {
  const state = session.state;
  const rev = session.revision;
  assert.throws(run);
  assert.equal(session.state, state);
  assert.equal(session.revision, rev);
}
function answer(command, outcome = 'continue') {
  let medicine;
  if (command.medicine) {
    const before = structuredClone(
      command.checkpoint.party.find((e) => e.monster.id === command.action.targetId),
    );
    const after = structuredClone(before);
    // This helper is used with the original 4-HP tonic only; fixed oracle, not core output.
    after.health.currentHP = Math.min(10, before.health.currentHP + 4);
    medicine = { before, after };
  }
  return {
    generation: command.generation,
    commandId: command.commandId,
    revision: command.revision,
    outcome,
    checkpoint: structuredClone(command.checkpoint),
    ...(medicine ? { medicine } : {}),
  };
}

test('wild failed then successful capture debits once each, final target goes to storage and history', () => {
  for (const none of [false, true]) {
    const { session } = open(
      [
        {},
        { actorHP: 7 },
        { targetHP: 4, targetCondition: 'weary', outcome: 'captured' },
      ],
      none,
    );
    session.act(move);
    session.act(capture(false));
    const failed = session.lastConfirmation;
    assert.equal(stock(session), 2);
    assert.equal(session.state.owned.length, 2);
    assert.equal(session.confirm(failed).status, 'already_applied');
    assert.equal(stock(session), 2);
    const receipt = session.act(capture(true));
    assert.equal(receipt.outcome, 'captured');
    assert.equal(session.activeRequest, undefined);
    assert.equal(stock(session), 1);
    assert.deepEqual(session.state.owned[2].health, {
      currentHP: 4,
      maxHP: 10,
      condition: 'weary',
    });
    assert.equal(session.state.owned[2].monster.id, 'enemy');
    assert.deepEqual(session.state.party, ['one', 'two']);
    assert.ok(session.state.collection.acquired.includes('mistpod'));
    assert.ok(session.state.collection.seen.includes('mistpod'));
    assert.equal(
      session.state.training.individuals[0].knownMoves[0].remaining,
      none ? null : 2,
    );
    const accepted = session.state;
    assert.equal(session.confirm(session.lastConfirmation).status, 'already_applied');
    assert.equal(session.state, accepted);
    unchanged(session, () => session.confirm(failed));
  }
});

test('capture into a free party slot preserves final known move/resource snapshot', () => {
  const f = completeFixture();
  const config = structuredClone(f.config);
  config.candidates[0].knownMoves = [{ moveId: 'mosschime', remaining: 1 }];
  const session = new EncounterSession(
    { ...f.state, partyCapacity: 3 },
    scriptedActionAdapter([{ outcome: 'captured' }]),
  );
  session.begin(config, 0);
  session.act(capture(true));
  assert.deepEqual(session.state.party, ['one', 'two', 'enemy']);
  assert.deepEqual(session.state.training.individuals[2].knownMoves, [
    { moveId: 'mosschime', remaining: 1 },
  ]);
});

test('wild flee failure continues, success closes without acquisition or item cost', () => {
  const { session } = open([{ actorHP: 8 }, { actorHP: 6, outcome: 'escaped' }]);
  session.act(flee(false));
  assert.ok(session.activeRequest);
  assert.equal(session.state.owned[0].health.currentHP, 8);
  session.act(flee(true));
  assert.equal(session.activeRequest, undefined);
  assert.equal(stock(session), 3);
  assert.equal(session.state.owned.length, 2);
  assert.equal(session.state.owned[0].health.currentHP, 6);
  assert.ok(!session.state.collection.acquired.includes('mistpod'));
});

test('preflight rejects trainer actions, full total, stock/target/item/no-effect and numeric decision misuse', () => {
  const { session, log, config } = open([]);
  for (const action of [
    { ...capture(true), success: 1 },
    { ...flee(true), success: NaN },
    { ...capture(true), itemId: 'moss-tonic' },
    { ...capture(true), targetId: 'one' },
    { ...capture(true), actorId: 'two' },
    { ...capture(true), itemId: 'missing' },
    medicine(),
    medicine('one', 'enemy'),
    medicine('one', 'one', 'reed-orb'),
    { ...flee(true), extra: 1 },
  ]) {
    unchanged(session, () => session.act(action));
  }
  assert.equal(log.length, 0);
  assert.equal(session.fault, undefined);
  for (const transform of [
    (s) => ({ ...s, totalCapacity: 2 }),
    (s) => ({ ...s, inventory: { ...s.inventory, stacks: [] } }),
  ]) {
    const x = open([], false, transform);
    unchanged(x.session, () => x.session.act(capture(false)));
    assert.equal(x.log.length, 0);
  }
  session.release();
  session.begin({ kind: 'trainer', opponents: config.candidates });
  unchanged(session, () => session.act(capture(true)));
  unchanged(session, () => session.act(flee(false)));
  assert.equal(log.length, 0);
  assert.throws(() => useMedicine(completeFixture().state, 'reed-orb', 'one'));
});

test('medicine effect acknowledgment and final retaliation commit once, without re-healing', () => {
  const { session } = open([{ actorHP: 6 }, { actorHP: 8 }]);
  session.act(move);
  session.act(medicine());
  assert.equal(stock(session, 'moss-tonic'), 2);
  assert.equal(session.lastConfirmation.medicine.after.health.currentHP, 10);
  assert.equal(session.state.owned[0].health.currentHP, 8); // do not heal again after enemy retaliation
  const state = session.state;
  session.confirm(session.lastConfirmation);
  assert.equal(session.state, state);
  const confirmation = structuredClone(session.lastConfirmation);
  confirmation.medicine.after.health.currentHP = 9;
  unchanged(session, () => session.confirm(confirmation));
});

test('battle revive/condition/resource medicines use explicit existing effects and bounded final state', () => {
  for (const [item, prepare, expected] of [
    [
      'dawn-drop',
      (e) => {
        e.health.currentHP = 0;
      },
      (e) => assert.equal(e.health.currentHP, 3),
    ],
    [
      'clear-dew',
      (e) => {
        e.health.condition = 'weary';
      },
      (e) => assert.equal(e.health.condition, null),
    ],
    ['echo-dew', () => {}, () => {}],
  ]) {
    const f = completeFixture();
    const state = structuredClone(f.state);
    prepare(state.owned[1]);
    if (item === 'echo-dew') {
      state.training.individuals[1].knownMoves[0].remaining = 0;
    }
    const session = new EncounterSession(state, scriptedActionAdapter([{}]));
    session.begin(f.config, 0);
    session.act(medicine('one', 'two', item));
    expected(session.state.owned[1]);
    assert.equal(stock(session, item), 2);
    if (item === 'echo-dew') {
      assert.equal(session.state.training.individuals[1].knownMoves[0].remaining, 3);
    }
    unchanged(session, () => session.act(medicine('one', 'two', item)));
  }
});

test('invalid advanced capture faults atomically; abandon retains previous failed capture cost', () => {
  let calls = 0;
  const f = completeFixture();
  const session = new EncounterSession(f.state, {
    setup() {
      return {
        execute(command) {
          calls++;
          const result = answer(command, calls === 1 ? 'continue' : 'captured');
          if (calls === 2) {
            result.checkpoint.opponents[0].health.currentHP = -1;
          }
          return result;
        },
        release() {},
      };
    },
  });
  session.begin(f.config, 0);
  session.act(capture(false));
  const retained = session.state;
  unchanged(session, () => session.act(capture(true)));
  assert.equal(stock(session), 2);
  unchanged(session, () => session.act(capture(true)));
  assert.equal(calls, 2);
  assert.equal(session.abandonFaultedEncounter(), retained);
  assert.equal(session.state.owned.length, 2);
  assert.ok(!session.state.collection.acquired.includes('mistpod'));
});

test('invalid result correlations/outcomes/medicine acknowledgments never debit or admit', () => {
  for (const [action, corrupt] of [
    [
      capture(true),
      (r) => {
        r.outcome = 'victory';
      },
    ],
    [
      capture(false),
      (r) => {
        r.outcome = 'captured';
      },
    ],
    [
      flee(true),
      (r) => {
        r.outcome = 'continue';
      },
    ],
    [
      flee(false),
      (r) => {
        r.outcome = 'escaped';
      },
    ],
    [
      capture(true),
      (r) => {
        r.commandId++;
      },
    ],
    [
      capture(true),
      (r) => {
        r.checkpoint.opponents[0].monster.id = 'one';
      },
    ],
    [
      capture(true),
      (r) => {
        r.checkpoint.opponents[0].health.maxHP++;
      },
    ],
    [
      capture(true),
      (r) => {
        r.medicine = {};
      },
    ],
    [
      medicine(),
      (r) => {
        delete r.medicine;
      },
    ],
    [
      medicine(),
      (r) => {
        r.medicine.after.health.currentHP = 6;
      },
    ],
  ]) {
    const f = completeFixture();
    const state = structuredClone(f.state);
    state.owned[0].health.currentHP = 6;
    const session = new EncounterSession(state, {
      setup() {
        return {
          execute(command) {
            const r = answer(
              command,
              action.kind === 'capture' && action.success
                ? 'captured'
                : action.kind === 'flee' && action.success
                  ? 'escaped'
                  : 'continue',
            );
            corrupt(r);
            return r;
          },
          release() {},
        };
      },
    });
    session.begin(f.config, 0);
    unchanged(session, () => session.act(action));
    assert.equal(session.fault.reason, 'invalid_confirmation');
    assert.equal(stock(session), 3);
    assert.equal(stock(session, 'moss-tonic'), 3);
    session.abandonFaultedEncounter();
  }
});

test('capture terminal cleanup failure withholds current debit/admission and never redispatches', () => {
  for (const result of ['throw', 'scalar']) {
    let fail = true;
    let calls = 0;
    const f = completeFixture();
    const session = new EncounterSession(f.state, {
      setup() {
        return {
          execute(command) {
            calls++;
            return answer(command, command.action.success ? 'captured' : 'continue');
          },
          release() {
            if (fail) {
              if (result === 'throw') {
                throw Error('release');
              }
              return 1;
            }
          },
        };
      },
    });
    session.begin(f.config, 0);
    session.act(capture(false));
    const retained = session.state;
    unchanged(session, () => session.act(capture(true)));
    assert.equal(session.fault.reason, 'release_failed');
    unchanged(session, () => session.act(capture(true)));
    unchanged(session, () => session.release());
    unchanged(session, () => session.abandonFaultedEncounter());
    assert.equal(calls, 2);
    fail = false;
    assert.equal(session.abandonFaultedEncounter(), retained);
    assert.equal(stock(session), 2);
    assert.equal(session.state.owned.length, 2);
  }
});

test('medicine/capture/flee permit end-turn permanent effects and retain isolation/replay bounds', () => {
  const { session } = open([
    { actorHP: 6 },
    { actorHP: 0, partyHP: 0, outcome: 'defeat' },
  ]);
  session.act(move);
  // Controlled adapter applies medicine then actor falls; final party[1] remains alive, so defeat must reject.
  unchanged(session, () => session.act(medicine()));
  assert.equal(stock(session, 'moss-tonic'), 3);
  const f = completeFixture();
  let returned;
  const other = new EncounterSession(f.state, {
    setup() {
      return {
        execute(command) {
          assert.throws(() => {
            command.action.success = false;
          }, TypeError);
          returned = answer(command, 'captured');
          return returned;
        },
        release() {},
      };
    },
  });
  other.begin(f.config, 0);
  other.act(capture(true));
  const last = other.lastConfirmation;
  returned.checkpoint.opponents[0].health.currentHP = 0;
  assert.equal(other.state.owned[2].health.currentHP, 10);
  for (const bad of [
    { ...last, commandId: last.commandId + 1 },
    { ...last, outcome: 'victory' },
    { ...last, revision: 0 },
  ]) {
    unchanged(other, () => other.confirm(bad));
  }
});

test('two interchangeable local adapters run complete wild/trainer public examples', () => {
  assert.deepEqual(
    runCompleteExample(),
    ['script', 'frames'].map((adapter) => ({
      adapter,
      escapedHP: 6,
      capturedHP: 5,
      storage: true,
      orbs: 1,
      trainerHP: 8,
      tonic: 2,
    })),
  );
});

test('medicine and failed capture/flee can end on validated engine defeat; no global unchanged-turn assumption', () => {
  for (const action of [medicine(), capture(false), flee(false)]) {
    const f = completeFixture();
    const state = structuredClone(f.state);
    state.owned[0].health.currentHP = 6;
    const session = new EncounterSession(state, {
      setup() {
        return {
          execute(command) {
            const r = answer(command, 'defeat');
            for (const member of r.checkpoint.party) {
              member.health.currentHP = 0;
            }
            return r;
          },
          release() {},
        };
      },
    });
    session.begin(f.config, 0);
    session.act(action);
    assert.equal(session.activeRequest, undefined);
    assert.ok(session.state.owned.every((e) => e.health.currentHP === 0));
    assert.equal(stock(session), action.kind === 'capture' ? 2 : 3);
    assert.equal(stock(session, 'moss-tonic'), action.kind === 'medicine' ? 2 : 3);
    assert.equal(session.state.owned.length, 2);
  }
});

test('last item removes stack; forged inventory/capture definition rejected; no-resource capture resources retained', () => {
  const f = completeFixture(true);
  const state = structuredClone(f.state);
  state.inventory.stacks.find((e) => e.itemId === 'reed-orb').count = 1;
  const config = structuredClone(f.config);
  config.candidates[0].knownMoves = [{ moveId: 'mosschime', remaining: null }];
  const session = new EncounterSession(
    state,
    scriptedActionAdapter([{ outcome: 'captured' }]),
  );
  session.begin(config, 0);
  session.act(capture(true));
  assert.equal(stock(session), 0);
  assert.deepEqual(session.state.training.individuals[2].knownMoves, [
    { moveId: 'mosschime', remaining: null },
  ]);
  for (const corrupt of [
    (s) => {
      s.inventory.stacks[0].count = Infinity;
    },
    (s) => {
      s.inventory.stacks[0].count = 0;
    },
    (s) => {
      s.inventory.rules.items[0].effect.amount = 1;
    },
  ]) {
    const forged = structuredClone(f.state);
    corrupt(forged);
    assert.throws(() => new EncounterSession(forged, scriptedActionAdapter([])));
  }
});

test('battle item callbacks cannot reenter state edits or dispatch, and medicine command data is immutable', () => {
  const f = completeFixture();
  const state = structuredClone(f.state);
  state.owned[0].health.currentHP = 6;
  let calls = 0;
  let session;
  session = new EncounterSession(state, {
    setup() {
      return {
        execute(command) {
          calls++;
          assert.throws(() => session.act(capture(true)));
          assert.throws(() => session.commit(session.revision, state));
          assert.throws(() => session.release());
          assert.throws(() => {
            command.medicine.amount = 0;
          }, TypeError);
          const r = answer(command);
          r.checkpoint.party[0] = structuredClone(r.medicine.after);
          return r;
        },
        release() {},
      };
    },
  });
  session.begin(f.config, 0);
  session.act(medicine());
  assert.equal(calls, 1);
  assert.equal(session.state.owned[0].health.currentHP, 10);
  assert.equal(stock(session, 'moss-tonic'), 2);
});

test('medicine application may occur after an enemy hit and before later retaliation', () => {
  const { session } = open([{ actorHP: 6 }, { beforeMedicineHP: 3, actorHP: 5 }]);
  session.act(move);
  session.act(medicine());
  assert.equal(session.lastConfirmation.medicine.before.health.currentHP, 3);
  assert.equal(session.lastConfirmation.medicine.after.health.currentHP, 7);
  assert.equal(session.state.owned[0].health.currentHP, 5);
  assert.equal(stock(session, 'moss-tonic'), 2);
});
