// Dude's ears: he understands what you say with Whisper (the small English model, MIT license) and knows when
// you're talking with Silero VAD (MIT), both running on this laptop through sherpa-onnx.
// The ear model (about 120 MB) downloads once and stays in Dude's folder in AppData.
// The sound from your microphone is only kept in memory for a few seconds while he works out the words.
// Nothing is recorded, saved or sent anywhere.
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { download, untar } = require('./fetcher');
const engine = require('./engine');
const { log } = require('./log');

const NAME = 'sherpa-onnx-whisper-tiny.en';
const URL_ASR = process.env.DUDE_EARS_URL || `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${NAME}.tar.bz2`;
const URL_VAD = process.env.DUDE_VAD_URL || 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx';
const SIZE_MB = 118;
const FILES = ['tiny.en-encoder.int8.onnx', 'tiny.en-decoder.int8.onnx', 'tiny.en-tokens.txt'];
const SR = 16000, WIN = 512;

const dir = () => path.join(app.getPath('userData'), 'ears');
const modelFile = f => path.join(dir(), NAME, f);
const vadFile = () => path.join(dir(), 'silero_vad.onnx');

let state = 'idle';              // idle | downloading | unpacking | loading | ready | error
let errKind = '', progress = 0, mb = 0, error = '', fails = 0, preparing = null;
let rec = null, vad = null, sherpa = null;
let on = false, carry = new Float32Array(0), queue = [], decoding = false, heard = () => {}, rtf = 0, busyMs = 0, busySince = Date.now();
// the last few seconds of sound, so each sentence can start a little before the VAD noticed it
// (Whisper often drops the first word, his name, without that)
const RING = SR * 16, ring = new Float32Array(RING), PRE = Math.round(SR * .3);
let fed = 0;
function ringPush(x) { for (let i = 0; i < x.length; i++) ring[(fed + i) % RING] = x[i]; fed += x.length; }
function ringGet(from, to) { from = Math.max(0, from, fed - RING); to = Math.min(to, fed); const out = new Float32Array(Math.max(0, to - from)); for (let i = from; i < to; i++) out[i - from] = ring[i % RING]; return out; }

function hasPack() { return FILES.every(f => fs.existsSync(modelFile(f))) && fs.existsSync(vadFile()); }
function status() { return { state, progress, mb: Math.round(mb), sizeMb: SIZE_MB, error, errKind, hasPack: hasPack(), engine: engine.ok(), fails, rtf }; }
const ready = () => !!(rec && vad);

async function ensurePack(emit) {
  if (hasPack()) return;
  await fsp.mkdir(dir(), { recursive: true });
  const tar = path.join(dir(), NAME + '.tar.bz2');
  for (let round = 1; ; round++) {
    if (!FILES.every(f => fs.existsSync(modelFile(f)))) {
      if (!fs.existsSync(tar)) {
        state = 'downloading'; progress = 0; emit();
        await download(URL_ASR, tar, (g, t) => { mb = g / 1e6; const p = t ? g / t * .95 : Math.min(.9, g / (SIZE_MB * 1e6)); if (p - progress > .01) { progress = p; emit(); } });
      }
      state = 'unpacking'; progress = 0; emit();
      // only the small (int8) model files: the big ones and the test sounds are not needed
      try { await untar(tar, dir(), FILES.map(f => `${NAME}/${f}`), p => { if (p - progress >= .02 || p === 1) { progress = p; emit(); } }); }
      catch (e) { await fsp.unlink(tar).catch(() => {}); if (e.damaged && round < 2) continue; throw e; }
      await fsp.unlink(tar).catch(() => {});
    }
    if (!fs.existsSync(vadFile())) await download(URL_VAD, vadFile());
    if (hasPack()) break;
    if (round >= 2) throw new Error('The ears download is incomplete. I will download it again.');
  }
  progress = 1;
}

function makeVad() {
  return new sherpa.Vad({
    sileroVad: { model: vadFile(), threshold: .5, minSpeechDuration: .25, minSilenceDuration: .65, maxSpeechDuration: 12, windowSize: WIN },
    sampleRate: SR, numThreads: 1, provider: 'cpu', debug: false
  }, 30);
}

async function prepare(emit = () => {}) {
  if (ready()) { state = 'ready'; return status(); }
  if (preparing) return preparing;
  preparing = (async () => {
    try {
      sherpa = engine.retry();
      if (!sherpa) throw new Error(engine.why());
      await ensurePack(emit);
      state = 'loading'; emit();
      const t0 = Date.now(), threads = Math.max(1, Math.min(2, os.cpus().length - 2));
      const cfg = {
        featConfig: { sampleRate: SR, featureDim: 80 },
        modelConfig: { whisper: { encoder: modelFile(FILES[0]), decoder: modelFile(FILES[1]), language: 'en', task: 'transcribe' }, tokens: modelFile(FILES[2]), numThreads: threads, provider: 'cpu', debug: 0 },
        decodingMethod: 'greedy_search'
      };
      rec = sherpa.OfflineRecognizer.createAsync ? await sherpa.OfflineRecognizer.createAsync(cfg) : new sherpa.OfflineRecognizer(cfg);
      vad = makeVad();
      // a quick test: one second of silence must come back (almost) empty, and fast
      const t1 = Date.now();
      await decode(new Float32Array(SR));
      rtf = +((Date.now() - t1) / 1000).toFixed(2);
      log('ears', `ears ready: loaded in ${Date.now() - t0} ms, ${rtf} s per sentence (${threads} threads)`);
      state = 'ready'; error = ''; fails = 0;
    } catch (e) {
      state = 'error'; error = String((e && e.message) || e); errKind = e && e.net ? 'net' : 'broken'; rec = null; vad = null; fails++;
      log('ears', `ears failed: ${error}${e && e.cause ? ' / ' + (e.cause.message || e.cause) : ''}`);
    }
    preparing = null; emit();
    return status();
  })();
  return preparing;
}

async function decode(samples) {
  const s = rec.createStream();
  s.acceptWaveform({ samples, sampleRate: SR });
  if (rec.decodeAsync) return (await rec.decodeAsync(s)).text || '';
  rec.decode(s); return rec.getResult(s).text || '';
}

// Whisper sometimes "hears" words in noise or music. These are its usual inventions.
const JUNK = /^(?:(?:thank you|thanks)(?: (?:so much|very much))?(?: for watching| for listening)?[.!]*|you[.!]*|um+[.!]*|uh+[.!]*|hmm+[.!]*|please subscribe.*|subtitles by.*|the end[.!]*|\.+|[-♪♫ ]+)$/i;
function cleanText(t) {
  t = String(t || '').replace(/\[[^\]]*\]|\([^)]*\)|[♪♫*]+|^\s*(?:>>|-)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || JUNK.test(t) || !/[a-z0-9]/i.test(t)) return '';
  return t;
}

async function pump() {
  if (decoding) return;
  decoding = true;
  while (queue.length && on) {
    // too much talking at once (music, a video): only the newest sentence matters
    if (queue.length > 2) queue.splice(0, queue.length - 1);
    const seg = queue.shift(), secs = seg.length / SR;
    if (secs < .35) continue;
    const t0 = Date.now();
    let text = '';
    try { text = cleanText(await decode(seg)); } catch (e) { log('ears', `decode failed: ${(e && e.message) || e}`); }
    busyMs += Date.now() - t0;
    if (text && on) heard({ text, conf: .9, secs: +secs.toFixed(1), ms: Date.now() - t0 });
  }
  decoding = false;
}

// sound from the microphone, 16 kHz mono
function feed(x) {
  if (!on || !vad) return;
  const f = x instanceof Float32Array ? x : x && x.buffer ? new Float32Array(x.buffer, x.byteOffset || 0, Math.floor((x.byteLength || 0) / 4)) : null;
  if (!f || !f.length) return;
  // keep the laptop fast: if he's spending more than half his time working out words (music playing all the time), skip some
  const now = Date.now();
  if (now - busySince > 20000) { busyMs *= .5; busySince = now - 10000; }
  const a = new Float32Array(carry.length + f.length); a.set(carry); a.set(f, carry.length);
  let i = 0;
  for (; i + WIN <= a.length; i += WIN) { const w = a.subarray(i, i + WIN); ringPush(w); vad.acceptWaveform(w); }
  carry = a.slice(i);
  while (!vad.isEmpty()) {
    const seg = vad.front(false); vad.pop();
    if (busyMs / Math.max(1, now - busySince) > .5 && queue.length) continue;
    const pre = seg.start > 0 && seg.start <= fed ? ringGet(seg.start - PRE, seg.start) : new Float32Array(0);
    const all = new Float32Array(pre.length + seg.samples.length); all.set(pre); all.set(seg.samples, pre.length);
    queue.push(all);
  }
  pump();
}
function listen(v, onHeard) {
  if (onHeard) heard = onHeard;
  on = !!v;
  if (!on) reset();
}
// he's talking (or you switched him off): forget the half-heard sound
function reset() { carry = new Float32Array(0); queue = []; fed = 0; if (vad) { try { vad.reset(); } catch (e) { try { vad.clear(); } catch (e2) {} } } }
function speaking() { try { return !!(vad && on && vad.isDetected()); } catch (e) { return false; } }

module.exports = { status, prepare, ready, listen, feed, reset, speaking, decode, cleanText };
