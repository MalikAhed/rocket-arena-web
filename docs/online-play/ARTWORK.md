# Artwork provenance

The existing Casual and Free Play cards remain unchanged. Five added 1000x625 WebP compositions cover Bots, Ranked and 1v1/2v2/3v3; the playlist images visibly contain 2/4/6 vehicles. Text labels are real UI elements. Together the rendered WebPs add approximately 412 KiB; two SVG source families are also retained.

`tools/online-art-scene.js` defines the editable Three.js/Canvas compositions, using the game's existing car/ball meshes and material code without modifying gameplay assets. `node tools/render-online-scenes.mjs` renders finite static images with Playwright/Chromium. It does not introduce runtime effects or offline network connections. Run `npm run art:online` first to regenerate the vector sources; install the test browser as documented in the root README.

`public/assets/online/ranks.svg` contains 23 addressable original drawings (Unranked plus 22 rank/subtier badges). Polygon cores, rays, ornaments and side plates distinguish progression beyond color. `tools/render-online-art.mjs` is the editable generator. No Rocket League emblem image was traced, recolored or imported.

The rendered car/ball imagery inherits the existing project's Jako/fairlight51 attribution and CC BY 4.0 declaration in `public/assets/sketchfab/CREDITS.md`. Changes are new compositions, team-color presentation, lighting and raster rendering; no endorsement is implied. Do not describe the meshes as newly authored or the resulting cards as CC0. Existing notices in `SOURCE.md` and `public/licenses/` remain; this contribution does not independently clear inherited game/trademark rights.
