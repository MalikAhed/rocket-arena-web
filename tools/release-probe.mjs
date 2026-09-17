// Bounded public inspection only; no account/service writes or keepalive loop.
import { mkdir, writeFile } from 'node:fs/promises';
const backend = 'https://rocket-arena-online-beta.onrender.com';
const targets = [
  ['https://malikahed.github.io/rocket-arena-web/', null],
  ['https://malikahed.github.io/rocket-arena-web/assets/online/config.json', null],
  ['https://rocket-arena-online-preview.onrender.com/assets/online/config.json', null],
  [backend + '/healthz', null], [backend + '/readyz', 'https://malikahed.github.io'],
  [backend + '/readyz', 'https://rocket-arena-online-preview.onrender.com'],
];
const reports = await Promise.all(targets.map(async ([url,origin]) => {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(90000), headers: origin ? { Origin: origin } : {} });
    const text = (await response.text()).slice(0,16384);
    let data; try { data = JSON.parse(text); } catch {}
    const safe = {};
    for (const key of ['serverUrl','supabaseUrl','ready','protocol','region','ranked','rooms','capacity','status','beta','build','error']) if (data && key in data) safe[key] = data[key];
    return { url, origin, status:response.status, finalUrl:response.url, allowOrigin:response.headers.get('access-control-allow-origin'), type:response.headers.get('content-type'), data:safe,
      title:text.match(/<title>([^<]*)<\/title>/i)?.[1] ?? null };
  } catch (error) { return {url,origin,error:error.name}; }
}));
const report={checkedAt:new Date().toISOString(),reports};
await mkdir('evidence',{recursive:true}); await writeFile('evidence/release-probe.json',JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
