# Source and package notes

The base code, bundled libraries, models, audio, physics and original park assets came from the user's `car-soccer-local(1).zip`. That project identifies its upstream browser-game source as car-soccer.com. This update did not re-fetch or reset the upstream game.

`src/game.js` remains an edited/formatted production bundle, with the new rendering work separated into the existing car/ball/park modules and `src/park-lighting.js`. It is not reconstructed original TypeScript. Destructive upstream refresh/reset scripts and their duplicate original bundles were omitted from this distribution.

The supplied reference folder guided the material tuning and pitch layout. The mountain alpha layer is derived from the supplied distant-view reference; the old city cutouts are replaced by low-poly geometry; the poplar atlas and cloud region are adapted from assets already in the project. The clean pitch and small grass-detail tile are authored programmatically. The existing detailed metal-bank artwork was losslessly recompressed, not repainted.

No new third-party models were downloaded. Model attribution is in `public/assets/sketchfab/CREDITS.md`; existing library, bot and physics notices remain with the corresponding files. The source/asset rights are those of the original components, not a new blanket license for this package.

`public/offline-manifest.json` is now an integrity manifest for this edited local package. It is not the original website's historical release manifest. `npm run verify` checks this manifest and independently verifies the shipped physics artifact pins.

RocketSim source revision: c2baacb8f4b441dd8505e63c2aeb5a1679b60b02. The source was checked against the clean vendored Git checkout before packaging. Its per-file checksums are recorded in `native/vendor/rocketsim-source.json`, allowing the existing build command to check the source after unnecessary Git history is removed.

## Goal/daylight release 1.2.0

The reference-goal update uses the latest `goal-visuals.js` implementation together with separately integrated `park-city.js` and `park-flags.js`. The flag atlas was supplied in the preceding working files and reuses the project's existing logo artwork. No external Minecraft shader pack, additional rendering library or remotely loaded model is required. Localized geometry glow is used rather than UnrealBloomPass.


## Checkpoint 02 — current package

The preceding sections describe inherited releases. For Checkpoint 02 the working base is Checkpoint 01 plus the separately supplied Pass 03 lighting, surface and static-shadow modules. New Fennec/pad resources were extracted only from the user's `OPEN_ME (1).html` and `boost-pads-source(1).zip`. No upstream game refresh, new library, new scenery, or new physics build was performed.

The Fennec source notice is `docs/third-party/FENNEC-SOURCE.md`; the supplied boost package's MIT license is preserved in `docs/third-party/boost-pads/LICENSE`. The existing 190-entry public integrity manifest is deliberately unchanged and verifies inherited assets. The separate `npm run verify:checkpoint2` verifies the additional resources and current editable runtime hashes.

Unlike the inherited 1.2.0 note above, this checkpoint DOES add a three-level HDR highlight/bloom pipeline for Balanced and High. See `VALIDATION.md` for its measured cost and limitations.

## Vanguard garage integration

The user-supplied `vanguard-reference-rebuild.html` was used as a one-time asset container. `tools/import-vanguard-reference.mjs` extracts its packed geometry and vertex occlusion into `public/assets/sketchfab/vanguard/model.glb`; the standalone HTML is intentionally deleted after import. No reference-viewer arena, controls, photographic backdrop or duplicate rendering runtime is loaded by the game. The game retains all 134,408 supplied triangles and assigns the reference material groups to the existing offline pearl renderer.

## Bot worker restoration

Restored the accidentally empty `public/assets/worker-iFqqV1m9.js` from the existing local project copy at `testing/car-soccer`. The restored file is 69,599 bytes and matches the original integrity manifest hash (`sha256-xpuR0/Ep5cS1OT+CMxAz5HSG+14RYXGqhiPkYNAEv7Y=`). No model, physics, or inference algorithm was changed. `tools/bot-worker.test.mjs` checks the hash and executes the actual bundled worker, WASM and each of the three models to verify readiness and valid decoded actions.
