// The speech engine (sherpa-onnx, Apache-2.0) that gives Dude his voice and his ears. It is loaded once.
// If it can't load, this keeps the real reason, in plain words, so Dude can tell you what's wrong
// instead of quietly falling back to the robot voice.
const fs = require('fs');
const path = require('path');
const { log } = require('./log');

let sherpa = null, tried = false, error = '', raw = '';
const addonDir = () => path.join(__dirname, 'node_modules', `sherpa-onnx-${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`);

function plain(msg) {
  if (/specified module could not be found|cannot open shared object|ERR_DLOPEN_FAILED/i.test(msg)) return 'A small Windows part I need is missing (the Microsoft Visual C++ runtime).';
  if (/procedure could not be found|entry point/i.test(msg)) return 'A Windows part I need is too old. Run Windows Update, then restart me.';
  if (/not a valid Win32|wrong ELF|bad CPU|machine type/i.test(msg)) return 'This Dude download needs 64-bit Windows.';
  if (/initiali[sz]ation routine failed/i.test(msg)) return "My voice engine couldn't start on this laptop's processor.";
  if (/Cannot find module|Could not find sherpa-onnx/i.test(msg)) return 'This Dude download is missing my voice engine. Get the newest Dude.';
  return 'My voice engine could not start.';
}

function load() {
  if (sherpa) return sherpa;
  if (tried) return null;
  tried = true;
  try { sherpa = require('sherpa-onnx-node'); error = ''; log('engine', `speech engine ${sherpa.version || ''} loaded`); return sherpa; }
  catch (e) { raw = String((e && e.message) || e); }
  // sherpa-onnx-node hides the real reason; load the engine file directly to find out what's wrong
  const dir = addonDir();
  try { require(path.join(dir, 'sherpa-onnx.node')); } catch (e) { raw = String((e && e.message) || e) + ' || ' + raw; }
  let files = '';
  try { files = fs.readdirSync(dir).join(', '); } catch (e) { files = 'folder missing'; }
  error = plain(raw);
  log('engine', `could not load: ${raw.slice(0, 400)} | files: ${files}`);
  return null;
}
// after a failed load (for example once the missing Windows part is installed), try again
function retry() { if (!sherpa) tried = false; return load(); }
const ok = () => !!load();
const why = () => (sherpa ? '' : (load(), error));

module.exports = { load, retry, ok, why, addonDir };
