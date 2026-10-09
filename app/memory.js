// Dude's memory of your computer work: which apps you used, what you were working on, notes.
// Saved on this laptop only. Switch it off or wipe it from the Memory tab.
const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const FRIENDLY = {
  fl64: 'FL Studio', fl: 'FL Studio', 'fl studio': 'FL Studio', chrome: 'Chrome', msedge: 'Edge', firefox: 'Firefox', opera: 'Opera', brave: 'Brave',
  winword: 'Word', excel: 'Excel', powerpnt: 'PowerPoint', outlook: 'Outlook', onenote: 'OneNote', code: 'VS Code', explorer: 'File Explorer',
  spotify: 'Spotify', teams: 'Teams', 'ms-teams': 'Teams', zoom: 'Zoom', photoshop: 'Photoshop', illustrator: 'Illustrator', afterfx: 'After Effects',
  'adobe premiere pro': 'Premiere Pro', resolve: 'DaVinci Resolve', obs64: 'OBS', whatsapp: 'WhatsApp', telegram: 'Telegram', discord: 'Discord',
  reaper: 'REAPER', 'studio one': 'Studio One', bitwig: 'Bitwig', cubase14: 'Cubase', cubase13: 'Cubase', notepad: 'Notepad', capcut: 'CapCut', figma: 'Figma', vlc: 'VLC',
  claude: 'Claude', chatgpt: 'ChatGPT', cursor: 'Cursor', windowsterminal: 'Terminal', powershell: 'PowerShell', pwsh: 'PowerShell', cmd: 'Command Prompt', devenv: 'Visual Studio',
  audacity: 'Audacity', canva: 'Canva', steam: 'Steam', netflix: 'Netflix', 'whatsapp.root': 'WhatsApp', protools: 'Pro Tools', 'adobe audition': 'Audition'
};
function friendly(exe) {
  const k = (exe || '').toLowerCase();
  if (FRIENDLY[k]) return FRIENDLY[k];
  if (/^ableton live/.test(k)) return 'Ableton Live';
  if (/^cubase/.test(k)) return 'Cubase';
  return exe || 'an app';
}

const file = () => path.join(app.getPath('userData'), 'dude-memory.json');
let M = null;
function load() { try { M = JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (e) { M = {}; } M.days = M.days || {}; M.opened = M.opened || []; M.routine = M.routine || {}; return M; }
function get() { return M || load(); }
let dirty = false;
function save() { try { fs.writeFileSync(file(), JSON.stringify(M)); dirty = false; } catch (e) {} }
setInterval(() => { if (dirty) save(); }, 30000);

const dkey = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = () => dkey(new Date());
// your "day" for routine purposes runs from 5am to 5am, so a 2am session still counts as last night
const logicalToday = () => dkey(new Date(Date.now() - 5 * 3600e3));
function dayRec(k) { const m = get(); return m.days[k] || (m.days[k] = { apps: {}, titles: [], talked: 0 }); }

/* called every few seconds with the app in front (only when you allowed app access + memory) */
function trackApp(exe, title, secs) {
  if (!exe) return;
  const d = dayRec(today());
  const name = friendly(exe);
  d.apps[name] = (d.apps[name] || 0) + secs;
  const work = cleanTitle(title, name);
  if (work) { d.titles = d.titles.filter(t => t.t !== work); d.titles.push({ t: work, app: name, at: Date.now() }); if (d.titles.length > 40) d.titles.shift(); }
  dirty = true;
}
function cleanTitle(title, appName) {
  if (!title) return '';
  let t = title.replace(/\s+/g, ' ').trim();
  // "beat_tuesday.flp - FL Studio 21" -> "beat_tuesday.flp"
  const parts = t.split(/ [-–—|] /);
  if (parts.length > 1) t = parts[0];
  if (!t || t.length < 3 || /^(new tab|untitled|home|start|inbox|google|youtube)$/i.test(t)) return '';
  if (t.toLowerCase() === (appName || '').toLowerCase()) return '';
  return t.slice(0, 80);
}
function noteOpened(p) { const m = get(); m.opened = [p].concat(m.opened.filter(x => x !== p)).slice(0, 30); dirty = true; }
function noteTalk() { dayRec(today()).talked++; dirty = true; }

/* ---------- routine: when you're at the laptop (only while memory is on) ---------- */
function routineRec(k) { const m = get(); return m.routine[k] || (m.routine[k] = { first: 0, last: 0, active: 0, hours: {}, sites: {} }); }
function trackPresence(secs) {
  const k = logicalToday(), r = routineRec(k), now = Date.now();
  if (!r.first) r.first = now;
  r.last = now; r.active += secs;
  const h = new Date().getHours(); r.hours[h] = (r.hours[h] || 0) + secs;
  const keys = Object.keys(get().routine).sort();
  while (keys.length > 60) delete get().routine[keys.shift()];
  dirty = true;
}
function trackSite(name, secs) { const r = routineRec(logicalToday()); r.sites[name] = (r.sites[name] || 0) + secs; dirty = true; }
function routineDays(n) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) { const k = dkey(new Date(Date.now() - 5 * 3600e3 - i * 86400e3)); const r = get().routine[k]; if (r) out.push({ key: k, r }); }
  return out;
}
function routineToday() { return get().routine[logicalToday()] || null; }
function markPattern() { routineRec(logicalToday()).pattern = true; dirty = true; }
function topApps(n) {
  const tot = {};
  for (let i = 0; i < n; i++) { const d = get().days[dkey(new Date(Date.now() - i * 86400e3))]; if (!d) continue; for (const a in d.apps) if (!/^(File Explorer|Desktop|an app)$/.test(a)) tot[a] = (tot[a] || 0) + d.apps[a]; }
  return Object.entries(tot).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([name, s]) => ({ name, hours: s / 3600 }));
}

function fmtDur(s) { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m} min`; }

/* the most recent day before today that has something in it */
function lastDay() {
  const m = get(), t = today();
  const keys = Object.keys(m.days).filter(k => k < t && (Object.keys(m.days[k].apps).length || m.days[k].titles.length)).sort();
  return keys.length ? keys[keys.length - 1] : null;
}
function summary(dayKey) {
  const d = get().days[dayKey];
  if (!d) return null;
  const apps = Object.entries(d.apps).filter(([a]) => a !== 'File Explorer').sort((a, b) => b[1] - a[1]).slice(0, 3);
  const titles = d.titles.slice().sort((a, b) => b.at - a.at).slice(0, 4);
  const date = new Date(dayKey + 'T12:00:00');
  const diff = Math.round((new Date(today() + 'T12:00:00') - date) / 86400000);
  const when = diff === 1 ? 'Yesterday' : diff < 7 ? date.toLocaleDateString('en-US', { weekday: 'long' }) : date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
  return { when, apps: apps.map(([a, s]) => ({ app: a, time: fmtDur(s) })), working: titles.map(t => ({ title: t.t, app: t.app })) };
}

/* Windows' own "recent files" list (only with your permission) */
function recentFiles(limit = 6) {
  if (process.platform !== 'win32') return [];
  const dir = path.join(process.env.APPDATA || '', 'Microsoft', 'Windows', 'Recent');
  let ents = [];
  try { ents = fs.readdirSync(dir).filter(n => n.toLowerCase().endsWith('.lnk')).map(n => ({ n, t: fs.statSync(path.join(dir, n)).mtimeMs })); } catch (e) { return []; }
  ents.sort((a, b) => b.t - a.t);
  const out = [];
  for (const e of ents) {
    let target = '';
    try { target = shell.readShortcutLink(path.join(dir, e.n)).target; } catch (err) {}
    if (!target || !path.extname(target)) continue;
    try { if (!fs.statSync(target).isFile()) continue; } catch (err) { continue; }
    out.push({ path: target, name: path.basename(target), mtime: e.t });
    if (out.length >= limit) break;
  }
  return out;
}

function wipe() { M = { days: {}, opened: [], routine: {} }; save(); }

module.exports = { today, logicalToday, friendly, trackApp, noteOpened, noteTalk, lastDay, summary, recentFiles, wipe, fmtDur, trackPresence, trackSite, routineDays, routineToday, markPattern, topApps, save: () => dirty && save() };
