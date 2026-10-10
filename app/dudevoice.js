// "Dude's voice": his own natural voice (voice 1, warm and friendly). Free, and it runs on this laptop.
// The voice model (about 130 MB) downloads once, the first time he talks with it, and stays in Dude's folder
// in AppData. Nothing you say or he says is sent anywhere.
// Engine: sherpa-onnx (Apache-2.0) with the Kokoro-82M model (Apache-2.0), speaker "am_michael".
const { app } = require('electron');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');
const { download, untar } = require('./voice');

const MODEL_NAME = 'kokoro-int8-multi-lang-v1_0';
const MODEL_URL = process.env.DUDE_DV_MODEL_URL || `https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${MODEL_NAME}.tar.bz2`;
const SPEAKER = 16;            // am_michael: voice 1 from the samples

const dir = () => path.join(app.getPath('userData'), 'voice');
const modelDir = () => path.join(dir(), MODEL_NAME);

let state = 'idle';            // idle | downloading | loading | ready | error
let progress = 0, error = '', tts = null, sherpa = null, busy = Promise.resolve(), preparing = null;

function hasPack() { return fs.existsSync(path.join(modelDir(), 'model.int8.onnx')) && fs.existsSync(path.join(modelDir(), 'voices.bin')); }
function engineOk() { try { sherpa = sherpa || require('sherpa-onnx-node'); return true; } catch (e) { return false; } }
function status() { return { state, progress, error, hasPack: hasPack(), engine: engineOk() }; }

async function ensurePack(emit) {
  if (hasPack()) return;
  await fsp.mkdir(dir(), { recursive: true });
  state = 'downloading'; progress = 0; emit();
  const tar = path.join(dir(), MODEL_NAME + '.tar.bz2');
  await download(MODEL_URL, tar, (g, t) => { const p = t ? g / t * .95 : .4; if (p - progress > .01) { progress = p; emit(); } });
  progress = .97; emit();
  await untar(tar, dir());
  await fsp.unlink(tar).catch(() => {});
  progress = 1;
}

async function prepare(emit = () => {}) {
  if (tts) { state = 'ready'; return status(); }
  if (preparing) return preparing;
  preparing = (async () => {
    try {
      if (!engineOk()) throw new Error('The voice engine is missing from this Dude download.');
      await ensurePack(emit);
      state = 'loading'; emit();
      const M = modelDir();
      tts = await sherpa.OfflineTts.createAsync({
        model: { kokoro: { model: path.join(M, 'model.int8.onnx'), voices: path.join(M, 'voices.bin'), tokens: path.join(M, 'tokens.txt'), dataDir: path.join(M, 'espeak-ng-data'), lexicon: path.join(M, 'lexicon-us-en.txt') } },
        numThreads: Math.max(2, Math.min(4, os.cpus().length - 1))
      });
      state = 'ready'; error = '';
    } catch (e) { state = 'error'; error = String(e.message || e); tts = null; }
    preparing = null; emit();
    return status();
  })();
  return preparing;
}

function clean(t) { return String(t || '').replace(/[^\p{L}\p{N}\s.,!?'%:;()-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 400); }
function say(text, speed = 1) {
  const job = busy.then(async () => {
    if (!tts) await prepare();
    if (!tts) return { error: error || 'Voice engine not ready.' };
    const t = clean(text);
    if (!t) return { error: 'Nothing to say.' };
    const a = await tts.generateAsync({ text: t, sid: SPEAKER, speed: Math.max(.7, Math.min(1.5, +speed || 1)), enableExternalBuffer: false });
    return { samples: a.samples, sampleRate: a.sampleRate };
  }).catch(e => ({ error: String(e.message || e) }));
  busy = job.catch(() => {});
  return job;
}

module.exports = { status, prepare, say };
