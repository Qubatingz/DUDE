// Dude — an AI desktop companion for Windows.
// One transparent, click-through window covers the screen; only Dude himself (and his panels/cards) catch the mouse.
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, globalShortcut, shell, dialog, net, powerMonitor } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execFile } = require('child_process');
const settings = require('./settings');
const files = require('./files');
const memory = require('./memory');
const { createBrain } = require('./brain');

app.setAppUserModelId('com.dude.desktoppet');
if (!app.requestSingleInstanceLock()) { app.quit(); }

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
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false }
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', () => win.showInactive());
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}
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
const brain = createBrain({ settings, files, memory, status, ask, open: openPath, net, emit: (type, payload) => send('dude:' + type, payload) });
ipcMain.handle('dude:chat', (e, text, ctx) => brain.chat(String(text || '').slice(0, 600), ctx || {}));
ipcMain.handle('dude:open', async (e, a) => { const f = brain.results.get(a && a.id); if (!f) return 'gone'; return openPath(f.path, a.how === 'show' ? 'show' : 'open'); });

/* ================= settings & permissions ================= */
ipcMain.handle('dude:settings', () => settings.publicView());
ipcMain.handle('dude:settings:set', (e, patch) => { settings.apply(patch || {}); afterSettings(); return settings.publicView(); });
ipcMain.handle('dude:key', async (e, key) => {
  key = String(key || '').trim();
  if (!key) { settings.setKey(''); brain.reset(); return { ok: true, view: settings.publicView() }; }
  const r = await brain.testKey(key);
  if (r.ok || (r.status === 400 && /credit/i.test(r.error))) { settings.setKey(key); brain.reset(); }
  return Object.assign(r, { view: settings.publicView() });
});
ipcMain.handle('dude:folder:add', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Pick a folder Dude may search', properties: ['openDirectory'] });
  if (!r.canceled && r.filePaths[0]) { settings.addCustomFolder(r.filePaths[0]); afterSettings(); }
  return settings.publicView();
});
ipcMain.handle('dude:memory:wipe', () => { memory.wipe(); brain.reset(); return true; });
function afterSettings() {
  const roots = settings.grantedFolders();
  files.watch(roots, onNewFile);
  for (const r of roots) files.getIndex(r.path).catch(() => {});
  pushFocus(true);
}

/* new files in allowed folders: warn about programs in Downloads, celebrate new exports */
let lastCheer = 0;
function onNewFile(f) {
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
// remember what you worked on (only with app access + memory, and only while you're at the laptop)
setInterval(() => {
  const s = settings.get();
  if (!s.perms.apps || !s.perms.memory || !focus.exe) return;
  try { if (powerMonitor.getSystemIdleTime() > 120) return; } catch (e) {}
  memory.trackApp(focus.exe, focus.title, 5);
}, 5000);

/* ================= tray ================= */
function buildMenu() {
  return Menu.buildFromTemplate([
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
  tray.setToolTip('Dude');
  tray.setContextMenu(buildMenu());
  tray.on('click', () => cmd('controls'));
  tray.on('right-click', () => tray.setContextMenu(buildMenu()));
}

ipcMain.on('kito:through', (e, v) => { if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(!!v, { forward: true }); });
ipcMain.on('kito:quit', () => { quitting = true; app.quit(); });

app.whenReady().then(() => {
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
app.on('second-instance', () => cmd('controls'));
app.on('before-quit', () => { quitting = true; memory.save(); if (watcher) { try { watcher.kill(); } catch (e) {} } });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
