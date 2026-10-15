// Dude's settings and permissions. Saved on this laptop only.
// Every kind of access starts switched off (except basic computer health), and can be switched off again anytime.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const FOLDERS = {
  music: { label: 'Music folder', getPath: () => app.getPath('music') },
  documents: { label: 'Documents', getPath: () => app.getPath('documents') },
  downloads: { label: 'Downloads', getPath: () => app.getPath('downloads') },
  desktop: { label: 'Desktop', getPath: () => app.getPath('desktop') },
  pictures: { label: 'Pictures', getPath: () => app.getPath('pictures') },
  videos: { label: 'Videos', getPath: () => app.getPath('videos') },
  flstudio: { label: 'FL Studio projects', getPath: () => path.join(app.getPath('documents'), 'Image-Line', 'FL Studio', 'Projects') }
};

const DEFAULTS = {
  userName: '',
  onboarded: false,
  mode: 'everyday',            // everyday | music | business | student | creative
  model: 'claude-haiku-5-5',   // fast; 'claude-sonnet-5-5' is smarter
  interrupt: 'sometimes',      // rarely | sometimes | often
  dnd: false,
  perms: {
    system: true,              // battery, processor, storage, internet
    apps: false,               // which app is in front (names + window titles)
    recent: false,             // Windows "recent files" list
    memory: true,              // notes, reminders, what you worked on
    projects: false,           // look inside music projects (tempo, time spent, samples), read-only
    laptop: false,             // remember the whole laptop: every file's name, folder, size and dates, and the text inside documents
    folders: { music: false, documents: false, downloads: false, desktop: false, pictures: false, videos: false, flstudio: false },
    custom: []                 // extra folders you added: [{ path, label }]
  },
  keyEnc: ''
};

let S = null;
const file = () => path.join(app.getPath('userData'), 'dude-settings.json');

function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(file(), 'utf8'));
    S = Object.assign({}, DEFAULTS, raw);
    S.perms = Object.assign({}, DEFAULTS.perms, raw.perms || {});
    S.perms.folders = Object.assign({}, DEFAULTS.perms.folders, (raw.perms || {}).folders || {});
    S.perms.custom = Array.isArray(S.perms.custom) ? S.perms.custom : [];
  } catch (e) { S = JSON.parse(JSON.stringify(DEFAULTS)); }
  return S;
}
function get() { return S || load(); }
const listeners = [];
function onChange(fn) { listeners.push(fn); }
function save() { try { fs.mkdirSync(path.dirname(file()), { recursive: true }); fs.writeFileSync(file(), JSON.stringify(S, null, 2)); } catch (e) {} for (const fn of listeners) { try { fn(); } catch (e) {} } }

function setKey(key) {
  key = (key || '').trim();
  if (!key) { S.keyEnc = ''; save(); return; }
  if (safeStorage.isEncryptionAvailable()) S.keyEnc = 'enc:' + safeStorage.encryptString(key).toString('base64');
  else S.keyEnc = 'raw:' + Buffer.from(key).toString('base64');
  save();
}
function getKey() {
  const v = get().keyEnc || '';
  try {
    if (v.startsWith('enc:')) return safeStorage.decryptString(Buffer.from(v.slice(4), 'base64'));
    if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString();
  } catch (e) {}
  return '';
}

/* folders Dude may look in right now */
function grantedFolders() {
  const s = get(), out = [];
  for (const k in FOLDERS) if (s.perms.folders[k]) { try { out.push({ key: k, label: FOLDERS[k].label, path: FOLDERS[k].getPath() }); } catch (e) {} }
  for (const c of s.perms.custom) out.push({ key: 'custom:' + c.path, label: c.label || path.basename(c.path), path: c.path });
  return out;
}
function folderInfo(key) {
  if (FOLDERS[key]) { let p = ''; try { p = FOLDERS[key].getPath(); } catch (e) {} return { key, label: FOLDERS[key].label, path: p }; }
  return null;
}

/* the safe view the page gets (never includes the key) */
function publicView() {
  const s = get();
  const folders = Object.keys(FOLDERS).map(k => ({ key: k, label: FOLDERS[k].label, on: !!s.perms.folders[k], path: (() => { try { return FOLDERS[k].getPath(); } catch (e) { return ''; } })() }));
  return {
    userName: s.userName, onboarded: s.onboarded, mode: s.mode, model: s.model, interrupt: s.interrupt, dnd: s.dnd,
    perms: { system: s.perms.system, apps: s.perms.apps, recent: s.perms.recent, memory: s.perms.memory, projects: s.perms.projects, laptop: !!s.perms.laptop },
    folders, custom: s.perms.custom.map(c => ({ path: c.path, label: c.label })), hasKey: !!getKey()
  };
}
/* changes the page is allowed to make */
function apply(patch) {
  const s = get();
  for (const k of ['userName', 'mode', 'model', 'interrupt']) if (typeof patch[k] === 'string') s[k] = patch[k].slice(0, 40);
  for (const k of ['onboarded', 'dnd']) if (typeof patch[k] === 'boolean') s[k] = patch[k];
  if (patch.perms) for (const k of ['system', 'apps', 'recent', 'memory', 'projects', 'laptop']) if (typeof patch.perms[k] === 'boolean') s.perms[k] = patch.perms[k];
  if (patch.folders) for (const k in patch.folders) if (k in s.perms.folders) s.perms.folders[k] = !!patch.folders[k];
  if (patch.removeCustom) s.perms.custom = s.perms.custom.filter(c => c.path !== patch.removeCustom);
  save();
}
function addCustomFolder(p) {
  const s = get();
  if (!s.perms.custom.some(c => c.path === p)) s.perms.custom.push({ path: p, label: path.basename(p) || p });
  save();
}
function grantFolder(key) { const s = get(); if (key in s.perms.folders) { s.perms.folders[key] = true; save(); } }
function grantPerm(key) { const s = get(); if (key in s.perms && typeof s.perms[key] === 'boolean') { s.perms[key] = true; save(); } }

module.exports = { FOLDERS, load, get, save, onChange, setKey, getKey, grantedFolders, folderInfo, publicView, apply, addCustomFolder, grantFolder, grantPerm };
