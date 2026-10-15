// Lists which Windows DLLs each .dll / .node file in a folder needs, and copies the Microsoft Visual C++
// runtime DLLs they need (from this machine's System32) next to them, so Dude's voice engine also starts on
// laptops that never installed the "Visual C++ Redistributable".
// Usage: node ci/pe-imports.js <folder> [--copy-vc-runtime]
const fs = require('fs'), path = require('path');

function imports(file) {
  const b = fs.readFileSync(file);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('not a PE file');
  const nsec = b.readUInt16LE(pe + 6), optSize = b.readUInt16LE(pe + 20), opt = pe + 24;
  const plus = b.readUInt16LE(opt) === 0x20b, dd = opt + (plus ? 112 : 96);
  const secs = [];
  for (let i = 0, s = opt + optSize; i < nsec; i++, s += 40) secs.push({ va: b.readUInt32LE(s + 12), vsize: b.readUInt32LE(s + 8), raw: b.readUInt32LE(s + 20), rsize: b.readUInt32LE(s + 16) });
  const off = rva => { for (const s of secs) if (rva >= s.va && rva < s.va + Math.max(s.vsize, s.rsize)) return rva - s.va + s.raw; return -1; };
  const str = rva => { const o = off(rva); if (o < 0) return ''; let e = o; while (e < b.length && b[e]) e++; return b.toString('latin1', o, e); };
  const out = new Set();
  const imp = b.readUInt32LE(dd + 8);
  if (imp) for (let o = off(imp); o >= 0 && o + 20 <= b.length; o += 20) { const name = b.readUInt32LE(o + 12); if (!name && !b.readUInt32LE(o)) break; if (name) out.add(str(name)); }
  const dly = b.readUInt32LE(dd + 13 * 8);
  if (dly) for (let o = off(dly); o >= 0 && o + 32 <= b.length; o += 32) { const name = b.readUInt32LE(o + 4); if (!name) break; out.add(str(name) + ' (delay)'); }
  return [...out];
}

const dir = path.resolve(process.argv[2] || '.'), copy = process.argv.includes('--copy-vc-runtime');
const here = new Set(fs.readdirSync(dir).map(f => f.toLowerCase()));
const need = new Set();
for (const f of fs.readdirSync(dir).filter(f => /\.(dll|node)$/i.test(f))) {
  let list; try { list = imports(path.join(dir, f)); } catch (e) { console.log(`${f}: ${e.message}`); continue; }
  console.log(`${f} needs: ${list.join(', ')}`);
  for (const d of list) { const n = d.replace(/ \(delay\)$/, '').toLowerCase(); if (/^(msvcp140.*|vcruntime140.*|concrt140|vcomp140)\.dll$/.test(n)) need.add(n); }
}
console.log(need.size ? `Visual C++ runtime DLLs needed: ${[...need].join(', ')}` : 'No Visual C++ runtime DLLs needed (the engine carries its own).');
if (copy) {
  // vcruntime140_1.dll is needed by x64 code built with newer compilers, even when only vcruntime140.dll is listed
  if (need.has('vcruntime140.dll')) need.add('vcruntime140_1.dll');
  if ([...need].some(n => n.startsWith('msvcp140'))) need.add('vcruntime140.dll'), need.add('vcruntime140_1.dll');
  const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  for (const n of need) {
    if (here.has(n)) { console.log(`  ${n}: already there`); continue; }
    const src = path.join(sys, n);
    if (!fs.existsSync(src)) { console.log(`  ${n}: NOT FOUND on this machine`); process.exitCode = 1; continue; }
    fs.copyFileSync(src, path.join(dir, n)); console.log(`  copied ${n}`);
  }
}
