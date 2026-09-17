import { onlineConfiguration } from './online-config.mjs';
import { createReadStream, watch } from "node:fs";
import { stat, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, relative, resolve } from "node:path";

const projectRoot = resolve(import.meta.dirname, "..");
const production = process.env.ROCKET_ARENA_DIST === '1';
const publicRoot = join(projectRoot, production ? "dist" : "public");
const hostname = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.ROCKET_ARENA_PORT || process.env.CAR_SOCCER_PORT || process.env.PORT || "4173", 10);
const liveReload = !production && (process.env.ROCKET_ARENA_LIVE_RELOAD || process.env.CAR_SOCCER_LIVE_RELOAD || '1') === "1";
const clients = new Set();
let reloadTimer;
if (liveReload) {
  const changed = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      for (const client of clients) client.write('data: reload\n\n');
    }, 350);
  };
  for (const directory of ['src', 'public']) watch(join(projectRoot, directory), { recursive: true }, changed);
  watch(join(projectRoot, 'index.html'), changed);
}

const contentTypes = {
  ".bin": "application/octet-stream",
  ".cmf": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".onnx": "application/octet-stream",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain; charset=utf-8",
  ".wasm": "application/wasm",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".webmanifest": "application/manifest+json; charset=utf-8",
};

function safeResolve(root, requestPath) {
  const target = resolve(root, requestPath.replace(/^\/+/, ""));
  const relation = relative(root, target);
  return relation.startsWith("..") ? null : target;
}

function requestedFile(pathname) {
  if (production) return safeResolve(publicRoot, pathname === '/' ? '/index.html' : pathname);
  if (pathname === "/" || pathname === "/index.html") return (process.env.ROCKET_ARENA_VIEWER || process.env.CAR_SOCCER_VIEWER) === '1'
    ? join(publicRoot, 'model-viewer.html') : join(projectRoot, "index.html");
  if (pathname.startsWith("/src/")) return safeResolve(projectRoot, pathname);
  return safeResolve(publicRoot, pathname);
}

const server = createServer(async (request, response) => {
  response.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
  response.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  response.setHeader("Cache-Control", "no-cache");

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://${hostname}`).pathname);
  } catch {
    response.writeHead(400);
    response.end("Bad request");
    return;
  }

  if (liveReload && pathname === '/__live/events') {
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    response.write(': connected\n\n');
    clients.add(response);
    const heartbeat = setInterval(() => response.write(': heartbeat\n\n'), 15000);
    response.on('close', () => { clearInterval(heartbeat); clients.delete(response); });
    return;
  }
  if (liveReload && pathname === '/__live/client.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript' });
    response.end("new EventSource('/__live/events').onmessage=()=>location.reload();");
    return;
  }
  if (!production && pathname === '/assets/online/config.json') {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify(onlineConfiguration())); return;
  }
  if (!production && pathname === '/assets/online/auth-sdk.js') {
    try {
      const { build } = await import('esbuild');
      const result = await build({ entryPoints: [join(projectRoot, 'src/online/auth-sdk.js')], bundle: true, write: false, format: 'esm', platform: 'browser', minify: true });
      response.writeHead(200, { 'Content-Type': 'application/javascript' }); response.end(result.outputFiles[0].text);
    } catch { response.writeHead(503); response.end('throw Error("Install online dependencies with npm ci first")'); }
    return;
  }
  const filePath = requestedFile(pathname);
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  if (!fileStat.isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  if (liveReload && extname(filePath) === '.html') {
    const html = (await readFile(filePath, 'utf8')).replace('</body>', '<script src="/__live/client.js"></script></body>');
    response.writeHead(200, { 'Content-Type': contentTypes['.html'], 'Content-Length': Buffer.byteLength(html) });
    response.end(request.method === 'HEAD' ? undefined : html);
    return;
  }
  const headers = {
    "Accept-Ranges": "bytes",
    "Content-Type": contentTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
  };
  let start = 0;
  let end = fileStat.size - 1;
  let status = 200;
  const range = request.headers.range?.match(/^bytes=(\d*)-(\d*)$/);
  if (range) {
    start = range[1] ? Number(range[1]) : 0;
    end = range[2] ? Number(range[2]) : end;
    if (start > end || end >= fileStat.size) {
      response.writeHead(416, { "Content-Range": `bytes */${fileStat.size}` });
      response.end();
      return;
    }
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${fileStat.size}`;
  }
  headers["Content-Length"] = String(end - start + 1);
  response.writeHead(status, headers);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath, { start, end }).pipe(response);
});

server.listen(port, hostname, () => {
  console.log(`Rocket Arena is running at http://${hostname}:${port}/`);
  console.log(liveReload ? 'Automatic refresh enabled for source and asset edits.' : 'Edit src/, then reload Chrome.');
});
