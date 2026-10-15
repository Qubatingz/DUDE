// Dude reads the text inside your documents (PDF, Word, PowerPoint, text files) all over the laptop,
// so you can ask "which file talks about royalties?" or "what does my contract say about payment?".
// Part of "Remember my whole laptop". It reads slowly in the background, one document at a time,
// keeps the text on this laptop only, and never changes a file.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const reader = require('./reader');
const { sentences, tok, matchKey, prefer, preferBonus } = require('./knowledge');

const DOC_EXT = new Set(['pdf', 'docx', 'pptx', 'txt', 'md', 'rtf', 'srt', 'lrc']);
const MAX_DOCS = 3000, MAX_SIZE = 25e6, MAX_CHARS = 20000;   // the first ~5 pages of each document is plenty to find it
let D = null;            // { docs: { [path]: { m: mtime, t: text } } }  (t is '' when it couldn't be read)
let queue = [], running = false, dirty = false, stopped = false, saving = false;
const file = () => path.join(app.getPath('userData'), 'docs-index.json.gz');

function load() {
  if (D) return D;
  try { D = JSON.parse(zlib.gunzipSync(fs.readFileSync(file())).toString()); } catch (e) { D = null; }
  if (!D || typeof D.docs !== 'object') D = { docs: {} };
  return D;
}
// saving happens in the background, so Dude never freezes while he writes his notes
function save(sync) {
  if (!D || saving) return;
  dirty = false;
  let json; try { json = JSON.stringify(D); } catch (e) { return; }
  if (sync) { try { fs.writeFileSync(file(), zlib.gzipSync(json)); } catch (e) {} return; }
  saving = true;
  zlib.gzip(json, (err, buf) => { if (err) { saving = false; return; } fs.writeFile(file() + '.tmp', buf, e => { if (!e) fs.rename(file() + '.tmp', file(), () => { saving = false; }); else saving = false; }); });
}
setInterval(() => { if (dirty && !running) save(); }, 90000).unref?.();

const isDoc = p => DOC_EXT.has(path.extname(p).slice(1).toLowerCase()) && !path.basename(p).startsWith('~$');

/* the laptop map is ready (or was refreshed): read the documents that are new or changed */
function sync(files) {
  load(); stopped = false;
  const docs = files.filter(f => f && isDoc(f[0]) && f[1] > 0 && f[1] <= MAX_SIZE).sort((a, b) => b[2] - a[2]).slice(0, MAX_DOCS);
  const keep = new Set(docs.map(f => f[0]));
  for (const p of Object.keys(D.docs)) if (!keep.has(p)) { delete D.docs[p]; dirty = true; }
  queue = docs.filter(f => !D.docs[f[0]] || D.docs[f[0]].m !== f[2]).map(f => [f[0], f[2]]);
  run();
}
/* a file changed while Dude was running */
function changed(p, mtime, gone) {
  if (!D || !isDoc(p)) return;
  if (gone) { if (D.docs[p]) { delete D.docs[p]; dirty = true; } return; }
  if (D.docs[p] && D.docs[p].m === mtime) return;
  queue = queue.filter(x => x[0] !== p); queue.unshift([p, mtime]); stopped = false; run();
}
async function run() {
  if (running) return;
  running = true;
  let n = 0;
  while (queue.length && !stopped) {
    const [p, m] = queue.shift();
    let t = '';
    try { t = await reader.readFile(p); } catch (e) { t = ''; }
    t = String(t || '').replace(/\r/g, '').replace(/[ \t ]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim().slice(0, MAX_CHARS);
    if (stopped) break;
    D.docs[p] = { m, t: t.length >= 20 ? t : '' };
    dirty = true;
    if (++n % 300 === 0) save();
    await new Promise(r => setTimeout(r, 120));   // gently, so the laptop stays fast
  }
  running = false;
  if (dirty) save();
}
function stop() { stopped = true; queue = []; }
function flush() { if (dirty) save(true); }
function wipe() { stop(); D = { docs: {} }; dirty = false; try { fs.unlinkSync(file()); } catch (e) {} }
function stats() { load(); let read = 0; for (const k in D.docs) if (D.docs[k].t) read++; return { read, pending: queue.length }; }

/* ---------- searching inside your documents ---------- */
function countOf(s, w, cap = 40) { let n = 0, i = s.indexOf(w); while (i >= 0 && n < cap) { n++; i = s.indexOf(w, i + w.length); } return n; }
function bestSentence(text, qw, pf) {
  let best = null, bs = 0, bh = 0;
  for (const s of sentences(text)) {
    if (s.length < 12) continue;
    const ws = tok(s);
    const hit = qw.filter(w => ws.some(x => x.startsWith(w))).length;
    if (!hit) continue;
    const sc = hit * 10 + preferBonus(s, pf) * 8 - Math.abs(s.length - 140) / 60;
    if (sc > bs) { bs = sc; best = s; bh = hit; }
  }
  if (!best) return { s: '', hit: 0 };
  return { s: best.length > 260 ? best.slice(0, 257).replace(/\s\S*$/, '') + '...' : best, hit: bh };
}
// returns [{ path, snippet, score }], best first. o.path: only look in that one document.
function search(q, o = {}) {
  load();
  const qw = [...new Set(tok(q).map(matchKey))].filter(w => w.length > 2), pf = prefer(q);
  if (!qw.length) return [];
  const paths = o.path ? (D.docs[o.path] && D.docs[o.path].t ? [o.path] : []) : Object.keys(D.docs).filter(p => D.docs[p].t);
  if (!paths.length) return [];
  const N = paths.length, df = new Map(qw.map(w => [w, 0]));
  const hits = [];
  for (const p of paths) {
    const s = D.docs[p].t.toLowerCase(), has = qw.filter(w => s.includes(w));
    if (!has.length) continue;
    for (const w of has) df.set(w, df.get(w) + 1);
    hits.push([p, s, has]);
  }
  const need = qw.length <= 2 ? qw.length : Math.ceil(qw.length * .6);   // most of your words should be in there
  const out = [];
  for (const [p, s, has] of hits) {
    if (has.length < need && !o.path) continue;
    let sc = 0;
    for (const w of has) { const idf = Math.log(1 + N / (df.get(w) || 1)); sc += idf * (1 + Math.log(countOf(s, w))); }
    const nm = path.basename(p).toLowerCase();
    for (const w of qw) if (nm.includes(w)) sc += 1.5;
    out.push({ path: p, score: sc });
  }
  out.sort((a, b) => b.score - a.score);
  // hits: how many of your words are in that one sentence (out of words)
  return out.slice(0, o.limit || 6).map(r => {
    const t = D.docs[r.path].t, b = bestSentence(t, qw, pf);
    // "when...?" / "how much...?": if the best sentence has no date (or no money), use the one in that document that does
    if (b.s && (pf.date || pf.money) && !preferBonus(b.s, pf)) { const alt = sentences(t).find(x => preferBonus(x, pf) > 0); if (alt) b.s = alt.length > 260 ? alt.slice(0, 257).replace(/\s\S*$/, '') + '...' : alt; }
    return Object.assign(r, { snippet: b.s, hits: b.hit, words: qw.length });
  }).filter(r => r.snippet || !o.needSnippet);
}
function has(p) { load(); return !!(D.docs[p] && D.docs[p].t); }

module.exports = { DOC_EXT, isDoc, sync, changed, stop, flush, wipe, stats, search, has };
