import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const consumer = mkdtempSync(join(tmpdir(), 'monster-rpg-consumer-'));
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: { ...process.env, npm_config_cache: join(consumer, 'cache') }, encoding: 'utf8', timeout: 60000 });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error ?? result.stderr ?? result.stdout}`);
  return result.stdout;
}
try {
  const [packed] = JSON.parse(run('npm', ['pack', '--pack-destination', consumer, '--json'], root));
  if (packed.files.some(file => !file.path.startsWith('dist/') && !['package.json', 'README.md'].includes(file.path))) throw new Error('Unexpected package file');
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  run('npm', ['install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(consumer, packed.filename)], consumer);
  const flow = `import { loadSpeciesCatalog, createMonsters, createOwnership, admitMonster, enableCollection, depositMonster, withdrawMonster, healMonster, EncounterSession } from 'monster-rpg-core';
const catalog = loadSpeciesCatalog([{id:'mossling',name:'Mossling'}]);
const [monster] = createMonsters(catalog,[{id:'one',speciesId:'mossling',nickname:'Moss'}]);
if (!monster) throw new Error('Missing instance');
let state = enableCollection(createOwnership(catalog,{totalCapacity:2,partyCapacity:1}));
state = admitMonster(state,monster,{currentHP:2,maxHP:8,condition:null});
state = depositMonster(state,'one');
state = withdrawMonster(state,'one');
state = healMonster(state,'one',3);
const session = new EncounterSession(state, { setup() { return { release() { return undefined; } }; } });
const saved = session.serialize();
session.restore(saved);
if (session.serialize() !== saved || session.state.owned[0]?.health.currentHP !== 5 || session.state.collection?.acquired[0] !== 'mossling') throw new Error('Package public flow failed');
`;
  writeFileSync(join(consumer, 'flow.mjs'), flow);
  run(process.execPath, ['flow.mjs'], consumer);
  // The root uses only explicit named re-exports; compare that declared runtime surface.
  const source = readFileSync(resolve(root, 'src/index.ts'), 'utf8');
  const names = [...source.matchAll(/export\s*\{([^}]+)\}/g)].flatMap(match => match[1].split(',').map(name => name.trim()).filter(Boolean)).sort();
  writeFileSync(join(consumer, 'exports.mjs'), `import * as api from 'monster-rpg-core';\nif (JSON.stringify(Object.keys(api).sort()) !== ${JSON.stringify(JSON.stringify(names))}) throw new Error('Runtime export mismatch');\n`);
  run(process.execPath, ['exports.mjs'], consumer);
  writeFileSync(join(consumer, 'flow.ts'), flow + `\nimport * as surface from 'monster-rpg-core';\n${names.map(name => `void surface.${name};`).join('\n')}\n`);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict:true,noUncheckedIndexedAccess:true,exactOptionalPropertyTypes:true,target:'ES2022',lib:['ES2022'],types:[],module:'NodeNext',moduleResolution:'NodeNext',noEmit:true }, include:['flow.ts'] }));
  run(process.execPath, [resolve(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer);
  console.log(JSON.stringify({ runtimeFlow:'PASS',declarationsWithoutNodeOrDOM:'PASS',runtimeExports:names.length,packageFiles:packed.files.length,packageBytes:packed.size,consumerInstall:'offline local tarball; no runtime dependencies' }));
} finally {
  rmSync(consumer, { recursive:true,force:true });
}
