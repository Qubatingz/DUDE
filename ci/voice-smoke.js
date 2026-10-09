// Build check on a real Windows machine: Dude's voice engine loads, the model unpacks with Windows' tar.exe,
// and it can talk in a copied voice. Run with: ELECTRON_RUN_AS_NODE=1 Dude.exe ci/voice-smoke.js <Dude folder>\resources\app
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
const appDir = path.resolve(process.argv[2]);
const sherpa = require(path.join(appDir, 'node_modules', 'sherpa-onnx-node'));
const NAME = 'sherpa-onnx-zipvoice-distill-int8-zh-en-emilia';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudevoice-'));
const get = async (url, dest) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} -> ${r.status}`); fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); };
function readWav(p) { const b = fs.readFileSync(p), sr = b.readUInt32LE(24); let o = 12; while (b.toString('ascii', o, o + 4) !== 'data') o += 8 + b.readUInt32LE(o + 4); const n = b.readUInt32LE(o + 4) / 2, out = new Float32Array(n); for (let i = 0; i < n; i++) out[i] = b.readInt16LE(o + 8 + i * 2) / 32768; return { sr, samples: out }; }
(async () => {
  const tar = path.join(dir, NAME + '.tar.bz2'), voc = path.join(dir, 'vocos_24khz.onnx');
  await get(`https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${NAME}.tar.bz2`, tar);
  await get('https://github.com/k2-fsa/sherpa-onnx/releases/download/vocoder-models/vocos_24khz.onnx', voc);
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xjf', tar, '-C', dir]);
  const Z = path.join(dir, NAME);
  const tts = await sherpa.OfflineTts.createAsync({ model: { zipvoice: { tokens: path.join(Z, 'tokens.txt'), encoder: path.join(Z, 'encoder.int8.onnx'), decoder: path.join(Z, 'decoder.int8.onnx'), vocoder: voc, dataDir: path.join(Z, 'espeak-ng-data'), lexicon: path.join(Z, 'lexicon.txt') } }, numThreads: 2 });
  const ref = readWav(path.join(Z, 'test_wavs', 'leijun-1.wav'));
  const t0 = Date.now();
  const a = await tts.generateAsync({ text: 'Yo Quba! Dude here, talking on Windows.', sid: 0, speed: 1, enableExternalBuffer: false, generationConfig: new sherpa.GenerationConfig({ numSteps: 4, referenceAudio: ref.samples, referenceSampleRate: ref.sr, referenceText: '那还是36年前, 1987年. 我呢考上了武汉大学的计算机系.' }) });
  const secs = a.samples.length / a.sampleRate;
  console.log(`voice OK: ${secs.toFixed(1)}s of audio in ${Date.now() - t0} ms`);
  if (secs < 1) throw new Error('voice too short');
})().catch(e => { console.error('VOICE CHECK FAILED', e); process.exit(1); });
