import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
for (const fixture of ['positive', 'negative', 'negative-health', 'negative-choice', 'negative-stock', 'negative-adapter', 'negative-command', 'negative-capture', 'negative-growth', 'negative-recovery', 'negative-save']) {
  const result = spawnSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--module', 'NodeNext',
    '--moduleResolution', 'NodeNext', '--target', 'ES2022', '--pretty', 'false',
    `tests/types/${fixture}.ts`], { encoding: 'utf8' });
  if (result.error) throw result.error;
  const output = result.stdout + result.stderr;
  if (fixture === 'positive') {
    assert.equal(result.status, 0, output);
  } else {
    assert.equal(result.status, 1, output);
    const errors = output.split('\n').filter(line => line.includes('error TS'));
    assert.equal(errors.length, 1, output);
    if (fixture === 'negative-health' || fixture === 'negative-choice' || fixture === 'negative-stock' || fixture === 'negative-command' || fixture === 'negative-growth' || fixture === 'negative-recovery' || fixture === 'negative-save') {
      assert.ok(errors[0].includes(`tests/types/${fixture}.ts(3,8): error TS2540:`), output);
      assert.match(errors[0], /read-only property/);
    } else {
      const column = fixture === 'negative-adapter' ? 59 : 7;
      assert.ok(errors[0].includes(`tests/types/${fixture}.ts(2,${column}): error TS2322:`), output);
      if (fixture === 'negative-adapter') assert.match(output, /not assignable to type 'undefined'/);
      else if (fixture === 'negative-capture') assert.match(errors[0], /not assignable to type 'boolean'/);
      else assert.match(errors[0], /not assignable to type 'number'/);
    }
  }
  console.log(`${fixture}: PASS`);
}
