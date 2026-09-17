# Compact edition validation — 2026-09-17

- Production bundling passed. Archive JavaScript hash matches the final build.
- 229 public files checked; all Meshopt buffer views decoded successfully.
- Original and experimental physics WASM hashes match the original game, and both modules pass WebAssembly validation.
- Compressed stadium geometry has valid vertex attributes and indices.
- Removed-car selections normalize to Fennec.
- All three bots (Seer, Necto, Nexto) loaded and returned valid actions through the shipped WASM inference engine.
- Headless Chrome loaded the production home screen and free play, and received driving input.
- All six garage cars loaded and equipped successfully. A separate browser model check confirmed nonempty four-wheel assemblies for every car.
- A bot match started successfully.
- Landscape mobile viewport (844×390) loaded with visible joystick and touch buttons.
- Extended browser run: 338 responses, zero failed requests, zero uncaught JavaScript exceptions. Details: `browser-report.json`.
- Screenshots: `gameplay-check.png`, `mobile-check.png`.
- Local preview HTTP health check passed at http://localhost:4287/; development server supplies automatic reload.

These are software-rendered functional checks. Hardware frame rates, real iPhone input and public-host deployment were not measured. No multiplayer networking was added.

Original public files: 120,690,813 bytes. Compact public files: 40,491,774 bytes (66.45% reduction). Final deployment archive: 27,030,100 bytes (25.78 MiB). The archive excludes source, npm dependencies, test tools and screenshots.
