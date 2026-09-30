import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsers } from 'prettier/plugins/typescript';
import { declarationSpecifiers } from '../scripts/declaration-specifiers.mjs';

test('declaration correction targets module literals, preserves other text and rejects missing targets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'monster-rpg-declarations-'));
  try {
    writeFileSync(join(directory, 'model.d.ts'), 'export interface Model {}\n');
    const source = `// import './comment';
import type { Model } from './model';
export { Model } from './model';
export * from './model';
export type Imported = import('./model').Model;
export type Literal = './model';
import type { Other } from 'external';
`;
    const result = await declarationSpecifiers(source, join(directory, 'index.d.ts'));
    assert.equal((result.match(/"\.\/model\.js"/g) ?? []).length, 4);
    assert.ok(result.includes("// import './comment';"));
    assert.ok(result.includes("export type Literal = './model';"));
    assert.ok(result.includes("from 'external'"));
    assert.equal(
      await declarationSpecifiers(result, join(directory, 'index.d.ts')),
      result,
    );
    await assert.rejects(
      declarationSpecifiers("export * from './missing';", join(directory, 'index.d.ts')),
      /Missing declaration target/,
    );
    await assert.rejects(
      declarationSpecifiers("export * from './model.ts';", join(directory, 'index.d.ts')),
      /Unsupported declaration specifier/,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('all maintained TypeScript module references use resolvable extensionless relative source paths', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const files = ['src', 'tests'].flatMap((directory) =>
    readdirSync(join(root, directory), { recursive: true })
      .filter((name) => name.endsWith('.ts'))
      .map((name) => join(root, directory, name)),
  );
  files.push(join(root, 'vite.config.ts'));
  let relativeImports = 0;
  function visit(node, filename) {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'TSImportType',
        'ImportExpression',
      ].includes(node.type)
    ) {
      const specifier = node.source?.value;
      if (typeof specifier === 'string' && /^\.\.?\//.test(specifier)) {
        relativeImports++;
        assert.equal(extname(specifier), '', `${filename}: ${specifier}`);
        assert.ok(
          existsSync(resolve(dirname(filename), `${specifier}.ts`)),
          `${filename}: ${specifier}`,
        );
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.forEach((child) => visit(child, filename));
      } else if (value && typeof value === 'object') {
        visit(value, filename);
      }
    }
  }
  for (const filename of files) {
    visit(await parsers.typescript.parse(readFileSync(filename, 'utf8')), filename);
  }
  assert.ok(relativeImports > 0);
});
