// Build check: Dude can read the files you give him to learn (Word, PDF with the full pdf.js reader, text).
// Run with: node ci/learn-smoke.js <Dude folder>/resources/app
const path = require('path');
const appDir = path.resolve(process.argv[2]);
const reader = require(path.join(appDir, 'reader.js'));
const fx = n => path.join(__dirname, 'fixtures', n);
(async () => {
  const doc = await reader.readFile(fx('contract.docx'));
  if (!/450,000 RWF/.test(doc)) throw new Error('Word file: text missing');
  console.log('Word OK:', doc.split('\n')[0]);
  const full = await reader.pdfjsText(require('fs').readFileSync(fx('release-plan.pdf')));
  if (!full) throw new Error('pdf.js is missing from the build');
  if (!/5 December 2026/.test(full)) throw new Error('PDF (pdf.js): text missing: ' + full.slice(0, 200));
  console.log('PDF OK (pdf.js):', full.replace(/\s+/g, ' ').slice(0, 80));
})().catch(e => { console.error('LEARN CHECK FAILED', e); process.exit(1); });
