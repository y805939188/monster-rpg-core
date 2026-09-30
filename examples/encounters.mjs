import { pathToFileURL } from 'node:url';
import { EncounterSession, loadSpeciesCatalog, createMonsters, createOwnership, admitMonster } from 'monster-rpg-core';

// Two controlled local adapters, not production battle engines.
export function memoryAdapter(log) {
  return { setup(request) {
    let temporary = structuredClone(request);
    log.push({ adapter: 'memory', kind: temporary.kind });
    return { release() { temporary = null; } };
  } };
}
export function indexedAdapter(log) {
  return { setup(request) {
    const temporaryHP = new Map([...request.party, ...request.opponents].map(entry => [entry.monster.id, entry.health.currentHP]));
    log.push({ adapter: 'indexed', kind: request.kind });
    return { release() { temporaryHP.clear(); } };
  } };
}
export function runExample() {
  const catalog = loadSpeciesCatalog([{ id: 'mossglow', name: 'Mossglow' }, { id: 'cinderfin', name: 'Cinderfin' }]);
  const [partner, wild] = createMonsters(catalog, [{ id: 'partner', speciesId: 'mossglow' }, { id: 'wild', speciesId: 'cinderfin' }]);
  const health = { currentHP: 10, maxHP: 10, condition: null };
  const state = admitMonster(createOwnership(catalog, { totalCapacity: 3, partyCapacity: 1 }), partner, health);
  const config = { kind: 'wild', candidates: [{ monster: wild, health, knownMoves: [], visible: true }] };
  const log = [];
  for (const adapter of [memoryAdapter(log), indexedAdapter(log)]) {
    const session = new EncounterSession(state, adapter);
    const request = session.begin(config, 0);
    if (request.opponents[0].monster.id !== 'wild') throw Error('Unexpected encounter');
    session.release();
    if (session.activeRequest !== undefined) throw Error('Session not released');
  }
  return log;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(runExample()));
