import { build } from 'esbuild';

// Bundle für die eingebettete QuickJS-Laufzeit (kein DOM, kein Node).
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'SqrittoEngine',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  outfile: 'dist/engine.js',
  logLevel: 'info',
});
