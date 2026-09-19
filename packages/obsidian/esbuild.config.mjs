import { builtinModules } from 'node:module';

import esbuild from 'esbuild';

const production = process.argv[2] === 'production';

const external = [
  'obsidian',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
];

const context = await esbuild.context({
  entryPoints: ['src/main.ts'],
  bundle: true,
  external,
  format: 'cjs',
  target: 'es2021',
  outfile: 'main.js',
  platform: 'node',
  sourcemap: production ? false : 'inline',
  treeShaking: true,
});

if (production) {
  await context.rebuild();
  await context.dispose();
  process.exit(0);
}

await context.watch();
