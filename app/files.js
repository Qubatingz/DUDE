// File search, the computer check-up report, and folder watching.
// Dude only ever reads file NAMES, sizes and dates inside folders you allowed. He never opens, moves or deletes anything by himself.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');

const KINDS = {
  music: ['flp', 'als', 'alp', 'ptx', 'rpp', 'cpr', 'song', 'logicx', 'band', 'mmp', 'mmpz', 'aup3', 'npr', 'bwproject'],
  audio: ['wav', 'mp3', 'flac', 'aif', 'aiff', 'm4a', 'ogg', 'wma', 'aac', 'mid', 'midi'],
  document: ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'pptx', 'ppt', 'xlsx', 'xls', 'csv', 'odp', 'ods'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'heic', 'psd', 'ai', 'svg', 'bmp', 'tif', 'tiff', 'xcf', 'fig'],
  video: ['mp4', 'mov', 'mkv', 'avi', 'wmv', 'webm', 'm4v', 'prproj', 'aep', 'veg', 'drp'],
  program: ['exe', 'msi', 'bat', 'cmd', 'scr', 'vbs', 'ps1', 'jar', 'apk', 'com', 'pif', 'hta'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz']
};
const KIND_OF = {};
for (const k in KINDS) for (const e of KINDS[k]) KIND_OF[e] = k;
const SKIP = new Set(['node_modules', '.git', '$recycle.bin', 'appdata', '.cache', 'system volume information', '__pycache__', '.venv', 'venv', 'cache', 'temp', 'tmp']);
const STOP = new Set('a an the my me i i\'m im was were is are be been of on in at to for from with and or that this those these it its find search look looking where wheres where\'s show get open file files folder folders thing things stuff some any please dude can you could would we our working worked work made make did do last week weeks month months year today yesterday ago recent recently latest new newest old older project projects one ones called named about'.split(' '));

const indexes = new Map();   // root -> { files, builtAt, building }

async function walk(root, limit = 40000) {
  const files = [], queue = [[root, 0]];
  while (queue.length && files.length < limit) {
    const [dir, depth] = queue.shift();
    let ents;
    try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch (e) { continue; }
    for (const d of ents) {
      const name = d.name;
      if (name.startsWith('.') || name.startsWith('~$')) continue;
      const p = path.join(dir, name);
      if (d.isDirectory()) { if (depth < 8 && !SKIP.has(name.toLowerCase())) queue.push([p, depth + 1]); continue; }
      if (!d.isFile()) continue;
      try {
        const st = await fsp.stat(p);
        const ext = path.extname(name).slice(1).toLowerCase();
        files.push({ p, n: name, lower: name.toLowerCase(), ext, kind: KIND_OF[ext] || 'other', size: st.size, mtime: st.mtimeMs });
      } catch (e) {}
      if (files.length >= limit) break;
    }
  }
  return files;
}
async function getIndex(root, maxAgeMs = 5 * 60 * 1000) {
  const ix = indexes.get(root);
  if (ix && Date.now() - ix.builtAt < maxAgeMs) return ix.files;
  if (ix && ix.building) return ix.building;
  const building = walk(root).then(files => { indexes.set(root, { files, builtAt: Date.now() }); return files; });
  indexes.set(root, { files: ix ? ix.files : [], builtAt: ix ? ix.builtAt : 0, building });
  return building;
}
function forget(root) { if (root) indexes.delete(root); else indexes.clear(); }

/* "last week", "yesterday", "3 days ago"... -> [fromMs, toMs] */
function timeWindow(when) {
  const t = (when || '').toLowerCase(), now = new Date(), day = 86400000;
  const startOfDay = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
  const sod = startOfDay(now);
  let m;
  if (!t) return null;
  if (/today|this morning|tonight/.test(t)) return [sod, Infinity];
  if (/yesterday/.test(t)) return [sod - day, sod];
  if (/this week/.test(t)) { const dow = (now.getDay() + 6) % 7; return [sod - dow * day, Infinity]; }
  if (/last week/.test(t)) { const dow = (now.getDay() + 6) % 7; return [sod - (dow + 7) * day, sod - dow * day]; }
  if (/this month/.test(t)) return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), Infinity];
  if (/last month/.test(t)) return [new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime(), new Date(now.getFullYear(), now.getMonth(), 1).getTime()];
  if (/this year/.test(t)) return [new Date(now.getFullYear(), 0, 1).getTime(), Infinity];
  if ((m = t.match(/(\d+)\s*days?/))) return [sod - (+m[1]) * day, Infinity];
  if ((m = t.match(/(\d+)\s*weeks?/))) return [sod - (+m[1]) * 7 * day, Infinity];
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  for (let i = 0; i < 7; i++) if (t.includes(days[i])) { let back = (now.getDay() - i + 7) % 7; if (back === 0) back = 7; const s = sod - back * day; return [s, s + day]; }
  return null;
}
function guessKind(text) {
  const t = (text || '').toLowerCase();
  if (/\b(beat|beats|session|sessions|project|projects|flp|instrumental|riddim|production)\b/.test(t)) return 'music';
  if (/\b(song|songs|track|tracks|audio|mp3|wav|vocal|vocals|sample|samples|mix|master|export)\b/.test(t)) return 'audio';
  if (/\b(doc|docs|document|documents|pdf|notes|proposal|report|invoice|contract|cv|resume|letter|essay|assignment|slides|presentation|spreadsheet)\b/.test(t)) return 'document';
  if (/\b(photo|photos|picture|pictures|image|images|logo|logos|design|designs|screenshot|screenshots|flyer|poster|cover)\b/.test(t)) return 'image';
  if (/\b(video|videos|clip|clips|footage|shoot|movie|edit)\b/.test(t)) return 'video';
  return 'any';
}
function tokens(text) { return (text || '').toLowerCase().replace(/[^a-z0-9\s'_-]/g, ' ').split(/\s+/).filter(w => w && !STOP.has(w) && w.length > 1); }

async function search(roots, { query = '', kind = 'any', when = '' } = {}) {
  const words = tokens(query).filter(w => !['beat', 'beats', 'song', 'songs', 'track', 'tracks', 'document', 'documents', 'photo', 'photos', 'picture', 'pictures', 'video', 'videos', 'image', 'images', 'doc', 'docs'].includes(w) || kind === 'any');
  const win = timeWindow(when || query);
  const all = [];
  for (const r of roots) { const files = await getIndex(r.path); for (const f of files) all.push([f, r]); }
  const scored = [];
  for (const [f, r] of all) {
    if (kind && kind !== 'any') {
      if (kind === 'music' ? !(f.kind === 'music' || (words.length && f.kind === 'audio')) : f.kind !== kind) continue;
    }
    if (win && (f.mtime < win[0] || f.mtime >= win[1])) continue;
    let score = 0;
    for (const w of words) {
      if (f.lower.includes(w)) score += 3 + (new RegExp('(^|[^a-z0-9])' + w.replace(/[^a-z0-9]/g, '')).test(f.lower) ? 1 : 0);
      else if (f.p.toLowerCase().includes(w)) score += 1.5;
    }
    if (words.length && score === 0) continue;
    if (kind && kind !== 'any' && f.kind === kind) score += 2;
    scored.push({ f, r, score });
  }
  scored.sort((a, b) => b.score - a.score || b.f.mtime - a.f.mtime);
  return scored.slice(0, 8).map(({ f, r }) => ({ path: f.p, name: f.n, folder: r.label, kind: f.kind, size: f.size, mtime: f.mtime }));
}

function fmtSize(b) { if (b > 1e9) return (b / 1e9).toFixed(1) + ' GB'; if (b > 1e6) return Math.round(b / 1e6) + ' MB'; if (b > 1e3) return Math.round(b / 1e3) + ' KB'; return b + ' B'; }

async function report(roots, disk) {
  const all = [];
  for (const r of roots) { const files = await getIndex(r.path, 60 * 1000); for (const f of files) all.push([f, r]); }
  const day = 86400000, now = Date.now();
  const large = all.filter(([f]) => f.size > 300e6).sort((a, b) => b[0].size - a[0].size);
  const oldDl = all.filter(([f, r]) => r.key === 'downloads' && now - f.mtime > 90 * day);
  const groups = new Map();
  for (const [f] of all) { if (f.size < 50e3) continue; const k = f.lower + '|' + f.size; groups.set(k, (groups.get(k) || []).concat([f])); }
  const dups = [...groups.values()].filter(g => g.length > 1);
  const dupWaste = dups.reduce((s, g) => s + g[0].size * (g.length - 1), 0);
  const shots = all.filter(([f]) => /^(screenshot|screen shot|capture)/i.test(f.n));
  const music = all.filter(([f]) => f.kind === 'music');
  const byKind = {};
  for (const [f] of all) byKind[f.kind] = (byKind[f.kind] || 0) + f.size;
  const recs = [];
  if (oldDl.length) recs.push(`Review ${oldDl.length} old downloads (${fmtSize(oldDl.reduce((s, [f]) => s + f.size, 0))}).`);
  if (large.length) recs.push(`Move big videos or files to another drive (${large.length} files over 300 MB).`);
  if (dups.length) recs.push(`Look at ${dups.length} possible duplicates (about ${fmtSize(dupWaste)} you could free).`);
  if (shots.length > 40) recs.push(`Clean up ${shots.length} screenshots.`);
  if (music.length > 15) recs.push(`Organize ${music.length} music projects by artist or year.`);
  return {
    disk, folders: roots.map(r => r.label), totalFiles: all.length,
    large: large.slice(0, 5).map(([f, r]) => ({ path: f.p, name: f.n, folder: r.label, size: f.size, mtime: f.mtime })),
    largeCount: large.length, oldDownloads: oldDl.length, duplicates: dups.length, duplicateWaste: dupWaste,
    screenshots: shots.length, musicProjects: music.length, recommendations: recs
  };
}

/* watch allowed folders for brand-new files */
const watchers = new Map();
function watch(roots, onNew) {
  const want = new Set(roots.map(r => r.path));
  for (const [p, w] of watchers) if (!want.has(p)) { try { w.close(); } catch (e) {} watchers.delete(p); }
  for (const r of roots) {
    if (watchers.has(r.path)) continue;
    const seen = new Map();
    let w;
    try {
      w = fs.watch(r.path, { recursive: true }, (ev, rel) => {
        if (!rel) return;
        const name = path.basename(rel);
        if (/^~|\.(tmp|crdownload|part|partial|download|lock)$/i.test(name) || name.startsWith('.')) return;
        const full = path.join(r.path, rel);
        clearTimeout(seen.get(full));
        seen.set(full, setTimeout(async () => {
          seen.delete(full);
          try {
            const st = await fsp.stat(full);
            if (!st.isFile()) return;
            const born = st.birthtimeMs || st.ctimeMs;
            if (Date.now() - born > 60000) return;
            const ext = path.extname(name).slice(1).toLowerCase();
            onNew({ root: r, path: full, name, ext, kind: KIND_OF[ext] || 'other', size: st.size });
          } catch (e) {}
        }, 2500));
        indexes.delete(r.path);
      });
      w.on('error', () => {});
      watchers.set(r.path, w);
    } catch (e) {}
  }
}

module.exports = { KINDS, search, report, guessKind, timeWindow, fmtSize, watch, forget, getIndex };
