// The small, safe bridge between Dude's page and Windows.
const { contextBridge, ipcRenderer } = require('electron');
const on = ch => cb => ipcRenderer.on(ch, (_e, v) => cb(v));
contextBridge.exposeInMainWorld('kitoDesktop', {
  setClickThrough: v => ipcRenderer.send('kito:through', !!v),
  stats: () => ipcRenderer.invoke('kito:stats'),
  onWindows: on('kito:windows'),
  onCommand: on('kito:cmd'),
  quit: () => ipcRenderer.send('kito:quit'),
  // brain, permissions, memory
  chat: (text, ctx) => ipcRenderer.invoke('dude:chat', text, ctx),
  thought: (req, ctx) => ipcRenderer.invoke('dude:thought', req, ctx),
  habits: () => ipcRenderer.invoke('dude:habits'),
  // "my voice"
  voiceStatus: () => ipcRenderer.invoke('dude:voice:status'),
  voicePrepare: () => ipcRenderer.invoke('dude:voice:prepare'),
  voiceSetRef: (samples, sr, text) => ipcRenderer.invoke('dude:voice:setRef', samples, sr, text),
  voiceSay: (text, speed) => ipcRenderer.invoke('dude:voice:say', text, speed),
  voiceForget: () => ipcRenderer.invoke('dude:voice:forget'),
  onVoiceStatus: on('dude:voiceStatus'),
  // Dude's own voice (voice 1)
  dvStatus: () => ipcRenderer.invoke('dude:dv:status'),
  dvPrepare: () => ipcRenderer.invoke('dude:dv:prepare'),
  dvSay: (text, speed) => ipcRenderer.invoke('dude:dv:say', text, speed),
  onDvStatus: on('dude:dvStatus'),
  // always listening (only while he's on)
  hearStart: () => ipcRenderer.invoke('dude:hear:start'),
  hearStop: () => ipcRenderer.send('dude:hear:stop'),
  hearPause: on => ipcRenderer.send('dude:hear:pause', !!on),
  onHear: on('dude:hear'),
  // his ears: microphone sound (16 kHz) goes to the main process, where Whisper works out the words
  earsAudio: samples => ipcRenderer.send('dude:ears:audio', samples),
  earsStatus: () => ipcRenderer.invoke('dude:ears:status'),
  voiceRetry: () => ipcRenderer.invoke('dude:voice:retry'),
  // his problem log
  logOpen: extra => ipcRenderer.invoke('dude:log:open', extra || {}),
  version: () => ipcRenderer.invoke('dude:version'),
  logTail: () => ipcRenderer.invoke('dude:log:tail'),
  log: (area, msg) => ipcRenderer.send('dude:log', String(area), String(msg)),
  // what he knows: your laptop, and things you gave him to learn
  laptopStats: () => ipcRenderer.invoke('dude:laptop:stats'),
  learnPick: () => ipcRenderer.invoke('dude:learn:pick'),
  learnFile: p => ipcRenderer.invoke('dude:learn:file', p),
  learnText: (text, title) => ipcRenderer.invoke('dude:learn:text', text, title),
  learnUrl: url => ipcRenderer.invoke('dude:learn:url', url),
  knowList: () => ipcRenderer.invoke('dude:know:list'),
  knowForget: id => ipcRenderer.invoke('dude:know:forget', id),
  // the studio (FL Studio projects)
  studioReport: () => ipcRenderer.invoke('dude:studio:report'),
  studioCurrent: () => ipcRenderer.invoke('dude:studio:current'),
  studioRename: (id, name) => ipcRenderer.invoke('dude:studio:rename', id, name),
  studioUndo: () => ipcRenderer.invoke('dude:studio:undo'),
  copy: text => ipcRenderer.invoke('dude:copy', text),
  open: (id, how) => ipcRenderer.invoke('dude:open', { id, how }),
  settings: () => ipcRenderer.invoke('dude:settings'),
  setSettings: patch => ipcRenderer.invoke('dude:settings:set', patch),
  setKey: key => ipcRenderer.invoke('dude:key', key),
  addFolder: () => ipcRenderer.invoke('dude:folder:add'),
  wipeMemory: () => ipcRenderer.invoke('dude:memory:wipe'),
  welcome: () => ipcRenderer.invoke('dude:welcome'),
  listen: () => ipcRenderer.invoke('dude:listen'),
  answer: (id, allow) => ipcRenderer.send('dude:answer', { id, allow }),
  onAsk: on('dude:ask'),
  onAskDone: on('dude:askDone'),
  onCard: on('dude:card'),
  onBusy: on('dude:busy'),
  onAction: on('dude:action'),
  onEvent: on('dude:event'),
  onSettings: on('dude:settingsChanged')
});
