// Dude studies your routine so he can talk like a friend who knows you:
// when your day usually starts, which apps and sites you live in, late nights, long sessions.
// It all stays on this laptop, inside his memory file. "Forget everything" wipes it.
// Routine needs Memory on. Apps and sites also need "Which app you're using" in the Access tab.
const memory = require('./memory');

const APP_CAT = {
  'FL Studio': 'music', 'Ableton Live': 'music', REAPER: 'music', 'Studio One': 'music', Bitwig: 'music', Cubase: 'music', Audacity: 'music', 'Pro Tools': 'music', Audition: 'music',
  'VS Code': 'build', 'Visual Studio': 'build', Cursor: 'build', Terminal: 'build', PowerShell: 'build', 'Command Prompt': 'build', Claude: 'build', ChatGPT: 'build',
  WhatsApp: 'chat', Telegram: 'chat', Discord: 'chat',
  Word: 'docs', Excel: 'docs', PowerPoint: 'docs', OneNote: 'docs', Notepad: 'docs', Outlook: 'docs',
  Photoshop: 'design', Illustrator: 'design', Figma: 'design', CapCut: 'design', Canva: 'design', 'After Effects': 'design', 'Premiere Pro': 'design', 'DaVinci Resolve': 'design', OBS: 'design',
  VLC: 'video', Netflix: 'video', Spotify: 'listen', Zoom: 'call', Teams: 'call', Steam: 'game'
};
const BROWSERS = new Set(['Chrome', 'Edge', 'Firefox', 'Opera', 'Brave']);
const SITES = [
  [/tiktok/i, 'TikTok', 'social'], [/instagram/i, 'Instagram', 'social'], [/facebook/i, 'Facebook', 'social'], [/snapchat/i, 'Snapchat', 'social'], [/twitter|\/ X( -|$)/, 'X', 'social'],
  [/youtube/i, 'YouTube', 'video'], [/netflix/i, 'Netflix', 'video'],
  [/whatsapp/i, 'WhatsApp', 'chat'], [/telegram/i, 'Telegram', 'chat'], [/discord/i, 'Discord', 'chat'],
  [/github/i, 'GitHub', 'build'], [/supabase/i, 'Supabase', 'build'], [/vercel/i, 'Vercel', 'build'], [/\bclaude\b/i, 'Claude', 'build'], [/chatgpt/i, 'ChatGPT', 'build'], [/localhost|127\.0\.0\.1/i, 'your local site', 'build'],
  [/google docs/i, 'Google Docs', 'docs'], [/google sheets/i, 'Google Sheets', 'docs'], [/notion/i, 'Notion', 'docs'], [/gmail/i, 'Gmail', 'docs'], [/linkedin/i, 'LinkedIn', 'docs'],
  [/canva/i, 'Canva', 'design'], [/figma/i, 'Figma', 'design'],
  [/soundcloud/i, 'SoundCloud', 'listen'], [/audiomack/i, 'Audiomack', 'listen'], [/boomplay/i, 'Boomplay', 'listen'], [/spotify/i, 'Spotify', 'listen'], [/apple music/i, 'Apple Music', 'listen']
];

/* which app or website is this, and what kind of thing is it? */
function classify(app, title) {
  if (!app) return null;
  let name = app, cat = APP_CAT[app] || '';
  const t = title || '';
  if (/^applicationframehost$/i.test(app)) { name = t.split(/ [-–—|] /)[0].trim().slice(0, 40); cat = APP_CAT[name] || ''; }
  if ((BROWSERS.has(app) || !cat) && !/google search|bing|duckduckgo/i.test(t)) {
    for (const [rx, n, c] of SITES) if (rx.test(t)) return { name: n, cat: c, site: BROWSERS.has(app) };
  }
  if (!name || name === 'Desktop' || name === 'File Explorer') return null;
  return { name, cat: cat || (BROWSERS.has(app) ? 'browser' : 'other'), site: false };
}

const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const hourOf = ms => { const d = new Date(ms); return d.getHours() + d.getMinutes() / 60; };
function fmtH(h) {
  if (h == null) return '';
  let q = Math.round(h * 4) / 4; if (q >= 24) q -= 24;
  const H = Math.floor(q), M = Math.round((q - H) * 60);
  return String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0');
}
const fmtHours = h => h >= 1 ? (Math.round(h * 10) / 10) + ' h' : Math.round(h * 60) + ' min';

/* what he has learned about your routine so far */
function learned() {
  const days = memory.routineDays(14);
  const todayKey = memory.logicalToday();
  const past = days.filter(d => d.key !== todayKey && d.r.active > 20 * 60 && d.r.first);
  const today = memory.routineToday();
  const out = { days: past.length, insights: [] };
  if (today && today.first) { out.todayStart = hourOf(today.first); out.todayHours = today.active / 3600; }
  if (past.length >= 3) {
    out.usualStart = median(past.map(d => hourOf(d.r.first)).filter(h => h >= 5));
    out.usualEnd = median(past.map(d => { const h = hourOf(d.r.last); return h < 5 ? h + 24 : h; }));
    const tot = {};
    for (const d of past) for (const h in d.r.hours) tot[h] = (tot[h] || 0) + d.r.hours[h];
    const best = Object.entries(tot).sort((a, b) => b[1] - a[1])[0];
    if (best) out.busiestHour = +best[0];
    out.avgHours = past.reduce((s, d) => s + d.r.active, 0) / past.length / 3600;
  }
  const week = days.slice(-7);
  out.lateNights = week.filter(d => [0, 1, 2, 3, 4].reduce((s, h) => s + (d.r.hours[h] || 0), 0) > 10 * 60).length;
  const siteTot = {};
  for (const d of week) for (const s in d.r.sites || {}) siteTot[s] = (siteTot[s] || 0) + d.r.sites[s];
  out.topSites = Object.entries(siteTot).sort((a, b) => b[1] - a[1]).slice(0, 3).filter(x => x[1] > 10 * 60).map(([name, s]) => ({ name, hours: s / 3600 }));
  out.topApps = memory.topApps(7).filter(a => a.hours > 10 / 60);

  const I = out.insights;
  if (out.usualStart != null) I.push(`You usually start around ${fmtH(out.usualStart)}${out.usualEnd != null ? ` and stop around ${fmtH(out.usualEnd)}` : ''}.`);
  if (out.busiestHour != null) I.push(`Your busiest hour is around ${fmtH(out.busiestHour)}.`);
  if (out.avgHours) I.push(`About ${fmtHours(out.avgHours)} a day on this laptop.`);
  if (out.topApps.length) I.push(`Most used this week: ${out.topApps.map(a => `${a.name} (${fmtHours(a.hours)})`).join(', ')}.`);
  if (out.topSites.length) I.push(`Top sites this week: ${out.topSites.map(a => `${a.name} (${fmtHours(a.hours)})`).join(', ')}.`);
  if (out.lateNights) I.push(`Late nights this week: ${out.lateNights}.`);
  if (past.length < 3) I.push(past.length ? `Still studying you. ${3 - past.length} more day${3 - past.length > 1 ? 's' : ''} and I'll know your routine.` : 'Still studying you. Give me a few days to learn your routine.');
  out.fmt = { usualStart: fmtH(out.usualStart), usualEnd: fmtH(out.usualEnd), busiestHour: fmtH(out.busiestHour), todayStart: fmtH(out.todayStart) };
  return out;
}
/* one short line for his AI brain */
function brief() {
  const L = learned(), b = [];
  if (L.usualStart != null) b.push(`usually starts around ${L.fmt.usualStart} and stops around ${L.fmt.usualEnd}`);
  if (L.busiestHour != null) b.push(`busiest hour ${L.fmt.busiestHour}`);
  if (L.avgHours) b.push(`about ${fmtHours(L.avgHours)} a day on the laptop`);
  if (L.topApps.length) b.push('top apps this week: ' + L.topApps.map(a => `${a.name} ${fmtHours(a.hours)}`).join(', '));
  if (L.topSites.length) b.push('top sites: ' + L.topSites.map(a => `${a.name} ${fmtHours(a.hours)}`).join(', '));
  b.push(`late nights this week: ${L.lateNights}`);
  if (L.todayStart != null) b.push(`today he started at ${L.fmt.todayStart} and has been active ${fmtHours(L.todayHours)}`);
  if (L.days < 3) b.push(`(only ${L.days} full days of data so far)`);
  return b.join('; ');
}

/* called every 5 seconds by the app. Sends "moments" Dude can react to. */
function createHabits(emit) {
  const st = { started: Date.now(), lastInput: 0, sessionStart: 0, longNext: 90, cur: '', seen: {}, binge: null, ping: 0 };
  function tick({ idle, app, title, appsOn, memoryOn }) {
    const now = Date.now(), li = now - idle * 1000, out = [];
    if (idle < 60) {
      const gap = st.lastInput ? li - st.lastInput : 0;
      if (gap >= 15 * 60e3 && now - st.started > 60e3) out.push({ kind: 'back', away: Math.round(gap / 60e3) });
      if (!st.sessionStart || gap >= 5 * 60e3) { st.sessionStart = li; st.longNext = 90; }
      st.lastInput = li;
      if (now - st.ping > 20e3) { st.ping = now; emit({ type: 'active' }); }
    }
    const active = idle < 120;
    if (active && st.sessionStart) {
      const mins = (now - st.sessionStart) / 60e3;
      if (mins >= st.longNext) { out.push({ kind: 'long', mins: Math.round(mins) }); st.longNext += 60; }
    }
    if (active && memoryOn) memory.trackPresence(5);
    if (appsOn && active && app) {
      const c = classify(app, title);
      if (c) {
        if (memoryOn && c.site) memory.trackSite(c.name, 5);
        if (c.name !== st.cur) {
          const seen = st.seen[c.name] || 0;
          st.cur = c.name;
          if (now - seen > 20 * 60e3 && now - st.started > 30e3) out.push({ kind: 'app', app: c.name, cat: c.cat });
        }
        st.seen[c.name] = now;
        if (c.cat === 'social' || c.cat === 'video') {
          if (!st.binge || st.binge.name !== c.name || now - st.binge.last > 2 * 60e3) st.binge = { name: c.name, cat: c.cat, since: now, next: 25 };
          st.binge.last = now;
          const m = (now - st.binge.since) / 60e3;
          if (m >= st.binge.next) { out.push({ kind: 'binge', app: c.name, cat: c.cat, mins: Math.round(m) }); st.binge.next += 25; }
        }
      }
    }
    if (memoryOn && active) {
      const t = memory.routineToday();
      if (t && !t.pattern && t.active >= 2 * 3600) { const L = learned(); if (L.days >= 3) { memory.markPattern(); out.push({ kind: 'pattern', learned: L }); } }
    }
    for (const m of out) emit(Object.assign({ type: 'moment' }, m));
  }
  return { tick };
}

module.exports = { createHabits, learned, brief, classify, fmtH };
