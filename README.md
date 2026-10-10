# Dude

<img src="app/icon.png" width="120" align="right" alt="Dude's face">

Dude is a desktop companion for Windows. He lives on your screen, walks along the bottom and on top of your open windows, talks, jokes, dances, finds your files, remembers what you worked on, and gets sick when your laptop has problems.

## Get Dude

GitHub builds Dude automatically every time the code changes.

1. Sign in to GitHub, open the [Actions](../../actions/workflows/build-windows.yml) tab, and click the newest green run.
2. Scroll to **Artifacts** and click **Dude-for-Windows** to download the zip.
3. Right-click the zip > **Extract All**. Open the folder and double-click **Dude.exe**.
4. If Windows says "Windows protected your PC", click **More info** > **Run anyway**. Dude is new and not code-signed yet.
5. Open **START HERE.txt** in the same folder for the full guide.

Each download stays available for 90 days. To make a fresh one, open the Actions tab, pick **Build Dude for Windows**, and click **Run workflow**.

## Play with him

- Grab him and throw him. He bounces off the screen edges.
- He walks on your windows. Drag a window while he stands on it.
- Right-click him, or press **Ctrl+Shift+D**, for his control panel.
- Press **Ctrl+Shift+Space** and speak to talk to him with your voice.
- His face sits in the tray near the clock: controls, Studio, jokes, voice, sleep, start with Windows, quit.
- **Ctrl+Shift+Q** quits him instantly.

## He gets to know you

- **Talks first:** when you open an app, in the morning, late at night, when you work too long, and a random thought every 10&#8211;15 minutes. He stays quiet while you focus.
- **Get-to-know-you questions:** what you're building, what you're learning, your dream.
- **Studies your routine** (on your laptop only): when you start, your busiest hour, the apps and sites you live in, late nights, long sessions.
- **Learns your humor:** tap &#128514; or &#128078; on his speech bubble. He does more of what you laugh at and never repeats a killed joke.
- **Daily mission:** every morning he asks for the one thing you'll do today, and checks on it in the evening.
- **English practice:** word of the day, small challenges, better ways to say things.
- **Calms overthinking:** say "I'm overthinking" and he walks you to one small next step.
- **Studio helper for FL Studio:** knows every project, how long you worked on each, which ones are untitled, unfinished (no export) or piled up in versions. "What was I working on?", "find the beat with the log drum", and a real name for every "Untitled" project. Renames only when you click Rename (with undo), never moves or deletes.
- **Teach him yourself, in any language:** "when I say *Amakuru?*, answer *Ni meza!*" in your own recorded voice, plus a move if you like. Kinyarwanda, English, anything.
- **My voice:** read a card for 15 seconds and Dude talks in your voice. Free, runs on your laptop (one-time 160 MB download), your recording never leaves it.
- **Teach tab:** pick his topics and how often he talks, and teach him your own lines.

## What he can do

- **Painted Dude:** his main look is a real painted character, animated from AI video clips (Chill, Talk, Walk, Wave, Sip, Groove, Sleep and a 360° Fit check). Switch to the cartoon look, with a new outfit every day, in the control panel.
- **Acting:** lip-synced talking, hand gestures that match his words, 20+ facial expressions, blinking, head movement, idle fidgets.
- **Rubber-hose body:** a bendy torso and noodle arms and legs. Try the **Noodle groove** dance.
- **A new outfit every day of the week:** hoodie Monday, tracksuit Tuesday, the original green beanie on Wednesday, and more.
- **20 moves:** noodle groove, fit check, moonwalk, backflip, head spin, robot, air guitar, banana slip, freestyle rap, graffiti...
- **AI brain (optional):** add your own Claude API key in the **Brain** tab and he really understands you. Without a key he still chats with simple built-in replies.
- **Finds your files:** "find the beat I made last week" searches only the folders you allowed.
- **Check-up report:** big files, old downloads, possible duplicates, piles of screenshots.
- **Memory:** "what was I working on yesterday?" and "remind me to call Eric in 30 minutes".
- **Knows when to be quiet:** fullscreen, Zoom, Teams, FL Studio, Ableton, or Do Not Disturb.
- **Voice:** pick a voice preset or any Windows voice, then tune pitch and speed.
- **Gets sick for real:** low battery, no internet, processor at 90%+, or a nearly full disk.

## Privacy

Dude asks before he touches anything. Access to your folders, apps and recent files is off until you turn it on in the **Access** tab, and if he needs a folder you haven't allowed, he asks first. He only reads file names, sizes and dates, never what is inside your files, except your FL Studio projects if you allow "Look inside music projects" (tempo, time spent, samples, read-only). He never moves or deletes anything, and renames a project only when you click Rename. His memory stays on your laptop and **Forget everything** wipes it. Your API key is encrypted with Windows' own protection and only goes to Claude.

## Project layout

| Path | What it is |
| --- | --- |
| `web/dude.html` | The whole character: drawing, animation, face, personality, control panel. Also runs in a normal browser as a demo. |
| `app/sprites/` | The painted Dude: one transparent video per move (`chill.webm`, `talk.webm`, `wave.webm`...), 260x500, Dude 420px tall with his feet at y=480. Every clip starts and ends in the same calm pose. A missing clip falls back to Chill, so a new move is just a new file here. |
| `app/main.js` | Windows app: transparent always-on-top window, tray menu, shortcuts, health stats, permissions. |
| `app/brain.js` | The AI brain: talks to Claude and gives it tools (search files, report, reminders, moves). |
| `app/files.js` | File search, the check-up report, and watching for new downloads and exports. |
| `app/memory.js` | What you worked on each day, kept on your laptop. |
| `app/habits.js` | Learns your routine and tells Dude about moments worth reacting to. |
| `app/studio.js`, `app/flp.js` | The studio helper: finds and reads FL Studio projects (read-only), reports, renames with undo. |
| `app/voice.js` | "My voice": copies your voice from a short recording, on your laptop (sherpa-onnx). |
| `ci/voice-smoke.js` | Build check on a real Windows machine that the voice engine loads and talks. |
| `app/settings.js` | Permissions, allowed folders, the encrypted API key. |
| `app/windows.ps1` | Reads where your open windows are so he can stand on them, and which app is in front so he can stay quiet. |
| `app/listen.ps1` | Push-to-talk speech recognition using Windows' built-in recognizer. |
| `build-windows.sh` | Builds `dist/Dude-for-Windows.zip` with Electron. |

Created by Kirenga Jimmy.
