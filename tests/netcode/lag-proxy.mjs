// Test-only WebSocket MESSAGE-delay proxy, not a UDP loss/TCP packet simulator.
// Real browser clients still connect to the real authoritative game server.
import http from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';
export async function createLagProxy(upstreamUrl, { rtt = 80, jitter = 20 } = {}) {
  let seed = 1717;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const resources = new Set();
  const server = http.createServer(async (request, response) => {
    try {
      const parts = []; let size = 0;
      for await (const part of request) {
        size += part.length; if (size > 8192) throw Error('test proxy payload limit'); parts.push(part);
      }
      const headers = { ...request.headers }; delete headers.host; delete headers['content-length']; delete headers.connection;
      const result = await fetch(upstreamUrl + request.url, { method: request.method, headers,
        ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: Buffer.concat(parts) }), signal: AbortSignal.timeout(10000) });
      response.writeHead(result.status, Object.fromEntries(result.headers)); response.end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(503); response.end('Test upstream unavailable'); }
  });
  const wss = new WebSocketServer({ server, maxPayload: 8192, perMessageDeflate: false });
  wss.on('connection', (client, request) => {
    const upstream = new WebSocket(upstreamUrl.replace(/^http/, 'ws') + '/play', { headers: { Origin: request.headers.origin } });
    const pair = { client, upstream, timers: new Set(), bytes: 0, queued: 0, aborted: false, deadline: null };
    resources.add(pair);
    const abort = pair.abort = () => {
      if (pair.aborted) return;
      pair.aborted = true; clearTimeout(pair.deadline);
      for (const timer of pair.timers) clearTimeout(timer);
      pair.timers.clear(); client.terminate(); upstream.terminate(); resources.delete(pair);
    };
    const settled = () => {
      if (client.readyState === WebSocket.CLOSED && upstream.readyState === WebSocket.CLOSED && !pair.timers.size) {
        clearTimeout(pair.deadline); resources.delete(pair);
      }
    };
    function pipe(from, to) {
      const queue = [];
      let last = 0, timer = null, ended = false, closingCode = 1000;
      const pump = () => {
        clearTimeout(timer); pair.timers.delete(timer); timer = null;
        if (pair.aborted || to.readyState === WebSocket.CONNECTING) return;
        const now = performance.now();
        while (queue.length && (queue[0].at <= now || to.readyState !== WebSocket.OPEN)) {
          const item = queue.shift(); pair.bytes -= item.data.length; pair.queued--;
          if (to.readyState === WebSocket.OPEN) to.send(item.data, { binary: item.binary });
        }
        if (queue.length) {
          timer = setTimeout(pump, Math.max(1, queue[0].at - performance.now())); pair.timers.add(timer);
        } else if (ended && to.readyState === WebSocket.OPEN) {
          // A graceful WebSocket close follows ALL its preceding messages.
          // Do not erase delayed leave/cancel commands on browser close.
          to.close(closingCode);
        }
        settled();
      };
      from.on('message', (data, binary) => {
        if (pair.aborted) return;
        if (pair.queued >= 256 || pair.bytes + data.length > 1048576) { abort(); return; }
        const at = last = Math.max(last, performance.now() + rtt / 2 + (random() * 2 - 1) * jitter);
        const copy = Buffer.from(data); pair.bytes += copy.length; pair.queued++;
        queue.push({ at, data: copy, binary }); pump();
      });
      from.on('close', code => {
        ended = true; closingCode = code === 1000 || code === 1001 || code >= 3000 && code <= 4999 ? code : 1000;
        pair.deadline ??= setTimeout(abort, 5000); pump();
      });
      to.on('open', pump);
    }
    pipe(client, upstream); pipe(upstream, client);
    client.on('error', abort); upstream.on('error', abort);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { url: `http://127.0.0.1:${server.address().port}`, conditions: { rtt, jitter, semantics: 'ordered application-message delay, 40ms each direction plus jitter; not real Internet packet loss' },
    async close() {
      for (const pair of resources) pair.abort();
      await new Promise(resolve => wss.close(resolve));
      await new Promise(resolve => server.close(resolve));
    } };
}
