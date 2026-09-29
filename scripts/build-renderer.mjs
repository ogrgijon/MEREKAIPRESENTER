import { build } from 'esbuild';
import { cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const sourceDir = path.join(rootDir, 'src', 'renderer');
const outputDir = path.join(rootDir, 'dist', 'renderer');

mkdirSync(outputDir, { recursive: true });

await build({
  entryPoints: [path.join(sourceDir, 'renderer.ts')],
  outfile: path.join(outputDir, 'renderer.js'),
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: ['chrome110', 'edge110'],
  sourcemap: false,
  logLevel: 'info',
});

for (const fileName of ['index.html', 'style.css']) {
  cpSync(
    path.join(sourceDir, fileName),
    path.join(outputDir, fileName),
    { force: true },
  );
}

for (const iconName of ['iconoMerekaiGallery.png', 'iconoMerekaiGallery.ico']) {
  cpSync(
    path.join(rootDir, iconName),
    path.join(outputDir, iconName),
    { force: true },
  );
}