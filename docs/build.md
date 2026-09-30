# Source and package builds

Use the pinned Node/npm versions in package.json, then npm ci.

```sh
npm run format:check
npm run typecheck
npm run build
npm run build:types
npm run test:types
npm test
node scripts/test-package.mjs
```

Internal TypeScript imports omit extensions. TypeScript checks these with
ESNext/Bundler resolution, and Vite bundles the runtime ESM entry. Node-executed
.mjs scripts/tests/examples keep explicit .mjs paths for relative runtime imports.

Declarations use a separate tsc emit followed by scripts/declaration-specifiers.mjs.
The latter uses the pinned Prettier TypeScript parser to add .js to relative
module specifiers in the emitted .d.ts files, checking their declaration targets.
This lets packaged declarations resolve under both NodeNext and Bundler. Run
build before build:types because Vite clears dist. Do not package raw tsc output
without the declaration correction step. No source aliases or skipLibCheck are
needed. The isolated package check installs the tarball offline, executes its
Node ESM API, and checks both declaration consumers without Node or DOM types.

npm run format writes consistent formatting; npm run format:check checks it.
Prettier 3.9.9 is an exact MIT-licensed development dependency, also reused for
its parser. It is not a runtime dependency of the distributed core.
