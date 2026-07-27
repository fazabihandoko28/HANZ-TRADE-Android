import fs from 'node:fs/promises';

const candidates = JSON.parse(await fs.readFile('public/bei-candidates.json', 'utf8'));
const health = JSON.parse(await fs.readFile('public/bei-health.json', 'utf8'));

if (candidates.schema_version !== 1) throw new Error('BEI schema_version must be 1');
if (!Array.isArray(candidates.candidates)) throw new Error('BEI candidates must be an array');
if (candidates.candidates.length > 8) throw new Error('BEI candidates exceeds 8 tickers');
for (const ticker of candidates.candidates) {
  if (!/^[A-Z]{4,5}$/.test(String(ticker))) throw new Error(`Invalid BEI ticker: ${ticker}`);
}
if (!['OK', 'FAILED'].includes(health.overall)) throw new Error(`Invalid BEI health: ${health.overall}`);
if (Number(health.count) !== candidates.candidates.length) throw new Error('BEI health count does not match candidates');
console.log('Public BEI JSON validated');
