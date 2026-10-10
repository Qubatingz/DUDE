// Build check on a real Windows machine: "Dude's voice" (voice 1) loads and talks.
// Run with: ELECTRON_RUN_AS_NODE=1 Dude.exe ci/dudevoice-smoke.js <Dude folder>\resources\app
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
const appDir = path.resolve(process.argv[2]);
const sherpa = require(path.join(appDir, 'node_modules', 'sherpa-onnx-node'));
const NAME = 'kokoro-int8-multi-lang-v1_0';
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudevoice-'));
const get = async (url, dest) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} -> ${r.status}`); fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); };
(async () => {
  const tar = path.join(dir, NAME + '.tar.bz2');
  await get(`https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${NAME}.tar.bz2`, tar);
  execFileSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xjf', tar, '-C', dir]);
  const M = path.join(dir, NAME);
  const tts = await sherpa.OfflineTts.createAsync({ model: { kokoro: { model: path.join(M, 'model.int8.onnx'), voices: path.join(M, 'voices.bin'), tokens: path.join(M, 'tokens.txt'), dataDir: path.join(M, 'espeak-ng-data'), lexicon: path.join(M, 'lexicon-us-en.txt') } }, numThreads: 2 });
  const t0 = Date.now();
  const a = await tts.generateAsync({ text: 'Yo Quba! Studio session with Eric at three. Matcha first, then we cook.', sid: 16, speed: 1, enableExternalBuffer: false });
  const secs = a.samples.length / a.sampleRate;
  console.log(`Dude's voice OK: ${secs.toFixed(1)}s of audio in ${Date.now() - t0} ms`);
  if (secs < 1) throw new Error('voice too short');
})().catch(e => { console.error("DUDE'S VOICE CHECK FAILED", e); process.exit(1); });
