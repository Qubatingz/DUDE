// Things you give Dude to learn (files, pasted text, web pages): he reads them, makes a short summary,
// and remembers them so you can ask about them later. Free and on this laptop; no AI key needed.
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const reader = require('./reader');

const file = () => path.join(app.getPath('userData'), 'dude-knowledge.json');
let K = null;
function load() { if (K) return K; try { K = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { K = { items: [] }; } K.items = K.items || []; return K; }
function save() { try { fs.writeFileSync(file(), JSON.stringify(K)); } catch (e) {} }

/* ---------- reading the words ---------- */
const STOP = new Set(('a about above after again against all also am an and any are as at be because been before being below between both but by can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours out over own same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with would you your yours yourself yourselves will shall may might must one two three get got make made also like well even much many us let im ive youre dont doesnt didnt cant wont isnt arent its thats theres etc via per new use used using within without upon onto').split(' '));
const stem = w => w.length > 5 ? w.replace(/(ings|ing|edly|ed|ies|es|s)$/, m => m === 'ies' ? 'y' : '') : w.replace(/s$/, '');
const tok = s => (String(s).toLowerCase().match(/[a-z0-9À-ɏ']+/g) || []).map(w => w.replace(/'/g, '')).filter(w => w.length > 2 && !STOP.has(w)).map(stem);
// the root of a word, so "payment" finds "pay", "royalties" finds "royalty" and "release" finds "released"
function matchKey(w) {
  let k = w.replace(/(ments?|ings?|edly|ers?|ies|es|ed|s|y|e)$/, '');
  if (k.length < 3) k = w;
  if (/ions?$/.test(k) && k.length > 7) k = k.replace(/ions?$/, '');
  return k;
}
const hasKey = (ws, key) => ws.some(x => x.startsWith(key));
// what kind of answer the question wants: a date ("when..."), money ("how much..."), a number ("how many...")
function prefer(q) {
  const t = String(q).toLowerCase();
  return { date: /^\s*(?:and )?when\b|\bwhat (?:date|day|time)\b|\bdeadline\b|\bdue\b/.test(t), money: /\bhow much\b|\b(?:price|prices|cost|costs|pay|paid|payment|payments|fee|fees|money|budget|rwf|francs?|dollars?)\b/.test(t), number: /\bhow many\b/.test(t) };
}
function preferBonus(s, pf) { DATE_RE.lastIndex = 0; MONEY_RE.lastIndex = 0; let b = 0; if (pf.date && (DATE_RE.test(s) || /\b(19|20)\d{2}\b/.test(s))) b += 1; if (pf.money && MONEY_RE.test(s)) b += 1; if (pf.number && /\d/.test(s)) b += .5; DATE_RE.lastIndex = 0; MONEY_RE.lastIndex = 0; return b; }
function clean(text) {
  return String(text || '').replace(/\r/g, '').replace(/(\w)-\n(\w)/g, '$1$2').replace(/[ \t ]+/g, ' ').replace(/\n /g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function sentences(text) {
  const out = [];
  for (const block of clean(text).split(/\n+/)) {
    const b = block.trim(); if (!b) continue;
    const parts = b.match(/[^.!?]+(?:[.!?]+["”')\]]*|$)/g) || [b];
    let cur = '';
    for (const p of parts) {
      cur += p;
      // don't split after "Mr." "Dr." "e.g." "No." or a single initial
      if (/\b(mr|mrs|ms|dr|st|no|vs|etc|e\.g|i\.e|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|[a-z])\.$/i.test(cur.trim())) continue;
      if (cur.trim()) out.push(cur.trim()); cur = '';
    }
    if (cur.trim()) out.push(cur.trim());
  }
  return out.filter(s => s.length > 2);
}

/* ---------- the little summary ---------- */
const MONTHS = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_RE = new RegExp(`\\b(?:\\d{1,2}(?:st|nd|rd|th)? (?:of )?(?:${MONTHS})\\.?(?:,? \\d{4})?|(?:${MONTHS})\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{4})?|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}/\\d{1,2}/\\d{2,4})\\b`, 'gi');
const MONEY_RE = /(?:[$€£]\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|million|thousand))?|\b\d[\d,.]*\s?(?:rwf|frw|usd|eur|dollars|francs|k)\b)/gi;
function summarize(text, title) {
  const sents = sentences(text);
  const words = tok(text);
  const freq = new Map(); for (const w of words) freq.set(w, (freq.get(w) || 0) + 1);
  const max = Math.max(1, ...freq.values());
  const scored = sents.map((s, i) => {
    const ws = tok(s), n = s.split(/\s+/).length;
    if (n < 5 || n > 60 || /^(page \d+|table of contents|copyright|all rights reserved)/i.test(s)) return { s, i, score: -1, ws };
    if (!/[.!?:;"”')\]]$/.test(s) && n < 12) return { s, i, score: -1, ws };   // a heading, not a sentence
    let sc = ws.reduce((a, w) => a + (freq.get(w) || 0) / max, 0) / Math.pow(Math.max(ws.length, 1), .55);
    if (i < 3) sc *= 1.25;
    if (/\d/.test(s)) sc *= 1.08;
    return { s, i, score: sc, ws: new Set(ws) };
  });
  const long = sents.length > 40, want = sents.length <= 6 ? Math.min(2, sents.length) : long ? 5 : 3;
  const picked = [];
  for (const x of scored.slice().sort((a, b) => b.score - a.score)) {
    if (x.score <= 0 || picked.length >= want) continue;
    if (picked.some(p => { let inter = 0; for (const w of x.ws) if (p.ws.has(w)) inter++; return inter / Math.max(1, Math.min(x.ws.size, p.ws.size)) > .6; })) continue;
    picked.push(x);
  }
  picked.sort((a, b) => a.i - b.i);
  const points = picked.map(p => p.s.length > 220 ? p.s.slice(0, 217).replace(/\s\S*$/, '') + '...' : p.s);
  if (!points.length && sents.length) points.push(sents.slice(0, 2).join(' ').slice(0, 300));
  // what it's about: the words that come up most (not counting the very common ones)
  const keywords = [...freq.entries()].filter(([w]) => w.length > 3 && !/^\d+$/.test(w)).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([w]) => w);
  const facts = { dates: [...new Set((text.match(DATE_RE) || []).map(x => x.trim()))].slice(0, 6), money: [...new Set((text.match(MONEY_RE) || []).map(x => x.trim()))].slice(0, 6) };
  const spoken = points.slice(0, 2).join(' ');
  return { points, keywords, facts, spoken: spoken.length > 340 ? spoken.slice(0, 337).replace(/\s\S*$/, '') + '...' : spoken, words: words.length, title: title || '' };
}

/* ---------- learning ---------- */
function guessTitle(text, fallback) {
  if (fallback) return fallback;
  const first = clean(text).split('\n').map(l => l.trim()).find(l => l.length > 3 && l.length < 70 && !/[.!?,;]$/.test(l));
  if (first) return first;
  const s1 = (sentences(text)[0] || clean(text)).replace(/[.!?]+$/, '');
  return s1.length <= 48 ? s1 : s1.split(/\s+/).slice(0, 6).join(' ') + '...';
}
function store(title, text, source, kind) {
  const t = clean(text);
  if (t.length < 40) throw new Error("There's almost no text in there for me to learn.");
  const sum = summarize(t, title);
  const it = { id: 'k' + Date.now().toString(36), title: title.slice(0, 90), source: source || '', kind: kind || 'text', addedAt: Date.now(), chars: t.length, points: sum.points, keywords: sum.keywords, facts: sum.facts, spoken: sum.spoken, text: t.slice(0, 400000) };
  const k = load();
  k.items = k.items.filter(x => !(source && x.source === source));   // learning the same file again replaces it
  k.items.unshift(it); if (k.items.length > 300) k.items.length = 300;
  save(); cache.delete(it.id);
  return view(it);
}
const view = it => ({ id: it.id, title: it.title, source: it.source, kind: it.kind, addedAt: it.addedAt, chars: it.chars, points: it.points, keywords: it.keywords, facts: it.facts, spoken: it.spoken });
async function learnFile(p) {
  const text = await reader.readFile(p);
  const base = path.basename(p).replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  return store(base, text, p, path.extname(p).slice(1).toLowerCase() || 'file');
}
function learnText(text, title) { return store(title || guessTitle(text), text, '', 'note'); }
async function learnUrl(url) {
  if (!/^https?:\/\//i.test(url)) throw new Error('That does not look like a web link.');
  const r = await net.fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Dude/1.6' } });
  if (!r.ok) throw new Error(`That page didn't open (${r.status}).`);
  const type = r.headers.get('content-type') || '';
  if (/pdf/i.test(type)) { const buf = Buffer.from(await r.arrayBuffer()); return store(decodeURIComponent(url.split('/').pop() || 'PDF').replace(/\.pdf$/i, ''), await reader.pdfText(buf), url, 'pdf'); }
  const h = reader.htmlText(await r.text());
  return store(h.title || url.replace(/^https?:\/\/(www\.)?/, '').split('/')[0], h.text, url, 'web');
}

/* ---------- asking about what he learned ---------- */
const cache = new Map();   // id -> sentences with their words
const twCache = new Map();
const titleWords = it => { let t = twCache.get(it.id); if (!t) { t = new Set(tok(it.title)); twCache.set(it.id, t); } return t; };
function sents(it) {
  let c = cache.get(it.id);
  if (!c) { c = sentences(it.text).map(s => ({ s, w: tok(s) })); cache.set(it.id, c); }
  return c;
}
function ask(q, o = {}) {
  const qw = [...new Set(tok(q))]; if (!qw.length) return null;
  const items = load().items.filter(it => !o.id || it.id === o.id);
  // BM25 over every sentence he knows
  const all = []; for (const it of items) for (const x of sents(it)) all.push({ it, x });
  if (!all.length) return null;
  const N = all.length, avg = all.reduce((a, b) => a + b.x.w.length, 0) / N, df = new Map();
  const key = new Map(qw.map(w => [w, matchKey(w)])), pf = prefer(q);
  for (const q1 of qw) df.set(q1, all.filter(e => hasKey(e.x.w, key.get(q1))).length);
  const titleHit = it => qw.filter(w => tok(it.title + ' ' + it.keywords.join(' ')).includes(w)).length;
  const res = [];
  for (const e of all) {
    let sc = 0;
    const tw = titleWords(e.it);
    for (const w of qw) {
      const kw = key.get(w), f = e.x.w.filter(x => x.startsWith(kw)).length; if (!f) continue;
      const idf = Math.log(1 + (N - df.get(w) + .5) / (df.get(w) + .5));
      // words from the title say WHICH thing you mean, not which sentence: they count half
      sc += (tw.has(w) ? .5 : 1) * idf * (f * 2.2) / (f + 1.2 * (.25 + .75 * e.x.w.length / avg));
    }
    if (sc > 0) res.push({ sc: sc + titleHit(e.it) * .2 + preferBonus(e.x.s, pf) * 1.2, e });
  }
  res.sort((a, b) => b.sc - a.sc);
  if (!res.length || res[0].sc < .8) return null;
  const top = res[0].e, near = res.slice(1).find(r => r.e.it === top.it && Math.abs(sents(top.it).indexOf(r.e.x) - sents(top.it).indexOf(top.x)) === 1 && r.sc > res[0].sc * .6);
  return { answer: near ? top.x.s + ' ' + near.e.x.s : top.x.s, title: top.it.title, id: top.it.id, source: top.it.source, score: res[0].sc };
}
function list() { return load().items.map(view); }
function findItem(q) { const w = tok(q); let best = null, sc = 0; for (const it of load().items) { const s = w.filter(x => tok(it.title).includes(x)).length; if (s > sc) { sc = s; best = it; } } return best ? view(best) : null; }
function forget(id) { const k = load(); const n = k.items.length; k.items = k.items.filter(x => x.id !== id); cache.delete(id); save(); return n !== k.items.length; }
function wipe() { K = { items: [] }; cache.clear(); save(); }

module.exports = { learnFile, learnText, learnUrl, ask, list, findItem, forget, wipe, summarize, sentences, tok, matchKey, prefer, preferBonus };
