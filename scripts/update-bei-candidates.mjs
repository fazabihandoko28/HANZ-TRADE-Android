import fs from 'node:fs/promises';
import process from 'node:process';

const OUT = 'public/bei-candidates.json';
const HEALTH = 'public/bei-health.json';
const MAX = 8;

if (process.env.HANZ_SELF_TEST === '1') {
  const out = sanitize(['BBRI.JK', {ticker:'ANTM'}, 'bad', 'TLKM']);
  if (out.join(',') !== 'BBRI,ANTM,TLKM') throw new Error('BEI sanitizer failed');
  console.log('HANZ BEI updater self-test passed');
  process.exit(0);
}

const existing = await readJson(OUT, { candidates: [] });
let candidates = [];
let source = 'last-known-good/local';
let status = 'no-input';
const url = process.env.BEI_CANDIDATES_URL;

if (url) {
  try {
    const res = await fetch(url, { headers: { accept:'application/json', 'user-agent':'HANZ-BEI-Updater/2.0' }, signal: AbortSignal.timeout(25000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    candidates = sanitize(data?.candidates ?? data?.bei_candidates ?? data);
    source = url;
    status = 'live';
  } catch (e) {
    candidates = sanitize(existing?.candidates ?? []);
    status = candidates.length ? 'stale' : 'unavailable';
    source = `Last known good; remote failed: ${e.message}`;
  }
} else {
  candidates = sanitize(existing?.candidates ?? []);
  status = candidates.length ? 'local' : 'no-candidates';
}

const updated = new Date().toISOString();
await fs.writeFile(OUT, JSON.stringify({ schema_version:1, updated, status, source, candidates }, null, 2) + '\n');
await fs.writeFile(HEALTH, JSON.stringify({ overall: status === 'unavailable' ? 'FAILED' : 'OK', updated, status, source, count:candidates.length }, null, 2) + '\n');
console.log(`BEI candidates updated: ${candidates.length}, status=${status}`);

function sanitize(input) {
  if (!Array.isArray(input)) return [];
  const out=[];
  for (const item of input) {
    const raw=typeof item==='string'?item:item?.ticker;
    const ticker=String(raw??'').toUpperCase().replace(/\.JK$/,'').trim();
    if (/^[A-Z]{4,5}$/.test(ticker) && !out.includes(ticker)) out.push(ticker);
    if (out.length>=MAX) break;
  }
  return out;
}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
