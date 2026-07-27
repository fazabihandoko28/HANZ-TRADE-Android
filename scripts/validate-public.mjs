import fs from 'node:fs/promises';
const widget = JSON.parse(await fs.readFile('public/widget-data.json','utf8'));
const health = JSON.parse(await fs.readFile('public/health.json','utf8'));
if (widget.schema_version !== 4 || widget.ok !== true) throw new Error('widget-data header invalid');
for (const key of ['usd_idr','aed_idr','uae_gold_24k','antam_gold_1g']) {
  const item=widget[key];
  if (!(Number(item?.price)>0)) throw new Error(`${key} missing price`);
  if (!['verified-live','live','stale'].includes(item.status)) throw new Error(`${key} bad status`);
}
if (!['OK','DEGRADED'].includes(health.overall)) throw new Error(`health=${health.overall}`);
console.log('Public market JSON validated');
