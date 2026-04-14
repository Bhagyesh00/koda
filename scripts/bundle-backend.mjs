/**
 * Bundles the Express backend into a single CJS file using esbuild.
 * Output: electron-build/backend.cjs
 *
 * Why CJS? Electron's utilityProcess.fork() works reliably with CommonJS.
 * esbuild handles ESM-only deps (execa, nanoid, etc.) by inlining them.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import path from 'path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(root, 'electron-build', 'backend.cjs');

mkdirSync(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(root, 'apps', 'backend', 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile,
  // Let esbuild handle ESM-only packages (execa, nanoid, etc.) by bundling them inline.
  // import.meta.url is shimmed so those packages resolve paths correctly at runtime.
  banner: {
    js: `const import_meta_url = require('url').pathToFileURL(__filename).href;`,
  },
  define: {
    'import.meta.url': 'import_meta_url',
  },
  // Resolve workspace package as source (it has no separate build step)
  alias: {
    '@koda/shared': path.join(root, 'packages', 'shared', 'src', 'index.ts'),
  },
  logLevel: 'info',
});

console.log(`\nBackend bundled → ${outfile}`);
