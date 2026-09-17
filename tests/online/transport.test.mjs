import test from 'node:test';
import assert from 'node:assert/strict';
import { Transport } from '../../src/online/transport.js';

function fixture() {
  const previous = globalThis.WebSocket, sockets = [], states = [], messages = [];
  class Socket {
    static OPEN = 1; static CLOSING = 2;
    constructor(url) { this.url = url; this.readyState = 1; this.sent = []; sockets.push(this); }
    send(data) { this.sent.push(JSON.parse(data)); }
    close(code = 1000) { this.readyState = 3; this.onclose?.({ code }); }
    message(message) { this.onmessage({ data: JSON.stringify(message) }); }
  }
  globalThis.WebSocket = Socket;
  const transport = new Transport({ serverUrl: 'https://game.example', token: 'test-only', onState: s => states.push(s), onMessage: m => messages.push(m), onSnapshot() {} });
  return { transport, sockets, states, messages, restore() { transport.stop(); globalThis.WebSocket = previous; } };
}
test('private waiting room handshake enables bounded reconnect without declaring a match', () => {
  const f = fixture();
  try {
    f.transport.connect(); const socket = f.sockets[0]; socket.onopen();
    assert.equal(socket.sent[0].type, 'hello');
    socket.message({ type: 'private_room', graceMs: 30000 });
    assert(f.transport.connected && f.transport.inLobby); assert(!f.transport.inMatch);
    socket.close(1006); assert.equal(f.states.at(-1), 'reconnecting');
    assert(f.transport.reconnectTimer);
  } finally { f.restore(); }
});
test('session replacement is terminal; the old tab never steals the slot back', () => {
  const f = fixture();
  try {
    f.transport.connect(); const socket = f.sockets[0]; socket.onopen();
    socket.message({ type: 'reserved', graceMs: 30000 }); socket.close(4001);
    assert.equal(f.states.at(-1), 'session_replaced'); assert(f.transport.stopped); assert(!f.transport.reconnectTimer);
    f.transport.connect(); assert.equal(f.sockets.length, 1);
  } finally { f.restore(); }
});
test('stale socket events cannot disrupt the new connection; leaving clears timers', () => {
  const f = fixture();
  try {
    f.transport.connect(); const old = f.sockets[0]; old.message({ type: 'private_room', graceMs: 30000 });
    f.transport.connect(); const current = f.sockets[1]; current.message({ type: 'private_room', graceMs: 30000 });
    const heartbeat = f.transport.heartbeat; old.close(1006);
    assert(f.transport.connected); assert.equal(f.transport.heartbeat, heartbeat);
    old.message({ type: 'reserved' }); assert(!f.transport.inMatch);
    current.message({ type: 'private_closed' }); assert(!f.transport.inLobby);
  } finally { f.restore(); }
});

test('browser congestion: close code is script-legal and enters authenticated reconnect without throwing', () => {
  const f=fixture();
  try {
    f.transport.connect(); const socket=f.sockets[0]; socket.message({type:'reserved',graceMs:30000});
    const originalClose=socket.close.bind(socket); let usedCode;
    socket.close=code=>{ if(code!==1000 && (code<3000 || code>4999)) throw new DOMException('Invalid close code','InvalidAccessError'); usedCode=code; originalClose(code); };
    socket.bufferedAmount=20000;
    assert.doesNotThrow(()=>assert.equal(f.transport.send({type:'input',seq:1}),false));
    assert.equal(usedCode,4013); assert.equal(f.states.at(-1),'reconnecting');
  } finally { f.restore(); }
});
