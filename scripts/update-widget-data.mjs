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
const HEALTH_FILE = path.join(PUBLIC, 'health.json');
const USER_AGENT = 'HANZ-Trade-Updater/2.0 (+https://hanz-trade.netlify.app)';
const TROY_OUNCE_GRAMS = 31.1034768;
const USD_AED_PEG = 3.6725;

if (process.env.HANZ_SELF_TEST === '1') {
  runSelfTest();
  process.exit(0);
}

const now = new Date();
const today = dateKey(now);
const existing = await readJson(OUTPUT, {});
const history = await readJson(HISTORY_FILE, {});
const previousDay = findPrevious(history, today);
const diagnostics = [];

const [fx, uaeGold, antam, candidateData] = await Promise.all([
  fetchFxResilient(diagnostics),
  fetchUaeGoldResilient(diagnostics),
  fetchAntamResilient(diagnostics),
  fetchCandidatesResilient(diagnostics)
]);

const values = {
  usd_idr: resolveValue(fx?.usd_idr, existing?.usd_idr, 'USD/IDR'),
  aed_idr: resolveValue(fx?.aed_idr, existing?.aed_idr, 'AED/IDR'),
  uae_gold_24k: resolveValue(uaeGold?.item, existing?.uae_gold_24k, 'UAE Gold 24K'),
  antam_gold_1g: resolveValue(antam?.item, existing?.antam_gold_1g, 'ANTAM 1g')
};

for (const [key, value] of Object.entries(values)) {
  if (!(value.price > 0)) throw new Error(`${key} unavailable: all sources failed and no verified last-known-good value exists`);
}

const prior = previousDay?.data ?? {};
const candidates = candidateData?.items ?? sanitizeCandidates(existing.bei_candidates ?? []);
const response = {
  schema_version: 4,
  ok: true,
  partial: Object.values(values).some(v => !v.live) || diagnostics.some(d => d.level === 'error'),
  updated: now.toISOString(),
  comparison_date: previousDay?.date ?? null,
  usd_idr: marketItem(values.usd_idr, firstPositive(fx?.previous_usd_idr, prior.usd_idr), 'IDR'),
  aed_idr: marketItem(values.aed_idr, firstPositive(fx?.previous_aed_idr, prior.aed_idr), 'IDR'),
  uae_gold_24k: marketItem(values.uae_gold_24k, firstPositive(uaeGold?.previous, prior.uae_gold_24k), 'AED/g'),
  antam_gold_1g: marketItem(values.antam_gold_1g, firstPositive(antam?.previous, prior.antam_gold_1g), 'IDR/1g'),
  bei_candidates: candidates,
  bei_candidates_source: candidateData?.source ?? 'last-known-good/local',
  diagnostics
};
validatePayload(response);

history[today] = {
  usd_idr: response.usd_idr.price,
  aed_idr: response.aed_idr.price,
  uae_gold_24k: response.uae_gold_24k.price,
  antam_gold_1g: response.antam_gold_1g.price
};
pruneHistory(history, 90);
await fs.writeFile(OUTPUT, JSON.stringify(response, null, 2) + '\n');
await fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 2) + '\n');
const health = buildHealth(response);
await fs.writeFile(HEALTH_FILE, JSON.stringify(health, null, 2) + '\n');
console.log(`Updated widget data: overall=${health.overall}, partial=${response.partial}, candidates=${candidates.length}`);

async function fetchFxResilient(diag) {
  const providers = [fetchFxFrankfurter, fetchFxOpenErApi];
  const results = await collectProviders('FX', providers, diag);
  if (!results.length) return null;
  const best = results[0];
  return best.value;
}

async function fetchFxFrankfurter() {
  const latest = await fetchJson('https://api.frankfurter.dev/v1/latest?base=USD&symbols=IDR,AED');
  const idr = Number(latest?.rates?.IDR);
  const aed = Number(latest?.rates?.AED);
  validateFx(idr, aed);
  let prior = null;
  try {
    const date = dateKey(new Date(Date.now() - 86400000));
    prior = await fetchJson(`https://api.frankfurter.dev/v1/${date}?base=USD&symbols=IDR,AED`);
  } catch {}
  const priorIdr = Number(prior?.rates?.IDR);
  const priorAed = Number(prior?.rates?.AED);
  return {
    usd_idr: { price: idr, source: `Frankfurter (${latest.date ?? 'latest'})`, provider_count: 1 },
    aed_idr: { price: idr / aed, source: `Frankfurter-derived (${latest.date ?? 'latest'})`, provider_count: 1 },
    previous_usd_idr: priorIdr > 0 ? priorIdr : null,
    previous_aed_idr: priorIdr > 0 && priorAed > 0 ? priorIdr / priorAed : null
  };
}

async function fetchFxOpenErApi() {
  const data = await fetchJson('https://open.er-api.com/v6/latest/USD');
  if (data?.result && data.result !== 'success') throw new Error(`Open ER API result=${data.result}`);
  const idr = Number(data?.rates?.IDR);
  const aed = Number(data?.rates?.AED);
  validateFx(idr, aed);
  return {
    usd_idr: { price: idr, source: 'ExchangeRate-API open endpoint', provider_count: 1 },
    aed_idr: { price: idr / aed, source: 'ExchangeRate-API-derived', provider_count: 1 },
    previous_usd_idr: null,
    previous_aed_idr: null
  };
}

function validateFx(idr, aed) {
  if (!(idr >= 10000 && idr <= 30000)) throw new Error(`Implausible USD/IDR ${idr}`);
  if (!(aed >= 3.5 && aed <= 3.9)) throw new Error(`Implausible USD/AED ${aed}`);
}

async function fetchUaeGoldResilient(diag) {
  const providers = [fetchUaeRetailGulfNews, fetchUaeSpotGoldApi, fetchUaeSpotHargaEmas];
  const results = await collectProviders('UAE gold', providers, diag);
  if (!results.length) return null;
  const retail = results.find(r => r.value.kind === 'retail');
  const chosen = retail ?? chooseMedianResult(results, r => r.value.item.price);
  return chosen.value;
}

async function fetchUaeRetailGulfNews() {
  const html = await fetchText('https://gulfnews.com/gold-forex');
  const parsed = parseUaeGoldRetail(cleanHtml(html));
  return {
    item: { price: parsed.price, source: 'Gulf News / Dubai Gold & Jewellery Group retail', provider_count: 1, quote_type: 'retail' },
    previous: parsed.previous,
    kind: 'retail'
  };
}

async function fetchUaeSpotGoldApi() {
  const data = await fetchJson('https://api.gold-api.com/price/XAU');
  const usdOz = firstPositive(data?.price, data?.ask, data?.value);
  if (!(usdOz >= 500 && usdOz <= 10000)) throw new Error(`Implausible XAU USD/oz ${usdOz}`);
  const price = usdOz / TROY_OUNCE_GRAMS * USD_AED_PEG;
  return {
    item: { price, source: 'Gold-API spot × USD/AED peg', provider_count: 1, quote_type: 'spot' },
    previous: null,
    kind: 'spot'
  };
}

async function fetchUaeSpotHargaEmas() {
  const html = await fetchText('https://harga-emas.org/');
  const usdOz = parseWorldGoldUsdOz(cleanHtml(html));
  const price = usdOz / TROY_OUNCE_GRAMS * USD_AED_PEG;
  return {
    item: { price, source: 'Harga-Emas.org world spot × USD/AED peg', provider_count: 1, quote_type: 'spot' },
    previous: null,
    kind: 'spot'
  };
}

async function fetchAntamResilient(diag) {
  const providers = [fetchAntamHargaEmasOrg, fetchAntamHargaEmasCom, fetchAntamOfficial];
  const results = await collectProviders('ANTAM', providers, diag);
  if (!results.length) return null;
  const accepted = rejectOutliers(results, r => r.value.item.price, 0.08);
  const chosenPool = accepted.length ? accepted : results;
  const chosen = chooseMedianResult(chosenPool, r => r.value.item.price);
  const verifiedBy = accepted.length;
  return {
    item: {
      ...chosen.value.item,
      source: verifiedBy >= 2 ? `${chosen.value.item.source}; cross-checked by ${verifiedBy} sources` : chosen.value.item.source,
      provider_count: Math.max(1, verifiedBy)
    },
    previous: chosen.value.previous ?? null
  };
}

async function fetchAntamHargaEmasOrg() {
  const html = await fetchText('https://harga-emas.org/');
  const price = parseAntamHargaEmasOrg(cleanHtml(html));
  return { item: { price, source: 'Harga-Emas.org ANTAM table', provider_count: 1 }, previous: null };
}

async function fetchAntamHargaEmasCom() {
  const html = await fetchText('https://www.hargaemas.com/');
  const price = parseAntamGeneric(cleanHtml(html));
  return { item: { price, source: 'HargaEmas.com ANTAM listing', provider_count: 1 }, previous: null };
}

async function fetchAntamOfficial() {
  const html = await fetchText('https://www.logammulia.com/harga-emas-hari-ini');
  const price = parseAntamGeneric(cleanHtml(html));
  return { item: { price, source: 'ANTAM Logam Mulia official', provider_count: 1 }, previous: null };
}

async function fetchCandidatesResilient(diag) {
  try { return await fetchCandidates(); }
  catch (error) { diag.push({ level: 'warning', group: 'Candidates', provider: 'candidate source', message: error.message }); return null; }
}

async function fetchCandidates() {
  const remote = process.env.BEI_CANDIDATES_URL;
  if (remote) {
    const data = await fetchJson(remote);
    return { items: sanitizeCandidates(data?.candidates ?? data?.bei_candidates ?? data), source: remote };
  }
  const local = await readJson(CANDIDATES_FILE, { candidates: [] });
  return { items: sanitizeCandidates(local?.candidates ?? local?.bei_candidates ?? local), source: 'public/bei-candidates.json' };
}

async function collectProviders(group, providers, diag) {
  const settled = await Promise.allSettled(providers.map(fn => fn()));
  const good = [];
  settled.forEach((result, index) => {
    const provider = providers[index].name;
    if (result.status === 'fulfilled') {
      good.push({ provider, value: result.value });
      diag.push({ level: 'info', group, provider, message: 'success' });
    } else {
      diag.push({ level: 'warning', group, provider, message: String(result.reason?.message ?? result.reason) });
    }
  });
  return good;
}

function parseUaeGoldRetail(text) {
  const normalized = String(text).replace(/,/g, ' ').replace(/\s+/g, ' ');
  const patterns = [
    /24\s*Carat\s+([0-9]{3}(?:\.[0-9]{1,2})?)(?:\s+-){0,3}\s+([0-9]{3}(?:\.[0-9]{1,2})?)/i,
    /24\s*Carat[^0-9]{0,120}([0-9]{3}(?:\.[0-9]{1,2})?)[^0-9]{0,180}Yesterday[^0-9]{0,60}([0-9]{3}(?:\.[0-9]{1,2})?)/i,
    /24\s*(?:K|Karat|Carat)[^0-9]{0,80}([0-9]{3}(?:\.[0-9]{1,2})?)/i
  ];
  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (match) {
      const price = Number(match[1]);
      const previous = Number(match[2]);
      if (price >= 100 && price <= 2000) return { price, previous: previous >= 100 && previous <= 2000 ? previous : null };
    }
  }
  throw new Error('Unable to parse UAE 24K retail rate');
}

function parseWorldGoldUsdOz(text) {
  const normalized = String(text).replace(/\s+/g, ' ');
  const patterns = [
    /USD\s*\(Spot Dunia\)\s*\$?([0-9.,]{4,12})/i,
    /USD\/oz\s*\$?([0-9.,]{4,12})/i,
    /Gold[^$]{0,80}\$([0-9.,]{4,12})\s*\/oz/i
  ];
  for (const p of patterns) {
    const m = normalized.match(p);
    if (m) {
      const n = parseInternationalNumber(m[1]);
      if (n >= 500 && n <= 10000) return n;
    }
  }
  throw new Error('Unable to parse world gold USD/oz');
}

function parseAntamHargaEmasOrg(text) {
  const normalized = String(text).replace(/\s+/g, ' ');
  const patterns = [
    /Antam[^]{0,5000}?\b1\s+(?:Rp\s*)?([0-9.]{7,15})\s+(?:Rp\s*)?[0-9.]{7,15}/i,
    /\b1\s+([0-9.]{7,15})\s+[0-9.]{7,15}\s+2\s+/i
  ];
  for (const p of patterns) {
    const m = normalized.match(p);
    if (m) {
      const price = parseIdr(m[1]);
      if (isPlausibleAntam(price)) return price;
    }
  }
  throw new Error('Unable to parse Harga-Emas.org ANTAM 1g');
}

function parseAntamGeneric(text) {
  const normalized = String(text).replace(/\s+/g, ' ');
  const patterns = [
    /(?:ANTAM[^]{0,800}?)?\b1\s*(?:gr|gram)\b[^0-9]{0,120}(?:Rp\s*)?([0-9.,]{7,15})/i,
    /(?:^|\s)1\s*(?:gr|gram)?\s+(?:Rp\s*)?([0-9.]{7,15})/i,
    /Price\/gram\s*IDR\s*([0-9,.]{7,15})/i
  ];
  for (const p of patterns) {
    const m = normalized.match(p);
    if (m) {
      const price = parseIdr(m[1]);
      if (isPlausibleAntam(price)) return price;
    }
  }
  throw new Error('Unable to parse ANTAM 1g price');
}

function isPlausibleAntam(price) { return price >= 500000 && price <= 10000000; }
function rejectOutliers(results, selector, tolerance) {
  if (results.length < 2) return results;
  const median = medianOf(results.map(selector));
  return results.filter(r => Math.abs(selector(r) - median) / median <= tolerance);
}
function chooseMedianResult(results, selector) {
  return [...results].sort((a,b) => selector(a)-selector(b))[Math.floor((results.length-1)/2)];
}
function medianOf(values) { const s=[...values].sort((a,b)=>a-b); const m=Math.floor(s.length/2); return s.length%2?s[m]:(s[m-1]+s[m])/2; }

function resolveValue(liveItem, existingItem, label) {
  const livePrice = Number(liveItem?.price);
  if (livePrice > 0) return { price: livePrice, source: liveItem.source, live: true, provider_count: liveItem.provider_count ?? 1, quote_type: liveItem.quote_type };
  const oldPrice = Number(existingItem?.price);
  if (oldPrice > 0 && existingItem?.verified !== false) return { price: oldPrice, source: `Last known good: ${existingItem.source ?? label}`, live: false, provider_count: existingItem.provider_count ?? 0, quote_type: existingItem.quote_type };
  return { price: null, source: 'Unavailable', live: false, provider_count: 0 };
}

function marketItem(value, previous, unit) {
  const prev = Number(previous);
  return {
    price: round(value.price, 2),
    previous: prev > 0 ? round(prev, 2) : null,
    change_pct: prev > 0 ? round(((value.price - prev) / prev) * 100, 2) : 0,
    unit,
    source: value.source,
    status: value.live ? (value.provider_count >= 2 ? 'verified-live' : 'live') : 'stale',
    live: value.live,
    verified: true,
    provider_count: value.provider_count,
    ...(value.quote_type ? { quote_type: value.quote_type } : {})
  };
}

function validatePayload(payload) {
  if (payload.schema_version !== 4 || payload.ok !== true) throw new Error('Invalid payload header');
  for (const key of ['usd_idr','aed_idr','uae_gold_24k','antam_gold_1g']) {
    const item = payload[key];
    if (!(item?.price > 0) || !Number.isFinite(item.change_pct) || typeof item.source !== 'string' || !['verified-live','live','stale'].includes(item.status)) throw new Error(`Invalid ${key}`);
  }
  if (!Array.isArray(payload.bei_candidates)) throw new Error('Candidates must be an array');
}

function runSelfTest() {
  validateFx(16300, 3.6725);
  const uae = parseUaeGoldRetail('24 Carat 492.75 - - - 488.50 22 Carat 456.25');
  if (uae.price !== 492.75 || uae.previous !== 488.5) throw new Error('UAE retail parser failed');
  const spot = parseWorldGoldUsdOz('USD (Spot Dunia) $4.092,25 (+39,37) /oz');
  if (spot !== 4092.25) throw new Error(`World spot parser failed ${spot}`);
  const antamOrg = parseAntamHargaEmasOrg('Antam, mulai dari 1 gram. Gram per Gram (Rp) per Gram (Rp) 0.5 1.343.500 1.132.500 1 2.445.000 2.265.000 2 4.823.000 4.530.000');
  if (antamOrg !== 2445000) throw new Error(`Harga-Emas.org parser failed ${antamOrg}`);
  const antamGeneric = parseAntamGeneric('ANTAM Emas Batangan 0.5 gr Rp1.469.500 1 gram Rp2.839.000 2 gram Rp5.618.000');
  if (antamGeneric !== 2839000) throw new Error(`ANTAM generic parser failed ${antamGeneric}`);
  const fake = [2445000, 2460000, 9000000].map((price,i)=>({value:{item:{price}},provider:String(i)}));
  const accepted = rejectOutliers(fake, r=>r.value.item.price, 0.08);
  if (accepted.length !== 2) throw new Error('Outlier rejection failed');
  const c = sanitizeCandidates(['BBRI.JK','ANTM','bad','TLKM']);
  if (c.join(',') !== 'BBRI,ANTM,TLKM') throw new Error('Candidate sanitation failed');
  const health = buildHealth({updated:new Date().toISOString(), partial:false, usd_idr:{status:'live',source:'test',price:1}, aed_idr:{status:'live',source:'test',price:1}, uae_gold_24k:{status:'verified-live',source:'test',price:1}, antam_gold_1g:{status:'verified-live',source:'test',price:1}, bei_candidates:['BBRI'], bei_candidates_source:'test', diagnostics:[]});
  if (health.overall !== 'OK') throw new Error('Health builder failed');
  console.log('HANZ v2.0 deterministic self-test passed');
}


function buildHealth(payload) {
  const entries = {
    usd_idr: payload.usd_idr,
    aed_idr: payload.aed_idr,
    uae_gold_24k: payload.uae_gold_24k,
    antam_gold_1g: payload.antam_gold_1g
  };
  const sources = {};
  let staleCount = 0;
  for (const [key, item] of Object.entries(entries)) {
    const status = item?.status ?? 'unavailable';
    if (status === 'stale') staleCount += 1;
    sources[key] = { status, source: item?.source ?? 'Unavailable', price_available: Number(item?.price) > 0 };
  }
  const candidates = Array.isArray(payload.bei_candidates) ? payload.bei_candidates : [];
  const overall = Object.values(sources).some(v => !v.price_available) ? 'FAILED' : (staleCount > 0 || payload.partial ? 'DEGRADED' : 'OK');
  return {
    schema_version: 1,
    overall,
    generated_at: payload.updated ?? new Date().toISOString(),
    market_data: sources,
    bei: { status: candidates.length ? 'available' : 'no-candidates', count: candidates.length, source: payload.bei_candidates_source ?? 'unknown' },
    diagnostics: payload.diagnostics ?? []
  };
}
function firstPositive(...values){for(const value of values){const n=Number(value);if(Number.isFinite(n)&&n>0)return n;}return null;}
function findPrevious(history,todayKey){const key=Object.keys(history).filter(k=>k<todayKey).sort().reverse()[0];return key?{date:key,data:history[key]}:null;}
function pruneHistory(history,keep){const keys=Object.keys(history).sort();while(keys.length>keep)delete history[keys.shift()];}
function sanitizeCandidates(input){if(!Array.isArray(input))return[];const out=[];for(const item of input){const raw=typeof item==='string'?item:item?.ticker;const ticker=String(raw??'').toUpperCase().replace(/\.JK$/,'').trim();if(/^[A-Z]{4,5}$/.test(ticker)&&!out.includes(ticker))out.push(ticker);if(out.length>=8)break;}return out;}
async function fetchJson(url){const r=await fetchWithTimeout(url,{headers:{accept:'application/json','user-agent':USER_AGENT}});if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);return r.json();}
async function fetchText(url){const r=await fetchWithTimeout(url,{headers:{accept:'text/html,application/xhtml+xml','user-agent':'Mozilla/5.0 (compatible; HANZ-Trade/1.8; +https://hanz-trade.netlify.app)'}});if(!r.ok)throw new Error(`HTTP ${r.status} ${url}`);return r.text();}
async function fetchWithTimeout(url,options){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),25000);try{return await fetch(url,{...options,signal:controller.signal,redirect:'follow'});}finally{clearTimeout(timer);}}
async function readJson(file,fallback){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch{return fallback;}}
function cleanHtml(html){return html.replace(/&nbsp;/gi,' ').replace(/&#x2F;/gi,'/').replace(/<script[\s\S]*?<\/script>/gi,' ').replace(/<style[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&amp;/gi,'&').replace(/&#39;/gi,"'").replace(/&quot;/gi,'"').replace(/\s+/g,' ');}
function parseIdr(value){return Number(String(value).replace(/[^0-9]/g,''));}
function parseInternationalNumber(value){const s=String(value).trim();if(s.includes('.')&&s.includes(',')){return s.lastIndexOf(',')>s.lastIndexOf('.')?Number(s.replace(/\./g,'').replace(',','.')):Number(s.replace(/,/g,''));}if(s.includes(',')&&!s.includes('.')){const parts=s.split(',');return parts.at(-1).length<=2?Number(s.replace(',','.')):Number(s.replace(/,/g,''));}return Number(s.replace(/,/g,''));}
function dateKey(date){return date.toISOString().slice(0,10);}
function round(value,digits){const p=10**digits;return Math.round((Number(value)+Number.EPSILON)*p)/p;}
