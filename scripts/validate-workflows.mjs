import fs from 'node:fs/promises';
const expected = [
  ['.github/workflows/android.yml','Build HANZ-TRADE APK'],
  ['.github/workflows/update-widget-data.yml','Update HANZ market data'],
  ['.github/workflows/update-bei-candidates.yml','Update HANZ BEI candidates']
];
for (const [file,name] of expected) {
  const text = await fs.readFile(file,'utf8');
  if (!text.includes(`name: ${name}`)) throw new Error(`${file}: wrong/missing workflow name`);
  if (!/^on:\s*$/m.test(text)) throw new Error(`${file}: missing on trigger`);
  if (!/^jobs:\s*$/m.test(text)) throw new Error(`${file}: missing jobs`);
  if (!/runs-on:\s*ubuntu-latest/.test(text)) throw new Error(`${file}: missing ubuntu runner`);
}
console.log('All 3 GitHub workflow files are present and structurally valid');
