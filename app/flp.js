// Reads an FL Studio project (.flp) WITHOUT changing it: tempo, time spent, created date, title, genre,
// the samples, plugins, patterns and mixer tracks inside. Event codes follow the open-source PyFLP project.
const fs = require('fs');

const TEXT = 192;
const EV = {
  tempo: 156, tempoCoarse: 66, title: 194, comments: 195, flVersion: 199, genre: 206, artists: 207,
  chanName: 192, samplePath: 196, pluginInternal: 201, pluginName: 203, patternName: 193, insertName: 204, timestamp: 237
};
const DELPHI_EPOCH = Date.UTC(1899, 11, 30);

function readFlp(path) {
  const b = fs.readFileSync(path);
  if (b.length < 22 || b.toString('ascii', 0, 4) !== 'FLhd') throw new Error('not an FL Studio project');
  const hdrLen = b.readUInt32LE(4);
  let o = 8 + hdrLen;
  if (b.toString('ascii', o, o + 4) !== 'FLdt') throw new Error('broken project file');
  const end = Math.min(b.length, o + 8 + b.readUInt32LE(o + 4));
  o += 8;
  const out = { tempo: 0, title: '', genre: '', artists: '', comments: '', version: '', created: 0, timeSpentMin: 0, samples: [], plugins: [], patterns: [], inserts: [], channels: 0 };
  let utf16 = true;
  const text = buf => {
    let s = utf16 && buf.length % 2 === 0 ? buf.toString('utf16le') : buf.toString('latin1');
    return s.replace(/\0+$/, '').replace(/[\0-\x1f]/g, ' ').trim();
  };
  const add = (list, v, max = 400) => { if (v && !list.includes(v) && list.length < max) list.push(v); };
  while (o < end) {
    const id = b[o++];
    let size;
    if (id < 64) size = 1; else if (id < 128) size = 2; else if (id < 192) size = 4;
    else { size = 0; let shift = 0, byte; do { byte = b[o++]; size |= (byte & 0x7f) << shift; shift += 7; } while (byte & 0x80 && shift < 35); }
    if (o + size > end) break;
    const d = b.subarray(o, o + size);
    o += size;
    switch (id) {
      case EV.tempo: out.tempo = d.readUInt32LE(0) / 1000; break;
      case EV.tempoCoarse: if (!out.tempo) out.tempo = d.readUInt16LE(0); break;
      case 64: out.channels++; break;                     // a new channel starts
      case EV.flVersion: out.version = d.toString('ascii').replace(/\0+$/, ''); { const m = out.version.match(/^(\d+)\.(\d+)/); utf16 = m ? (+m[1] > 11 || (+m[1] === 11 && +m[2] >= 5)) : true; } break;
      case EV.title: out.title = text(d); break;
      case EV.genre: out.genre = text(d); break;
      case EV.artists: out.artists = text(d); break;
      case EV.comments: out.comments = text(d).slice(0, 300); break;
      case EV.samplePath: { const p = text(d); if (p) add(out.samples, p.split(/[\\/]/).pop()); break; }
      case EV.pluginInternal: case EV.pluginName: { const n = text(d); if (n && !/^(fruity wrapper|sampler|audio clip)$/i.test(n)) add(out.plugins, n, 100); break; }
      case EV.patternName: add(out.patterns, text(d), 200); break;
      case EV.insertName: add(out.inserts, text(d), 130); break;
      case EV.timestamp: if (size >= 16) { const c = d.readDoubleLE(0), t = d.readDoubleLE(8); if (c > 1000) out.created = DELPHI_EPOCH + c * 864e5; if (t >= 0 && t < 3650) out.timeSpentMin = Math.round(t * 1440); } break;
    }
  }
  if (out.tempo > 999 || out.tempo < 10) out.tempo = 0;
  out.tempo = Math.round(out.tempo * 10) / 10;
  return out;
}

module.exports = { readFlp };
