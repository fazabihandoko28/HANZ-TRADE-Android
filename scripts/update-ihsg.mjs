import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const OUTPUT = path.join(ROOT, 'public', 'ihsg.json');
const URL = 'https://query1.finance.yahoo.com/v8/finance/chart/%5EJKSE?range=10d&interval=1d&includePrePost=false&events=div%2Csplits';

const now = new Date();
let existing = {};
try { existing = JSON.parse(await fs.readFile(OUTPUT, 'utf8')); } catch {}

try {
  const res = await fetch(URL, {
    headers: {
      'user-agent': 'Mozilla/5.0 HANZ-Trade-IHSG/1.0',
      'accept': 'application/json'
    }
  });
  if (!res.ok) throw new Error(`Yahoo HTTP ${res.status}`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(json?.chart?.error?.description || 'No chart result');

  const ts = result.timestamp || [];
  const quote = result.indicators?.quote?.[0] || {};
  const adj = result.indicators?.adjclose?.[0]?.adjclose || [];
  const rows = ts.map((t, i) => ({
    t,
    close: Number.isFinite(adj[i]) ? adj[i] : quote.close?.[i]
  })).filter(r => Number.isFinite(r.close) && r.close > 0);

  if (rows.length < 2) throw new Error('Not enough valid IHSG daily rows');
  const latest = rows.at(-1);
  const prev = rows.at(-2);
  const close = round2(latest.close);
  const previousClose = round2(prev.close);
  const change = round2(close - previousClose);
  const changePct = round2((change / previousClose) * 100);
  const marketDate = toJakartaDate(latest.t * 1000);

  const payload = {
    symbol: '^JKSE',
    name: 'IHSG',
    status: 'last_close',
    market_date: marketDate,
    close,
    previous_close: previousClose,
    change,
    change_pct: changePct,
    source: 'Yahoo Finance chart API',
    updated_at: now.toISOString(),
    stale: false
  };

  validate(payload);
  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2) + '\n');
  console.log(`IHSG ${marketDate}: ${close} (${change >= 0 ? '+' : ''}${change}, ${changePct >= 0 ? '+' : ''}${changePct}%)`);
} catch (err) {
  if (Number(existing?.close) > 0 && existing?.market_date) {
    const fallback = {
      ...existing,
      status: 'last_known_good',
      updated_at: now.toISOString(),
      stale: true,
      error: String(err?.message || err)
    };
    await fs.writeFile(OUTPUT, JSON.stringify(fallback, null, 2) + '\n');
    console.warn(`IHSG source failed; preserving last-known-good ${existing.close}: ${fallback.error}`);
  } else {
    throw err;
  }
}

function toJakartaDate(ms) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(ms));
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function round2(n) { return Math.round((n + Number.EPSILON) * 100) / 100; }
function validate(p) {
  if (!(p.close > 1000 && p.close < 20000)) throw new Error(`Implausible IHSG close ${p.close}`);
  if (!(p.previous_close > 1000 && p.previous_close < 20000)) throw new Error(`Implausible previous close ${p.previous_close}`);
  if (Math.abs(p.change_pct) > 20) throw new Error(`Implausible IHSG daily change ${p.change_pct}%`);
}
