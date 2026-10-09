// Dude's brain. With a Claude API key he really understands you and decides which tool to use.
// Without a key he uses a simple built-in brain that still handles search, status, reports and memory.
// Permissions are enforced HERE in the tools, never left to the AI.
const path = require('path');

const MOODS = ['happy', 'excited', 'smug', 'thinking', 'concerned', 'sad', 'surprised', 'annoyed', 'laugh', 'sleepy', 'proud', 'scared', 'cheeky', 'chill'];
const MODE_TEXT = {
  everyday: 'Everyday mode: help with whatever the user is doing on the computer.',
  music: 'Music mode: the user makes music. You know music projects (FL Studio .flp, Ableton .als, REAPER, Studio One), samples, exports, mixes, artists and releases.',
  business: 'Business mode: be a bit more professional. Focus on documents, proposals, meetings, tasks and clients.',
  student: 'Student mode: focus on notes, assignments, research and study organization.',
  creative: 'Creative mode: focus on design, video, photography and writing projects.'
};
const API = process.env.DUDE_API_BASE || 'https://api.anthropic.com';

const TOOLS = [
  { name: 'get_computer_status', description: 'Battery, processor load, memory, storage, internet, and (if allowed) the app in front plus the apps using the most memory. Use for questions about the laptop, slowness, battery or storage.', input_schema: { type: 'object', properties: {} } },
  { name: 'search_files', description: 'Search file names inside folders the user allowed. Returns up to 8 matches (best and newest first) and shows them to the user as a clickable list. If no folder is allowed yet, the app asks the user for permission first.', input_schema: { type: 'object', properties: { query: { type: 'string', description: 'Words that may be in the file name or path, e.g. "gihanga" or "chemistry notes". Empty lists the newest files.' }, kind: { type: 'string', enum: ['any', 'music', 'audio', 'document', 'image', 'video', 'program', 'archive'], description: 'music = music projects (FL Studio, Ableton...), audio = songs and exports.' }, when: { type: 'string', description: 'Optional time filter: today, yesterday, this week, last week, this month, a weekday name, or "3 days".' }, folder: { type: 'string', enum: ['any', 'music', 'documents', 'downloads', 'desktop', 'pictures', 'videos'] } } } },
  { name: 'open_file', description: 'Open a file from the latest search results by its id, or show it in File Explorer. Only works with ids from results.', input_schema: { type: 'object', properties: { id: { type: 'string' }, how: { type: 'string', enum: ['open', 'show_in_folder'] } }, required: ['id'] } },
  { name: 'computer_report', description: 'Organization report of the allowed folders: storage, large files, old downloads, possible duplicates, screenshots, music projects, and recommendations. Shown to the user as a card. Never deletes anything.', input_schema: { type: 'object', properties: {} } },
  { name: 'recent_activity', description: 'What the user worked on recently: apps used, documents or projects that were open, and recent files. Needs memory and app permission.', input_schema: { type: 'object', properties: {} } },
  { name: 'set_reminder', description: 'Remind the user about something after a number of minutes.', input_schema: { type: 'object', properties: { text: { type: 'string' }, minutes: { type: 'number' } }, required: ['text', 'minutes'] } },
  { name: 'remember_note', description: 'Save a short note the user wants you to remember.', input_schema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
  { name: 'do_move', description: 'Perform an animation on screen, for fun or to celebrate.', input_schema: { type: 'object', properties: { move: { type: 'string', enum: ['dance', 'noodle', 'moonwalk', 'backflip', 'dab', 'robot', 'shimmy', 'runningman', 'guitar', 'headspin', 'flex', 'selfie', 'graffiti', 'rap', 'wave', 'sleep'] } }, required: ['move'] } },
  { name: 'teach_dude', description: 'Save something the user teaches you about himself or about how you should behave. kind=fact: a fact about him ("I make beats at night"). kind=rule: when something happens, say a line (when=app needs the app or website name). kind=topic_on/topic_off: what you talk about by yourself. kind=talk_more/talk_less: how often you speak up by yourself. kind=about: his project, what it is, what he is learning, or his dream.', input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['fact', 'rule', 'topic_on', 'topic_off', 'talk_more', 'talk_less', 'about'] }, fact: { type: 'string' }, when: { type: 'string', enum: ['app', 'morning', 'night', 'back', 'anytime'] }, app: { type: 'string' }, say: { type: 'string' }, topic: { type: 'string', enum: ['hustle', 'english', 'roast', 'calm', 'random'] }, field: { type: 'string', enum: ['project', 'what', 'learning', 'dream'] }, value: { type: 'string' } }, required: ['kind'] } }
];
const TOPIC_TEXT = {
  hustle: 'his project and money moves: hype, a practical business tip, or a push to do one small thing today',
  english: 'English practice: a useful word, a better way to say something, or a tiny speaking challenge',
  roast: 'a friendly roast about what he is doing right now (never about looks, money problems, family or anything sensitive)',
  calm: 'calming his overthinking: one grounding thought or one small next step, no lectures',
  random: 'a random funny thought that just popped into your cartoon head'
};
const TRIGGER_TEXT = {
  random: 'Nothing special happened; a thought just came to you.',
  long: 'He has been working for a long time without a break.',
  night: 'It is late at night and he is still on the laptop.',
  back: 'He just came back to the laptop after being away.',
  binge: 'He has been on the same social or video site for a while.',
  pattern: 'You noticed something about his routine by watching.',
  app: 'He just opened an app or website.'
};

function createBrain(d) {
  // d: { settings, files, memory, status(ctx), ask(scopeKey, question, reason), emit(type, payload), net }
  const results = new Map();   // id -> { path, name }
  let history = [];             // [{ role, content: string }]
  let lastCtx = {};
  let plain = false;            // API rejected optional speed settings once -> don't send them again

  const rel = ms => { const d0 = new Date(ms), now = new Date(); const day = 86400000; const a = new Date(now); a.setHours(0, 0, 0, 0); const diff = Math.floor((a - new Date(d0).setHours(0, 0, 0, 0)) / day); const time = d0.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); if (diff <= 0) return 'today ' + time; if (diff === 1) return 'yesterday ' + time; if (diff < 7) return d0.toLocaleDateString('en-US', { weekday: 'long' }) + ' ' + time; return d0.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: diff > 300 ? 'numeric' : undefined }); };
  function keep(list) {
    results.clear();
    return list.map((f, i) => { const id = 'f' + (i + 1); results.set(id, f); return Object.assign({ id }, f); });
  }

  /* ---------- tools (permission checks live here) ---------- */
  const FOLDER_FOR = { music: ['music', 'documents'], audio: ['music', 'downloads'], document: ['documents', 'desktop', 'downloads'], image: ['pictures', 'desktop', 'downloads'], video: ['videos', 'downloads'], program: ['downloads'], archive: ['downloads'], any: ['documents', 'music', 'downloads', 'desktop'] };
  async function needFolder(key, why) {
    const info = d.settings.folderInfo(key);
    if (!info) return false;
    if (d.settings.get().perms.folders[key]) return true;
    const ok = await d.ask('folder:' + key, `Can I search your ${info.label}?`, why || `I'll only read file names and dates there, nothing else. You can switch it off in the Access tab.`);
    if (ok) d.settings.grantFolder(key);
    return ok;
  }
  async function tool(name, input = {}) {
    const s = d.settings.get();
    try {
      if (name === 'get_computer_status') return await d.status(lastCtx);
      if (name === 'search_files') {
        const kind = input.kind || 'any';
        if (input.folder && input.folder !== 'any') { if (!(await needFolder(input.folder))) return { error: 'permission_denied', folder: input.folder }; }
        let roots = d.settings.grantedFolders();
        if (input.folder && input.folder !== 'any') roots = roots.filter(r => r.key === input.folder);
        if (!roots.length) {
          const want = (FOLDER_FOR[kind] || FOLDER_FOR.any)[0];
          if (!(await needFolder(want))) return { error: 'permission_denied', folder: want, note: 'The user said not now. Do not ask again right away.' };
          roots = d.settings.grantedFolders();
        }
        d.emit('busy', { text: 'searching' });
        const found = keep(await d.files.search(roots, { query: input.query || '', kind, when: input.when || '' }));
        d.emit('card', { type: 'files', title: found.length ? `Found ${found.length} file${found.length > 1 ? 's' : ''}` : 'Nothing found', note: `Searched: ${roots.map(r => r.label).join(', ')}`, items: found.map(f => ({ id: f.id, name: f.name, sub: `${f.folder} · ${rel(f.mtime)} · ${d.files.fmtSize(f.size)}` })) });
        return { searched: roots.map(r => r.label), count: found.length, results: found.map(f => ({ id: f.id, name: f.name, folder: f.folder, kind: f.kind, modified: rel(f.mtime), size: d.files.fmtSize(f.size) })) };
      }
      if (name === 'open_file') {
        const f = results.get(input.id);
        if (!f) return { error: 'unknown_id', note: 'Only ids from the latest search results work.' };
        const err = await d.open(f.path, input.how === 'show_in_folder' ? 'show' : 'open');
        return err ? { error: err } : { done: true, name: f.name };
      }
      if (name === 'computer_report') {
        let roots = d.settings.grantedFolders();
        if (!roots.length) { if (!(await needFolder('downloads', 'To make the report I need to look at file names and sizes. Downloads is where most mess hides.'))) return { error: 'permission_denied' }; roots = d.settings.grantedFolders(); }
        d.emit('busy', { text: 'checking' });
        const st = s.perms.system ? await d.status(lastCtx) : {};
        const rep = await d.files.report(roots, st.storage || null);
        rep.large = keep(rep.large);
        d.emit('card', { type: 'report', report: Object.assign({}, rep, { duplicateWaste: d.files.fmtSize(rep.duplicateWaste), large: rep.large.map(f => ({ id: f.id, name: f.name, sub: `${f.folder} · ${d.files.fmtSize(f.size)}` })) }) });
        return Object.assign({}, rep, { duplicateWaste: d.files.fmtSize(rep.duplicateWaste), large: rep.large.map(f => ({ id: f.id, name: f.name, size: d.files.fmtSize(f.size) })) });
      }
      if (name === 'recent_activity') {
        if (!s.perms.memory) return { error: 'memory_off', note: 'Memory is switched off in the Memory tab.' };
        const out = {};
        const day = d.memory.lastDay();
        if (day) out.lastDay = d.memory.summary(day);
        const td = d.memory.summary(d.memory.today());
        if (td) out.today = td;
        if (!s.perms.apps) out.note = 'App access is off, so I do not know which apps were used.';
        if (s.perms.recent) { const rf = keep(d.memory.recentFiles(6)); out.recentFiles = rf.map(f => ({ id: f.id, name: f.name, opened: rel(f.mtime) })); if (rf.length) d.emit('card', { type: 'files', title: 'You opened these lately', items: rf.map(f => ({ id: f.id, name: f.name, sub: rel(f.mtime) })) }); }
        return out;
      }
      if (name === 'set_reminder') { d.emit('action', { type: 'reminder', text: String(input.text || '').slice(0, 120), minutes: Math.max(.1, Math.min(1440, +input.minutes || 5)) }); return { done: true }; }
      if (name === 'remember_note') { if (!s.perms.memory) return { error: 'memory_off' }; d.emit('action', { type: 'note', text: String(input.text || '').slice(0, 160) }); return { done: true }; }
      if (name === 'do_move') { d.emit('action', { type: 'move', move: input.move }); return { done: true }; }
      if (name === 'teach_dude') { const t = {}; for (const k of ['kind', 'fact', 'when', 'app', 'say', 'topic', 'field', 'value']) if (input[k] != null) t[k] = String(input[k]).slice(0, 160); d.emit('action', Object.assign({ type: 'teach' }, t)); return { done: true }; }
    } catch (e) { return { error: String(e.message || e) }; }
    return { error: 'unknown_tool' };
  }

  /* ---------- Claude ---------- */
  function system(ctx) {
    const s = d.settings.get(), nm = s.userName || 'the user';
    const allowed = d.settings.grantedFolders().map(r => r.label);
    return `You are ${ctx.petName || 'Dude'}, an animated cartoon character who lives on ${nm}'s Windows laptop. You have a body on screen: you walk on their windows, dance, sit and react. Today you wear: ${ctx.outfit || 'a green beanie'}.
Personality: funny, confident, a bit of swagger, warm, never mean, never cringe. Humor level ${ctx.humor ?? 80}% (at low levels be mostly practical). Humor should come from the real situation, not random jokes.
${MODE_TEXT[s.mode] || MODE_TEXT.everyday}

How to answer:
- Your words appear in a small speech bubble and are read aloud. Use 1 or 2 short sentences, at most about 35 words. Plain text only: no markdown, no lists, no emojis.
- Begin every reply with exactly one mood tag: ${MOODS.map(m => '[' + m + ']').join(' ')}. Example: "[cheeky] Found it. Want me to open it?"
- Use simple, clear English.
- Permission comes first. You can only see what the user allowed. The tools ask for permission themselves; if a tool says permission_denied, accept it kindly and offer another way.
- You can't delete, move or rename files. Never pretend you did something you didn't.
- When a search finds files, the app shows them as a clickable list, so just say what you found in a few words and offer to open the best match.
- Use ${nm === 'the user' ? 'their name' : nm} now and then, not every message.

Right now: ${new Date().toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'long' })}. Folders you may search: ${allowed.length ? allowed.join(', ') : 'none yet'}. App access: ${s.perms.apps ? 'on' : 'off'}. Memory: ${s.perms.memory ? 'on' : 'off'}.${ctx.focusApp ? ' App in front: ' + ctx.focusApp + '.' : ''}${ctx.sick ? ' The computer has a problem right now: ' + ctx.sick + '.' : ''}
${aboutHim(ctx, nm)}`;
  }
  /* everything he taught Dude, plus what Dude noticed, so Dude sounds like a friend and not a stranger */
  function aboutHim(ctx, nm) {
    const me = ctx.me || {}, a = me.about || {}, L = [];
    const who = [a.project && `building ${a.project}${a.what ? ` (${a.what})` : ''}`, a.learning && `getting better at ${a.learning}`, a.dream && `dream: ${a.dream}`].filter(Boolean);
    if (who.length) L.push(`- ${who.join('; ')}.`);
    if (me.facts && me.facts.length) L.push(`- Things he told you: ${me.facts.join(' | ')}`);
    if (me.notes && me.notes.length) L.push(`- Notes you saved for him: ${me.notes.join(' | ')}`);
    if (d.habits && s0().perms.memory) { try { L.push(`- His routine (you learned it by watching): ${d.habits.brief()}`); } catch (e) {} }
    if (me.mission) L.push(`- His mission for today: "${me.mission}"${me.missionDone ? ' (done!)' : ''}.`);
    if (me.word) L.push(`- Word of the day you taught him: "${me.word}".`);
    if (me.topics && me.topics.length) L.push(`- He wants you to talk about: ${me.topics.join(', ')}.`);
    if (me.liked && me.liked.length) L.push(`- Lines he laughed at (more like these): ${me.liked.map(x => '"' + x + '"').join(' ')}`);
    if (me.disliked && me.disliked.length) L.push(`- Lines he did NOT like (avoid this kind): ${me.disliked.map(x => '"' + x + '"').join(' ')}`);
    if (me.lastThought) L.push(`- The last thing you said on your own: "${me.lastThought}".`);
    const learning = /english/i.test(a.learning || '') || (me.topics || []).includes('English practice');
    return `About ${nm} (use this to sound like his friend who really knows him; bring it up naturally, not every time):
${L.length ? L.join('\n') : '- You are still getting to know him.'}
${learning ? `- ${nm} is learning English. Use simple words. When he practices (a story or a sentence), cheer him on and give at most one small, kind correction.\n` : ''}- If he seems stuck in his head or overthinking: help him get out. Ask him to dump it, then help him pick one 10-minute step, and offer a reminder. No lectures.
- If he teaches you something about himself or how to behave, save it with teach_dude.
- Serious moments: if he mentions self-harm, suicide or a real crisis, drop all jokes, answer with care, and encourage him to reach out right now to someone he trusts or to a local crisis line or emergency number.`;
  }
  const s0 = () => d.settings.get();
  async function call(key, body) {
    const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 45000);
    try {
      const r = await d.net.fetch(API + '/v1/messages', { method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctrl.signal });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { const e = new Error((j.error && j.error.message) || ('HTTP ' + r.status)); e.status = r.status; throw e; }
      return j;
    } finally { clearTimeout(timer); }
  }
  async function claude(key, msgs, ctx, opt = {}) {
    const body = { model: d.settings.get().model || 'claude-haiku-5-5', max_tokens: opt.max || 700, system: opt.system || system(ctx), messages: msgs };
    if (!opt.noTools) body.tools = TOOLS;
    if (!plain) { body.output_config = { effort: 'low' }; body.thinking = { type: 'disabled' }; }
    try { return await call(key, body); }
    catch (e) {
      if (!plain && e.status === 400 && /thinking|effort|output_config/i.test(e.message)) { plain = true; delete body.output_config; delete body.thinking; return await call(key, body); }
      throw e;
    }
  }
  function parse(text) {
    let t = (text || '').trim(), mood = 'happy';
    const m = t.match(/^\s*\[([a-z]+)\]\s*/i);
    if (m) { if (MOODS.includes(m[1].toLowerCase())) mood = m[1].toLowerCase(); t = t.slice(m[0].length); }
    t = t.replace(/\*\*?|__|`|#+\s/g, '').replace(/\s*\[[a-z]+\]\s*/gi, ' ').trim();
    return { say: t || 'Hmm.', mood };
  }
  async function aiChat(key, text, ctx) {
    history.push({ role: 'user', content: text });
    history = history.slice(-16);
    while (history.length && history[0].role !== 'user') history.shift();
    const msgs = history.map(h => ({ role: h.role, content: h.content }));
    let finalText = '';
    for (let i = 0; i < 6; i++) {
      const res = await claude(key, msgs, ctx);
      msgs.push({ role: 'assistant', content: res.content });
      const uses = (res.content || []).filter(b => b.type === 'tool_use');
      const said = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
      if (res.stop_reason !== 'tool_use' || !uses.length) { finalText = said; break; }
      const out = [];
      for (const u of uses) out.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(await tool(u.name, u.input || {})).slice(0, 6000) });
      msgs.push({ role: 'user', content: out });
      if (i === 5) finalText = said || '[thinking] That took more steps than I can handle at once. Try asking a simpler way?';
    }
    const r = parse(finalText);
    history.push({ role: 'assistant', content: `[${r.mood}] ${r.say}` });
    return r;
  }

  /* ---------- built-in brain (no key) ---------- */
  async function ruleChat(text, ctx) {
    const t = text.toLowerCase().trim(), s = d.settings.get(), nm = s.userName || 'boss';
    let m;
    if (results.size && (m = t.match(/^(yes|yeah|yep|yup|sure|ok|okay|open it|open that|do it|go|open (the )?(first|top|1st) one|open (number |#)?(\d))\b/))) {
      const n = m[5] ? +m[5] : 1, f = results.get('f' + n);
      if (f) { const err = await d.open(f.path, 'open'); return err ? { say: `Hmm, Windows wouldn't open "${f.name}".`, mood: 'concerned' } : { say: `Opening "${f.name}". Let's work.`, mood: 'excited' }; }
    }
    if (/^(show|show me)( it)? in (the )?folder|^show it$/.test(t) && results.size) { const f = results.get('f1'); await d.open(f.path, 'show'); return { say: 'There it is, in its natural habitat.', mood: 'smug' }; }
    if (/\b(find|search|look for|where('?s| is| are| did i (put|save))|locate|show me my|open my)\b/.test(t)) {
      const kind = d.files.guessKind(t);
      const q = t.replace(/^.*?\b(find|search for|search|look for|where('?s| is| are| did i (put|save))|locate|show me my|show me|open my)\b\s*/, '').replace(/\?$/, '');
      const r = await tool('search_files', { query: q, kind, when: t });
      if (r.error === 'permission_denied') return { say: `No problem. I won't look. If you change your mind, switch it on in my Access tab.`, mood: 'chill' };
      if (!r.count) return { say: `I looked in ${r.searched.join(', ')} and found nothing like that. Try other words, or give me another folder in the Access tab.`, mood: 'concerned' };
      return { say: r.count === 1 ? `Found it: "${r.results[0].name}". Want me to open it?` : `I found ${r.count} files. The best match is "${r.results[0].name}" from ${r.results[0].modified}. Want me to open it?`, mood: 'cheeky' };
    }
    if (/(how('?s| is) (my )?(laptop|computer|pc|battery|storage|system|memory)|why is (my )?(laptop|computer|pc) (so )?slow|check (my )?(laptop|computer|pc)|computer status|battery|storage)/.test(t)) {
      const st = await tool('get_computer_status');
      if (st.error) return { say: 'Computer health is switched off in my Access tab, so I can\'t look.', mood: 'chill' };
      const bits = [];
      if (st.battery) bits.push(`battery ${st.battery}`);
      bits.push(`processor ${st.processor}`, `memory ${st.memory}`);
      if (st.storage) bits.push(`${st.storage.free} free on ${st.storage.drive}`);
      const worry = st.problems && st.problems.length ? ' ' + st.problems[0] : ' Everything looks healthy.';
      return { say: `Check-up: ${bits.join(', ')}.${worry}`, mood: st.problems && st.problems.length ? 'concerned' : 'proud' };
    }
    if (/(organi[sz]e|clean ?up|tidy|report|large files|big files|duplicates|storage report|check ?up|declutter)/.test(t)) {
      const r = await tool('computer_report');
      if (r.error) return { say: 'No worries, I won\'t look. The report needs at least one folder in the Access tab.', mood: 'chill' };
      return { say: r.recommendations.length ? `Report's ready. First thing I'd do: ${r.recommendations[0].replace(/\.$/, '').toLowerCase()}.` : 'Report\'s ready. Honestly? Your files are cleaner than my jokes.', mood: r.recommendations.length ? 'thinking' : 'proud' };
    }
    if (/(what did i (do|work on)|where did i stop|what was i doing|last time|continue where)/.test(t)) {
      const r = await tool('recent_activity');
      if (r.error) return { say: 'My memory is switched off, so I genuinely have no idea. Peaceful, honestly.', mood: 'chill' };
      const L = r.lastDay;
      if (L && L.working.length) return { say: `${L.when} you were working on "${L.working[0].title}" in ${L.working[0].app}. Want to keep going?`, mood: 'happy' };
      if (L && L.apps.length) return { say: `${L.when} you spent most of your time in ${L.apps[0].app} (${L.apps[0].time}).`, mood: 'happy' };
      return { say: s.perms.apps ? `I don't remember much yet. Give me a day of watching... I mean, helping.` : `Switch on app access in my Access tab and I'll remember what you worked on.`, mood: 'thinking' };
    }
    return { local: true };
  }

  return {
    results,
    keep,
    async chat(text, ctx = {}) {
      lastCtx = ctx;
      d.memory.noteTalk();
      const key = d.settings.getKey();
      if (!key) return Object.assign({ brain: 'basic' }, await ruleChat(text, ctx));
      try { return Object.assign({ brain: 'ai' }, await aiChat(key, text, ctx)); }
      catch (e) {
        history.pop();
        const st = e.status;
        if (st === 401 || st === 403) return { say: `My brain key isn't working. Check it in the Brain tab, ${d.settings.get().userName || 'boss'}.`, mood: 'concerned', brain: 'error' };
        if (st === 429 || st === 529 || st === 503) return { say: 'My brain is a bit busy right now. Ask me again in a minute.', mood: 'sleepy', brain: 'error' };
        if (st === 400 && /credit|billing|balance/i.test(e.message)) return { say: 'My brain ran out of credits. Top up on the Claude Console and I\'m back.', mood: 'sad', brain: 'error' };
        const basic = await ruleChat(text, ctx);
        if (!basic.local) return Object.assign({ brain: 'basic' }, basic);
        return { say: 'I can\'t reach my brain right now. Is the internet okay?', mood: 'concerned', brain: 'error' };
      }
    },
    /* Dude speaks first: one short line, written for this moment and this person */
    async thought(req, ctx = {}) {
      const key = d.settings.getKey();
      if (!key) return null;
      lastCtx = ctx;
      const nm = d.settings.get().userName || 'the user';
      const extra = `\n\nRight now you speak FIRST, without being asked. ${TRIGGER_TEXT[req.trigger] || TRIGGER_TEXT.random} Topic: ${TOPIC_TEXT[req.topic] || TOPIC_TEXT.random}.${req.data ? ' Details: ' + JSON.stringify(req.data).slice(0, 500) + '.' : ''}
Write ONE short line, at most 25 words, that only you could say to ${nm}, because you know him. Start with one mood tag. Do not greet him and do not ask how he is. No emojis.`;
      try {
        const res = await claude(key, [{ role: 'user', content: '(Say what comes to your mind.)' }], ctx, { system: system(ctx) + extra, noTools: true, max: 160 });
        const text = (res.content || []).filter(b => b.type === 'text').map(b => b.text).join(' ').trim();
        if (!text) return null;
        const r = parse(text);
        return r.say.length > 220 ? null : Object.assign({ brain: 'ai' }, r);
      } catch (e) { return null; }
    },
    async testKey(key) {
      try { await call(key, { model: d.settings.get().model || 'claude-haiku-5-5', max_tokens: 5, messages: [{ role: 'user', content: 'Say hi' }] }); return { ok: true }; }
      catch (e) { return { ok: false, status: e.status || 0, error: e.status === 401 ? 'That key was not accepted.' : e.status === 400 && /credit|billing|balance/i.test(e.message) ? 'The key works, but the account has no credits yet.' : !e.status ? 'Could not reach Claude. Check your internet.' : e.message }; }
    },
    reset() { history = []; }
  };
}

module.exports = { createBrain };
