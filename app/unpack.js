// Dude's own unzip tool for .tar.bz2 files (his voice and his ears come packed that way).
// Windows 11 can unpack them by itself, but the tar.exe that comes with Windows 10 can't (it has no bzip2),
// so Dude does it himself: bzip2 with seek-bzip (MIT, plain JavaScript, in vendor/) and a small tar reader.
// It runs in a separate thread, so Dude keeps moving while it works. Every file is written as "name.part" first
// and only gets its real name when it's complete, so a half-unpacked file can never look finished.
const fs = require('fs');
const path = require('path');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');

/* ---------- the part that runs in the main thread ---------- */
// unpack file (.tar.bz2) into folder. members: only these paths (and what's inside them), [] = everything.
// onProgress(0..1). Rejects with err.damaged = true when the download is broken (bad checksum, cut short).
function untarBz2(file, into, members = [], onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    let done = false;
    const w = new Worker(__filename, { workerData: { dudeUnpack: true, file, into, members } });
    w.on('message', m => {
      if (m.progress != null) { try { onProgress(m.progress); } catch (e) {} }
      else if (m.ok) { done = true; resolve(m); }
      else if (m.error) { done = true; const e = new Error(m.error); e.damaged = !!m.damaged; reject(e); }
    });
    w.on('error', e => { if (!done) { done = true; reject(e); } });
    w.on('exit', c => { if (!done) { done = true; reject(new Error(`unpacking stopped (${c})`)); } });
  });
}

/* ---------- a small tar reader: feed it bytes, it writes the files ---------- */
function tarWriter(into, members) {
  const root = path.resolve(into);
  const want = name => !members.length || members.some(m => name === m || name.startsWith(m.replace(/\/$/, '') + '/'));
  let hdr = Buffer.alloc(512), hdrN = 0;        // collecting a 512-byte header
  let left = 0, pad = 0;                         // bytes of the current entry still to come, then padding
  let fd = null, partPath = '', finalPath = '';  // the file being written
  let meta = null, metaBuf = null, metaN = 0;    // a GNU long name ('L') or pax header ('x') being collected
  let longName = '', paxPath = '', zeros = 0, ended = false, files = 0, bytes = 0;

  const octal = (b, s, n) => {
    if (b[s] & 0x80) { let v = 0; for (let i = s + 1; i < s + n; i++) v = v * 256 + b[i]; return v; }   // base-256 (huge files)
    const t = b.toString('latin1', s, s + n).replace(/\0.*$/s, '').trim(); return t ? parseInt(t, 8) : 0;
  };
  const str = (b, s, n) => { const t = b.subarray(s, s + n); const z = t.indexOf(0); return t.toString('utf8', 0, z < 0 ? n : z); };
  const safe = name => {
    name = name.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!name || name.startsWith('/') || /^[a-z]:/i.test(name) || name.split('/').includes('..')) return null;
    const p = path.resolve(root, name);
    return p === root || p.startsWith(root + path.sep) ? p : null;
  };
  function header(h) {
    if (h.every(x => x === 0)) { if (++zeros >= 2) ended = true; return; }
    zeros = 0;
    let sum = 0; for (let i = 0; i < 512; i++) sum += (i >= 148 && i < 156) ? 32 : h[i];
    if (sum !== octal(h, 148, 8)) throw Object.assign(new Error('the download is damaged (bad tar header)'), { damaged: true });
    const type = String.fromCharCode(h[156] || 48), size = octal(h, 124, 12);
    let name = str(h, 0, 100);
    if (h.toString('latin1', 257, 262) === 'ustar') { const pre = str(h, 345, 155); if (pre) name = pre + '/' + name; }
    if (paxPath) { name = paxPath; paxPath = ''; } else if (longName) { name = longName; longName = ''; }
    left = size; pad = (512 - (size % 512)) % 512;
    if (type === 'L' || type === 'x') { meta = type; metaBuf = Buffer.alloc(size); metaN = 0; return; }
    meta = null;
    if (type === '5') { const p = want(name) && safe(name); if (p) fs.mkdirSync(p, { recursive: true }); return; }
    if ((type === '0' || type === '7') && want(name)) {
      const p = safe(name);
      if (p) { fs.mkdirSync(path.dirname(p), { recursive: true }); finalPath = p; partPath = p + '.part'; fd = fs.openSync(partPath, 'w'); }
    }
    if (left === 0) finish();
  }
  function finish() {
    if (fd != null) { fs.closeSync(fd); fd = null; try { fs.unlinkSync(finalPath); } catch (e) {} fs.renameSync(partPath, finalPath); files++; }
    if (meta) {
      const t = metaBuf.toString('utf8');
      if (meta === 'L') longName = t.replace(/\0.*$/s, '');
      else for (const rec of t.split('\n')) { const m = rec.match(/^\d+ path=(.*)$/s); if (m) paxPath = m[1]; }
      meta = null; metaBuf = null;
    }
  }
  function push(chunk) {
    let i = 0;
    while (i < chunk.length && !ended) {
      if (left > 0) {
        const n = Math.min(left, chunk.length - i);
        if (fd != null) { fs.writeSync(fd, chunk, i, n); bytes += n; }
        else if (meta) { chunk.copy(metaBuf, metaN, i, i + n); metaN += n; }
        i += n; left -= n;
        if (left === 0) finish();
      } else if (pad > 0) {
        const n = Math.min(pad, chunk.length - i); i += n; pad -= n;
      } else {
        const n = Math.min(512 - hdrN, chunk.length - i);
        chunk.copy(hdr, hdrN, i, i + n); hdrN += n; i += n;
        if (hdrN === 512) { hdrN = 0; header(hdr); }
      }
    }
  }
  function abort() { if (fd != null) { try { fs.closeSync(fd); fs.unlinkSync(partPath); } catch (e) {} fd = null; } }
  function end() {
    if (left > 0 || hdrN > 0) { if (fd != null) { try { fs.closeSync(fd); fs.unlinkSync(partPath); } catch (e) {} fd = null; } throw Object.assign(new Error('the download is incomplete (cut short)'), { damaged: true }); }
    return { files, bytes };
  }
  return { push, end, abort };
}

/* ---------- the part that runs in its own thread ---------- */
function work({ file, into, members }) {
  const Bunzip = require('./vendor/seek-bzip/lib/index.js');
  const input = fs.readFileSync(file);
  const tar = tarWriter(into, members);
  const CH = 1 << 20;
  let out = Buffer.allocUnsafe(CH), n = 0, lastP = -1;
  const inStream = {
    pos: 0,
    readByte() { return this.pos < input.length ? input[this.pos++] : -1; },
    read(buf, off, len) { const n = Math.min(len, input.length - this.pos); if (n <= 0) return -1; input.copy(buf, off, this.pos, this.pos + n); this.pos += n; return n; },
    eof() { return this.pos >= input.length; },
    seek(p) { this.pos = p; }
  };
  const outStream = {
    writeByte(b) { out[n++] = b; if (n === CH) this.flush(); },
    write(buf, off, len) { for (let i = 0; i < len; i++) this.writeByte(buf[off + i]); return len; },
    flush() {
      if (!n) return;
      tar.push(out.subarray(0, n)); out = Buffer.allocUnsafe(CH); n = 0;
      const p = Math.floor(inStream.pos / input.length * 100);
      if (p !== lastP) { lastP = p; parentPort.postMessage({ progress: p / 100 }); }
    }
  };
  try {
    Bunzip.decode(inStream, outStream, true);
    outStream.flush();
    const r = tar.end();
    parentPort.postMessage({ ok: true, files: r.files, bytes: r.bytes });
  } catch (e) {
    tar.abort();
    const msg = String((e && e.message) || e);
    parentPort.postMessage({ error: msg, damaged: !!(e && e.damaged) || /CRC|bzip|magic|data error|Unexpected|not a/i.test(msg) || e.name === 'Bzip2Error' });
  }
}
if (!isMainThread && workerData && workerData.dudeUnpack) work(workerData);

module.exports = { untarBz2, tarWriter };
