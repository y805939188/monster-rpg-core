import { pathToFileURL } from 'node:url';
import {
  EncounterSession, loadSpeciesCatalog, createMonsters, createOwnership, admitMonster,
  enableLearning, requestLearning,
} from 'monster-rpg-core';

// Controlled fixtures only: scripted HP deltas are not a production battle formula.
export function scriptedActionAdapter(steps, log = []) {
  return { setup(request) {
    let temporary = { party: structuredClone(request.party), opponents: structuredClone(request.opponents), activeId: request.party.find(entry => entry.health.currentHP > 0).monster.id };
    let position = 0;
    return {
      execute(command) {
        const step = steps[position++];
        if (!step) throw Error('No scripted step');
        log.push(command);
        const action = command.action;
        let medicine;
        if (action.kind === 'switch') temporary.activeId = action.targetId;
        else if (action.kind === 'medicine') {
          const target = temporary.party.find(entry => entry.monster.id === action.targetId);
          if (step.beforeMedicineHP !== undefined) target.health.currentHP = step.beforeMedicineHP;
          const before = structuredClone(target); const rule = command.medicine;
          if (rule.kind === 'heal') target.health.currentHP = Math.min(target.health.maxHP, target.health.currentHP + rule.amount);
          if (rule.kind === 'revive') target.health.currentHP = Math.min(target.health.maxHP, rule.amount);
          if (rule.kind === 'clearCondition') target.health.condition = null;
          if (rule.kind === 'restoreResources') for (const move of target.knownMoves) {
            const resource = request.moveRules.moves.find(entry => entry.id === move.moveId).resource;
            move.remaining = resource.kind === 'none' ? null : resource.maximum;
          }
          medicine = { before, after: structuredClone(target) };
        } else if (action.kind === 'move') {
          const actor = temporary.party.find(entry => entry.monster.id === action.actorId);
          const move = actor.knownMoves.find(entry => entry.moveId === action.moveId);
          if (move.remaining !== null) move.remaining--;
          const target = temporary.opponents.find(entry => entry.monster.id === action.targetId);
          target.health.currentHP = Math.max(0, target.health.currentHP - (step.damage ?? 0));
          if (step.partyHP !== undefined) for (const member of temporary.party) member.health.currentHP = step.partyHP;
        }
        if (step.actorHP !== undefined) temporary.party.find(entry => entry.monster.id === temporary.activeId).health.currentHP = step.actorHP;
        if (step.targetHP !== undefined) temporary.opponents[0].health.currentHP = step.targetHP;
        if (step.targetCondition !== undefined) temporary.opponents[0].health.condition = step.targetCondition;
        return { ...(step.outcome === 'victory' && command.participants ? { participants: [...command.participants] } : {}), ...(medicine ? { medicine } : {}), generation: command.generation, commandId: command.commandId, revision: command.revision,
          outcome: step.outcome ?? 'continue', checkpoint: structuredClone(temporary) };
      },
      release() { temporary = null; },
    };
  } };
}

// A different result source: caller-provided, hand-specified checkpoint frames.
export function checkpointActionAdapter(frames, log = []) {
  return { setup() {
    let position = 0;
    let temporary;
    return {
      execute(command) {
        const frame = frames[position++];
        if (!frame) throw Error('No checkpoint frame');
        temporary = structuredClone(frame.checkpoint);
        log.push(command);
        return { generation: command.generation, commandId: command.commandId, revision: command.revision,
          outcome: frame.outcome, checkpoint: structuredClone(temporary),
          ...(frame.medicine ? { medicine: structuredClone(frame.medicine) } : {}),
          ...(frame.participants ? { participants: [...frame.participants] } : {}) };
      },
      release() { temporary = undefined; },
    };
  } };
}
export function actionExampleFixture(none = false) {
  const catalog = loadSpeciesCatalog([{ id: 'mossglow', name: 'Mossglow' }, { id: 'mistpod', name: 'Mistpod' }]);
  const [one, two, enemy] = createMonsters(catalog, [{ id: 'one', speciesId: 'mossglow' }, { id: 'two', speciesId: 'mossglow' }, { id: 'enemy', speciesId: 'mistpod' }]);
  const health = { currentHP: 10, maxHP: 10, condition: null };
  let state = createOwnership(catalog, { totalCapacity: 3, partyCapacity: 2 });
  state = admitMonster(admitMonster(state, one, health), two, health);
  state = enableLearning(state, { slotCapacity: 1, moves: [{ id: 'mosschime', name: 'Mosschime', resource: none ? { kind: 'none' } : { kind: 'finite', maximum: 3 } }] });
  state = requestLearning(requestLearning(state, 'one', 'mosschime'), 'two', 'mosschime');
  const config = { kind: 'wild', candidates: [{ monster: enemy, health, knownMoves: [], visible: true }] };
  return { state, config };
}
export function runActionExample() {
  const { state, config } = actionExampleFixture();
  const base = { party: state.owned.map(entry => ({ ...structuredClone(entry), knownMoves: [{ moveId: 'mosschime', remaining: 3 }] })),
    opponents: [{ monster: config.candidates[0].monster, health: { currentHP: 10, maxHP: 10, condition: null }, knownMoves: [] }], activeId: 'one' };
  const first = structuredClone(base); first.party[0].knownMoves[0].remaining = 2; first.opponents[0].health.currentHP = 8;
  const second = structuredClone(first); second.activeId = 'two';
  const third = structuredClone(second); third.party[1].knownMoves[0].remaining = 2; third.opponents[0].health.currentHP = 0;
  const adapters = [scriptedActionAdapter([{ damage: 2 }, {}, { damage: 8, outcome: 'victory' }]),
    checkpointActionAdapter([{ outcome: 'continue', checkpoint: first }, { outcome: 'continue', checkpoint: second }, { outcome: 'victory', checkpoint: third }])];
  return adapters.map(adapter => {
    const session = new EncounterSession(state, adapter); session.begin(config, 0);
    session.act({ kind: 'move', actorId: 'one', moveId: 'mosschime', targetId: 'enemy' });
    session.act({ kind: 'switch', actorId: 'one', targetId: 'two' });
    const receipt = session.act({ kind: 'move', actorId: 'two', moveId: 'mosschime', targetId: 'enemy' });
    if (session.activeRequest !== undefined) throw Error('Terminal release not completed');
    return { outcome: receipt.outcome, remaining: session.state.training.individuals.map(entry => entry.knownMoves[0].remaining) };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(runActionExample()));
