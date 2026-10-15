// Dude's problem log: a small text file where he writes down what went wrong (and what went right) with his
// voice, his ears and his downloads, so a problem can be found. It stays on this laptop. Only notes, never what you say.
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const MAX = 200e3;
let file = '';
function where() {
  if (!file) { try { file = path.join(app.getPath('userData'), 'dude-log.txt'); } catch (e) { file = ''; } }
  return file;
}
function log(area, msg) {
  const f = where(); if (!f) return;
  const line = `${new Date().toISOString().replace('T', ' ').slice(0, 19)} [${area}] ${String(msg).replace(/\s+/g, ' ').slice(0, 600)}\n`;
  if (process.env.DUDE_DEBUG) process.stdout.write(line);
  try {
    // keep the file small: when it gets big, keep only the newest half
    try { if (fs.statSync(f).size > MAX) { const t = fs.readFileSync(f, 'utf8'); fs.writeFileSync(f, t.slice(-MAX / 2).replace(/^[^\n]*\n/, '')); } } catch (e) {}
    fs.appendFileSync(f, line);
  } catch (e) {}
}
function tail(n = 40) { try { return fs.readFileSync(where(), 'utf8').trim().split('\n').slice(-n).join('\n'); } catch (e) { return ''; } }

module.exports = { log, tail, where };
