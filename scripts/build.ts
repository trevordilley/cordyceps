import { rm, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';

// Bun is build tooling only; published entry points target Node and externalize peers.
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const check = Bun.spawn(['bun', 'x', '--no-install', 'tsc', '--noEmit'], { stdout: 'inherit', stderr: 'inherit' });
if (await check.exited) process.exit(1);
const result = await Bun.build({
  entrypoints: ['src/index.ts', 'src/playwright.ts'],
  outdir: 'dist', target: 'node', format: 'esm', splitting: true,
  packages: 'bundle', external: ['@playwright/test'], sourcemap: 'none',
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const commonjs = await Bun.build({
  entrypoints: ['src/index.ts', 'src/playwright.ts'],
  outdir: 'dist', target: 'node', format: 'cjs', splitting: false,
  packages: 'bundle', external: ['@playwright/test'], sourcemap: 'none', naming: '[name].cjs',
});
if (!commonjs.success) {
  for (const log of commonjs.logs) console.error(log);
  process.exit(1);
}
const declarations = Bun.spawn(['bun', 'x', '--no-install', 'tsc', '--emitDeclarationOnly'], { stdout: 'inherit', stderr: 'inherit' });
if (await declarations.exited) process.exit(1);
// CommonJS declarations need their own module identity, including relative imports.
for (const path of await readdir('dist', { recursive: true })) {
  if (!path.endsWith('.d.ts')) continue;
  const declaration = await readFile(`dist/${path}`, 'utf8');
  await writeFile(`dist/${path.replace(/\.d\.ts$/, '.d.cts')}`,
    declaration.replace(/(from\s+['"]|import\(['"])(\.[^'"]+)\.js(['"])/g, '$1$2.cjs$3'));
}

const notices: string[] = [];
for (const [name, file] of [['ajv', 'LICENSE'], ['fast-deep-equal', 'LICENSE'], ['fast-uri', 'LICENSE'], ['json-schema-traverse', 'LICENSE'], ['require-from-string', 'license']]) {
  notices.push(`${name}\n${await readFile(`node_modules/${name}/${file}`, 'utf8')}`);
}
await writeFile('dist/THIRD_PARTY_NOTICES.txt', notices.join('\n\n'));
