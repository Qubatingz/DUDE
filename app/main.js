// Dude — an AI desktop companion for Windows.
// One transparent, click-through window covers the screen; only Dude himself (and his panels/cards) catch the mouse.
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell, dialog, net, powerMonitor, clipboard } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFile, execFileSync } = require('child_process');
const settings = require('./settings');
const files = require('./files');
const memory = require('./memory');
const habits = require('./habits');
const voice = require('./voice');
const dudeVoice = require('./dudevoice');
const ears = require('./ears');
const engine = require('./engine');
const { log, tail: logTail, where: logFile } = require('./log');
const laptop = require('./laptop');
const knowledge = require('./knowledge');
const studio = require('./studio');
const { readFlp } = require('./flp');
const { createBrain } = require('./brain');

app.setAppUserModelId('com.dude.desktoppet');
// build check (CI): DUDE_SELFTEST=<result.json> runs his voice and ears once in a fresh folder, then quits
const SELFTEST = process.env.DUDE_SELFTEST || '';
if (SELFTEST) app.setPath('userData', path.join(os.tmpdir(), 'dude-selftest-' + process.pid));
// Only one Dude at a time. Opening the same Dude again just wakes him up.
// But if an OLDER Dude from another folder is still running (in the tray, or started with Windows),
// this one takes over: otherwise the old one keeps running and the new download never gets a chance.
const ME = { exe: process.execPath, version: app.getVersion() };
let haveLock = !!SELFTEST || app.requestSingleInstanceLock(ME);
const sameExe = (a, b) => path.resolve(String(a || '')).toLowerCase() === path.resolve(String(b || '')).toLowerCase();
const verNum = v => { const [a = 0, b = 0, c = 0] = String(v || '0').split('.').map(n => parseInt(n, 10) || 0); return a * 1e6 + b * 1e3 + c; };
function versionAt(exe) { try { return JSON.parse(fs.readFileSync(path.join(path.dirname(exe), 'resources', 'app', 'package.json'), 'utf8')).version || ''; } catch (e) { return ''; } }
// other running Dude.exe copies that live in a different folder: [{ pid, exe }]
function otherCopies() {
  if (process.platform !== 'win32') return [];
  try {
    // (sent base64-encoded, so no quote marks get lost on the way to PowerShell)
    const ps = "[Console]::OutputEncoding = [Text.Encoding]::UTF8; Get-CimInstance Win32_Process -Filter \"Name='Dude.exe'\" | ForEach-Object { '' + $_.ProcessId + '|' + $_.ParentProcessId + '|' + $_.ExecutablePath }";
    const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')],
      { timeout: 12000, windowsHide: true, encoding: 'utf8' });
    return parseCopies(out, process.pid, process.execPath);
  } catch (e) { log('app', 'could not list other Dudes: ' + (e && e.message)); return []; }
}
// lines "pid|parent pid|path". Not this Dude, and not this Dude's own helper processes.
function parseCopies(out, myPid, myExe) {
  return String(out || '').replace(/^\uFEFF/, '').split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => { const [pid, ppid, ...rest] = l.split('|'); return { pid: +pid, ppid: +ppid, exe: rest.join('|').trim() }; })
    .filter(o => o.pid && o.pid !== myPid && o.ppid !== myPid && o.exe && !sameExe(o.exe, myExe));
}
const sleepMs = ms => new Promise(r => setTimeout(r, ms));
async function takeOver() {
  if (haveLock) return true;
  const retry = async n => { for (let i = 0; i < n && !haveLock; i++) { await sleepMs(400); haveLock = app.requestSingleInstanceLock(ME); } return haveLock; };
  const others = otherCopies();
  if (!others.length) {
    // nothing from another folder is running: this same Dude is already open (he wakes up and this copy leaves),
    // or another copy just stepped aside for this one
    if (await retry(3)) { log('app', 'the other Dude stepped aside'); fixStartWithWindows(); return true; }
    return false;
  }
  const exes = [...new Set(others.map(o => o.exe))];
  const newest = exes.reduce((m, e) => Math.max(m, verNum(versionAt(e))), 0);
  if (newest > verNum(ME.version)) { log('app', `a newer Dude is already running (${exes.join(', ')}), so this one leaves`); return false; }
  log('app', `taking over from another Dude: ${exes.map(e => `${e} (${versionAt(e) || 'old'})`).join(', ')}`);
  if (!(await retry(8))) {   // a new enough Dude steps aside by himself; an old one has to be closed
    try { execFileSync('taskkill.exe', ['/F', '/T', ...others.flatMap(o => ['/PID', String(o.pid)])], { timeout: 12000, windowsHide: true }); } catch (e) {}
    await retry(20);
  }
  log('app', haveLock ? 'took over' : 'the old Dude did not let go; starting anyway');
  fixStartWithWindows();
  return true;
}
// "Start with Windows" still points at the old Dude's folder: point it at this one
function fixStartWithWindows() {
  if (process.platform !== 'win32') return;
  try {
    const out = execFileSync('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'], { timeout: 8000, windowsHide: true, encoding: 'utf8' });
    const hit = out.split(/\r?\n/).map(l => l.match(/^\s+(.+?)\s+REG_\w+\s+(.*)$/)).filter(Boolean).filter(m => /dude\.exe/i.test(m[2]) && !m[2].toLowerCase().includes(process.execPath.toLowerCase()));
    if (!hit.length) return;
    for (const m of hit) { try { execFileSync('reg.exe', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', m[1], '/f'], { timeout: 8000, windowsHide: true }); } catch (e) {} }
    app.setLoginItemSettings({ openAtLogin: true });
    log('app', 'Start with Windows now opens this Dude');
  } catch (e) {}
}

let win = null, tray = null, watcher = null, quitting = false;
const workArea = () => screen.getPrimaryDisplay().workArea;
const send = (ch, payload) => { if (win && !win.isDestroyed()) win.webContents.send(ch, payload); };
const fmt = b => files.fmtSize(b);

function createWindow() {
  const wa = workArea();
  win = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: wa.height,
    transparent: true, frame: false, resizable: false, movable: false, minimizable: false, maximizable: false,
    fullscreenable: false, skipTaskbar: true, hasShadow: false, alwaysOnTop: true, show: false,
    backgroundColor: '#00000000', title: 'Dude', icon: path.join(__dirname, 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false, autoplayPolicy: 'no-user-gesture-required' }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}
// after a file picker closes, Windows can forget the click-through setting: switch it back on (Dude's page fixes it on the next mouse move)
function rearmMouse() { if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(true, { forward: true }); }
function fitToScreen() { if (win && !win.isDestroyed()) win.setBounds(workArea()); }
function cmd(c) {
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.showInactive();
  send('kito:cmd', c);
}

/* ================= asking permission ================= */
const pendingAsks = new Map(); let askSeq = 0;
function ask(scope, question, reason) {
  return new Promise(resolve => {
    const id = 'a' + (++askSeq);
    pendingAsks.set(id, resolve);
    send('dude:ask', { id, scope, question, reason });
    setTimeout(() => { if (pendingAsks.has(id)) { pendingAsks.delete(id); send('dude:askDone', id); resolve(false); } }, 60000);
  });
}
ipcMain.on('dude:answer', (e, a) => { const r = a && pendingAsks.get(a.id); if (r) { pendingAsks.delete(a.id); r(!!a.allow); } });

/* ================= computer health ================= */
let prevCpu = os.cpus();
function cpuNow() {
  const cur = os.cpus(); let idle = 0, total = 0;
  cur.forEach((c, i) => { const p = prevCpu[i] || c; for (const k in c.times) total += c.times[k] - p.times[k]; idle += c.times.idle - p.times.idle; });
  prevCpu = cur;
  return total > 0 ? 1 - idle / total : 0;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
function disk() {
  const drive = process.platform === 'win32' ? (process.env.SystemDrive || 'C:') : '/';
  try { const s = fs.statfsSync(process.platform === 'win32' ? drive + '\\' : drive); return { drive, freeB: s.bavail * s.bsize, totalB: s.blocks * s.bsize, freeRatio: s.bavail / s.blocks }; } catch (e) { return null; }
}
function topApps() {
  if (process.platform !== 'win32') return Promise.resolve([]);
  const ps = "Get-Process | Group-Object ProcessName | ForEach-Object { [pscustomobject]@{ n = $_.Name; mb = [int](($_.Group | Measure-Object WorkingSet64 -Sum).Sum / 1MB) } } | Sort-Object mb -Descending | Select-Object -First 5 | ConvertTo-Json -Compress";
  return new Promise(resolve => {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true, timeout: 7000 }, (err, out) => {
      try { const j = JSON.parse(out); resolve((Array.isArray(j) ? j : [j]).map(a => `${memory.friendly(a.n)} (${a.mb} MB)`)); } catch (e) { resolve([]); }
    });
  });
}
async function status(ctx = {}) {
  const s = settings.get();
  if (!s.perms.system) return { error: 'permission_denied', note: 'Computer health is switched off in the Access tab.' };
  cpuNow(); await sleep(400); const cpu = cpuNow();
  const mem = 1 - os.freemem() / os.totalmem(), dk = disk(), upDays = os.uptime() / 86400;
  const out = { processor: Math.round(cpu * 100) + '% busy', memory: `${Math.round(mem * 100)}% used of ${fmt(os.totalmem())}`, internet: ctx.online === false ? 'offline' : 'online', windows: `${os.version()} (${os.release()})`, uptime: upDays >= 1 ? `${Math.floor(upDays)} days since restart` : `${Math.round(os.uptime() / 3600)} hours since restart`, problems: [] };
  if (ctx.battery) out.battery = `${ctx.battery.level}%${ctx.battery.charging ? ' and charging' : ''}`;
  if (dk) out.storage = { drive: dk.drive, free: fmt(dk.freeB), total: fmt(dk.totalB), usedPercent: Math.round(100 * (1 - dk.freeRatio)) };
  if (cpu > .85) out.problems.push('The processor is working very hard right now.');
  if (mem > .88) out.problems.push('Memory is almost full. Closing some apps or browser tabs will help.');
  if (dk && dk.freeRatio < .08) out.problems.push('Storage is almost full.');
  if (ctx.battery && ctx.battery.level < 15 && !ctx.battery.charging) out.problems.push('The battery is low.');
  if (upDays > 5) out.problems.push(`The laptop hasn't restarted in ${Math.floor(upDays)} days. A restart often makes it faster.`);
  if (s.perms.apps) { out.appInFront = focus.app || null; out.heaviestApps = await topApps(); }
  return out;
}
ipcMain.handle('kito:stats', () => { const dk = disk(); return { cpu: cpuNow(), disk: dk ? dk.freeRatio : 1 }; });

/* ================= opening files ================= */
async function openPath(p, how) {
  try {
    if (how === 'show') shell.showItemInFolder(p);
    else { const err = await shell.openPath(p); if (err) return err; }
    if (settings.get().perms.memory) memory.noteOpened(p);
    return '';
  } catch (e) { return String(e.message || e); }
}

/* ================= the brain ================= */
const laptopDone = st => send('dude:event', { type: 'laptopReady', files: st.files });
const brain = createBrain({ settings, files, memory, habits, studio, laptop, laptopDone, knowledge, openInFl: p => openInFl(p), status, ask, open: openPath, net, emit: (type, payload) => send('dude:' + type, payload) });
ipcMain.handle('dude:chat', (e, text, ctx) => brain.chat(String(text || '').slice(0, 600), ctx || {}));
ipcMain.handle('dude:thought', (e, req, ctx) => brain.thought(req || {}, ctx || {}));
ipcMain.handle('dude:habits', () => settings.get().perms.memory ? habits.learned() : { off: true, insights: [] });
ipcMain.handle('dude:open', async (e, a) => { const f = brain.results.get(a && a.id); if (!f) return 'gone'; return openPath(f.path, a.how === 'show' ? 'show' : 'open'); });

/* ================= what he knows: your whole laptop, and things you gave him to learn ================= */
ipcMain.handle('dude:laptop:stats', () => Object.assign({ allowed: !!settings.get().perms.laptop }, laptop.stats()));
const learnErr = e => ({ error: String((e && e.message) || e) });
ipcMain.handle('dude:learn:pick', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Give Dude something to learn', properties: ['openFile'], filters: [{ name: 'Things Dude can read', extensions: ['pdf', 'docx', 'pptx', 'txt', 'md', 'rtf', 'csv', 'html', 'htm', 'srt', 'lrc', 'json'] }] });
  rearmMouse();
  if (r.canceled || !r.filePaths[0]) return { canceled: true };
  try { return await knowledge.learnFile(r.filePaths[0]); } catch (e) { return learnErr(e); }
});
ipcMain.handle('dude:learn:file', async (e, p) => { try { return await knowledge.learnFile(String(p || '')); } catch (err) { return learnErr(err); } });
ipcMain.handle('dude:learn:text', (e, text, title) => { try { return knowledge.learnText(String(text || '').slice(0, 400000), title ? String(title).slice(0, 90) : ''); } catch (err) { return learnErr(err); } });
ipcMain.handle('dude:learn:url', async (e, url) => { try { return await knowledge.learnUrl(String(url || '')); } catch (err) { return learnErr(err); } });
ipcMain.handle('dude:know:list', () => knowledge.list());
ipcMain.handle('dude:know:forget', (e, id) => knowledge.forget(String(id || '')));

/* ================= settings & permissions ================= */
ipcMain.handle('dude:settings', () => settings.publicView());
ipcMain.handle('dude:settings:set', (e, patch) => { settings.apply(patch || {}); return settings.publicView(); });
// any change (also a "yes" to "Can I search your folder?") starts watching new folders and updates his panel
let settingsTimer = 0;
settings.onChange(() => { clearTimeout(settingsTimer); settingsTimer = setTimeout(() => { afterSettings(); send('dude:settingsChanged', settings.publicView()); }, 50); });
ipcMain.handle('dude:key', async (e, key) => {
  key = String(key || '').trim();
  if (!key) { settings.setKey(''); brain.reset(); return { ok: true, view: settings.publicView() }; }
  const r = await brain.testKey(key);
  if (r.ok || (r.status === 400 && /credit/i.test(r.error))) { settings.setKey(key); brain.reset(); }
  return Object.assign(r, { view: settings.publicView() });
});
ipcMain.handle('dude:folder:add', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick a folder Dude may search', properties: ['openDirectory'] });
  rearmMouse();
  if (!r.canceled && r.filePaths[0]) { settings.addCustomFolder(r.filePaths[0]); afterSettings(); }
  return settings.publicView();
});
ipcMain.handle('dude:memory:wipe', async () => { memory.wipe(); studio.forget(); laptop.wipe(); knowledge.wipe(); brain.reset(); await voice.forget(); return true; });

/* ================= the studio: FL Studio projects (see studio.js) ================= */
// Dude's own suggestions come through here; they never ask for new permissions (the brain does that).
async function studioList() {
  const s = settings.get(), roots = settings.grantedFolders();
  if (!roots.length) return null;
  return studio.list(roots, files, memory, { look: s.perms.projects });
}
const keepOne = p => p && Object.assign({ id: brain.keep([{ path: p.path, name: p.name + '.flp' }])[0].id }, p);
ipcMain.handle('dude:studio:report', async () => {
  const L = await studioList(); if (!L) return { off: true };
  const rep = studio.report(L);
  const all = rep.untitled.concat(rep.unfinished, rep.versionPiles, rep.stale, rep.mostWorked);
  const ids = brain.keep(all.map(p => ({ path: p.path, name: p.name + '.flp' })));
  for (const k of ['untitled', 'unfinished', 'versionPiles', 'stale', 'mostWorked']) rep[k] = rep[k].map(p => Object.assign({ id: (ids.find(x => x.path === p.path) || {}).id }, p));
  return { report: rep, looked: settings.get().perms.projects };
});
ipcMain.handle('dude:studio:current', async () => {
  const L = await studioList(); if (!L) return { off: true };
  const cur = /^fl(64)?$/i.test(focus.exe) ? studio.titleProject(focus.title) : '';
  const last = L.projects[0];   // the one you touched most recently
  return { current: cur, currentUntitled: !cur || studio.isUntitled(cur), last: last ? keepOne(studio.brief(last)) : null };
});
// renaming a project while FL Studio has it open would make FL save the old name again on Ctrl+S
function openInFl(file) {
  const name = path.basename(file, path.extname(file)).toLowerCase();
  if (/^fl(64)?$/i.test(focus.exe) && studio.titleProject(focus.title).toLowerCase() === name) return true;
  const seen = memory.projectTime()[name];
  return !!seen && Date.now() - seen.last < 90e3;
}
ipcMain.handle('dude:copy', async (e, text) => { await clipboard.writeText(String(text || '').slice(0, 200)); return true; });
ipcMain.handle('dude:studio:rename', async (e, id, name) => {
  const f = brain.results.get(id);
  if (!f) return { error: 'That list is old. Ask me again.' };
  if (openInFl(f.path)) { await clipboard.writeText(String(name || '')); return { error: 'open', name }; }
  try { const r = await studio.rename(f.path, name, settings.grantedFolders()); brain.results.set(id, { path: r.path, name: r.name + '.flp' }); return r; }
  catch (err) { return { error: String(err.message || err) }; }
});
ipcMain.handle('dude:studio:undo', async () => { try { return await studio.undo(); } catch (err) { return { error: String(err.message || err) }; } });

/* ================= "my voice": Dude talks in your voice (see voice.js) ================= */
const voiceEmit = () => send('dude:voiceStatus', voice.status());
ipcMain.handle('dude:voice:status', () => voice.status());
ipcMain.handle('dude:voice:prepare', () => voice.prepare(voiceEmit));
ipcMain.handle('dude:voice:setRef', (e, samples, sr, text) => voice.setRef(samples, sr, text).catch(err => ({ error: String(err.message || err) })));
ipcMain.handle('dude:voice:say', (e, text, speed) => voice.say(text, speed));
ipcMain.handle('dude:voice:forget', () => voice.forget());
// Dude's own voice (voice 1)
const dvEmit = () => send('dude:dvStatus', dudeVoice.status());
ipcMain.handle('dude:dv:status', () => dudeVoice.status());
ipcMain.handle('dude:dv:prepare', () => dudeVoice.prepare(dvEmit));
ipcMain.handle('dude:dv:say', (e, text, speed) => dudeVoice.say(text, speed));
// his problem log (voice, ears, downloads): open the folder, or read the last lines
// "open your log": a report you can find easily. It goes on the Desktop as "Dude problem log.txt", opens in Notepad,
// and is copied, so you can paste it straight into a message (Ctrl+V). Only notes about his voice, ears and downloads.
function problemReport(extra = {}) {
  const v = dudeVoice.status(), e = ears.status(), cpu = os.cpus();
  const lines = [
    `Dude ${ME.version}  |  ${new Date().toString().slice(0, 24)}`,
    `Running from: ${process.execPath}`,
    `Windows: ${os.version()} ${os.release()} ${os.arch()}  |  ${cpu.length} x ${(cpu[0] && cpu[0].model || '?').trim()}  |  ${Math.round(os.totalmem() / 1e9)} GB memory`,
    `Speech engine: ${engine.ok() ? 'works' : 'broken: ' + engine.why()}`,
    `His voice: ${v.state}${v.state === 'downloading' ? ' ' + Math.round(v.progress * 100) + '%' : ''}${v.error ? ' (' + v.error + ')' : ''}, fails ${v.fails}, speed ${v.rtf || '?'} s per second of speech`,
    `His ears: ${e.state}${e.state === 'downloading' ? ' ' + Math.round(e.progress * 100) + '%' : ''}${e.error ? ' (' + e.error + ')' : ''}, fails ${e.fails}`,
    `Listening with: ${hearMode || 'nothing'}  |  voice picked in his panel: ${extra.engine || '?'}  |  sound ${extra.voiceOn === false ? 'off' : 'on'}`,
    '', '--- his notes ---', logTail(150)
  ];
  return lines.join('\r\n');
}
ipcMain.handle('dude:log:open', async (e, extra) => {
  log('app', 'problem log opened');
  const text = problemReport(extra || {});
  try { clipboard.writeText(text); } catch (er) {}
  let f = '';
  try { f = path.join(app.getPath('desktop'), 'Dude problem log.txt'); fs.writeFileSync(f, text); } catch (er) { f = ''; }
  if (f) { const r = await shell.openPath(f); if (r) shell.showItemInFolder(f); }
  else shell.showItemInFolder(logFile());
  return { desktop: !!f, copied: true };
});
ipcMain.handle('dude:log:tail', () => logTail(30));
ipcMain.handle('dude:version', () => ME.version);
ipcMain.on('dude:log', (e, area, msg) => log(String(area).slice(0, 12), msg));
function afterSettings() {
  // his memory of the whole laptop: on when you allow it, forgotten completely when you switch it off
  if (settings.get().perms.laptop) laptop.ensure(laptopDone); else if (laptop.stats().state !== 'idle' || laptop.stats().files) laptop.wipe();
  const roots = settings.grantedFolders();
  if (process.env.DUDE_DEBUG) console.log('[watch]', roots.map(r => r.path).join(' | '));
  files.watch(roots, onNewFile);
  for (const r of roots) files.getIndex(r.path).catch(() => {});
  pushFocus(true);
}

/* new files in allowed folders: warn about programs in Downloads, celebrate new exports */
let lastCheer = 0;
function onNewFile(f) {
  if (process.env.DUDE_DEBUG) console.log('[newfile]', f.path, f.ext);
  if (f.ext === 'flp' && studio.justTouched(f.path)) return;   // Dude renamed it himself
  if (f.ext === 'flp' && !/[\\/]backup[\\/]|\((autosave|overwrite)\)/i.test(f.path)) {
    const name = path.basename(f.path, path.extname(f.path));
    let info = null; if (settings.get().perms.projects) { try { info = readFlp(f.path); } catch (e) {} }
    const id = brain.keep([{ path: f.path, name: f.name }])[0].id;
    send('dude:event', { type: 'project', id, name, untitled: studio.isUntitled(name), suggest: studio.suggestName({ created: Date.now(), mtime: Date.now(), info }) });
    return;
  }
  if (f.root.key === 'downloads' && f.kind === 'program') send('dude:event', { type: 'suspicious', name: f.name });
  else if ((f.kind === 'audio' || f.kind === 'video') && f.root.key !== 'downloads' && f.size > 200e3 && Date.now() - lastCheer > 120000) { lastCheer = Date.now(); send('dude:event', { type: 'export', name: f.name }); }
}

/* ================= welcome back ================= */
ipcMain.handle('dude:welcome', () => {
  const s = settings.get(), out = {};
  if (s.perms.memory) { const d = memory.lastDay(); if (d) out.last = memory.summary(d); }
  if (s.perms.recent) out.recent = brain.keep(memory.recentFiles(3)).map(f => ({ id: f.id, name: f.name }));
  if (s.perms.folders.desktop) { try { const n = fs.readdirSync(app.getPath('desktop')).filter(x => !/^desktop\.ini$/i.test(x)).length; if (n > 60) out.clutter = n; } catch (e) {} }
  return out;
});

/* ================= voice input (Windows speech recognition, push-to-talk) ================= */
let listening = null;
const VOICE_ERR = {
  nomic: "I can't hear you. Check your microphone, and that desktop apps may use it (Windows Settings > Privacy > Microphone).",
  norecognizer: "Windows speech recognition isn't installed. Add English speech in Settings > Time & language > Speech.",
  nothing: "I didn't catch that. Try again?"
};
function listen() {
  if (process.platform !== 'win32') return Promise.resolve({ ok: false, error: 'Voice input works on Windows only.' });
  if (listening) return listening;
  listening = new Promise(resolve => {
    let out = '';
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'listen.ps1')], { windowsHide: true });
    const t = setTimeout(() => { try { p.kill(); } catch (e) {} }, 22000);
    p.stdout.on('data', d => { out += d.toString(); });
    p.on('error', () => { clearTimeout(t); listening = null; resolve({ ok: false, error: 'Voice input could not start.' }); });
    p.on('exit', () => {
      clearTimeout(t); listening = null;
      const line = out.split(/\r?\n/).find(l => /^(OK|ERR):/.test(l)) || 'ERR:nothing';
      if (line.startsWith('OK:') && line.slice(3).trim()) resolve({ ok: true, text: line.slice(3).trim() });
      else resolve({ ok: false, error: VOICE_ERR[line.slice(4).trim()] || VOICE_ERR.nothing });
    });
  });
  return listening;
}
ipcMain.handle('dude:listen', () => listen());

/* ================= always listening (only while Dude is switched on) ================= */
// His ears (ears.js): your microphone sound comes from his page, Whisper works out the words, right here on the laptop.
// Until his ears have downloaded (or if they can't load), Windows speech recognition (hear.ps1) fills in.
// While Dude himself is talking, he stops listening, so he doesn't hear his own voice. Nothing is recorded or saved.
let hearer = null, hearWant = false, hearFails = 0, hearMode = '';
const pauseFile = () => path.join(os.tmpdir(), `dude-hear-pause-${process.pid}`);
const earsEmit = () => send('dude:hear', Object.assign({ type: 'ears' }, ears.status()));
const onEarsHeard = h => send('dude:hear', { type: 'heard', text: h.text, conf: h.conf, by: 'ears' });
function useEars() {
  if (!hearWant || !ears.ready()) return false;
  winHearStop();
  ears.listen(true, onEarsHeard);
  if (hearMode !== 'ears') log('ears', 'listening with his own ears');
  hearMode = 'ears';
  send('dude:hear', { type: 'mode', mode: 'ears' });
  return true;
}
let earsRetry = 0;
function earsGet() {
  clearTimeout(earsRetry);
  ears.prepare(earsEmit).then(st => {
    if (st.state === 'ready') { useEars(); return; }
    if (hearWant && !hearer && hearMode !== 'windows') winHearStart();
    // the internet dropped? try again by himself a bit later
    if (st.errKind === 'net' && st.fails <= 3) earsRetry = setTimeout(() => { if (hearWant) earsGet(); }, [0, 60e3, 180e3, 600e3][st.fails]);
  }).catch(() => {});
}
function hearStart() {
  hearWant = true;
  if (useEars()) return { ok: true, mode: 'ears' };
  // his ears aren't ready: get them (after his voice, which starts downloading first), and let Windows listen until then
  setTimeout(earsGet, 1500);
  if (process.platform !== 'win32') return { ok: true, mode: 'waiting' };
  return winHearStart();
}
function winHearStart() {
  if (process.platform !== 'win32' || !hearWant) return { ok: false, error: 'Listening works on Windows only.' };
  if (hearer) return { ok: true, mode: 'windows' };
  try { fs.unlinkSync(pauseFile()); } catch (e) {}
  try { hearer = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'hear.ps1'), pauseFile()], { windowsHide: true }); }
  catch (e) { hearer = null; log('hear', 'Windows listening could not start: ' + e.message); return { ok: false, error: 'Listening could not start.' }; }
  hearMode = 'windows';
  send('dude:hear', { type: 'mode', mode: 'windows' });
  let buf = '', failed = false;
  const me = hearer;
  me.stdout.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line === 'READY') { hearFails = 0; log('hear', 'Windows listening ready'); send('dude:hear', { type: 'ready' }); }
      else if (line.startsWith('OK:')) { const m = line.match(/^OK:([\d.]+):(.*)$/); if (m && m[2].trim()) send('dude:hear', { type: 'heard', conf: +m[1], text: m[2].trim(), by: 'windows' }); }
      else if (line.startsWith('ERR:')) {
        failed = true; log('hear', 'Windows listening: ' + line);
        // his own ears are coming: don't scare you with a Windows problem in the meantime
        const st = ears.status();
        if (!['downloading', 'unpacking', 'loading'].includes(st.state)) send('dude:hear', { type: 'error', error: VOICE_ERR[line.slice(4).trim()] || 'Listening stopped.' });
      }
    }
  });
  me.on('error', () => {});
  me.on('exit', () => {
    if (hearer === me) hearer = null;
    // it stopped by itself (not because of an error message): start it again, but don't keep trying forever
    if (hearWant && hearMode === 'windows' && !quitting && !failed && ++hearFails <= 3) setTimeout(() => { if (hearWant && !hearer && hearMode === 'windows') winHearStart(); }, 2000 * hearFails);
  });
  return { ok: true, mode: 'windows' };
}
function winHearStop() { if (hearer) { const h = hearer; hearer = null; try { h.kill(); } catch (e) {} } try { fs.unlinkSync(pauseFile()); } catch (e) {} }
function hearStop() { hearWant = false; hearMode = ''; winHearStop(); ears.listen(false); }
function hearPause(on) {
  if (on) ears.reset();
  try { if (on) fs.writeFileSync(pauseFile(), '1'); else fs.unlinkSync(pauseFile()); } catch (e) {}
}
ipcMain.handle('dude:hear:start', () => hearStart());
ipcMain.on('dude:hear:stop', () => hearStop());
ipcMain.on('dude:hear:pause', (e, on) => hearPause(!!on));
// microphone sound from his page (16 kHz, about 8 times a second), only while his ears are on
ipcMain.on('dude:ears:audio', (e, samples) => { if (hearMode === 'ears') ears.feed(samples); });
ipcMain.handle('dude:ears:status', () => ears.status());
// "try again" (his voice and his ears)
ipcMain.handle('dude:voice:retry', async () => {
  engine.retry();
  const v = await dudeVoice.prepare(dvEmit);
  if (hearWant && !ears.ready()) earsGet();
  return v;
});


/* ================= what's on screen: windows + the app in front ================= */
let focus = { exe: '', title: '', app: '', fullscreen: false, quiet: false };
let lastFocusSent = '';
const FOCUS_APPS = /^(fl64|fl|ableton live.*|studio one|reaper|cubase.*|bitwig studio|protools|afterfx|adobe premiere pro|photoshop|illustrator|resolve|obs64|zoom|teams|ms-teams|webex.*|ciscowebex.*)$/i;
function pushFocus(force) {
  const s = settings.get();
  focus.quiet = !!(s.dnd || focus.fullscreen || (s.perms.apps && FOCUS_APPS.test(focus.exe)));
  const payload = { type: 'focus', quiet: focus.quiet, fullscreen: focus.fullscreen, dnd: s.dnd, app: s.perms.apps ? focus.app : '' };
  const key = JSON.stringify(payload);
  if (force || key !== lastFocusSent) { lastFocusSent = key; send('dude:event', payload); }
}
function startWatcher() {
  if (process.platform !== 'win32' || quitting) return;
  try { watcher = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'windows.ps1'), String(process.pid)], { windowsHide: true }); }
  catch (e) { watcher = null; return; }
  let buf = '';
  watcher.stdout.on('data', d => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (line.startsWith('[')) forwardWindows(line);
      else if (line.startsWith('{')) onForeground(line);
    }
  });
  watcher.on('error', () => {});
  watcher.on('exit', () => { watcher = null; if (!quitting) setTimeout(startWatcher, 8000); });
}
function toDip(l, t, r, b) { let rect = { x: l, y: t, width: r - l, height: b - t }; try { rect = screen.screenToDipRect(null, rect); } catch (e) {} return rect; }
function forwardWindows(line) {
  let list; try { list = JSON.parse(line); } catch (e) { return; }
  const wa = workArea(), out = [];
  for (const w of list) { const r = toDip(w[1], w[2], w[3], w[4]); out.push({ id: 'hw' + w[0], l: r.x - wa.x, t: r.y - wa.y, r: r.x + r.width - wa.x, b: r.y + r.height - wa.y }); }
  send('kito:windows', out);
}
function onForeground(line) {
  let f; try { f = JSON.parse(line).fg; } catch (e) { return; }
  if (!f) return;
  if (f.pid === process.pid) return;
  const rect = toDip(f.l, f.t, f.r, f.b);
  let full = false;
  try { const db = screen.getDisplayMatching(rect).bounds; full = !f.desk && Math.abs(rect.x - db.x) < 3 && Math.abs(rect.y - db.y) < 3 && rect.width >= db.width - 4 && rect.height >= db.height - 4; } catch (e) {}
  focus = { exe: f.desk ? '' : (f.exe || ''), title: f.desk ? '' : (f.title || ''), app: f.desk ? 'Desktop' : memory.friendly(f.exe), fullscreen: full, quiet: focus.quiet };
  pushFocus();
}
// study your routine and remember what you worked on (only while you're at the laptop).
// Routine needs Memory on; apps and sites also need "Which app you're using".
const habitRun = habits.createHabits(ev => send('dude:event', ev));
setInterval(() => {
  const s = settings.get();
  let idle = 0; try { idle = powerMonitor.getSystemIdleTime(); } catch (e) {}
  const app = focus.exe ? (focus.app || memory.friendly(focus.exe)) : '';
  try { habitRun.tick({ idle, app: s.perms.apps ? app : '', title: s.perms.apps ? focus.title : '', appsOn: s.perms.apps, memoryOn: s.perms.memory }); } catch (e) {}
  if (s.perms.apps && s.perms.memory && focus.exe && idle <= 120) {
    memory.trackApp(focus.exe, focus.title, 5);
    if (/^fl(64)?$/i.test(focus.exe)) { const proj = studio.titleProject(focus.title); if (proj) memory.trackProject(proj, 5); }
  }
}, 5000);

/* ================= tray ================= */
function buildMenu() {
  return Menu.buildFromTemplate([
    { label: 'Turn Dude on / off', click: () => cmd('power') },
    { label: 'Show controls', click: () => cmd('controls') },
    { label: 'Talk to Dude (voice)', click: () => cmd('listen') },
    { label: 'Open Studio', click: () => cmd('studio') },
    { label: 'Call Dude over', click: () => cmd('call') },
    { label: 'Computer check-up', click: () => cmd('checkup') },
    { label: 'Voice on / off', click: () => cmd('voice') },
    { label: 'Do not disturb', type: 'checkbox', checked: settings.get().dnd, click: i => { settings.apply({ dnd: i.checked }); pushFocus(true); send('dude:settingsChanged', settings.publicView()); } },
    { type: 'separator' },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: 'Quit Dude', click: () => { quitting = true; app.quit(); } }
  ]);
}
function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip(`Dude ${ME.version}`);
  tray.setContextMenu(buildMenu());
  tray.on('click', () => cmd('power'));   // the tray icon is his on/off button
  tray.on('right-click', () => tray.setContextMenu(buildMenu()));
}

ipcMain.on('kito:through', (e, v) => { if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!v, { forward: true }); });
ipcMain.on('kito:quit', () => { quitting = true; app.quit(); });

/* ================= build check: his voice, his ears and his page, on a real Windows machine ================= */
function readWav16(p) {
  const b = fs.readFileSync(p); let o = 12, sr = 16000, ch = 1, data = null;
  while (o + 8 <= b.length) { const id = b.toString('ascii', o, o + 4), n = b.readUInt32LE(o + 4); if (id === 'fmt ') { ch = b.readUInt16LE(o + 10); sr = b.readUInt32LE(o + 12); } if (id === 'data') { data = b.subarray(o + 8, o + 8 + n); break; } o += 8 + n + (n & 1); }
  if (!data || sr !== 16000) throw new Error('need a 16 kHz 16-bit wav');
  const out = new Float32Array(Math.floor(data.length / 2 / ch)); for (let i = 0; i < out.length; i++) out[i] = data.readInt16LE(i * 2 * ch) / 32768;
  return out;
}
async function selfTest() {
  const out = { ok: false }, step = (k, v) => { out[k] = v; log('selftest', `${k}: ${JSON.stringify(v).slice(0, 400)}`); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const finish = code => { try { fs.writeFileSync(SELFTEST, JSON.stringify(out, null, 2)); } catch (e) {} app.exit(code); };
  setTimeout(() => { step('timeout', true); finish(3); }, 20 * 60e3);
  try {
    step('engine', { ok: engine.ok(), why: engine.why() });
    let t0 = Date.now();
    const v = await dudeVoice.prepare(() => {});
    step('voice', { state: v.state, error: v.error, rtf: v.rtf, secs: Math.round((Date.now() - t0) / 1000) });
    if (v.state === 'ready') { const a = await dudeVoice.say('Yo Quba! Studio session with Eric at three. Matcha first, then we cook.'); step('voiceSay', { secs: a.samples ? +(a.samples.length / a.sampleRate).toFixed(2) : 0, error: a.error || '' }); }
    t0 = Date.now();
    const st = await ears.prepare(() => {});
    step('ears', { state: st.state, error: st.error, rtf: st.rtf, secs: Math.round((Date.now() - t0) / 1000) });
    const heard = [];
    if (st.state === 'ready' && process.env.DUDE_SELFTEST_WAV) {
      ears.listen(true, h => heard.push(h.text));
      const w = readWav16(process.env.DUDE_SELFTEST_WAV), all = new Float32Array(8000 + w.length + 24000); all.set(w, 8000);
      for (let i = 0; i < all.length; i += 2000) { ears.feed(all.slice(i, i + 2000)); await sleep(15); }
      for (let i = 0; i < 100 && !heard.length; i++) await sleep(100);
      ears.listen(false);
      step('earsHeard', heard);
    }
    // his page loads and runs without errors
    settings.load();
    const errors = [];
    createWindow();
    win.webContents.on('console-message', (...a) => { const ev = a[0] || {}, lv = ev.level ?? a[1], msg = ev.message ?? a[2]; if (lv === 'error' || lv === 3) errors.push(String(msg).slice(0, 300)); });
    await new Promise(r => win.webContents.once('did-finish-load', r));
    await sleep(9000);
    const page = await win.webContents.executeJavaScript('({ dude: !!window.__kito, on: !!document.querySelector("#powerBtn") })').catch(e => ({ error: String(e) }));
    step('page', Object.assign(page, { errors }));
    out.ok = engine.ok() && !!(out.voiceSay && out.voiceSay.secs > 1) && st.state === 'ready' && (!process.env.DUDE_SELFTEST_WAV || heard.some(t => /\bdude\b/i.test(t))) && page.dude && !errors.some(e => /Uncaught/.test(e));
  } catch (e) { step('crash', String((e && e.stack) || e)); }
  out.log = logTail(60);
  finish(out.ok ? 0 : 1);
}

app.whenReady().then(async () => {
  if (SELFTEST) { selfTest(); return; }
  if (!haveLock && !(await takeOver())) { app.quit(); return; }
  log('app', `Dude ${ME.version} started`);
  settings.load();
  createWindow();
  createTray();
  startWatcher();
  afterSettings();
  globalShortcut.register('CommandOrControl+Shift+D', () => cmd('controls'));
  globalShortcut.register('CommandOrControl+Shift+Space', () => cmd('listen'));
  globalShortcut.register('CommandOrControl+Shift+Q', () => { quitting = true; app.quit(); });
  screen.on('display-metrics-changed', fitToScreen);
  screen.on('display-added', fitToScreen);
  screen.on('display-removed', fitToScreen);
});
app.on('second-instance', (e, argv, cwd, other) => {
  // a newer Dude from another folder is starting: step aside so he can take over
  // (DUDE_TEST_OLD: the build check pretends to be an old Dude that doesn't step aside)
  if (!process.env.DUDE_TEST_OLD && other && other.exe && !sameExe(other.exe, process.execPath) && verNum(other.version) >= verNum(ME.version)) { log('app', `Dude ${other.version} from ${other.exe} is taking over`); quitting = true; app.quit(); return; }
  cmd('wake');   // opening the same Dude again switches him on
});
app.on('before-quit', () => { quitting = true; hearStop(); laptop.stop(); laptop.flush(); memory.save(); if (watcher) { try { watcher.kill(); } catch (e) {} } });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (!SELFTEST) app.quit(); });
