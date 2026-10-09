// Dude's studio helper: knows all your FL Studio projects so you never lose one again.
// - Finds .flp files in the folders you allowed.
// - With your OK, looks inside them (read-only): tempo, time spent, samples, instruments, patterns.
// - Knows how long you worked on each one (from FL Studio's window title, if app access is on).
// - Spots untitled projects, piles of versions, unfinished beats, and exports that belong together.
// - Renames a project ONLY when you click "Rename", and can undo it. Never moves or deletes anything.
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { readFlp } = require('./flp');

const AUDIO = new Set(['wav', 'mp3', 'flac', 'aif', 'aiff', 'm4a', 'ogg']);
const cacheFile = () => path.join(app.getPath('userData'), 'dude-studio.json');
let C = null;
function cache() {
  if (C) return C;
  try { C = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')); } catch (e) { C = {}; }
  C.flp = C.flp || {}; C.renames = C.renames || [];
  return C;
}
let dirty = false;
setInterval(() => { if (dirty) { dirty = false; fs.writeFile(cacheFile(), JSON.stringify(C), () => {}); } }, 20000);

const base = p => path.basename(p).replace(/\.[^.]+$/, '');
const isBackup = p => /[\\/]backup[\\/]/i.test(p) || /\((autosave|overwrite)\)/i.test(path.basename(p));
const isUntitled = n => /^(untitled|new project|project|unsorted|template|empty|basic|default)(\s*\(\d+\)|\s*\d+)?$/i.test(n.trim());
/* "Beat_v3 (2) FINAL" -> "beat" : versions of the same idea share this */
function family(n) {
  let s = n.toLowerCase().replace(/[_.]+/g, ' ').trim(), prev;
  do {
    prev = s;
    s = s.replace(/\s*\(\d+\)$/, '').replace(/[\s-]*\b(v|ver|version)\s*\d+$/, '').replace(/[\s-]*\b(final|finale|master|mastered|mixdown|copy|new|old|edit|wip|demo|draft)\b$/, '').replace(/[\s-]+\d{1,3}$/, '').trim();
  } while (s !== prev && s.length > 2);
  return s || n.toLowerCase();
}
function words(s) { return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 1); }

/* the useful word that describes a beat: a named pattern, a sample, or an instrument */
const BORING = /^(pattern|default|track|insert|master|audio track|instrument track|channel|sampler|kick|snare|hat|hihat|clap|perc|automation clip|layer|new|untitled|\d+)\b/i;
function vibe(info) {
  if (!info) return '';
  const pick = list => (list || []).map(x => x.replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').trim()).find(x => x && x.length < 28 && !BORING.test(x));
  return pick(info.patterns) || pick(info.samples) || pick(info.plugins) || '';
}
const safeName = s => s.replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
function suggestName(p) {
  const d = new Date(p.created || p.mtime), mon = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return safeName([p.info && p.info.tempo ? Math.round(p.info.tempo) + 'bpm' : '', vibe(p.info), mon].filter(Boolean).join(' ')) || safeName('Beat ' + mon);
}

/* read inside one project (cached until the file changes) */
function deep(f) {
  const c = cache(), k = f.path, hit = c.flp[k];
  if (hit && hit.mtime === f.mtime && hit.size === f.size) return hit.info;
  let info = null;
  try { info = readFlp(f.path); } catch (e) { info = { error: String(e.message || e) }; }
  c.flp[k] = { mtime: f.mtime, size: f.size, info }; dirty = true;
  return info;
}

/* every project in the allowed folders, with everything Dude knows about it */
async function list(roots, files, memory, { look = false } = {}) {
  const seen = new Set(), flps = [], audio = [];
  let backups = 0, backupBytes = 0;
  for (const r of roots) {
    for (const f of await files.getIndex(r.path)) {
      if (seen.has(f.p)) continue; seen.add(f.p);
      if (f.ext === 'flp') { if (isBackup(f.p)) { backups++; backupBytes += f.size; } else flps.push({ f, r }); }
      else if (AUDIO.has(f.ext)) audio.push(f);
    }
  }
  const audioByFam = new Map();
  for (const a of audio) { const k = family(base(a.n)); if (!audioByFam.has(k)) audioByFam.set(k, []); audioByFam.get(k).push(a); }
  const worked = memory.projectTime ? memory.projectTime() : {};
  const out = flps.map(({ f, r }) => {
    const name = base(f.n), fam = isUntitled(name) ? name.toLowerCase() : family(name), info = look ? deep({ path: f.p, mtime: f.mtime, size: f.size }) : null;
    const exports = (audioByFam.get(fam) || []).filter(a => a.mtime >= f.mtime - 30 * 864e5);
    const w = worked[name.toLowerCase()] || null;
    return {
      path: f.p, name, folder: r.label, mtime: f.mtime, size: f.size, family: fam, untitled: isUntitled(name),
      info: info && !info.error ? info : null, created: info && info.created ? info.created : 0,
      minutes: Math.max(info && info.timeSpentMin || 0, w ? Math.round(w.secs / 60) : 0), lastOpen: w ? w.last : 0,
      exports: exports.map(a => a.n).slice(0, 3)
    };
  });
  const famCount = new Map(); for (const p of out) famCount.set(p.family, (famCount.get(p.family) || 0) + 1);
  for (const p of out) { p.versions = famCount.get(p.family); p.suggest = p.untitled ? suggestName(p) : ''; p.last = Math.max(p.mtime, p.lastOpen); }
  out.sort((a, b) => b.last - a.last);
  return { projects: out, backups, backupBytes, roots: roots.map(r => r.label) };
}

/* find a project by anything you remember: its name, a sample, an instrument, a pattern, the tempo */
function search(projects, query, { when } = {}) {
  const q = words(query).filter(w => !/^(the|a|my|beat|beats|project|projects|song|track|with|that|had|has|in|on|fl|studio|find|where|is|from|last|this|week|yesterday|today|one|i|made|was|working)$/.test(w));
  const bpm = (String(query).match(/(\d{2,3})\s*bpm/i) || [])[1];
  let list = projects;
  if (when) list = list.filter(p => p.last >= when[0] && p.last < when[1]);
  if (!q.length && !bpm) return list.slice(0, 8);
  const scored = list.map(p => {
    const hay = [p.name, p.info && p.info.title, p.info && p.info.genre, ...(p.info ? [...p.info.samples, ...p.info.plugins, ...p.info.patterns, ...p.info.inserts] : [])].join(' ').toLowerCase();
    let s = 0;
    for (const w of q) { if (p.name.toLowerCase().includes(w)) s += 3; else if (hay.includes(w)) s += 2; }
    if (bpm && p.info && Math.abs(p.info.tempo - +bpm) < 1.5) s += 3;
    return { p, s };
  }).filter(x => x.s > 0);
  scored.sort((a, b) => b.s - a.s || b.p.last - a.p.last);
  return scored.slice(0, 8).map(x => x.p);
}

/* what's worth knowing about your studio */
function report(L) {
  const P = L.projects, day = 864e5, now = Date.now();
  const untitled = P.filter(p => p.untitled);
  const newestOf = new Map(); for (const p of P) if (!newestOf.has(p.family) || newestOf.get(p.family).mtime < p.mtime) newestOf.set(p.family, p);
  const unfinished = P.filter(p => newestOf.get(p.family) === p && p.minutes >= 45 && !p.exports.length && now - p.last < 120 * day).sort((a, b) => b.minutes - a.minutes);
  const fams = new Map(); for (const p of P) if (p.versions >= 3) { if (!fams.has(p.family) || fams.get(p.family).mtime < p.mtime) fams.set(p.family, p); }
  const stale = P.filter(p => now - p.last > 120 * day && p.minutes >= 60);
  const week = P.filter(p => now - p.last < 7 * day);
  const tempos = P.filter(p => p.info && p.info.tempo).map(p => Math.round(p.info.tempo));
  const mode = a => { const m = new Map(); for (const x of a) m.set(x, (m.get(x) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]; };
  const top = (key) => { const m = new Map(); for (const p of P) if (p.info) for (const x of p.info[key]) { const k = x.replace(/\.[a-z0-9]+$/i, ''); if (!BORING.test(k)) m.set(k, (m.get(k) || 0) + 1); } return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => ({ name: n, count: c })); };
  const fav = mode(tempos);
  return {
    total: P.length, thisWeek: week.length, looked: P.filter(p => p.info).length,
    untitled: untitled.slice(0, 20).map(brief), untitledCount: untitled.length,
    unfinished: unfinished.slice(0, 5).map(brief),
    versionPiles: [...fams.values()].sort((a, b) => b.versions - a.versions).slice(0, 4).map(brief),
    stale: stale.slice(0, 4).map(brief),
    mostWorked: P.slice().sort((a, b) => b.minutes - a.minutes).filter(p => p.minutes > 0).slice(0, 3).map(brief),
    favTempo: fav ? { bpm: fav[0], count: fav[1] } : null,
    topSamples: top('samples'), topPlugins: top('plugins'),
    backups: L.backups, backupBytes: L.backupBytes, folders: L.roots
  };
}
function brief(p) { return { path: p.path, name: p.name, folder: p.folder, last: p.last, minutes: p.minutes, tempo: p.info ? p.info.tempo : 0, vibe: vibe(p.info), versions: p.versions, exports: p.exports, untitled: p.untitled, suggest: p.suggest }; }

/* rename a project in its own folder (only after you clicked Rename) */
async function rename(file, newName, allowedRoots) {
  const dir = path.dirname(file), clean = safeName(String(newName || '').replace(/\.flp$/i, ''));
  if (!clean) throw new Error('That name is empty.');
  if (!/\.flp$/i.test(file)) throw new Error('I only rename FL Studio projects.');
  const inside = r => path.resolve(file).toLowerCase().startsWith(path.resolve(r.path).toLowerCase() + path.sep);
  if (!allowedRoots.some(inside)) throw new Error('That file is outside the folders you allowed.');
  const to = path.join(dir, clean + '.flp');
  if (to.toLowerCase() === file.toLowerCase()) return { path: file, name: clean };
  if (fs.existsSync(to)) throw new Error(`There's already a project called "${clean}".`);
  touch(file, to);
  await fsp.rename(file, to);
  const c = cache(); c.renames.unshift({ from: file, to, at: Date.now() }); c.renames = c.renames.slice(0, 50); dirty = true;
  const hit = c.flp[file]; if (hit) { c.flp[to] = hit; delete c.flp[file]; }
  return { path: to, name: clean, from: base(file) };
}
async function undo() {
  const c = cache(), r = c.renames[0];
  if (!r) throw new Error("There's nothing to undo.");
  if (!fs.existsSync(r.to)) { c.renames.shift(); throw new Error('That project moved or was renamed again.'); }
  if (fs.existsSync(r.from)) throw new Error('The old name is taken now.');
  touch(r.to, r.from);
  await fsp.rename(r.to, r.from);
  c.renames.shift(); dirty = true;
  return { name: base(r.from), was: base(r.to) };
}

/* which project is open in FL Studio, from its window title: "my beat.flp - FL Studio 21", "FL Studio 2024 - my beat" */
function titleProject(title) {
  let t = String(title || '').replace(/^\*\s*/, '').trim();
  t = t.replace(/\s*[-–—]\s*(image-line\s*)?fl studio[^-–—]*$/i, '').replace(/^(image-line\s*)?fl studio[\s\d.]*(producer|signature|all plugins|fruity|edition|\s)*[-–—]\s*/i, '');
  t = t.replace(/\.flp$/i, '').replace(/\s*\*$/, '').trim();
  return /^fl studio/i.test(t) ? '' : t;
}
function forget() { C = { flp: {}, renames: [] }; dirty = true; }
/* a file Dude renamed himself in the last few minutes (so it's not a "new project") */
const touched = new Map();
function justTouched(p) { const t = touched.get(path.resolve(p).toLowerCase()); return !!t && Date.now() - t < 3 * 60e3; }
function touch(...ps) { for (const p of ps) touched.set(path.resolve(p).toLowerCase(), Date.now()); }

module.exports = { list, search, report, brief, rename, undo, titleProject, suggestName, isUntitled, family, forget, justTouched };
