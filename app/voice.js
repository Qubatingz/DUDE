// "My voice": Dude talks in YOUR voice. Free, and it runs on this laptop.
// You record about 15 seconds inside Dude. The voice model (about 160 MB) downloads once, the first time
// you switch it on, and stays in Dude's folder in AppData. Your recording never leaves this laptop.
// Engine: sherpa-onnx (Apache-2.0) with the ZipVoice voice-copying model and the Vocos vocoder.
const { app, net } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const MODEL_NAME = 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia';
const MODEL_URL = process.env.DUDE_VOICE_MODEL_URL || `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL_NAME}.tar.bz2`;
const VOCODER_URL = process.env.DUDE_VOICE_VOCODER_URL || 'https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx';

const dir = () => path.join(app.getPath('userData'), 'voice');
const modelDir = () => path.join(dir(), MODEL_NAME);
const vocoderPath = () => path.join(dir(), 'vocos_24khz.onnx');
const refWav = () => path.join(dir(), 'me.wav');
const refJson = () => path.join(dir(), 'me.json');

let steps = 4;                 // fewer steps = faster but a bit rougher; tuned to how fast this laptop is
let state = 'idle';            // idle | downloading | loading | ready | error
let progress = 0, error = '', tts = null, sherpa = null, ref = null, busy = Promise.resolve(), preparing = null;

function hasPack() { return fs.existsSync(path.join(modelDir(), 'decoder.int8.onnx')) && fs.existsSync(vocoderPath()); }
function status() { return { state, progress, error, hasPack: hasPack(), hasRef: !!(ref || fs.existsSync(refJson())), refText: ref ? ref.text : readRefText(), engine: engineOk() }; }
function readRefText() { try { return JSON.parse(fs.readFileSync(refJson(), 'utf8')).text || ''; } catch (e) { return ''; } }
function engineOk() { try { sherpa = sherpa || require('sherpa-onnx-node'); return true; } catch (e) { return false; } }

/* ---------- download the model once ---------- */
async function download(url, dest, onBytes) {
  const r = await net.fetch(url);
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const total = +r.headers.get('content-length') || 0;
  const tmp = dest + '.part';
  const out = fs.createWriteStream(tmp);
  let got = 0;
  const reader = r.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(Buffer.from(value))) await new Promise(res => out.once('drain', res));
      onBytes(got, total);
    }
  } finally { await new Promise(res => out.end(res)); }
  if (total && got < total) throw new Error('Download was cut off. Check the internet and try again.');
  await fsp.rename(tmp, dest);
}
function untar(file, into) {
  return new Promise((resolve, reject) => {
    // Windows 10 and 11 come with tar.exe, which understands .tar.bz2
    const bin = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const p = spawn(bin, ['-xjf', file, '-C', into], { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => reject(new Error('Could not unpack the voice model: ' + e.message)));
    p.on('exit', c => c === 0 ? resolve() : reject(new Error('Could not unpack the voice model. ' + err.slice(0, 200))));
  });
}
async function ensurePack(emit) {
  if (hasPack()) return;
  await fsp.mkdir(dir(), { recursive: true });
  state = 'downloading'; progress = 0; emit();
  const tar = path.join(dir(), MODEL_NAME + '.tar.bz2');
  // the model is ~104 MB, the vocoder ~54 MB
  await download(MODEL_URL, tar, (g, t) => { const p = t ? g / t * .66 : .3; if (p - progress > .01) { progress = p; emit(); } });
  if (!fs.existsSync(vocoderPath())) await download(VOCODER_URL, vocoderPath(), (g, t) => { const p = .66 + (t ? g / t * .3 : .15); if (p - progress > .01) { progress = p; emit(); } });
  progress = .97; emit();
  await untar(tar, dir());
  await fsp.unlink(tar).catch(() => {});
  progress = 1;
}

/* ---------- load the engine ---------- */
async function prepare(emit = () => {}) {
  if (tts) { state = 'ready'; return status(); }
  if (preparing) return preparing;
  preparing = (async () => {
    try {
      if (!engineOk()) throw new Error('The voice engine is missing from this Dude download.');
      await ensurePack(emit);
      state = 'loading'; emit();
      const Z = modelDir();
      tts = await sherpa.OfflineTts.createAsync({
        model: { zipvoice: { tokens: path.join(Z, 'tokens.txt'), encoder: path.join(Z, 'encoder.int8.onnx'), decoder: path.join(Z, 'decoder.int8.onnx'), vocoder: vocoderPath(), dataDir: path.join(Z, 'espeak-ng-data'), lexicon: path.join(Z, 'lexicon.txt') } },
        numThreads: Math.max(2, Math.min(4, os.cpus().length - 1))
      });
      loadRef();
      state = 'ready'; error = '';
    } catch (e) { state = 'error'; error = String(e.message || e); tts = null; }
    preparing = null; emit();
    return status();
  })();
  return preparing;
}

/* ---------- your recording ---------- */
function wavBytes(samples, sr) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  return b;
}
function readWav(p) {
  const b = fs.readFileSync(p), sr = b.readUInt32LE(24);
  let o = 12; while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4);
  const n = b.readUInt32LE(o + 4) / 2, d = o + 8, out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = b.readInt16LE(d + i * 2) / 32768;
  return { samples: out, sr };
}
function loadRef() {
  try { const w = readWav(refWav()); ref = { samples: w.samples, sr: w.sr, text: readRefText() }; } catch (e) { ref = null; }
}
async function setRef(samples, sr, text) {
  samples = Float32Array.from(samples || []);
  if (samples.length < sr * 3) throw new Error('That was too short. Record at least 5 seconds.');
  await fsp.mkdir(dir(), { recursive: true });
  await fsp.writeFile(refWav(), wavBytes(samples, sr));
  await fsp.writeFile(refJson(), JSON.stringify({ text: String(text || '').slice(0, 600), at: Date.now() }));
  ref = { samples, sr, text: String(text || '') };
  return status();
}

/* ---------- speak ---------- */
function clean(t) { return String(t || '').replace(/[^\p{L}\p{N}\s.,!?'%:;()-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 320); }
function say(text, speed = 1) {
  const job = busy.then(async () => {
    if (!tts) await prepare();
    if (!tts) return { error: error || 'Voice engine not ready.' };
    if (!ref) loadRef();
    if (!ref) return { error: 'Record your voice first.' };
    const t = clean(text);
    if (!t) return { error: 'Nothing to say.' };
    const t0 = Date.now();
    const a = await tts.generateAsync({ text: t, sid: 0, speed: Math.max(.6, Math.min(1.6, +speed || 1)), enableExternalBuffer: false, generationConfig: new sherpa.GenerationConfig({ numSteps: steps, referenceAudio: ref.samples, referenceSampleRate: ref.sr, referenceText: ref.text }) });
    // slow laptop? use fewer steps next time. Fast one? go back to the best quality.
    const dur = a.samples.length / a.sampleRate, rtf = (Date.now() - t0) / 1000 / Math.max(.5, dur);
    if (process.env.DUDE_DEBUG) console.log(`[voice] ${t.length} chars -> ${(a.samples.length / a.sampleRate).toFixed(1)}s audio in ${Date.now() - t0} ms (steps ${steps}, threads ${Math.max(2, Math.min(4, os.cpus().length - 1))})`);
    if (dur >= 1.5) steps = rtf > 1.1 ? Math.max(2, steps - 1) : rtf < .45 ? Math.min(4, steps + 1) : steps;   // judge speed on real lines only
    return { samples: a.samples, sampleRate: a.sampleRate };
  }).catch(e => ({ error: String(e.message || e) }));
  busy = job.catch(() => {});
  return job;
}

async function forget() { ref = null; await fsp.unlink(refWav()).catch(() => {}); await fsp.unlink(refJson()).catch(() => {}); return status(); }

module.exports = { status, prepare, setRef, say, forget, download, untar };
