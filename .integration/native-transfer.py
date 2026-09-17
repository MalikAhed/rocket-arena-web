# One-time lossless source transfer. This parses data; it never executes it.
# Compressed chunks and before/after source hashes are fixed and verified.
import gzip, hashlib, json
from pathlib import Path
ALLOWED = {'Dockerfile','docs/online-play/NATIVE_CHECKPOINT.md','server/index.mjs','server/native.mjs','server/room.mjs','src/app/startup.js','src/online/checkpoint.js','src/online/interface.js','src/online/prediction.js','src/online/protocol.js','src/online/transport.js','src/physics/simulation.js','src/physics/source-runtime.js','tests/netcode/harness.mjs','tests/netcode/native-checkpoint.mjs','tests/online/browser.mjs','tests/online/checkpoint.test.mjs','tools/verify.mjs'}
GENERATED = {
 'public/physics/rocketsim-network.js': '4c4346e67aece5db48cafce63005f43a683c3e4d390f58a9c7ddb0957bc81a83',
 'public/physics/rocketsim-network.wasm': '6d92e76f35d6cd7e5df76fede54f690bdb6f0394f48cb81f3bc742871bec1992',
 'public/physics/rocketsim-network-build.json': '03ed61d5475133da3d5713151e60a6245b0c56f44922feea916bf4993da769a3',
 'src/physics/network-core.js': '5034e71e33f8c3a26aecbe414d8523d53507e8c74d7d83dd843c0166fea2d0e2'
}
hash_bytes = lambda b: hashlib.sha256(b).hexdigest() if b is not None else None
packed = b''.join(Path(f'.integration/native-transfer.part{i}').read_bytes() for i in range(4))
assert hash_bytes(packed) == '1a4a4f4c4a65dcc7b491bbace6d3fbd7454fed2b7eb0fa04c4bd2e49cfb04d0f', 'Transfer corruption'
raw = gzip.decompress(packed)
assert hash_bytes(raw) == '87fb47266e4927a53c046322160fbfc7d5c745830bf9dc484cef4392a531323e'
FILES = json.loads(raw)
assert set(FILES) == ALLOWED, 'Unexpected transfer paths'
def apply():
 outputs = {}
 for name, spec in FILES.items():
  path = Path(name); before = path.read_bytes() if path.exists() else None
  assert hash_bytes(before) == spec['before'], f'Concurrent source change: {name}'
  if before is None: after = spec['content'].encode()
  else:
   lines = before.decode().splitlines(keepends=True)
   for start,end,replacement in reversed(spec['edits']): lines[start:end] = replacement.splitlines(keepends=True)
   after = ''.join(lines).encode()
  assert hash_bytes(after) == spec['after'], f'Output corruption: {name}'
  outputs[path] = after
 for path, content in outputs.items(): path.parent.mkdir(parents=True,exist_ok=True); path.write_bytes(content)
 print('Applied',len(outputs),'hash-verified tested source files')
def verify_outputs():
 for name,spec in FILES.items(): assert hash_bytes(Path(name).read_bytes()) == spec['after'], name
 for name,sha in GENERATED.items(): assert hash_bytes(Path(name).read_bytes()) == sha, name
if __name__ == '__main__': apply()
