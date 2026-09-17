import { onlineConfiguration } from './online-config.mjs';
import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { resolve, join, extname } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(resolve(root, 'public'), dist, { recursive: true });
await mkdir(resolve(dist, 'assets/online'), { recursive: true });
await writeFile(resolve(dist, 'assets/online/config.json'), JSON.stringify(onlineConfiguration()));
await cp(resolve(root, 'SOURCE.md'), resolve(dist, 'SOURCE.md'));
let html = await readFile(resolve(root, 'index.html'), 'utf8');
const css = [...html.matchAll(/href="(\/src\/[^" ]+\.css)"/g)].map(m => m[1]);
await build({
  absWorkingDir: root, entryPoints: { 'assets/online/auth-sdk': 'src/online/auth-sdk.js', 'app/game': 'src/game.js', 'src/materials/reference-field-worker': 'src/materials/reference-field-worker.js' },
  outdir: dist, bundle: true, minify: true, splitting: true, format: 'esm', target: ['es2022'],
  external: ['/physics/*', '/assets/online/auth-sdk.js'], legalComments: 'linked', chunkNames: 'app/chunks/[name]-[hash]',
  plugins: [{ name: 'browser-only-physics', setup(b) {
    b.onResolve({ filter: /__vite-browser-external/ }, () => ({ path: resolve(root, 'public/assets/__vite-browser-external-BIHI7g3E.js') }));
  } }],
});
await build({ absWorkingDir: root, stdin: { contents: css.map(p => `@import ${JSON.stringify('.' + p)};`).join('\n'), resolveDir: root, loader: 'css' },
  outfile: resolve(dist, 'app/game.css'), bundle: true, minify: true, external: ['/assets/*'], legalComments: 'linked' });
html = html.replace('/src/game.js', '/app/game.js').replace(/\s*<link rel="stylesheet" href="\/src\/[^" ]+\.css" \/>/g, '');
html = html.replace('</head>', '<link rel="stylesheet" href="/app/game.css" /></head>');
await mkdir(resolve(dist, 'src'), { recursive: true });
await cp(resolve(root, 'src/rocket-arena.webmanifest'), resolve(dist, 'src/rocket-arena.webmanifest'));
await writeFile(resolve(dist, 'index.html'), html);
await writeFile(resolve(dist, '.nojekyll'), '');

// GitHub Pages project sites live below /<repository>/. Rewrite root asset
// paths at build time while keeping local/root deployments unchanged.
const basePath = ('/' + (process.env.ROCKET_ARENA_BASE_PATH || '').replace(/^\/+|\/+$/g, '')).replace(/^\/$/, '');
if (basePath) {
  const textExtensions = new Set(['.html', '.js', '.css', '.json', '.webmanifest', '.gltf', '.md']);
  const visit = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (textExtensions.has(extname(entry.name))) {
        let source = await readFile(path, 'utf8');
        for (const prefix of ['/assets/', '/physics/', '/src/', '/app/']) source = source.replaceAll(prefix, basePath + prefix);
        for (const file of ['/favicon.ico', '/favicon-16x16.png', '/favicon-32x32.png', '/apple-touch-icon.png', '/android-chrome-192x192.png', '/android-chrome-512x512.png']) {
          source = source.replaceAll(file, basePath + file);
        }
        source = source.replaceAll('"start_url":"/"', `"start_url":"${basePath}/"`)
          .replaceAll('"start_url": "/"', `"start_url": "${basePath}/"`);
        await writeFile(path, source);
      }
    }
  };
  await visit(dist);
}
console.log(basePath ? `Built dist/ for ${basePath}/` : 'Built dist/: upload its contents to the root of an HTTPS static host.');
