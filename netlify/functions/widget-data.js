const { getStore } = require('@netlify/blobs');

const UAE_GOLD_URL = 'https://dubaicityofgold.com/';
const ANTAM_URL = 'https://www.logammulia.com/id/harga-emas-hari-ini';

exports.handler = async function () {
  const now = new Date();
  const today = dateKey(now);
  const store = getStore('hanz-widget-history');
  let partial = false;

  const [fx, goldCurrent, antamCurrent, candidates] = await Promise.all([
    fetchFx().catch(() => null),
    fetchUaeGold().catch(() => null),
    fetchAntam().catch(() => null),
    fetchCandidates().catch(() => [])
  ]);

  let previous = null;
  try {
    previous = await findPreviousSnapshot(store, today);
  } catch (_) {
    partial = true;
  }

  const current = {
    usd_idr: fx?.usd_idr ?? numberEnv('USD_IDR'),
    aed_idr: fx?.aed_idr ?? numberEnv('AED_IDR'),
    uae_gold_24k: goldCurrent ?? numberEnv('UAE_GOLD_24K_AED'),
    antam_gold_1g: antamCurrent ?? numberEnv('ANTAM_GOLD_1G_IDR')
  };

  for (const value of Object.values(current)) {
    if (!Number.isFinite(value) || value <= 0) partial = true;
  }

  const response = {
    ok: true,
    partial,
    updated: now.toISOString(),
    comparison_date: previous?.date || null,
    usd_idr: marketItem(current.usd_idr, previous?.data?.usd_idr, 'IDR', 'currency-api'),
    aed_idr: marketItem(current.aed_idr, previous?.data?.aed_idr, 'IDR', 'currency-api'),
    uae_gold_24k: marketItem(current.uae_gold_24k, previous?.data?.uae_gold_24k, 'AED/g', 'Dubai City of Gold'),
    antam_gold_1g: marketItem(current.antam_gold_1g, previous?.data?.antam_gold_1g, 'IDR/1g', 'Logam Mulia ANTAM'),
    bei_candidates: candidates
  };

  try {
    const snapshot = Object.fromEntries(Object.entries(current).filter(([, v]) => Number.isFinite(v) && v > 0));
    if (Object.keys(snapshot).length) await store.setJSON(today, snapshot);
  } catch (_) {
    response.partial = true;
  }

  return {
    statusCode: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300, s-maxage=900',
      'access-control-allow-origin': '*'
    },
    body: JSON.stringify(response)
  };
};

async function fetchFx() {
  const current = await fetchCurrencyFile('latest');
  const historical = await fetchRecentHistorical();
  const usdIdr = current.idr;
  const aedIdr = current.idr / current.aed;
  return {
    usd_idr: usdIdr,
    aed_idr: aedIdr,
    historical: historical ? {
      usd_idr: historical.idr,
      aed_idr: historical.idr / historical.aed
    } : null
  };
}

async function fetchCurrencyFile(date) {
  const url = `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${date}/v1/currencies/usd.json`;
  const data = await fetchJson(url);
  if (!data?.usd?.idr || !data?.usd?.aed) throw new Error('Currency fields missing');
  return { idr: Number(data.usd.idr), aed: Number(data.usd.aed) };
}

async function fetchRecentHistorical() {
  for (let days = 1; days <= 7; days++) {
    const d = new Date(Date.now() - days * 86400000);
    try { return await fetchCurrencyFile(dateKey(d)); } catch (_) {}
  }
  return null;
}

async function fetchUaeGold() {
  const override = numberEnv('UAE_GOLD_24K_AED');
  if (override) return override;
  const html = await fetchText(UAE_GOLD_URL);
  const cleaned = html.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const patterns = [
    /24\s*K(?:ARAT)?[^0-9]{0,40}(\d{2,4}(?:[.,]\d{1,2})?)/i,
    /(\d{2,4}(?:[.,]\d{1,2})?)[^0-9]{0,40}24\s*K/i
  ];
  return firstValid(cleaned, patterns, 100, 1000);
}

async function fetchAntam() {
  const override = numberEnv('ANTAM_GOLD_1G_IDR');
  if (override) return override;
  const html = await fetchText(ANTAM_URL);
  const cleaned = html.replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const patterns = [
    /1\s*(?:gram|gr)[^0-9]{0,100}(?:Rp\s*)?([0-9.]{7,15})/i,
    /(?:Rp\s*)?([0-9.]{7,15})[^0-9]{0,100}1\s*(?:gram|gr)/i
  ];
  return firstValid(cleaned, patterns, 500000, 10000000, true);
}

async function fetchCandidates() {
  const env = process.env.BEI_STRONG_CANDIDATES;
  if (env) return sanitizeCandidates(env.split(','));
  const endpoint = process.env.BEI_CANDIDATES_URL;
  if (endpoint) {
    const data = await fetchJson(endpoint);
    return sanitizeCandidates(data.candidates || data.bei_candidates || data);
  }
  return [];
}

function sanitizeCandidates(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const item of input) {
    const raw = typeof item === 'string' ? item : item?.ticker;
    const ticker = String(raw || '').toUpperCase().replace('.JK', '').trim();
    if (/^[A-Z]{4,5}$/.test(ticker) && !out.includes(ticker)) out.push(ticker);
    if (out.length >= 8) break;
  }
  return out;
}

async function findPreviousSnapshot(store, today) {
  for (let days = 1; days <= 10; days++) {
    const key = dateKey(new Date(Date.now() - days * 86400000));
    if (key === today) continue;
    const data = await store.get(key, { type: 'json' });
    if (data) return { date: key, data };
  }
  return null;
}

function marketItem(price, previous, unit, source) {
  const validPrice = Number.isFinite(price) && price > 0 ? round(price, unit.startsWith('AED') ? 2 : 4) : null;
  const validPrevious = Number.isFinite(previous) && previous > 0 ? previous : null;
  const change = validPrice && validPrevious ? ((validPrice - validPrevious) / validPrevious) * 100 : 0;
  return { price: validPrice, previous: validPrevious, change_pct: round(change, 2), unit, source };
}

function numberEnv(name) {
  const value = Number(String(process.env[name] || '').replace(/,/g, ''));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function firstValid(text, patterns, min, max, Indonesian = false) {
  for (const pattern of patterns) {
    const m = text.match(pattern);
    if (!m) continue;
    let raw = m[1];
    if (Indonesian) raw = raw.replace(/\./g, '');
    else raw = raw.replace(',', '.');
    const value = Number(raw);
    if (Number.isFinite(value) && value >= min && value <= max) return value;
  }
  throw new Error('Price not found');
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'HANZ-Trade/1.3' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { accept: 'text/html', 'user-agent': 'Mozilla/5.0 HANZ-Trade/1.3' } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

function dateKey(date) { return date.toISOString().slice(0, 10); }
function round(value, digits) { const p = 10 ** digits; return Math.round(value * p) / p; }
