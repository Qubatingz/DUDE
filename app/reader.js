// Reads the text out of things you give Dude to learn: text files, Word (.docx), PowerPoint (.pptx), PDF and web pages.
// Pure Node, nothing leaves the laptop (except fetching a web page you asked him to learn).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pathToFileURL } = require('url');

/* ---------- zip (docx / pptx are zip files) ---------- */
function zipEntries(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Not a zip file');
  const n = buf.readUInt16LE(e + 10); let p = buf.readUInt32LE(e + 16);
  const out = [];
  for (let i = 0; i < n && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    out.push({ name: buf.toString('utf8', p + 46, p + 46 + nlen), method, csize, off });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}
function zipRead(buf, ent) {
  const p = ent.off, nlen = buf.readUInt16LE(p + 26), xlen = buf.readUInt16LE(p + 28), start = p + 30 + nlen + xlen;
  const raw = buf.subarray(start, start + ent.csize);
  return ent.method === 8 ? zlib.inflateRawSync(raw) : raw;
}
const xmlDecode = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (m, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, '&');
function docxText(buf) {
  const ents = zipEntries(buf), main = ents.find(x => x.name === 'word/document.xml');
  if (!main) throw new Error('No text in this Word file');
  const xml = zipRead(buf, main).toString('utf8');
  return xmlDecode(xml.replace(/<w:tab\/>/g, '\t').replace(/<w:br[^>]*\/>/g, '\n').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')).replace(/\n{3,}/g, '\n\n').trim();
}
function pptxText(buf) {
  const ents = zipEntries(buf).filter(x => /^ppt\/slides\/slide\d+\.xml$/.test(x.name)).sort((a, b) => +a.name.match(/\d+/)[0] - +b.name.match(/\d+/)[0]);
  return ents.map(en => xmlDecode(zipRead(buf, en).toString('utf8').replace(/<\/a:p>/g, '\n').replace(/<[^>]+>/g, '')).trim()).filter(Boolean).join('\n\n');
}

/* ---------- PDF ---------- */
// The full PDF reader (pdf.js) ships with the Windows app; a small built-in reader handles simple PDFs if it's missing.
async function pdfjsText(buf) {
  const base = path.join(__dirname, 'node_modules', 'pdfjs-dist', 'legacy', 'build');
  const lib = path.join(base, 'pdf.mjs');
  if (!fs.existsSync(lib)) return null;
  const pdfjs = await import(pathToFileURL(lib).href);
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(path.join(base, 'pdf.worker.mjs')).href;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true, useSystemFonts: false, isEvalSupported: false, verbosity: 0 }).promise;
  const out = [];
  for (let i = 1; i <= Math.min(doc.numPages, 80); i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map(x => (x.str || '') + (x.hasEOL ? '\n' : ' ')).join(''));
  }
  await doc.destroy();
  return out.join('\n\n');
}
function pdfSimpleText(buf) {
  const s = buf.toString('latin1'), out = [];
  const re = /<<([\s\S]*?)>>\s*stream\r?\n/g; let m;
  while ((m = re.exec(s))) {
    const start = m.index + m[0].length, end = s.indexOf('endstream', start);
    if (end < 0) break;
    let data = buf.subarray(start, end);
    if (/\/FlateDecode/.test(m[1])) { try { data = zlib.inflateSync(data); } catch (e) { try { data = zlib.inflateSync(data.subarray(0, data.length - 1)); } catch (e2) { continue; } } }
    else if (/\/Filter/.test(m[1])) continue;
    const c = data.toString('latin1');
    if (!/\b(Tj|TJ)\b/.test(c)) continue;
    let line = '';
    const tok = /\((?:\\.|[^\\)])*\)|\[(?:[^\]]*)\]\s*TJ|T\*|Td|TD|ET|'|"/g; let t;
    while ((t = tok.exec(c))) {
      const v = t[0];
      if (v === 'ET' || v === 'T*' || v === 'Td' || v === 'TD' || v === "'" || v === '"') { if (line.trim()) out.push(line.trim()); line = ''; continue; }
      const strs = v.startsWith('[') ? v.match(/\((?:\\.|[^\\)])*\)/g) || [] : [v];
      for (const x of strs) line += x.slice(1, -1).replace(/\\([nrtbf()\\]|\d{1,3})/g, (q, e) => ({ n: '\n', r: '', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' })[e] ?? String.fromCharCode(parseInt(e, 8)));
      if (v.startsWith('[')) line += ' ';
    }
    if (line.trim()) out.push(line.trim());
  }
  return out.join('\n');
}
async function pdfText(buf) {
  try { const t = await pdfjsText(buf); if (t && t.trim().length > 20) return t; } catch (e) {}
  return pdfSimpleText(buf);
}

/* ---------- web pages ---------- */
function htmlText(html) {
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
  let body = html.replace(/<(script|style|noscript|svg|nav|footer|header|form|aside)[\s\S]*?<\/\1>/gi, ' ');
  const main = body.match(/<(article|main)[\s\S]*?<\/\1>/i); if (main && main[0].length > 600) body = main[0];
  const text = xmlDecode(body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h[1-6]|tr|section)>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '))
    .split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(l => l.length > 30 || /[.!?:]$/.test(l)).join('\n');
  return { title: xmlDecode(title.replace(/\s+/g, ' ').trim()), text };
}

/* ---------- any file ---------- */
const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'srt', 'lrc', 'rtf', 'html', 'htm', 'xml', 'ini', 'yaml', 'yml']);
async function readFile(p) {
  const ext = path.extname(p).slice(1).toLowerCase();
  const st = fs.statSync(p);
  if (st.size > 60e6) throw new Error('That file is too big for me to read (over 60 MB).');
  const buf = fs.readFileSync(p);
  if (ext === 'docx') return docxText(buf);
  if (ext === 'pptx') return pptxText(buf);
  if (ext === 'pdf') return pdfText(buf);
  if (ext === 'html' || ext === 'htm') return htmlText(buf.toString('utf8')).text;
  if (ext === 'rtf') return buf.toString('latin1').replace(/\\par[d]?/g, '\n').replace(/\{\\[^{}]*\}|\\[a-z]+-?\d* ?|[{}]/gi, '').trim();
  if (TEXT_EXT.has(ext)) return buf.toString('utf8');
  throw new Error(`I can't read .${ext} files yet. Try a PDF, Word, PowerPoint or text file.`);
}

module.exports = { readFile, docxText, pptxText, pdfText, pdfjsText, pdfSimpleText, htmlText, zipEntries };
