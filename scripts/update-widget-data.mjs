import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PUBLIC = path.join(ROOT, 'public');
const OUTPUT = path.join(PUBLIC, 'widget-data.json');
const HISTORY_FILE = path.join(PUBLIC, 'widget-history.json');
const CANDIDATES_FILE = path.join(PUBLIC, 'bei-candidates.json');
const USER_AGENT = 'Mozilla/5.0 HANZ-Trade-Updater/1.6';

if (process.env.HANZ_SELF_TEST === '1') {
  runSelfTest();
  process.exit(0);
}

const now = new Date();
const today = dateKey(now);
const existing = await readJson(OUTPUT, {});
const history = await readJson(HISTORY_FILE, {});
const previousDay = findPrevious(history, today);

const [fxResult, uaeResult, antamResult, candidateResult] = await Promise.allSettled([
  fetchFx(),
  fetchUaeGold(),
  fetchAntam(),
  fetchCandidates()
]);

const fx = valueOrNull(fxResult, 'FX');
const uae = valueOrNull(uaeResult, 'UAE gold');
const antam = valueOrNull(antamResult, 'ANTAM');
const candidates = valueOrNull(candidateResult, 'Candidates') ?? existing.bei_candidates ?? [];

const current = {
  usd_idr: firstPositive(fx?.usd_idr, numberEnv('USD_IDR'), existing?.usd_idr?.price),
  aed_idr: firstPositive(fx?.aed_idr, numberEnv('AED_IDR'), existing?.aed_idr?.price),
  uae_gold_24k: firstPositive(uae?.price, numberEnv('UAE_GOLD_24K_AED'), existing?.uae_gold_24k?.price),
  antam_gold_1g: firstPositive(antam?.price, numberEnv('ANTAM_GOLD_1G_IDR'), existing?.antam_gold_1g?.price)
};

for (const key of Object.keys(current)) {
  if (!(current[key] > 0)) throw new Error(`${key} unavailable and no last-known-good value exists`);
}

const previousOverride = {
  usd_idr: firstPositive(fx?.previous_usd_idr),
  aed_idr: firstPositive(fx?.previous_aed_idr),
  uae_gold_24k: firstPositive(uae?.previous),
  antam_gold_1g: firstPositive(antam?.previous)
};

const response = buildResponse({ current, previousDay, previousOverride, candidates, now });
validatePayload(response);

history[today] = { ...current };
pruneHistory(history, 45);
await fs.writeFile(OUTPUT, JSON.stringify(response, null, 2) + '\n');
await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n');
console.log(`Updated widget-data.json; candidates=${response.bei_candidates.length}`);

async function fetchFx() {
  const fixtureUsd = numberEnv('USD_IDR');
  const fixtureAed = numberEnv('AED_IDR');
  if (fixtureUsd && fixtureAed) return { usd_idr: fixtureUsd, aed_idr: fixtureAed };

  const latest = await fetchJson('https://api.frankfurter.dev/v2/rates?base=USD&quotes=IDR,AED');
  const latestMap = rateArrayToMap(latest);
  const yesterday = new Date(Date.now() - 86400000);
  const date = dateKey(yesterday);
  let priorMap = {};
  try {
    priorMap = rateArrayToMap(await fetchJson(`https://api.frankfurter.dev/v2/rates?base=USD&quotes=IDR,AED&date=${date}`));
  } catch (error) {
    warn('FX history', error);
  }
  const idr = Number(latestMap.IDR);
  const aed = Number(latestMap.AED);
  if (!(idr > 0 && aed > 0)) throw new Error('Frankfurter returned incomplete rates');
  return {
    usd_idr: idr,
    aed_idr: idr / aed,
    previous_usd_idr: Number(priorMap.IDR) || null,
    previous_aed_idr: Number(priorMap.IDR) > 0 && Number(priorMap.AED) > 0 ? Number(priorMap.IDR) / Number(priorMap.AED) : null
  };
}

async function fetchUaeGold() {
  const override = numberEnv('UAE_GOLD_24K_AED');
  const overridePrev = numberEnv('UAE_GOLD_24K_PREVIOUS_AED');
  if (override) return { price: override, previous: overridePrev };
  const html = await fetchText('https://gulfnews.com/gold-forex');
  const text = cleanHtml(html);
  const match = text.match(/24\s*Carat\s*[|:]?\s*([0-9]{3}(?:\.[0-9]{1,2})?)[\s|\-]*[0-9.\-]*[\s|\-]*[0-9.\-]*[\s|]+([0-9]{3}(?:\.[0-9]{1,2})?)/i)
    ?? text.match(/24\s*Carat[^0-9]{0,80}([0-9]{3}(?:\.[0-9]{1,2})?)[^0-9]{0,120}([0-9]{3}(?:\.[0-9]{1,2})?)/i);
  if (!match) throw new Error('Unable to parse Gulf News 24K rate');
  return { price: Number(match[1]), previous: Number(match[2]) };
}

async function fetchAntam() {
  const override = numberEnv('ANTAM_GOLD_1G_IDR');
  const overridePrev = numberEnv('ANTAM_GOLD_1G_PREVIOUS_IDR');
  if (override) return { price: override, previous: overridePrev };

  try {
    const data = await fetchJson('https://logam-mulia-api.iamutaki.workers.dev/api/prices/logammulia');
    const rows = Array.isArray(data?.data) ? data.data : [];
    const row = rows.find(x => Number(x?.weight) === 1 && String(x?.weightUnit ?? '').toLowerCase().startsWith('gr'));
    const price = Number(row?.sellPrice);
    if (!(price > 0)) throw new Error('1g ANTAM row missing');
    return { price, previous: null };
  } catch (apiError) {
    warn('Community ANTAM API', apiError);
    const html = await fetchText('https://www.logammulia.com/en/harga-emas-hari-ini');
    const text = cleanHtml(html);
    const match = text.match(/\b1\s*gr\b[^0-9]{0,80}([0-9.,]{7,15})/i);
    if (!match) throw new Error('Unable to parse official ANTAM 1g price');
    return { price: parseIdr(match[1]), previous: null };
  }
}

async function fetchCandidates() {
  const env = process.env.BEI_STRONG_CANDIDATES;
  if (env) return sanitizeCandidates(env.split(','));
  const remote = process.env.BEI_CANDIDATES_URL;
  if (remote) {
    const data = await fetchJson(remote);
    return sanitizeCandidates(data?.candidates ?? data?.bei_candidates ?? data);
  }
  const local = await readJson(CANDIDATES_FILE, []);
  return sanitizeCandidates(local?.candidates ?? local?.bei_candidates ?? local);
}

function buildResponse({ current, previousDay, previousOverride, candidates, now }) {
  const prior = previousDay?.data ?? {};
  return {
    schema_version: 1,
    ok: true,
    partial: false,
    updated: now.toISOString(),
    comparison_date: previousDay?.date ?? dateKey(new Date(now.getTime() - 86400000)),
    usd_idr: marketItem(current.usd_idr, firstPositive(previousOverride.usd_idr, prior.usd_idr), 'IDR', 'Frankfurter'),
    aed_idr: marketItem(current.aed_idr, firstPositive(previousOverride.aed_idr, prior.aed_idr), 'IDR', 'Frankfurter'),
    uae_gold_24k: marketItem(current.uae_gold_24k, firstPositive(previousOverride.uae_gold_24k, prior.uae_gold_24k), 'AED/g', 'Gulf News / Dubai Gold & Jewellery Group'),
    antam_gold_1g: marketItem(current.antam_gold_1g, firstPositive(previousOverride.antam_gold_1g, prior.antam_gold_1g), 'IDR/1g', 'ANTAM Logam Mulia'),
    bei_candidates: sanitizeCandidates(candidates)
  };
}

function marketItem(price, previous, unit, source) {
  const p = Number(price);
  const prev = Number(previous);
  const change = prev > 0 ? ((p - prev) / prev) * 100 : 0;
  return {
    price: round(p, unit.startsWith('AED') ? 2 : 2),
    previous: prev > 0 ? round(prev, 2) : null,
    change_pct: round(change, 2),
    unit,
    source
  };
}

function validatePayload(payload) {
  if (payload.schema_version !== 1 || payload.ok !== true || payload.partial !== false) throw new Error('Invalid payload header');
  if (!/^\d{4}-\d{2}-\d{2}T/.test(payload.updated)) throw new Error('Invalid timestamp');
  for (const key of ['usd_idr','aed_idr','uae_gold_24k','antam_gold_1g']) {
    const item = payload[key];
    if (!(item?.price > 0) || !Number.isFinite(item.change_pct)) throw new Error(`Invalid ${key}`);
  }
  if (!Array.isArray(payload.bei_candidates)) throw new Error('Candidates must be an array');
}

function runSelfTest() {
  const payload = buildResponse({
    current: { usd_idr: 17938.8, aed_idr: 4884.63, uae_gold_24k: 492.75, antam_gold_1g: 2622000 },
    previousDay: { date: '2026-07-26', data: { usd_idr: 17893.9, aed_idr: 4872.4, uae_gold_24k: 488.5, antam_gold_1g: 2612000 } },
    previousOverride: {}, candidates: ['BBRI.JK','ANTM','bad','TLKM'], now: new Date('2026-07-27T08:00:00Z')
  });
  validatePayload(payload);
  if (payload.usd_idr.change_pct !== 0.25) throw new Error('USD change test failed');
  if (payload.uae_gold_24k.change_pct !== 0.87) throw new Error('UAE gold change test failed');
  if (payload.bei_candidates.join(',') !== 'BBRI,ANTM,TLKM') throw new Error('Candidate sanitation test failed');
  console.log('HANZ v1.6 self-test passed');
}

function rateArrayToMap(data) {
  const out = {};
  if (Array.isArray(data)) for (const row of data) out[String(row.quote)] = Number(row.rate);
  return out;
}
function parseIdr(value) { return Number(String(value).replace(/[^0-9]/g, '')); }
function valueOrNull(result, label) { if (result.status === 'fulfilled') return result.value; warn(label, result.reason); return null; }
function firstPositive(...values) { for (const value of values) { const n = Number(value); if (Number.isFinite(n) && n > 0) return n; } return null; }
function findPrevious(history, todayKey) { const key = Object.keys(history).filter(k => k < todayKey).sort().reverse()[0]; return key ? { date: key, data: history[key] } : null; }
function pruneHistory(history, keep) { const keys = Object.keys(history).sort(); while (keys.length > keep) delete history[keys.shift()]; }
function sanitizeCandidates(input) { if (!Array.isArray(input)) return []; const out=[]; for (const item of input) { const raw=typeof item==='string'?item:item?.ticker; const ticker=String(raw??'').toUpperCase().replace(/\.JK$/,'').trim(); if (/^[A-Z]{4,5}$/.test(ticker)&&!out.includes(ticker)) out.push(ticker); if(out.length>=8) break; } return out; }
async function fetchJson(url) { const r=await fetchWithTimeout(url,{headers:{accept:'application/json','user-agent':USER_AGENT}}); if(!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r.json(); }
async function fetchText(url) { const r=await fetchWithTimeout(url,{headers:{accept:'text/html','user-agent':USER_AGENT}}); if(!r.ok) throw new Error(`HTTP ${r.status} ${url}`); return r.text(); }
async function fetchWithTimeout(url, options) { const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),25000); try{return await fetch(url,{...options,signal:controller.signal});} finally{clearTimeout(timer);} }
async function readJson(file,fallback) { try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;} }
function cleanHtml(html) { return html.replace(/&nbsp;/g,' ').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/\s+/g,' '); }
function dateKey(date) { return date.toISOString().slice(0,10); }
function numberEnv(name) { const n=Number(process.env[name]); return Number.isFinite(n)&&n>0?n:null; }
function round(value,digits) { const p=10**digits; return Math.round((Number(value)+Number.EPSILON)*p)/p; }
function warn(label,error) { console.warn(`${label}: ${error?.message ?? error}`); }
