// Bounded public HTTP inspection only. No provider writes, accounts or keepalive.
import { mkdir, writeFile } from 'node:fs/promises';
const targets = [
  'https://malikahed.github.io/rocket-arena-web/',
  'https://malikahed.github.io/rocket-arena-web/assets/online/config.json',
  'https://rocket-arena-online-preview.onrender.com/assets/online/config.json',
  'https://rocket-arena-online-beta.onrender.com/healthz',
  'https://rocket-arena-online-beta.onrender.com/readyz',
];
const reports = await Promise.all(targets.map(async url => {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(90000), headers: { Origin: 'https://malikahed.github.io' } });
    const text = (await r.text()).slice(0,16384);
    let data; try { data = JSON.parse(text); } catch {}
    const safe = {};
    for (const key of ['serverUrl','supabaseUrl','ready','protocol','region','ranked','rooms','capacity','status','beta']) if (data && key in data) safe[key] = data[key];
    if (data?.publishableKey) {
      const key=data.publishableKey;
      const isPublic=key.startsWith('sb_publishable_') || (()=>{try{return JSON.parse(Buffer.from(key.split('.')[1], 'base64url')).role==='anon';}catch{return false;}})();
      if (isPublic) safe.publishableKey=key; else safe.invalidPrivilegedKey=true;
    }
    return { url, status:r.status, finalUrl:r.url, allowOrigin:r.headers.get('access-control-allow-origin'), type:r.headers.get('content-type'), data:safe,
      title: text.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null };
  } catch (error) { return { url, error:error.name }; }
}));
const report={checkedAt:new Date().toISOString(),reports};
await mkdir('evidence',{recursive:true}); await writeFile('evidence/release-probe.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
