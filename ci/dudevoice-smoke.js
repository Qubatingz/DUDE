// Build check on a real Windows machine: "Dude's voice" (voice 1) loads and talks, and how fast.
// It also measures the full-size version of the same voice, to know which one talks faster on Windows laptops.
// Run with: ELECTRON_RUN_AS_NODE=1 Dude.exe ci/dudevoice-smoke.js <Dude folder>\resources\app
const path = require('path'), fs = require('fs'), os = require('os'), { execFileSync } = require('child_process');
const appDir = path.resolve(process.argv[2]);
const sherpa = require(path.join(appDir, 'node_modules', 'sherpa-onnx-node'));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dudevoice-'));
const get = async (url, dest) => { const r = await fetch(url); if (!r.ok) throw new Error(`${url} -> ${r.status}`); fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer())); };
const LINES = ['Yo Quba! Studio session with Eric at three.', 'Nothing on your list today. Tell me, like, studio session with Eric at three, or to do, finish the hook.'];
async function bench(name, file, threads) {
  const M = path.join(dir, name);
  const tts = await sherpa.OfflineTts.createAsync({ model: { kokoro: { model: path.join(M, file), voices: path.join(M, 'voices.bin'), tokens: path.join(M, 'tokens.txt'), dataDir: path.join(M, 'espeak-ng-data'), lexicon: path.join(M, 'lexicon-us-en.txt') } }, numThreads: threads });
  await tts.generateAsync({ text: 'Yo, what is up?', sid: 16, speed: 1, enableExternalBuffer: false });   // warm up
  let gen = 0, audio = 0;
  for (const t of LINES) { const t0 = Date.now(); const a = await tts.generateAsync({ text: t, sid: 16, speed: 1, enableExternalBuffer: false }); gen += Date.now() - t0; audio += a.samples.length / a.sampleRate; }
  const rtf = gen / 1000 / audio;
  console.log(`::notice title=Voice speed::${name} ${file} ${threads} threads: ${audio.toFixed(1)} s of speech made in ${(gen / 1000).toFixed(1)} s (${rtf.toFixed(2)} s per second of speech)`);
  if (audio < 3) throw new Error('voice too short');
  return rtf;
}
(async () => {
  console.log(`CPU: ${os.cpus()[0].model} x ${os.cpus().length}`);
  const tarExe = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  for (const name of ['kokoro-int8-multi-lang-v1_0', 'kokoro-multi-lang-v1_0']) {
    const tar = path.join(dir, name + '.tar.bz2');
    await get(`https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/${name}.tar.bz2`, tar);
    execFileSync(tarExe, ['-xjf', tar, '-C', dir]);
    fs.unlinkSync(tar);
    const file = name.includes('int8') ? 'model.int8.onnx' : 'model.onnx';
    for (const th of [2, 4]) await bench(name, file, th);
  }
  console.log("Dude's voice OK");
})().catch(e => { console.error("DUDE'S VOICE CHECK FAILED", e); process.exit(1); });
