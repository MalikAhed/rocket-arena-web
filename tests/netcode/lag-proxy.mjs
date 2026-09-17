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
            const parts = [];
            let size = 0;
            for await (const part of request) {
                size += part.length;
                if (size > 8192)
                    throw Error('test proxy payload limit');
                parts.push(part);
            }
            const headers = { ...request.headers };
            delete headers.host;
            delete headers['content-length'];
            delete headers.connection;
            const result = await fetch(upstreamUrl + request.url, { method: request.method, headers,
                ...(['GET', 'HEAD'].includes(request.method) ? {} : { body: Buffer.concat(parts) }), signal: AbortSignal.timeout(10000) });
            response.writeHead(result.status, Object.fromEntries(result.headers));
            response.end(Buffer.from(await result.arrayBuffer()));
        }
        catch {
            response.writeHead(503);
            response.end('Test upstream unavailable');
        }
    });
    const wss = new WebSocketServer({ server, maxPayload: 8192, perMessageDeflate: false });
    wss.on('connection', (client, request) => {
        const upstream = new WebSocket(upstreamUrl.replace(/^http/, 'ws') + '/play', { headers: { Origin: request.headers.origin } });
        const pair = { client, upstream, timers: new Set(), bytes: 0 };
        resources.add(pair);
        function pipe(from, to) {
            let last = 0;
            from.on('message', (data, isBinary) => {
                if (pair.timers.size >= 256 || pair.bytes + data.length > 1048576) {
                    client.terminate();
                    upstream.terminate();
                    return;
                }
                const at = last = Math.max(last, performance.now() + rtt / 2 + (random() * 2 - 1) * jitter);
                const copy = Buffer.from(data);
                pair.bytes += copy.length;
                const timer = setTimeout(() => {
                    pair.timers.delete(timer);
                    pair.bytes -= copy.length;
                    if (to.readyState === WebSocket.OPEN)
                        to.send(copy, { binary: isBinary });
                    else if (to.readyState === WebSocket.CONNECTING)
                        to.once('open', () => to.send(copy, { binary: isBinary }));
                }, Math.max(0, at - performance.now()));
                pair.timers.add(timer);
            });
        }
        pipe(client, upstream);
        pipe(upstream, client);
        const close = () => {
            for (const timer of pair.timers)
                clearTimeout(timer);
            pair.timers.clear();
            client.terminate();
            upstream.terminate();
            resources.delete(pair);
        };
        client.on('error', () => { });
        upstream.on('error', close);
        client.on('close', close);
        upstream.on('close', close);
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    return { url: `http://127.0.0.1:${server.address().port}`, conditions: { rtt, jitter, semantics: 'ordered application-message delay, 40ms each direction plus jitter; not real Internet packet loss' },
        async close() {
            for (const pair of resources) {
                for (const timer of pair.timers)
                    clearTimeout(timer);
                pair.client.terminate();
                pair.upstream.terminate();
            }
            await new Promise(resolve => wss.close(resolve));
            await new Promise(resolve => server.close(resolve));
        } };
}
