// "Dude's voice": his own natural voice (voice 1, warm and friendly). Free, and it runs on this laptop.
// The voice model (about 130 MB) downloads once, right when Dude starts for the first time, and stays in
// Dude's folder in AppData. Nothing you say or he says is sent anywhere.
// Engine: sherpa-onnx (Apache-2.0) with the Kokoro-82M model (Apache-2.0), speaker "am_michael".
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { download, untar } = require('./fetcher');
const engine = require('./engine');
const { log } = require('./log');

const MODEL_NAME = 'kokoro-int8-multi-lang-v1_0';
const MODEL_URL = process.env.DUDE_DV_MODEL_URL || `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL_NAME}.tar.bz2`;
const SIZE_MB = 130;
const SPEAKER = 16;            // am_michael: voice 1 from the samples
const NEED = ['model.int8.onnx', 'voices.bin', 'tokens.txt', 'lexicon-us-en.txt', 'espeak-ng-data'];

const dir = () => path.join(app.getPath('userData'), 'voice');
const modelDir = () => path.join(dir(), MODEL_NAME);

let state = 'idle';            // idle | downloading | unpacking | loading | ready | error
let errKind = '', progress = 0, mb = 0, error = '', tts = null, busy = Promise.resolve(), preparing = null, rtf = 0, fails = 0;

function hasPack() { return NEED.every(f => fs.existsSync(path.join(modelDir(), f))); }
function status() { return { state, progress, mb: Math.round(mb), sizeMb: SIZE_MB, error, errKind, hasPack: hasPack(), engine: engine.ok(), engineError: engine.why(), rtf, fails }; }

async function ensurePack(emit) {
  if (hasPack()) return;
  await fsp.mkdir(dir(), { recursive: true });
  const tar = path.join(dir(), MODEL_NAME + '.tar.bz2');
  for (let round = 1; ; round++) {
    if (!fs.existsSync(tar)) {
      state = 'downloading'; progress = 0; emit();
      await download(MODEL_URL, tar, (g, t) => { mb = g / 1e6; const p = t ? g / t * .95 : Math.min(.9, g / (SIZE_MB * 1e6)); if (p - progress > .01) { progress = p; emit(); } });
    }
    state = 'unpacking'; progress = .97; emit();
    try { await untar(tar, dir()); }
    catch (e) { await fsp.unlink(tar).catch(() => {}); if (e.damaged && round < 2) continue; throw e; }
    await fsp.unlink(tar).catch(() => {});
    if (hasPack()) break;
    if (round >= 2) throw new Error('The voice download is incomplete. I will download it again.');
  }
  progress = 1;
}

async function prepare(emit = () => {}) {
  if (tts) { state = 'ready'; return status(); }
  if (preparing) return preparing;
  preparing = (async () => {
    try {
      const sherpa = engine.retry();
      if (!sherpa) throw new Error(engine.why());
      await ensurePack(emit);
      state = 'loading'; emit();
      const M = modelDir(), threads = Math.max(2, Math.min(4, os.cpus().length - 1)), t0 = Date.now();
      tts = await sherpa.OfflineTts.createAsync({
        model: { kokoro: { model: path.join(M, 'model.int8.onnx'), voices: path.join(M, 'voices.bin'), tokens: path.join(M, 'tokens.txt'), dataDir: path.join(M, 'espeak-ng-data'), lexicon: path.join(M, 'lexicon-us-en.txt') } },
        numThreads: threads
      });
      // say a word quietly first: checks the voice really works, and makes his first real sentence come out faster
      const t1 = Date.now();
      const a = await tts.generateAsync({ text: 'Yo, what is up?', sid: SPEAKER, speed: 1, enableExternalBuffer: false });
      const dur = a.samples.length / a.sampleRate;
      if (!(dur > .3)) throw new Error('My voice came out empty.');
      rtf = +((Date.now() - t1) / 1000 / dur).toFixed(2);
      log('voice', `Dude's voice ready: loaded in ${Date.now() - t0} ms, ${rtf} s per second of speech (${threads} threads)`);
      state = 'ready'; error = ''; fails = 0;
    } catch (e) {
      state = 'error'; error = String((e && e.message) || e); errKind = e && e.net ? 'net' : 'broken'; tts = null; fails++;
      log('voice', `Dude's voice failed: ${error}${e && e.cause ? ' / ' + (e.cause.message || e.cause) : ''}`);
    }
    preparing = null; emit();
    return status();
  })();
  return preparing;
}

function clean(t) { return String(t || '').replace(/[^\p{L}\p{N}\s.,!?'%:;()-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 400); }
function say(text, speed = 1) {
  const job = busy.then(async () => {
    if (!tts) return { error: error || 'My voice is not ready yet.', state };
    const t = clean(text);
    if (!t) return { error: 'Nothing to say.' };
    const t0 = Date.now();
    const a = await tts.generateAsync({ text: t, sid: SPEAKER, speed: Math.max(.7, Math.min(1.5, +speed || 1)), enableExternalBuffer: false });
    const dur = a.samples.length / a.sampleRate;
    if (dur > 1) rtf = +(rtf * .7 + (Date.now() - t0) / 1000 / dur * .3).toFixed(2);
    return { samples: a.samples, sampleRate: a.sampleRate };
  }).catch(e => { log('voice', `speaking failed: ${(e && e.message) || e}`); return { error: String((e && e.message) || e) }; });
  busy = job.catch(() => {});
  return job;
}

module.exports = { status, prepare, say };
