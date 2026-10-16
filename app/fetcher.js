// Downloads Dude's big one-time files (his voice, his ears) from GitHub, safely on slow or shaky internet:
// - one download at a time, so each one is ready sooner
// - if the internet drops or stalls, it waits and continues where it stopped (it doesn't start over)
// - every problem is written to the problem log, and explained in plain words
const { net } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { spawn } = require('child_process');
const { log } = require('./log');
const { untarBz2 } = require('./unpack');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const STALL_MS = 40000;   // no new bytes for this long: the connection is stuck, reconnect
const TRIES = 8;

function plain(e) {
  const m = String((e && (e.code || '') + ' ' + (e.message || e)) || '');
  if (/ENOSPC|disk full|not enough space/i.test(m)) return 'Your laptop is out of space. Free up about 300 MB and try again.';
  if (/INTERNET_DISCONNECTED|NETWORK_CHANGED|ADDRESS_UNREACHABLE|ENETUNREACH/i.test(m)) return "There's no internet right now.";
  if (/NAME_NOT_RESOLVED|ENOTFOUND|EAI_AGAIN/i.test(m)) return "I can't reach GitHub (where my files live). Is the internet on?";
  if (/stall|abort|TIMED_OUT|ETIMEDOUT|CONNECTION_(RESET|CLOSED|ABORTED)|ECONNRESET|cut off/i.test(m)) return 'The internet is too slow or keeps dropping.';
  if (/PROXY|TUNNEL/i.test(m)) return 'A proxy or firewall is blocking the download.';
  if (/CERT|SSL/i.test(m)) return "The laptop's clock or a firewall is blocking the download (security check failed).";
  if (/server said 4/i.test(m)) return 'The download link is broken. Get the newest Dude.';
  if (/server said 5/i.test(m)) return 'GitHub is having problems. I will try again later.';
  return 'The download failed.';
}

async function fetchTo(url, tmp, onBytes) {
  let have = 0; try { have = fs.statSync(tmp).size; } catch (e) {}
  const ctl = new AbortController();
  let timer = setTimeout(() => ctl.abort(new Error('stalled (no answer)')), STALL_MS);
  const kick = () => { clearTimeout(timer); timer = setTimeout(() => ctl.abort(new Error('stalled')), STALL_MS); };
  try {
    const r = await net.fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctl.signal, cache: 'no-store' });
    if (r.status === 416 && have) return have;   // we already have all of it
    if (!r.ok) { const e = new Error(`server said ${r.status}`); e.fatal = r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429; throw e; }
    if (have && r.status !== 206) have = 0;      // the server can't continue a download: start over
    const len = +r.headers.get('content-length') || 0, total = len ? have + len : 0;
    const out = fs.createWriteStream(tmp, { flags: have ? 'a' : 'w' });
    let got = have, failed = null;
    out.on('error', e => { failed = e; });
    const reader = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (failed) throw failed;
        kick();
        got += value.length;
        if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res));
        onBytes(got, total);
      }
    } finally { await new Promise(res => out.end(res)); }
    if (failed) throw failed;
    if (total && got < total) throw new Error('cut off');
    return got;
  } finally { clearTimeout(timer); }
}

let chain = Promise.resolve();
// download url to dest. onBytes(got, total) reports progress. Rejects with a plain-words message.
function download(url, dest, onBytes = () => {}) {
  const job = chain.then(async () => {
    const tmp = dest + '.part', name = path.basename(dest);
    let last = null;
    log('download', `start ${name}`);
    for (let i = 1; i <= TRIES; i++) {
      const t0 = Date.now();
      try {
        const n = await fetchTo(url, tmp, onBytes);
        await fsp.rename(tmp, dest);
        log('download', `done ${name}: ${(n / 1e6).toFixed(1)} MB (try ${i}, ${Math.round((Date.now() - t0) / 1000)} s)`);
        return;
      } catch (e) {
        last = e;
        log('download', `${name} try ${i}/${TRIES} failed: ${String((e && e.message) || e).slice(0, 200)}`);
        if (e.fatal || /ENOSPC/.test(String(e.code || e.message))) break;
        await sleep(Math.min(45000, 2500 * i * i));
      }
    }
    const err = new Error(plain(last)); err.cause = last; err.net = !/ENOSPC/.test(String((last && (last.code || last.message)) || '')); throw err;
  });
  chain = job.catch(() => {});
  return job;
}

// unpack a .tar.bz2. members: only these files (optional). onProgress(0..1) (optional).
// Windows 11's tar.exe does it fast. Windows 10's tar.exe can't open .bz2 ("unable to run bzip2"), so then Dude
// unpacks it himself (unpack.js). DUDE_UNPACK=js always uses Dude's own (the Windows build check tests it that way).
let tarExeNoBz2 = false;
function untar(file, into, members = [], onProgress = () => {}) {
  const name = path.basename(file), own = () => {
    const t0 = Date.now();
    log('download', `unpacking ${name} myself`);
    return untarBz2(file, into, members, onProgress).then(r => { log('download', `unpacked ${name} myself: ${r.files} files in ${Math.round((Date.now() - t0) / 1000)} s`); return r; },
      e => { log('download', `unpacking ${name} myself failed: ${e.message}`); const er = new Error(e.damaged ? 'The download was damaged. I will download it again.' : "I couldn't unpack the download: " + e.message); er.damaged = !!e.damaged; throw er; });
  };
  if (!/\.bz2$/i.test(file)) return tarExe(file, into, members);
  if (tarExeNoBz2 || process.env.DUDE_UNPACK === 'js') return own();
  return tarExe(file, into, members).catch(e => {
    if (/bzip2|initialize filter|could not start|missing/i.test(e.detail || e.message)) tarExeNoBz2 = true;   // this Windows' tar can't do it: don't even try next time
    return own();
  });
}
function tarExe(file, into, members = []) {
  return new Promise((resolve, reject) => {
    const bin = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const p = spawn(bin, ['-xjf', file, '-C', into, ...members], { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { log('download', `unpack ${path.basename(file)} could not start: ${e.message}`); const er = new Error("I couldn't unpack the download (tar.exe is missing on this Windows)."); er.detail = 'could not start'; reject(er); });
    p.on('exit', c => {
      if (c === 0) return resolve();
      log('download', `unpack ${path.basename(file)} with tar.exe failed (${c}): ${err.slice(0, 300)}`);
      const e = new Error('The download was damaged. I will download it again.'); e.damaged = true; e.detail = err; reject(e);
    });
  });
}

module.exports = { download, untar, plain };
