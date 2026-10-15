// Dude's memory of your WHOLE laptop: every file's name, folder, size and dates, plus the text inside your
// documents (see docs.js), so you can ask "where's the contract from last month?", "what did I download yesterday?"
// or "which file talks about royalties?". Needs "Remember my whole laptop" in the Access tab.
// Saved on this laptop only. Never moves or deletes anything.
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const zlib = require('zlib');
const { KIND_OF, timeWindow, fmtSize } = require('./files');
const docs = require('./docs');

// folders that are Windows / programs / caches, not your stuff
const SKIP = new Set(['node_modules', '.git', 'appdata', '$recycle.bin', 'system volume information', 'windows', 'program files', 'program files (x86)',
  'programdata', 'recovery', 'perflogs', 'msocache', 'config.msi', '$windows.~bt', '$windows.~ws', '$winreagent', 'windowsapps', 'intel', 'amd', 'nvidia',
  '__pycache__', '.venv', 'venv', 'site-packages', '.cache', 'cache', 'caches', 'temp', 'tmp', '.vscode', '.idea', '.gradle', '.m2', '.npm', '.nuget',
  'onedrivetemp', 'steamapps', 'epic games', 'riot games', 'xboxgames', '.android', 'android', 'dist', 'build', 'bin', 'obj']);
const MAX_FILES = 300000;
const bornOf = st => Math.round(process.env.DUDE_BIRTH_IS_MTIME ? st.mtimeMs : (st.birthtimeMs || st.ctimeMs || st.mtimeMs));   // when the file arrived on this laptop

let ix = null;          // { files: [[p, size, mtime, born]], builtAt, roots }
let building = null, progress = { done: 0, state: 'idle' };
let watchers = [], dirty = false;
const file = () => path.join(app.getPath('userData'), 'laptop-index.json.gz');

function roots() {
  const out = [];
  const home = os.homedir();
  out.push({ path: home, label: 'Your folders' });
  if (process.platform === 'win32') {
    const sys = (process.env.SystemDrive || 'C:').toUpperCase();
    for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
      const d = L + ':\\';
      if ((L + ':') === sys) continue;   // the Windows drive: we already have your user folder on it
      try { fs.accessSync(d); out.push({ path: d, label: 'Drive ' + L + ':' }); } catch (e) {}
    }
  }
  return out;
}

function load() {
  if (ix) return ix;
  try { ix = JSON.parse(zlib.gunzipSync(fs.readFileSync(file())).toString()); } catch (e) { ix = null; }
  return ix;
}
let saving = false;
function save(sync) {   // in the background, so Dude never freezes while he writes it down
  if (!ix || saving) return;
  dirty = false;
  const json = JSON.stringify({ files: ix.files.filter(Boolean), builtAt: ix.builtAt, roots: ix.roots });
  if (sync) { try { fs.writeFileSync(file(), zlib.gzipSync(json)); } catch (e) {} return; }
  saving = true;
  zlib.gzip(json, (err, buf) => { if (err) { saving = false; return; } fs.writeFile(file() + '.tmp', buf, e => { if (!e) fs.rename(file() + '.tmp', file(), () => { saving = false; }); else saving = false; }); });
}
setInterval(() => { if (dirty) save(); }, 60000);

async function walk(rootList, onProgress) {
  const files = [], seen = new Set();
  for (const r of rootList) {
    const queue = [[r.path, 0]];
    while (queue.length && files.length < MAX_FILES) {
      const [dir, depth] = queue.shift();
      let ents;
      try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { continue; }
      for (const d of ents) {
        const name = d.name;
        if (name.startsWith('.') || name.startsWith('~$') || name.startsWith('$')) continue;
        const p = path.join(dir, name);
        if (d.isSymbolicLink && d.isSymbolicLink()) continue;
        if (d.isDirectory()) { if (depth < 14 && !SKIP.has(name.toLowerCase()) && !seen.has(p.toLowerCase())) { seen.add(p.toLowerCase()); queue.push([p, depth + 1]); } continue; }
        if (!d.isFile()) continue;
        try { const st = await fsp.stat(p); files.push([p, st.size, Math.round(st.mtimeMs), bornOf(st)]); } catch (e) {}
        if (files.length % 2000 === 0) { onProgress(files.length); await new Promise(res => setImmediate(res)); }
        if (files.length >= MAX_FILES) break;
      }
    }
  }
  return files;
}

/* build (or rebuild) the map of your laptop. Takes a few minutes the first time, quietly in the background. */
function build(onDone) {
  if (building) return building;
  progress = { done: 0, state: 'building' };
  const list = roots();
  building = walk(list, n => { progress.done = n; }).then(files => {
    ix = { files, builtAt: Date.now(), roots: list.map(r => r.path) };
    progress = { done: files.length, state: 'ready' };
    save(); building = null; startWatch(); docs.sync(files);
    if (onDone) onDone(stats());
    return ix;
  }).catch(e => { building = null; progress = { done: 0, state: 'error', error: String(e.message || e) }; return null; });
  return building;
}
let docsStarted = false;
function ensure(onDone) {
  load();
  if (!ix) { build(onDone); return false; }
  if (!docsStarted && !building) { docsStarted = true; docs.sync(ix.files.filter(Boolean)); }   // read any documents that are new since last time
  if (Date.now() - ix.builtAt > 12 * 3600e3 && !building) build();   // refresh twice a day, quietly
  if (!watchers.length) startWatch();
  return true;
}
function stop() { for (const w of watchers) { try { w.close(); } catch (e) {} } watchers = []; }
function wipe() { stop(); docs.wipe(); docsStarted = false; ix = null; try { fs.unlinkSync(file()); } catch (e) {} progress = { done: 0, state: 'idle' }; }
function flush() { if (dirty) save(true); docs.flush(); }

/* keep the map fresh while Dude runs: new, changed and removed files */
function startWatch() {
  stop();
  if (!ix) return;
  for (const r of ix.roots) {
    try {
      const pending = new Map();
      const w = fs.watch(r, { recursive: true }, (ev, rel) => {
        if (!rel) return;
        const parts = rel.split(/[\\/]/);
        if (parts.some(x => SKIP.has(x.toLowerCase()) || x.startsWith('.') || x.startsWith('$'))) return;
        const full = path.join(r, rel);
        clearTimeout(pending.get(full));
        pending.set(full, setTimeout(() => { pending.delete(full); touch(full); }, 3000));
      });
      w.on('error', () => {});
      watchers.push(w);
    } catch (e) {}
  }
}
const byPath = () => { if (!ix._map) { ix._map = new Map(); ix.files.forEach((f, i) => ix._map.set(f[0], i)); } return ix._map; };
function touch(full) {
  if (!ix || /\.(tmp|crdownload|part|partial|lock)$/i.test(full) || path.basename(full).startsWith('~')) return;
  fs.stat(full, (err, st) => {
    const map = byPath(), i = map.get(full);
    if (err || !st.isFile()) { if (i != null && err) { ix.files[i] = null; map.delete(full); dirty = true; docs.changed(full, 0, true); } return; }
    const rec = [full, st.size, Math.round(st.mtimeMs), bornOf(st)];
    docs.changed(full, rec[2], false);
    if (i != null) ix.files[i] = rec; else { map.set(full, ix.files.length); ix.files.push(rec); }
    dirty = true;
  });
}

/* ---------- asking about your laptop ---------- */
const all = () => (load() ? ix.files.filter(Boolean) : []);
const kindOf = p => KIND_OF[path.extname(p).slice(1).toLowerCase()] || 'other';
const home = () => os.homedir();
function where(p) {
  const h = home();
  let rel = p.startsWith(h) ? p.slice(h.length + 1) : p;
  const parts = rel.split(/[\\/]/); parts.pop();
  if (!parts.length) return p.startsWith(h) ? 'your home folder' : path.dirname(p);
  return parts.slice(-2).join('\\');
}
function item(f, note) { return { path: f[0], name: path.basename(f[0]), folder: where(f[0]), kind: kindOf(f[0]), size: f[1], mtime: f[2], born: f[3], note: note || '' }; }
const STOP = new Set('a an the my me i i\'m im was were is are be been of on in at to for from with and or that this those these it its find search look looking where wheres where\'s show get open file files folder folders thing things stuff some any please dude can you could would we our working worked work made make did do last week weeks month months year today yesterday ago recent recently latest new newest old older called named about when edit edited open opened change changed save saved'.split(' '));
const words = q => String(q || '').toLowerCase().replace(/[^a-z0-9\s'_-]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && w.length > 1);
const KIND_WORDS = { music: /\b(beats?|projects?|flps?|sessions?)\b/, audio: /\b(songs?|tracks?|audio|mp3s?|wavs?|vocals?|samples?|mix(es)?|masters?|exports?)\b/, document: /\b(docs?|documents?|pdfs?|contracts?|invoices?|cv|resume|letters?|notes?|reports?|proposals?|slides|presentations?|spreadsheets?)\b/, image: /\b(photos?|pictures?|images?|pics?|logos?|designs?|screenshots?|covers?|flyers?|posters?)\b/, video: /\b(videos?|clips?|footage|movies?|edits?)\b/, program: /\b(programs?|apps?|installers?|setups?)\b/, archive: /\b(zips?|archives?|rars?)\b/ };
function kindFrom(t) { for (const k in KIND_WORDS) if (KIND_WORDS[k].test(t)) return k; return 'any'; }

function find(query, o = {}) {
  // generic words ("documents", "beats") pick the kind of file; specific ones ("contract", "mix") are also searched in the names
  const GENERIC = /^(beats?|projects?|flps?|songs?|tracks?|audio|mp3s?|wavs?|docs?|documents?|pdfs?|files?|photos?|pictures?|images?|pics?|videos?|clips?|footage|movies?|programs?|apps?|installers?|setups?|zips?|archives?|rars?)$/;
  const kind = o.kind || kindFrom(query), win = timeWindow(o.when || query), ws = words(query).filter(w => !GENERIC.test(w));
  const out = [];
  for (const f of all()) {
    const p = f[0], k = kindOf(p);
    if (kind !== 'any' && (kind === 'music' ? !(k === 'music' || (ws.length && k === 'audio')) : k !== kind)) continue;
    if (win && (f[2] < win[0] || f[2] >= win[1])) continue;
    const low = path.basename(p).toLowerCase();
    let s = 0;
    for (const w of ws) { if (low.includes(w)) s += 3 + (new RegExp('(^|[^a-z0-9])' + w.replace(/[^a-z0-9]/g, '')).test(low) ? 1 : 0); else if (p.toLowerCase().includes(w)) s += 1.2; }
    if (ws.length && s === 0) continue;
    out.push([s, f]);
  }
  out.sort((a, b) => b[0] - a[0] || b[1][2] - a[1][2]);
  return { count: out.length, results: out.slice(0, o.limit || 8).map(([, f]) => item(f)) };
}
/* what came onto the laptop (and what you changed) during a time: "yesterday", "last week", "on Tuesday" */
function during(when, o = {}) {
  const win = timeWindow(when) || timeWindow('today');
  const added = [], edited = [];
  const dl = path.join(home(), 'Downloads').toLowerCase();
  for (const f of all()) {
    if (o.downloads && !f[0].toLowerCase().startsWith(dl)) continue;
    if (f[3] >= win[0] && f[3] < win[1]) added.push(f);
    else if (f[2] >= win[0] && f[2] < win[1]) edited.push(f);
  }
  added.sort((a, b) => b[3] - a[3]); edited.sort((a, b) => b[2] - a[2]);
  const byKind = {}; for (const f of added) { const k = kindOf(f[0]); byKind[k] = (byKind[k] || 0) + 1; }
  return { from: win[0], to: win[1], addedCount: added.length, editedCount: edited.length, byKind, added: added.slice(0, 12).map(f => item(f, 'new')), edited: edited.slice(0, 8).map(f => item(f, 'changed')) };
}
function counts() {
  const c = {}, sz = {};
  for (const f of all()) { const k = kindOf(f[0]); c[k] = (c[k] || 0) + 1; sz[k] = (sz[k] || 0) + f[1]; }
  return { total: all().length, count: c, size: sz };
}
function biggest(n = 8) {
  const fl = all().slice().sort((a, b) => b[1] - a[1]).slice(0, n).map(f => item(f));
  const folders = new Map(), h = home();
  for (const f of all()) {
    let rel = f[0].startsWith(h) ? f[0].slice(h.length + 1) : f[0];
    const parts = rel.split(/[\\/]/); if (parts.length < 2) continue;
    const key = (f[0].startsWith(h) ? '' : '') + parts.slice(0, Math.min(2, parts.length - 1)).join('\\');
    folders.set(key, (folders.get(key) || 0) + f[1]);
  }
  return { files: fl, folders: [...folders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, size]) => ({ name, size })) };
}
function itemOf(p) { if (!load()) return null; const i = byPath().get(p); return i != null && ix.files[i] ? item(ix.files[i]) : null; }
function recent(n = 8) { return all().slice().sort((a, b) => b[2] - a[2]).slice(0, n).map(f => item(f)); }
function stats() { const L = load(), d = L ? docs.stats() : { read: 0, pending: 0 }; return { state: progress.state === 'building' ? 'building' : L ? 'ready' : progress.state, files: L ? L.files.filter(Boolean).length : progress.done, builtAt: L ? L.builtAt : 0, docsRead: d.read, docsPending: d.pending }; }

/* ---------- the laptop scan: keep / move off / can delete ---------- */
function scan() {
  const now = Date.now(), day = 864e5, files = all();
  const dl = path.join(home(), 'Downloads').toLowerCase();
  const del = [], move = [], seenDel = new Set();
  const addDel = (f, why) => { if (seenDel.has(f[0])) return; seenDel.add(f[0]); del.push(Object.assign(item(f), { why })); };
  // duplicates: same name and same size; keep the newest one
  const groups = new Map();
  for (const f of files) { if (f[1] < 100e3) continue; const k = path.basename(f[0]).toLowerCase() + '|' + f[1]; const g = groups.get(k); if (g) g.push(f); else groups.set(k, [f]); }
  for (const g of groups.values()) if (g.length > 1) { g.sort((a, b) => b[2] - a[2]); for (const f of g.slice(1)) addDel(f, 'Copy of a file you still have'); }
  const dirs = new Set(); for (const f of files) dirs.add(path.dirname(f[0]).toLowerCase());
  for (const f of files) {
    const p = f[0], low = p.toLowerCase(), k = kindOf(p), ext = path.extname(low), age = now - Math.max(f[2], f[3]);
    const inDl = low.startsWith(dl);
    if (/\.(crdownload|part|partial|tmp)$/.test(low) && age > 2 * day) addDel(f, 'Unfinished download');
    else if (inDl && k === 'program' && /\.(exe|msi|msix|apk)$/.test(ext) && age > 14 * day) addDel(f, 'Installer you already used');
    else if (inDl && k === 'archive' && age > 30 * day && dirs.has(low.replace(/\.(zip|rar|7z)$/, ''))) addDel(f, 'Already unzipped');
    else if (f[1] === 0 && age > 7 * day) addDel(f, 'Empty file');
    else if (inDl && age > 180 * day && f[1] > 20e6 && k !== 'music') addDel(f, 'Old download, not touched in 6 months');
    // move off: big things you don't use (to an external drive or the cloud)
    if (!seenDel.has(p)) {
      if (k === 'video' && f[1] > 200e6 && now - f[2] > 60 * day) move.push(Object.assign(item(f), { why: 'Big video, not opened in 2 months' }));
      else if (f[1] > 1e9 && now - f[2] > 90 * day) move.push(Object.assign(item(f), { why: 'Over 1 GB, not used in 3 months' }));
      else if ((k === 'music' || k === 'audio') && f[1] > 50e6 && now - f[2] > 365 * day) move.push(Object.assign(item(f), { why: 'Old project, over a year untouched' }));
    }
  }
  const sum = list => list.reduce((s, x) => s + x.size, 0);
  del.sort((a, b) => b.size - a.size); move.sort((a, b) => b.size - a.size);
  const keepRecent = files.filter(f => now - f[2] < 30 * day && f[1] > 0).length;
  const keepMusic = files.filter(f => kindOf(f[0]) === 'music').length;
  return {
    totalFiles: files.length, totalSize: sum(files.map(f => ({ size: f[1] }))),
    del: del.slice(0, 15), delCount: del.length, delSize: sum(del),
    move: move.slice(0, 12), moveCount: move.length, moveSize: sum(move),
    keep: { recent: keepRecent, music: keepMusic }
  };
}

module.exports = { roots, ensure, build, stats, wipe, stop, flush, itemOf, docs, find, during, counts, biggest, recent, scan, fmtSize, progress: () => progress };
