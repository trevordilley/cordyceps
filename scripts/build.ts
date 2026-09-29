import { rm, mkdir } from 'node:fs/promises';

// Bun is build tooling only; published entry points target Node and externalize peers.
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
const check = Bun.spawn(['bun', 'x', '--no-install', 'tsc', '--noEmit'], { stdout: 'inherit', stderr: 'inherit' });
if (await check.exited) process.exit(1);
const result = await Bun.build({
  entrypoints: ['src/index.ts', 'src/playwright.ts'],
  outdir: 'dist', target: 'node', format: 'esm', splitting: true,
  packages: 'external', sourcemap: 'none',
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
const declarations = Bun.spawn(['bun', 'x', '--no-install', 'tsc', '--emitDeclarationOnly'], { stdout: 'inherit', stderr: 'inherit' });
process.exit(await declarations.exited);
