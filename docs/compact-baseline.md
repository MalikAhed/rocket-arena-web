# Rocket Arena — compact web edition

## [▶ Play Rocket Arena in your browser](https://malikahed.github.io/rocket-arena-web/)

Drive, boost, jump and play arena soccer against the included AI opponents. Keyboard, controller and mobile touch controls are supported.

An independent copy of the game, optimized for static HTTPS hosting. The original project is unchanged apart from an added offline asset-conversion script.

## Run and build

Requires Node 22 or newer. Run `npm start` for local play (no installed packages needed). The default URL is http://localhost:4173; use `PORT=4287 npm start` to choose another port. Source edits automatically reload the local page.

Run `npm ci` followed by `npm run build` to generate `dist/`. There are no runtime npm dependencies; esbuild is the only development dependency. Upload **the contents of `dist/`**, not this whole directory, to the root of an HTTPS static host. For a subpath deployment, set `ROCKET_ARENA_BASE_PATH` during the build, as the included GitHub Pages workflow does.

The included `_headers` config supports hosts that recognize that format and enables cross-origin isolation for threaded runtimes. The game also runs on GitHub Pages without those custom headers, using its single-thread inference fallback. Serve `.wasm` as `application/wasm`, `.js` as JavaScript, and `.mp3` as `audio/mpeg`. Enable host-side Brotli/gzip for JS, CSS, WASM and ONNX. The stadium `.json.gz` is an opaque gzip file decoded by the game: do not set `Content-Encoding` on that file. This version targets modern browsers with WebGL2 and DecompressionStream support.

Local production check: `ROCKET_ARENA_DIST=1 PORT=4288 npm start` after building. `npm run verify` checks assets, physics hashes, geometry and removed-car fallback. `npm test` runs all three bots through the shipped inference engine.

## Changes

- Tripo, Vanguard (including Original), Crimson and Volt are removed from the garage and shipping assets. Old saved selections fall back to Fennec. Spectre now uses Fennec as its wheel donor.
- Remaining garage cars: Fennec, Octane Original, Challenger, Spectre, Vesper and Amethyst. Unselectable model variants, reference files, viewers, native sources and review output are excluded from the production build.
- Large artwork and embedded model textures use WebP. Color textures are capped at 1024px; wide environment artwork at 2048px. The shader lighting lookup PNG remains lossless.
- GLB geometry uses Meshopt compression. Car triangle counts, names and custom shading attributes are preserved. Decorative garden/stone meshes are simplified, with regenerated lower-detail indices and retained instancing.
- Reflection cube resolution is 128px instead of 256px, using the existing mip chain. The stadium geometry is stored as gzip without changing any values. Collision meshes and physics WASM remain byte-for-byte unchanged.
- Vehicle and impact effects use MP3. Engine grains and boost loops retain WAV to preserve their timing. Balanced rendering starts at 85% scale with a 60 FPS cap; quality remains configurable.
- Bot models and the inference engine load when starting a bot match. They are retained because removing them would remove the existing opponent modes.
- Garage thumbnails render at 256×144 and the selected car at 854×480. Switching cars redraws the selected preview; previews initialize sequentially, without an extra shader-compilation pass.
- Mobile play uses an original “Field Console” interface with a squared Drive/Steer pad and geometric Lift, Thrust, Drift and View controls. It keeps the same gameplay bindings while using its own layout, HUD treatment, safe-area rules and touch language.

The game retains solo practice and local AI matches. Hosting this edition makes it playable through a website; network multiplayer has not been added.

## Measured size

| Files | Original | Compact |
| --- | ---: | ---: |
| Public assets | 115.10 MiB | 38.62 MiB |
| Garden/stone scenery, including LOD data | 7.40 MiB | 1.01 MiB |
| Audio | 12.33 MiB | 3.68 MiB |
| Garage backgrounds | 4.37 MiB | 0.23 MiB |

The full static deployment is approximately 41 MiB before transport compression. AI models and their runtime account for about half the retained asset size. Do not upload `node_modules`, source files, tests, screenshots or reports.

`asset-report.json` records individual conversions. The asset-conversion tool lives at `../tools/build-web-assets.mjs` in the original project and requires its existing optimization dependencies plus ffmpeg. It is an offline maintenance tool; this edition runs and builds independently of that original project.

Existing attribution and license files are retained in `public/licenses/`, model credits and bot directories. See `SOURCE.md` for provenance. Browser checks use software rendering, so they establish functionality, not hardware FPS or phone performance.
