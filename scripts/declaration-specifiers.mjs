import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsers } from 'prettier/plugins/typescript';

// Use the pinned formatter's parser; never rewrite strings in comments or types.
export async function declarationSpecifiers(source, filename) {
  const ast = await parsers.typescript.parse(source);
  const edits = [];
  function visit(node) {
    if (!node || typeof node !== 'object') {
      return;
    }
    if (
      [
        'ImportDeclaration',
        'ExportNamedDeclaration',
        'ExportAllDeclaration',
        'TSImportType',
      ].includes(node.type)
    ) {
      const literal = node.source;
      const specifier = literal?.value;
      if (typeof specifier === 'string' && /^\.\.?\//.test(specifier)) {
        if (extname(specifier) && !specifier.endsWith('.js')) {
          throw new Error(`Unsupported declaration specifier: ${specifier}`);
        }
        const stem = specifier.endsWith('.js') ? specifier.slice(0, -3) : specifier;
        if (!existsSync(resolve(dirname(filename), `${stem}.d.ts`))) {
          throw new Error(`Missing declaration target: ${specifier} in ${filename}`);
        }
        if (!specifier.endsWith('.js')) {
          edits.push({
            start: literal.range[0],
            end: literal.range[1],
            text: JSON.stringify(`${specifier}.js`),
          });
        }
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        value.forEach(visit);
      } else if (value && typeof value === 'object') {
        visit(value);
      }
    }
  }
  visit(ast);
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    source = source.slice(0, edit.start) + edit.text + source.slice(edit.end);
  }
  return source;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = fileURLToPath(new URL('../dist/', import.meta.url));
  for (const name of readdirSync(directory)) {
    if (name.endsWith('.d.ts')) {
      const filename = resolve(directory, name);
      writeFileSync(
        filename,
        await declarationSpecifiers(readFileSync(filename, 'utf8'), filename),
      );
    }
  }
}
